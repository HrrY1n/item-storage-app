import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { BUMP_REVISION_SQL, UPSERT_SQL, buildUpsertBindValues, preloadSql, readNameNormalizedOf } from './syncSql'
import { MAX_PUSH, PRELOAD_CHUNK } from './limitsContract'
import type { SyncEntity } from './syncLogic'

/**
 * Worker 侧 SQL 的行为测试 —— 用**真实的 SQLite** 执行，而不是手写的假 D1。
 *
 * 理由：本文件验证的两条不变量都是"数据库层的原子性"。
 * 假实现可能恰好掩盖竞态（第二轮审查里已经吃过一次亏）；
 * D1 基于 SQLite，真库跑才有说服力。
 *
 * 覆盖 Phase 3B 最终审查第 1、2 条：
 *   1. revision 分配与写入同事务 → 提交顺序与 revision 可见顺序一致
 *   2. tombstone 保护落到最终执行的 SQL 上
 */

const SCHEMA = `
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
CREATE TABLE sync_revision_seq (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
INSERT INTO sync_revision_seq (id, revision) VALUES (1, 0);
CREATE UNIQUE INDEX idx_sync_tag_normalized
  ON sync_records (json_extract(payload, '$.nameNormalized'))
  WHERE entity = 'tag' AND deleted_at IS NULL;
`

function newDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  return db
}

interface PushRow {
  entity: SyncEntity
  entityId: string
  payload: string
  deletedAt: string | null
  clientUpdatedAt: string
  deviceId: string
  undelete: 0 | 1
}

/**
 * 模拟 Worker 的一次 push：**一个事务**里先逐条 upsert、最后推进计数器。
 * 与 pushPipeline.ts 的 `db.batch([...upserts, bump])` 完全对应。
 *
 * ⭐ 绑定值一律经由 `buildUpsertBindValues()` 生成 —— 与真实装配层**同一个函数**。
 *   以前这里手写了一遍 bind 顺序，于是"SQL 改了、测试的 bind 顺序没跟着改"
 *   这类漂移无法被发现。现在两处共用一个定义。
 *
 *   （`?N` 是 SQLite 的**编号参数**语义，不是位置顺序；
 *     顺序必须与 UPSERT_SQL 顶部注释里的 ?1..?8 定义严格一致。）
 */
function push(db: DatabaseSync, rows: PushRow[]): void {
  db.exec('BEGIN')
  try {
    // ⚠️ 与 pushPipeline 一致：先 upsert，最后才推进计数器
    rows.forEach((r, offset) => {
      db.prepare(UPSERT_SQL).run(
        ...buildUpsertBindValues(
          {
            entity: r.entity,
            entityId: r.entityId,
            // PushRow.payload 已是 JSON 文本，解析后交给 helper 重新序列化
            payload: JSON.parse(r.payload) as unknown,
            deletedAt: r.deletedAt,
            clientUpdatedAt: r.clientUpdatedAt,
            undeleteIntent: r.undelete === 1,
          },
          r.deviceId,
          offset,
        ),
      )
    })
    db.prepare(BUMP_REVISION_SQL).run(rows.length)
    db.exec("COMMIT")
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 无活动事务时忽略
    }
    throw e
  }
}

const row = (entity: SyncEntity, deletedAt: string | null, deviceId = 'D', undelete: 0 | 1 = 0): PushRow => ({
  entity,
  entityId: 'x',
  payload: '{}',
  deletedAt,
  clientUpdatedAt: '2026-01-01T00:00:00.000Z',
  deviceId,
  undelete,
})

