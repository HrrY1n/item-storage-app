/**
 * Worker 侧的 D1 语句（纯 SQL 字符串 + 可单测的辅助函数）。
 *
 * ⭐ 本文件存在的核心理由：**把"revision 分配"与"记录写入"放进同一个事务**，
 * 并让 tombstone 保护落在**最终执行的 SQL** 上，而不是只靠写前的 preload 判断。
 * 这两点是 Phase 3B 最终审查（第 1、2 条）指出的问题。
 *
 * ## 为什么不能"先分配 revision，再另一个事务写记录"
 *
 * 那样会出现：
 *   A 取到 revision=1 → A 被挂起
 *   B 取到 revision=2 → B 先提交 → 客户端 pull 到 2 并把 cursor 推到 2
 *   A 恢复后提交 revision=1 → **永久位于 cursor 之后，客户端再也不会拉到它**
 *
 * 即使两个区间**不重叠**，提交顺序与 revision 顺序不一致仍会产生漏同步。
 *
 * ## 解法
 *
 * 把 `UPDATE sync_revision_seq SET revision = revision + N`（推进 N）
 * 与本批 N 条 upsert 放进**同一个 `db.batch()`** —— Cloudflare 官方文档明确说明
 * batch 是 SQL transaction：语句顺序执行，任一失败整批回滚。
 *
 * 每条 upsert 的 revision 值**在 SQL 内部计算**：
 *   revision = (SELECT revision FROM sync_revision_seq) + 1 + offset
 * 因为 bump 放在批的**最后**，每条 upsert 执行时计数器里存的仍是
 * 「上一批已提交的最大 revision」= 本批基线；`offset` 是批内序号（0,1,2…），
 * 纯客户端算，不依赖任何读取。
 *
 * → **提交顺序与 revision 可见顺序必然一致**，不存在悬空区间。
 *
 * ⚠️ 顺序是 `[...upserts, bump]`，**只有这一个正确顺序**。
 *   若把 bump 放在最前面，计数器会先跳到 基线+N，
 *   再加上 `+1+offset` 就会整体偏移 N+1 —— 这正是第一版修复踩到的坑。
 *   任何"逐条重试"的写法也一律禁止：那会让成功的 upsert 与计数器推进
 *   分属不同 transaction，重新引入悬空区间。见 pushPipeline.ts 的单一重试路径。
 */

// 平台限制数值统一在 limitsContract（单一定义源）
export { MAX_PULL, MAX_PUSH, PRELOAD_CHUNK } from './limitsContract'

import type { PushChange } from './syncLogic'

/**
 * 推进全局 revision 计数器。
 *
 * ⚠️ **必须放在批的最后一条**（顺序：`[...upserts, bump]`，见文件顶部推导）。
 */
export const BUMP_REVISION_SQL =
  'UPDATE sync_revision_seq SET revision = revision + ?1 WHERE id = 1'

/**
 * 单条 upsert（批内 offset 递增，revision 因此连续）。
 *
 * 绑定参数（用 SQLite 的 **?N 编号形式**，编号互不干扰）：
 *   ?1 offsetInBatch · ?2 entity · ?3 entityId · ?4 payload
 *   ?5 deletedAt · ?6 clientUpdatedAt · ?7 deviceId · ?8 undeleteIntent(0/1)
 *
 * ⚠️ **编号不能从 ?1 开始**：`?1` 已经用在 revision 公式里。
 *   若把 entity 写成 ?1，就会有两个 `?1` → 后者覆盖前者，参数整体错位
 *   （实测表现为 `payload` 收到 NULL，触发 NOT NULL 约束错误）。
 *   用递增的独立编号可以彻底避免这种歧义。
 *
 * ⭐ `ON CONFLICT ... DO UPDATE ... WHERE` 就是 **tombstone 的最终防线**：
 * 只在「现有记录未删除」或「本次也是删除」或「显式恢复」时才覆盖。
 * stale upsert（拿着 preload 时的旧快照）**无法**把 tombstone 清掉——
 * 该不变量由真正执行写入的 SQL 保证，不依赖 preload 是否及时。
 */
export const UPSERT_SQL = `
INSERT INTO sync_records
  (revision, entity, entity_id, payload, deleted_at, client_updated_at, device_id)
VALUES (
  (SELECT revision FROM sync_revision_seq) + 1 + ?1,
  ?2, ?3, ?4, ?5, ?6, ?7
)
ON CONFLICT(entity, entity_id) DO UPDATE SET
  revision = excluded.revision,
  payload = excluded.payload,
  deleted_at = excluded.deleted_at,
  client_updated_at = excluded.client_updated_at,
  device_id = excluded.device_id
WHERE sync_records.deleted_at IS NULL
   OR excluded.deleted_at IS NOT NULL
   OR ?8 = 1
`.trim()

