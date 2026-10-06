/**
 * 用**真实 node:sqlite** 实现的 D1 适配器（仅测试用，不参与 Worker 打包）。
 *
 * ## 为什么不用假实现
 *
 * Worker 侧要验证的两条不变量都是**数据库层的原子性**：
 *   1. revision 分配与记录写入同 transaction
 *   2. tag 规范化名的部分唯一索引会真的拒绝并发重复
 *
 * 假 D1 很容易"恰好掩盖"这两点（第二轮审查已经吃过一次亏）。
 * D1 基于 SQLite，所以这里直接把 `node:sqlite` 包装成 PushDatabase 形状，
 * 让 `executePush()` 原封不动地跑在真库上。
 *
 * ## 语义对齐（这几条必须与 Cloudflare D1 一致，否则测试就是假的）
 *
 * - `bind()` 返回**新**对象（不可变），原对象不带参数
 * - `?N` 是**编号参数**：第 n 个 bind 值交给 `?n`，不是按出现顺序。
 *   这正是本轮 bug 的核心 —— bind 顺序错了 SQL 不会报错，只会在运行期炸。
 * - `batch()` 是**一个 SQL transaction**：BEGIN → 顺序执行 → COMMIT；
 *   任一语句失败则**整批 ROLLBACK** 并抛错
 * - 参数个数与SQL 声明的 `?N` 最大编号不符时**抛错**，不做静默补位
 */

import { DatabaseSync } from 'node:sqlite'
import type { PushDatabase, PushStatement } from './pushPipeline'

/** 与 worker/migrations/0001_init.sql 等价的 schema（同步侧三张表） */
export const TEST_SCHEMA = `
CREATE TABLE sync_records (
  revision          INTEGER PRIMARY KEY,
  entity            TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  payload           TEXT NOT NULL,
  deleted_at        TEXT,
  client_updated_at TEXT NOT NULL,
  device_id         TEXT NOT NULL,
  UNIQUE (entity, entity_id)
);
CREATE TABLE sync_revision_seq (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL
);
INSERT INTO sync_revision_seq (id, revision) VALUES (1, 0);
CREATE TABLE sync_auth (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  key_id      TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sync_tag_normalized
  ON sync_records (json_extract(payload, '$.nameNormalized'))
  WHERE entity = 'tag' AND deleted_at IS NULL;
`

/** 内部表示：一条已绑定参数的语句 */
interface Bound {
  sql: string
  values: readonly unknown[]
}

export interface SqliteD1Options {
  /**
   * 每次 `batch()` **开始之前**触发（序号从 1 开始）。
   * 用来制造"另一台设备在同一瞬间提交了同名 tag"的竞态。
   */
  onBeforeBatch?: (index: number) => void
  /**
   * 第 n 次（1 起）tag 预加载查询返回**空**，模拟 D1 读副本的最终一致性：
   * 对手设备已经提交的行，本机这次预加载却读不到。
   *
   * 这不是人造场景 —— D1 的读取确实可能落到稍滞后的副本，
   * 所以"重试也可能再次踩空"必须由代码显式兜住（最多一次，然后放弃）。
   */
  staleTagKeyReads?: ReadonlySet<number>
}

export interface SqliteD1 {
  /** 交给 executePush 的数据库句柄 */
  db: PushDatabase
  /** 底层真库，测试用它直接查最终行内容 */
  raw: DatabaseSync
  /** 执行过的 SQL 文本（用于核对 queries/invocation 预算） */
  readonly queryLog: readonly string[]
  /**
   * 每一次 `bind()` 的实际取值，按调用顺序记录。
   * ⭐ 这是本轮 bug 的关键抓手：装配层到底按什么顺序把值交给了 SQL。
   * 只断言 SQL 字符串是抓不到这类错位 bug 的。
   */
  readonly bindLog: ReadonlyArray<{ sql: string; values: readonly unknown[] }>
}