describe('revision 分配与写入的原子性（最终审查第 1 条）', () => {
  it('★ A 先取得较小 revision、B 后取得较大 revision → 提交顺序与 revision 顺序一致', () => {
    const db = newDb()

    push(db, [
      { ...row('item', null, 'devA'), entityId: 'from-A', payload: '{"n":"A"}' },
    ])
    push(db, [
      { ...row('item', null, 'devB'), entityId: 'from-B', payload: '{"n":"B"}' },
    ])

    const rows = db
      .prepare('SELECT entity_id, revision FROM sync_records ORDER BY revision')
      .all() as Array<{ entity_id: string; revision: number }>

    // ⭐ 旧实现（先分配 revision、再用另一个事务写记录）无法保证这个性质：
    //    A 可能拿到小 revision 却后提交，落在客户端 cursor 后方而永久漏同步。
    expect(rows.map((r) => r.entity_id)).toEqual(['from-A', 'from-B'])
    expect(rows.map((r) => r.revision)).toEqual([1, 2])
  })

  it('★ 任意 cursor 推进都不漏掉已提交记录', () => {
    const db = newDb()
    for (const id of ['i1', 'i2', 'i3']) {
      push(db, [{ ...row('item', null), entityId: id }])
    }
    // 模拟客户端分页 pull
    const after1 = db
      .prepare('SELECT entity_id FROM sync_records WHERE revision > ? ORDER BY revision')
      .all(1) as Array<{ entity_id: string }>
    expect(after1.map((r) => r.entity_id)).toEqual(['i2', 'i3'])
    const after2 = db
      .prepare('SELECT entity_id FROM sync_records WHERE revision > ? ORDER BY revision')
      .all(2) as Array<{ entity_id: string }>
    expect(after2.map((r) => r.entity_id)).toEqual(['i3'])
    const after3 = db
      .prepare('SELECT entity_id FROM sync_records WHERE revision > ? ORDER BY revision')
      .all(3)
    expect(after3).toHaveLength(0)
  })

  it('批量内 revision 连续（offset 机制生效）', () => {
    const db = newDb()
    push(db, [
      { ...row('item', null), entityId: 'a' },
      { ...row('item', null), entityId: 'b' },
      { ...row('item', null), entityId: 'c' },
    ])
    const revs = (db.prepare('SELECT revision FROM sync_records ORDER BY revision').all() as Array<{ revision: number }>).map(
      (r) => r.revision,
    )
    expect(revs).toEqual([1, 2, 3])
  })

  it('同一实体的连续更新拿到递增 revision（不是原地不动）', () => {
    const db = newDb()
    push(db, [{ ...row('item', null), payload: '{"v":1}' }])
    push(db, [{ ...row('item', null), payload: '{"v":2}' }])
    const r = db.prepare('SELECT revision, payload FROM sync_records WHERE entity_id=?').get('x') as
      | { revision: number; payload: string }
      | undefined
    expect(r?.payload).toBe('{"v":2}')
    expect(r?.revision).toBe(2)
  })

  it('★ 事务中途失败整批回滚：计数器不推进（无悬空 revision）', () => {
    const db = newDb()
    // ⚠️ 原始 SQLite 语义：约束失败**不会**自动回滚事务，必须显式 ROLLBACK。
    //   D1 的 db.batch() 正是替我们做了这件事 —— 它是一个真正的 SQL transaction，
    //   任一语句失败则整批回滚。这条测试就是在验证那个语义。
    db.exec('BEGIN')
    let failed = false
    try {
      db.prepare(UPSERT_SQL).run(0, 'item', 'ok-1', '{}', null, 't', 'D', 0)
      db.prepare(UPSERT_SQL).run(1, 'item', 'bad', null, null, 't', 'D', 0)
      db.prepare(BUMP_REVISION_SQL).run(2)
      db.exec('COMMIT')
    } catch {
      failed = true
      db.exec('ROLLBACK')
    }
    expect(failed).toBe(true)

    // ⭐ 关键：连第一条 ok-1 也必须消失，计数器保持 0
    const seq = db.prepare('SELECT revision FROM sync_revision_seq WHERE id=1').get() as { revision: number }
    expect(seq.revision).toBe(0)
    expect((db.prepare('SELECT COUNT(*) AS n FROM sync_records').get() as { n: number }).n).toBe(0)
  })
})