/** 读取当前 revision 末值（仅用于响应里的 currentRevision 提示，不参与分配） */
export const CURRENT_REVISION_SQL = 'SELECT revision FROM sync_revision_seq WHERE id = 1'

/**
 * ⭐ UPSERT_SQL 的绑定值 —— **唯一**的装配入口。
 *
 * 返回数组的顺序**必须**与 UPSERT_SQL 里 `?1..?8` 的定义严格一致：
 *   ?1 offsetInBatch · ?2 entity · ?3 entityId · ?4 payload
 *   ?5 deletedAt · ?6 clientUpdatedAt · ?7 deviceId · ?8 undeleteIntent(0/1)
 *
 * ## 为什么必须抽成helper
 *
 * `?N` 是 SQLite 的**编号参数**，不是位置参数 —— `stmt.bind(v1,…,v8)`
 * 按下标把值交给 `?1..?8`。一旦调用方手写 bind 时顺序写错（比如漏了 offset、
 * 把它放到最后），SQL 本身毫无察觉，错误只在**运行时**以
 * `payload NOT NULL` 之类的间接症状爆出来，极难定位。
 *
 * 本项目已经真实踩过一次：worker/index.ts 的 bind 顺序是
 * `entity, entityId, payload, …, offset`，而 SQL 期望 `offset` 在 `?1`，
 * 于是 payload 收到 null —— 那次真实 Worker push 会直接失败。
 *
 * → 现在 Worker 装配层与所有测试**共用这一个函数**，顺序只有一处定义。
 *   workerPushAssembly.test.ts 里有针对`?1..?8` 逐位的回归断言。
 */
export function buildUpsertBindValues(
  change: Pick<PushChange, 'entity' | 'entityId' | 'payload' | 'deletedAt' | 'clientUpdatedAt' | 'undeleteIntent'>,
  deviceId: string,
  offsetInBatch: number,
): unknown[] {
  return [
    offsetInBatch, // ?1
    String(change.entity), // ?2
    String(change.entityId), // ?3
    JSON.stringify(change.payload ?? {}), // ?4 —— 必须是 JSON 字符串，绝不能是 null
    change.deletedAt ?? null, // ?5
    change.clientUpdatedAt, // ?6
    deviceId, // ?7
    change.undeleteIntent === true ? 1 : 0, // ?8
  ]
}

/** 读取认证记录（id 固定为 1 —— schema 用 CHECK(id=1) 表达单空间） */
export const SELECT_AUTH_SQL = 'SELECT key_id, secret_hash FROM sync_auth WHERE id = 1'

export const HAS_ANY_AUTH_SQL = 'SELECT id FROM sync_auth LIMIT 1'

export const INSERT_AUTH_SQL =
  'INSERT INTO sync_auth (id, key_id, secret_hash, created_at) VALUES (1, ?1, ?2, ?3)'

/** pull：恒为「主键有序 + WHERE revision > ?」，禁止 SELECT * */
export const PULL_SQL = `
SELECT revision, entity, entity_id, payload, deleted_at, client_updated_at, device_id
FROM sync_records
WHERE revision > ?1
ORDER BY revision
LIMIT ?2
`.trim()

export const COUNT_RECORDS_SQL = 'SELECT COUNT(*) AS n FROM sync_records'

/** tag nameNormalized 预加载（扫描 entity='tag'，规模远小于 items） */
export const PULL_TAG_KEYS_SQL =
  "SELECT entity_id, payload FROM sync_records WHERE entity = 'tag' AND deleted_at IS NULL"

/**
 * 预加载本批涉及的现有记录。**必须按 id 分片**以避开 100 绑定参数上限。
 */
export function preloadSql(entityCount: number, idCount: number): string {
  const entities = new Array(entityCount).fill('?').join(',')
  const ids = new Array(idCount).fill('?').join(',')
  return `
SELECT entity, entity_id, revision, deleted_at, client_updated_at, device_id, payload
FROM sync_records
WHERE entity IN (${entities})
  AND entity_id IN (${ids})
`.trim()
}

/** 从 payload JSON 里取 nameNormalized（仅 tag 用；坏 JSON 返回 null） */
export function readNameNormalizedOf(payload: string): string | null {
  try {
    const p = JSON.parse(payload) as unknown
    if (typeof p !== 'object' || p === null) return null
    const v = (p as Record<string, unknown>).nameNormalized
    return typeof v === 'string' && v !== '' ? v : null
  } catch {
    return null
  }
}