/** 造一个跑在真库上的 PushDatabase */
export function createSqliteD1(options: SqliteD1Options = {}): SqliteD1 {
  const raw = new DatabaseSync(':memory:')
  raw.exec(TEST_SCHEMA)
  const queryLog: string[] = []
  const bindLog: Array<{ sql: string; values: readonly unknown[] }> = []
  const bound = new WeakMap<object, Bound>()
  let batchIndex = 0
  let tagKeyReadIndex = 0

  const wrap = (sql: string, values: readonly unknown[]): PushStatement => {
    /**
     * 与真实 D1 一致：bind 个数必须等于 SQL 的参数个数。
     * 在**执行时**校验而不是 bind 时 —— 真实 D1 允许 `prepare()` 后暂不 bind，
     * 且它是等到执行才报参数不匹配。
     */
    const assertBound = (): void => {
      const expected = maxParamIndex(sql)
      if (values.length !== expected) {
        throw new Error(`bind count mismatch: got ${values.length}, expected ${expected} (${sql.slice(0, 48)}…)`)
      }
    }
    const self = {
      bind: (...next: unknown[]): PushStatement => {
        bindLog.push({ sql, values: next })
        return wrap(sql, next)
      },
      run: async <T,>(): Promise<D1Result<T>> => {
        assertBound()
        queryLog.push(sql)
        const r = raw.prepare(sql).run(...values)
        return { success: true, results: [], meta: { changes: Number(r.changes) } }
      },
      first: async <T,>(): Promise<T | null> => {
        assertBound()
        queryLog.push(sql)
        const row = raw.prepare(sql).get(...values)
        return (row ?? null) as T | null
      },
      all: async <T,>(): Promise<D1Result<T>> => {
        assertBound()
        queryLog.push(sql)
        // 模拟读副本滞后：指定的第 N 次 tag 预加载读不到对手已提交的行
        if (sql.includes("FROM sync_records WHERE entity = 'tag'")) {
          tagKeyReadIndex += 1
          if (options.staleTagKeyReads?.has(tagKeyReadIndex)) return { success: true, results: [] }
        }
        const rows = raw.prepare(sql).all(...values)
        return { success: true, results: rows as T[] }
      },
    }
    bound.set(self as unknown as object, { sql, values })
    return self as unknown as PushStatement
  }

  const db: PushDatabase = {
    prepare: (sql: string): PushStatement => wrap(sql, []),
    batch: async (statements: PushStatement[]): Promise<D1Result[]> => {
      batchIndex += 1
      //竞态注入点：必须在 BEGIN 之前，让"对手提交"先落库
      options.onBeforeBatch?.(batchIndex)
      queryLog.push('BATCH')
      // ⭐ 与 D1 一致：batch 是**一个** transaction，任一失败整批回滚。
      //   注意原始 SQLite 语义下约束失败**不会**自动回滚，必须显式 ROLLBACK。
      raw.exec('BEGIN')
      try {
        const out: D1Result[] = []
        for (const s of statements) {
          const b = bound.get(s as unknown as object)
          if (b === undefined) throw new Error('statement not created by createSqliteD1')
          const expected = maxParamIndex(b.sql)
          if (b.values.length !== expected) {
            throw new Error(`bind count mismatch in batch: got ${b.values.length}, expected ${expected}`)
          }
          const r = raw.prepare(b.sql).run(...b.values)
          out.push({ success: true, results: [], meta: { changes: Number(r.changes) } })
        }
        raw.exec('COMMIT')
        return out
      } catch (e) {
        try {
          raw.exec('ROLLBACK')
        } catch {
          // 无活动事务时忽略（真实 D1 自行处理回滚）
        }
        throw e
      }
    },
  }

  return { db, raw, queryLog, bindLog }
}

/**
 * 统计 SQL 期望的 bind 个数。
 *
 * SQLite 有两种占位符：
 *   - 匿名 `?`        → 按出现顺序编号 1..N（N = 出现次数）
 *   - 显式编号 `?N`   → N 就是它的参数下标（本项目的 UPSERT_SQL 用这种）
 *
 * 两者混用时以"参数下标的最大值"为准。preloadSql 用匿名 `?`，
 * UPSERT_SQL 用 `?1..?8`，两者都要能校验。
 */
function maxParamIndex(sql: string): number {
  let max = 0
  for (const m of sql.matchAll(/\?(\d+)/g)) {
    const n = Number(m[1])
    if (n > max) max = n
  }
  // 匿名 `?`（后面不跟数字）各自占一个下标
  const anonymous = sql.match(/\?(?!\d)/g)?.length ?? 0
  return Math.max(max, anonymous)
}