describe('tombstone 保护落在最终 SQL（最终审查第 2 条）', () => {
  it('★ preload 到 active → A 写 tombstone → B stale upsert → 仍 tombstoned', () => {
    const db = newDb()

    push(db, [{ ...row('item', null, 'devA'), entityId: 'i1', payload: '{"n":"A"}' }])

    // B 此刻 preload 到 active 记录（这就是"提前 decide 为 accept"的快照）
    const snapshot = db.prepare(preloadSql(1, 1)).all('item', 'i1') as Array<{
      entity_id: string
      deleted_at: string | null
    }>
    expect(snapshot[0]!.deleted_at).toBeNull()

    // A 写 tombstone
    push(db, [
      {
        ...row('item', '2026-03-01T00:00:00.000Z', 'devA'),
        entityId: 'i1',
        payload: '{}',
      },
    ])

    // B 拿着过期快照执行 upsert（deleted_at=NULL，无 undelete）
    push(db, [{ ...row('item', null, 'devB'), entityId: 'i1', payload: '{"n":"B-STALE"}' }])

    const final = db.prepare('SELECT deleted_at, payload, device_id FROM sync_records WHERE entity_id=?').get('i1') as
      | { deleted_at: string | null; payload: string; device_id: string }
      | undefined
    expect(final?.deleted_at).toBe('2026-03-01T00:00:00.000Z')
    expect(final?.payload).not.toContain('B-STALE')
    expect(final?.device_id).toBe('devA')
  })

  it('显式 undeleteIntent 可以复活', () => {
    const db = newDb()
    push(db, [{ ...row('item', '2026-01-01T00:00:00.000Z'), payload: '{}' }])
    push(db, [{ ...row('item', null, 'devB', 1), payload: '{"v":"restored"}' }])
    const r = db.prepare('SELECT deleted_at, payload FROM sync_records WHERE entity_id=?').get('x') as
      | { deleted_at: string | null; payload: string }
      | undefined
    expect(r?.deleted_at).toBeNull()
    expect(r?.payload).toContain('restored')
  })

  it('重复写 tombstone 允许（状态保持一致）', () => {
    const db = newDb()
    push(db, [{ ...row('item', 'T1'), payload: '{}' }])
    push(db, [{ ...row('item', 'T2'), payload: '{}' }])
    const r = db.prepare('SELECT deleted_at FROM sync_records WHERE entity_id=?').get('x') as { deleted_at: string }
    expect(r.deleted_at).toBe('T2')
  })
})

describe('SQL 与限制的静态核对', () => {
  it('UPSERT_SQL 带 tombstone 守卫子句', () => {
    expect(UPSERT_SQL).toContain('WHERE sync_records.deleted_at IS NULL')
    expect(UPSERT_SQL).toContain('OR excluded.deleted_at IS NOT NULL')
    expect(UPSERT_SQL).toContain('OR ?8 = 1')
  })

  it('revision 在 SQL 内部读取计数器（客户端不传绝对值）', () => {
    expect(UPSERT_SQL).toContain('(SELECT revision FROM sync_revision_seq) + 1 + ?')
  })

  it('UPSERT_SQL 不含 SELECT *（避免全表扫描烧rows read）', () => {
    expect(UPSERT_SQL).not.toMatch(/SELECT\s+[*]/)
  })

  it('预加载 SQL 的占位符数 = 实体种类 + id 数，且 ≤ 100', () => {
    const sql = preloadSql(3, 90)
    expect((sql.match(/\?/g) ?? []).length).toBe(93)
    expect((sql.match(/\?/g) ?? []).length).toBeLessThanOrEqual(100)
  })

  it('单次 push 的查询总数 ≤ Free 的 50 queries/invocation', () => {
    const preloadChunks = Math.ceil((MAX_PUSH * 2) / PRELOAD_CHUNK)
    // 1(查auth) + 分片预加载 + 1(tag keys) + 1(bump) + N upsert
    expect(1 + preloadChunks + 1 + 1 + MAX_PUSH).toBeLessThanOrEqual(50)
  })
})

describe('占位符形式（踩过的坑）', () => {
  it('UPSERT_SQL 用递增编号 ?1..?8，且每个编号只出现一次', () => {
    // 编号重复会导致参数整体错位（实测：payload 收到 NULL → NOT NULL 失败）
    for (let n = 1; n <= 8; n += 1) {
      const count = UPSERT_SQL.split(`?${n}`).length - 1
      expect(count, `?${n} 出现 ${count} 次`).toBe(1)
    }
  })

  it('revision 公式用 ?1（offset）', () => {
    expect(UPSERT_SQL).toContain('(SELECT revision FROM sync_revision_seq) + 1 + ?1')
  })

  it('tombstone 守卫用 ?8（undeleteIntent）', () => {
    expect(UPSERT_SQL).toContain('OR ?8 = 1')
  })

  it('BUMP 用 ?1', () => {
    expect(BUMP_REVISION_SQL).toContain('?1')
  })
})

describe('readNameNormalizedOf', () => {
  it('取出规范化名', () => {
    expect(readNameNormalizedOf('{"nameNormalized":"apple"}')).toBe('apple')
  })

  it('坏 JSON / 缺失 → null', () => {
    expect(readNameNormalizedOf('not json')).toBeNull()
    expect(readNameNormalizedOf('{}')).toBeNull()
    expect(readNameNormalizedOf('null')).toBeNull()
    expect(readNameNormalizedOf('{"nameNormalized":""}')).toBeNull()
  })
})

describe('tag 规范化名的数据库级唯一性（最终审查第 6 条）', () => {
  const tagRow = (revision: number, entityId: string, normalized: string) =>
    [
      revision,
      'tag',
      entityId,
      JSON.stringify({ name: normalized, nameNormalized: normalized }),
      null,
      '2026-01-01T00:00:00.000Z',
      'dev',
      0,
    ] as const

  it('★ 拒绝并发写入的同名 tag（数据库层保证，不靠应用层判断）', () => {
    const db = newDb()!
    db.prepare(UPSERT_SQL).run(...tagRow(1, 'tag-A', 'apple'))
    expect(() => {
      db.prepare(UPSERT_SQL).run(...tagRow(2, 'tag-B', 'apple'))
    }).toThrow()
  })

  it('不同nameNormalized 可共存', () => {
    const db = newDb()!
    db.prepare(UPSERT_SQL).run(...tagRow(1, 'tag-A', 'apple'))
    db.prepare(UPSERT_SQL).run(...tagRow(2, 'tag-B', 'banana'))
    expect((db.prepare('SELECT COUNT(*) AS n FROM sync_records').get() as { n: number }).n).toBe(2)
  })

  it('★ 非 tag 行不参与该唯一性（item 的 nameNormalized 字段不产生冲突）', () => {
    const db = newDb()!
    // 用真实的两批 push：偏移量递增，避免 revision 撞车
    push(db, [
      { entity: 'tag', entityId: 't1', payload: '{"nameNormalized":"apple"}', deletedAt: null, clientUpdatedAt: 't', deviceId: 'A', undelete: 0 },
    ])
    // item 载荷里也带 nameNormalized —— 不应受影响（部分索引限定 entity='tag'）
    push(db, [
      { entity: 'item', entityId: 'i1', payload: '{"nameNormalized":"apple"}', deletedAt: null, clientUpdatedAt: 't', deviceId: 'A', undelete: 0 },
    ])
    expect((db.prepare('SELECT COUNT(*) AS n FROM sync_records').get() as { n: number }).n).toBe(2)
  })

  it('★ 已删除的 tag 释放名字（删掉 #Apple 后可重新创建）', () => {
    const db = newDb()!
    db.prepare(UPSERT_SQL).run(...tagRow(1, 'tag-A', 'apple'))
    // A 删掉它
    db.prepare(UPSERT_SQL).run(0, 'tag', 'tag-A', '{}', '2026-03-01T00:00:00.000Z', 't', 'A', 0)
    // 另一台设备现在可以用同一个名字
    db.prepare(UPSERT_SQL).run(...tagRow(2, 'tag-B', 'apple'))
    const rows = db
      .prepare("SELECT entity_id, deleted_at FROM sync_records WHERE entity='tag' ORDER BY revision")
      .all() as Array<{ entity_id: string; deleted_at: string | null }>
    expect(rows[0]!.deleted_at).toBe('2026-03-01T00:00:00.000Z')
    expect(rows[1]!.entity_id).toBe('tag-B')
  })

  it('同一 tag 的重命名后仍唯一', () => {
    const db = newDb()!
    db.prepare(UPSERT_SQL).run(...tagRow(1, 'tag-A', 'apple'))
    // A 改名为 banana
    db.prepare(UPSERT_SQL).run(0, 'tag', 'tag-A', '{"nameNormalized":"banana"}', null, 't', 'A', 0)
    expect((db.prepare('SELECT COUNT(*) AS n FROM sync_records').get() as { n: number }).n).toBe(1)
  })
})
