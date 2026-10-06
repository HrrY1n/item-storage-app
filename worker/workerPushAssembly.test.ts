/**
 * ⭐ Worker **装配层**回归测试（Phase 3B 最终 runtime 修复）。
 *
 * ## 这个文件存在的理由
 *
 * 上一轮只测了 `UPSERT_SQL` 字符串本身，结果 `worker/index.ts` 的 bind 顺序
 * 与 SQL 里的 `?1..?8` 定义**完全错位**却一路绿灯：
 *
 *   SQL 期望：?1 offset · ?2 entity · ?3 entityId · ?4 payload …
 *   实际 bind：entity, entityId, payload, …, offset
 *
 * 错位后 `payload` 收到 `null` → 触发 `payload NOT NULL` → **真实 Worker push 必失败**。
 * 而任何"只断言 SQL 文本"的测试都不可能发现它。
 *
 * 所以这里不做字符串断言，而是**驱动真实的 `executePush()`**：
 * 同一个装配函数、同一个 `buildUpsertBindValues`、同一个真SQLite，
 * 逐位断言 bind 值与最终落库结果。
 *
 * 覆盖：
 *   A. 第一条真实 item push 的 bind 值与落库行
 *   B. 正常 batch 的 revision 连续性 + 计数器一致
 *   C. tag 并发 unique 冲突 → 整批回滚 → 重读 → merge-tag-into
 *   D. 冲突重试之后再正常 push（不得 PRIMARY KEY 冲突）
 */

import { describe, expect, it } from 'vitest'
import { executePush, isTagUniqueConflict } from './pushPipeline'
import { buildUpsertBindValues } from './syncSql'
import type { PushChange } from './syncLogic'
import { createSqliteD1, type SqliteD1 } from './sqliteD1.testHarness'

/* ---------------------------------------------------------------------- */
/* 夹具                                                                    */
/* ---------------------------------------------------------------------- */

const change = (over: Partial<PushChange> & Pick<PushChange, 'entity' | 'entityId'>): PushChange => ({
  payload: { name: over.entityId },
  deletedAt: null,
  clientUpdatedAt: '2026-10-06T00:00:00.000Z',
  baseRevision: 0,
  ...over,
})

const item = (id: string, over: Partial<PushChange> = {}): PushChange =>
  change({ entity: 'item', entityId: id, ...over })

const tag = (id: string, nameNormalized: string, over: Partial<PushChange> = {}): PushChange =>
  change({
    entity: 'tag',
    entityId: id,
    payload: { name: nameNormalized, nameNormalized },
    ...over,
  })

/** 取计数器末值 */
const seqOf = (d1: SqliteD1): number =>
  (d1.raw.prepare('SELECT revision FROM sync_revision_seq WHERE id=1').get() as { revision: number }).revision

/** 取所有记录的 revision（升序） */
const revisionsOf = (d1: SqliteD1): number[] =>
  (d1.raw.prepare('SELECT revision FROM sync_records ORDER BY revision').all() as Array<{ revision: number }>).map(
    (r) => r.revision,
  )

/** 只看活跃 tag 的 (entity_id, nameNormalized) */
const activeTags = (d1: SqliteD1): Array<{ entity_id: string; nameNormalized: string }> =>
  (
    d1.raw
      .prepare(
        "SELECT entity_id, json_extract(payload,'$.nameNormalized') AS nameNormalized FROM sync_records WHERE entity='tag' AND deleted_at IS NULL",
      )
      .all() as Array<{ entity_id: string; nameNormalized: string }>
  )

/**
 * 核心不变量：计数器必须**恰好等于**已写入记录的最大 revision。
 *
 * seq > MAX(revision) → 悬空区间（预留了却没写进去，客户端游标推过就永久漏同步）
 * seq < MAX(revision) → 即将发生主键冲突（下一批会重新分配已用过的 revision）
 */
function expectSeqEqualsMaxRevision(d1: SqliteD1): void {
  const max = d1.raw.prepare('SELECT MAX(revision) AS m FROM sync_records').get() as { m: number | null }
  expect(seqOf(d1)).toBe(max.m ?? 0)
}

/* ---------------------------------------------------------------------- */
/* A. bind 顺序 —— 装配层逐位断言                                          */
/* ---------------------------------------------------------------------- */

describe('A. UPSERT bind 顺序（真实装配层，不是 SQL 字符串）', () => {
  it('★ 普通 item push：bind 值与 ?1..?8 逐位对应', async () => {
    const d1 = createSqliteD1()
    const out = await executePush(
      d1.db,
      [item('item-1', { payload: { name: '机械键盘' }, clientUpdatedAt: '2026-10-06T01:02:03.000Z' })],
      'dev-A',
    )
    expect(out.ok).toBe(true)

    //装配层实际交出去的 8 个值（最后一条 bind 属于 UPSERT_SQL）
    const bound = d1.bindLog.filter((b) => b.sql.includes('INSERT INTO sync_records')).at(-1)!
    expect(bound.values).toEqual([
      0, // ?1 offsetInBatch
      'item', // ?2 entity
      'item-1', // ?3 entityId
      '{"name":"机械键盘"}', // ?4 payload —— JSON 字符串
      null, // ?5 deletedAt
      '2026-10-06T01:02:03.000Z', // ?6 clientUpdatedAt
      'dev-A', // ?7 deviceId
      0, // ?8 undeleteIntent
    ])
  })

  it('★ deletedAt=null 时 payload 仍然是 JSON 字符串（不是 null / undefined）', async () => {
    const d1 = createSqliteD1()
    await executePush(d1.db, [item('i-null', { payload: { name: 'x' }, deletedAt: null })], 'dev-A')

    const bound = d1.bindLog.filter((b) => b.sql.includes('INSERT INTO sync_records')).at(-1)!
    const payload = bound.values[3]
    expect(typeof payload).toBe('string')
    expect(payload).toBe('{"name":"x"}')
    expect(bound.values[4]).toBeNull()
  })

  it('offset 0/ 1 / 31 正确进入 ?1', async () => {
    const d1 = createSqliteD1()
    const many = Array.from({ length: 32 }, (_, i) => item(`bulk-${String(i).padStart(2, '0')}`))
    const out = await executePush(d1.db, many, 'dev-A')
    expect(out.ok).toBe(true)

    const upserts = d1.bindLog.filter((b) => b.sql.includes('INSERT INTO sync_records'))
    expect(upserts).toHaveLength(32)
    expect(upserts.map((u) => u.values[0])).toEqual(Array.from({ length: 32 }, (_, i) => i))
  })

  it('undeleteIntent 正确进入 ?8（true→1，其余→0）', () => {
    const base = change({ entity: 'item', entityId: 'a' })
    expect(buildUpsertBindValues(base, 'D', 0)[7]).toBe(0)
    expect(buildUpsertBindValues({ ...base, undeleteIntent: false }, 'D', 0)[7]).toBe(0)
    expect(buildUpsertBindValues({ ...base, undeleteIntent: true }, 'D', 0)[7]).toBe(1)
    // 任何 truthy 非 true 值都不得被当成恢复意图
    expect(buildUpsertBindValues({ ...base, undeleteIntent: 'yes' as unknown as boolean }, 'D', 0)[7]).toBe(0)
  })

  it('★ 装配层的第一条真实 item push：落库行逐字段正确', async () => {
    const d1 = createSqliteD1()
    await executePush(
      d1.db,
      [item('item-1', { payload: { name: '机械键盘', note: '红轴' }, clientUpdatedAt: '2026-10-06T01:02:03.000Z' })],
      'dev-A',
    )

    const row = d1.raw
      .prepare('SELECT entity, entity_id, payload, deleted_at, client_updated_at, device_id, revision FROM sync_records')
      .get() as Record<string, unknown>

    expect(row.entity).toBe('item')
    expect(row.entity_id).toBe('item-1')
    expect(JSON.parse(row.payload as string)).toEqual({ name: '机械键盘', note: '红轴' })
    expect(row.deleted_at).toBeNull()
    expect(row.device_id).toBe('dev-A')
    expect(row.revision).toBe(1)
    expect(row.client_updated_at).toBe('2026-10-06T01:02:03.000Z')
    expectSeqEqualsMaxRevision(d1)
  })

  it('★ 没有 payload 的变更也会写入 {} 而不是让 payload 变 NULL', async () => {
    const d1 = createSqliteD1()
    // 载荷完全缺失时不能触发 payload NOT NULL
    const out = await executePush(
      d1.db,
      [{ ...item('i-nopayload'), payload: undefined as unknown as Record<string, unknown> }],
      'dev-A',
    )
    expect(out.ok).toBe(true)
    const row = d1.raw.prepare('SELECT payload FROM sync_records').get() as { payload: string }
    expect(row.payload).toBe('{}')
  })
})

/* ---------------------------------------------------------------------- */
/* B. 正常 batch                                                           */
/* ---------------------------------------------------------------------- */

describe('B. 正常 batch 的原子性', () => {
  it('★ 3 条记录 → revision 1,2,3，计数器 = 3', async () => {
    const d1 = createSqliteD1()
    const out = await executePush(d1.db, [item('a'), item('b'), item('c')], 'dev-A')
    expect(out.ok).toBe(true)
    if (!out.ok) return

    expect(revisionsOf(d1)).toEqual([1, 2, 3])
    expect(seqOf(d1)).toBe(3)
    expect(out.result.currentRevision).toBe(3)
    expect(out.result.accepted).toBe(3)
    expect(out.result.acceptedIds).toEqual(['a', 'b', 'c'])
    expectSeqEqualsMaxRevision(d1)
  })

  it('★ 一个 batch 就是一次事务：batch 调用次数为 1（绝不逐条 run）', async () => {
    const d1 = createSqliteD1()
    await executePush(d1.db, [item('a'), item('b'), item('c')], 'dev-A')
    expect(d1.queryLog.filter((q) => q === 'BATCH')).toHaveLength(1)
  })

  it('upsert 与计数器推进在同一次 batch 里（bump 是最后一条）', async () => {
    const d1 = createSqliteD1()
    await executePush(d1.db, [item('a'), item('b')], 'dev-A')
    const bumpIdx = d1.bindLog.findIndex((b) => b.sql.includes('UPDATE sync_revision_seq'))
    const upsertIdx = d1.bindLog.findIndex((b) => b.sql.includes('INSERT INTO sync_records'))
    // bind 顺序即执行顺序：先 upsert，最后才 bump
    expect(upsertIdx).toBeGreaterThanOrEqual(0)
    expect(bumpIdx).toBeGreaterThan(upsertIdx)
    // 且 bump 的推进量 = 本批 upsert 条数
    expect(d1.bindLog[bumpIdx]!.values).toEqual([2])
  })

  it('连续两次 push：revision 严格递增，不复用', async () => {
    const d1 = createSqliteD1()
    await executePush(d1.db, [item('a')], 'dev-A')
    await executePush(d1.db, [item('b')], 'dev-A')
    expect(revisionsOf(d1)).toEqual([1, 2])
    expectSeqEqualsMaxRevision(d1)
  })

  it('★ 非 tag 约束失败 → 整批放弃、返回 push-failed，绝不重试也绝不留下半批', async () => {
    const d1 = createSqliteD1()
    // clientUpdatedAt 为 null 会撞 `client_updated_at TEXT NOT NULL`。
    // 这是**非 tag** 的失败（不是唯一索引冲突），因此必须直接放弃：
    // 重试只会把同一个 bug 再撞一遍，并白烧50 queries/invocation 的额度。
    const bad = { ...item('bad'), clientUpdatedAt: null as unknown as string }
    const out = await executePush(d1.db, [item('ok-1'), bad, item('ok-2')], 'dev-A')

    expect(out).toEqual({ ok: false, error: 'push-failed' })
    // ⭐ 整批回滚：同批的 ok-1 / ok-2 也不能留下
    expect((d1.raw.prepare('SELECT COUNT(*) AS n FROM sync_records').get() as { n: number }).n).toBe(0)
    // 计数器也没被推进
    expectSeqEqualsMaxRevision(d1)
    // 只尝试了 1 次（没有把非唯一索引失败误判成可重试）
    expect(d1.queryLog.filter((q) => q === 'BATCH')).toHaveLength(1)
  })

  it('唯一索引冲突才会重试；其他 UNIQUE 冲突不重试', () => {
    // entity+entity_id 的 UNIQUE 冲突不会发生（UPSERT_SQL 有 ON CONFLICT 兜住），
    // 这里直接验证判定函数本身，避免误判。
    expect(
      isTagUniqueConflict(new Error("UNIQUE constraint failed: index 'idx_sync_tag_normalized'")),
    ).toBe(true)
    expect(isTagUniqueConflict(new Error('UNIQUE constraint failed: sync_records.entity, sync_records.entity_id'))).toBe(
      false,
    )
    expect(isTagUniqueConflict(new Error('NOT NULL constraint failed: sync_records.payload'))).toBe(false)
    expect(isTagUniqueConflict('some string')).toBe(false)
  })
})

/* ---------------------------------------------------------------------- */
/* C. tag 并发 unique 冲突 → 整批回滚 → 重读 → 合并                        */
/* ---------------------------------------------------------------------- */

describe('C. tag 并发唯一索引冲突（整批重试，绝不逐条）', () => {
  /**
   * 场景C 的搭建：
   *   1. 设备 B 开始 push（此时 preload 看不到 #apple）
   *   2. 在 B 的 batch 执行**之前**，设备 A 抢先提交了 #apple
   *   3. B 的旧 batch 撞上部分唯一索引 → 整批回滚
   *   4. executePush 重读 tagKeys → 拿到 A 的 canonicalId → merge-tag-into
   */
  function setupRace(): SqliteD1 {
    let injected = false
    const d1 = createSqliteD1({
      onBeforeBatch: (index) => {
        // 只在 B 的第一次 batch 前注入 A 的提交（B 自己的重试批次不再注入）
        if (index !== 1 || injected) return
        injected = true
        // A 抢先写入 #apple（完整的 upsert + bump，与真实 push 等价）
        d1.raw.exec('BEGIN')
        d1.raw
          .prepare(
            `INSERT INTO sync_records
               (revision, entity, entity_id, payload, deleted_at, client_updated_at, device_id)
             VALUES ((SELECT revision FROM sync_revision_seq) + 1 + ?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .run(
            0,
            'tag',
            'tag-A',
            JSON.stringify({ name: 'Apple', nameNormalized: 'apple' }),
            null,
            '2026-10-06T00:00:00.000Z',
            'dev-A',
          )
        d1.raw.prepare('UPDATE sync_revision_seq SET revision = revision + ?1 WHERE id = 1').run(1)
        d1.raw.exec('COMMIT')
      },
    })
    return d1
  }

  it('★ 云端只保留一个 active apple，客户端拿到 A 的 canonicalId', async () => {
    const d1 = setupRace()
    const out = await executePush(d1.db, [tag('tag-B', 'apple')], 'dev-B')

    expect(out.ok).toBe(true)
    if (!out.ok) return

    // 只有一个活跃的 #apple
    expect(activeTags(d1)).toEqual([{ entity_id: 'tag-A', nameNormalized: 'apple' }])
    // 客户端拿到正确的 canonicalId
    expect(out.result.dedupDirectives).toEqual([
      { kind: 'merge-tag-into', duplicateId: 'tag-B', canonicalId: 'tag-A' },
    ])
  })

  it('★ 重试后 seq == MAX(revision)，没有悬空计数器、没有重复 revision', async () => {
    const d1 = setupRace()
    await executePush(d1.db, [tag('tag-B', 'apple')], 'dev-B')

    const revs = revisionsOf(d1)
    expect(new Set(revs).size).toBe(revs.length) // 无重复
    expect(revs).toEqual([...revs].sort((a, b) => a - b)) // 单调
    expectSeqEqualsMaxRevision(d1)
    // 只有 A 的那一条（revision 1），B 的重复 tag 没有写进去
    expect(revs).toEqual([1])
    expect(seqOf(d1)).toBe(1)
  })

  it('★ 冲突回滚后，非冲突的同批变更必须被重试批次写进去', async () => {
    const d1 = setupRace()
    // B 这一批里除了冲突的 tag，还有一条正常 item
    const out = await executePush(d1.db, [tag('tag-B', 'apple'), item('item-B')], 'dev-B')
    expect(out.ok).toBe(true)

    // item 在重试批次里成功写入，且拿到紧接 A 之后的 revision
    const itemRow = d1.raw.prepare("SELECT revision, device_id FROM sync_records WHERE entity_id='item-B'").get() as {
      revision: number
      device_id: string
    }
    expect(itemRow.revision).toBe(2)
    expect(itemRow.device_id).toBe('dev-B')
    expectSeqEqualsMaxRevision(d1)
  })

  it('★ 冲突批次整批回滚：不会留下"只写进一半"的记录', async () => {
    const d1 = setupRace()
    await executePush(d1.db, [tag('tag-B', 'apple'), item('item-B')], 'dev-B')

    // 回滚意味着第一次 batch 的所有写入都没了；
    // 最终只有 A 的 tag + 重试批次写进的 item，**没有多余的 tag 行**
    const all = d1.raw.prepare('SELECT entity, entity_id FROM sync_records ORDER BY revision').all() as Array<{
      entity: string
      entity_id: string
    }>
    expect(all).toEqual([
      { entity: 'tag', entity_id: 'tag-A' },
      { entity: 'item', entity_id: 'item-B' },
    ])
  })

  it('★ 冲突重试最多一次：预加载再次踩空时返回 push-failed 且无副作用', async () => {
    // 对手已提交 canonical tag，但**两次**预加载都读不到（D1 读副本滞后），
    // 于是两次尝试都会真的去写、都会撞唯一索引。
    // 正确行为：最多重试一次，第二次仍失败就 push-failed —— 不无限重试。
    let injected = false
    const d1 = createSqliteD1({
      // 第1、2 次 tag 预加载都返回空
      staleTagKeyReads: new Set([1, 2]),
      onBeforeBatch: (index) => {
        if (index !== 1 || injected) return
        injected = true
        d1.raw.exec('BEGIN')
        d1.raw
          .prepare(
            `INSERT INTO sync_records
               (revision, entity, entity_id, payload, deleted_at, client_updated_at, device_id)
             VALUES ((SELECT revision FROM sync_revision_seq) + 1 + ?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .run(
            0,
            'tag',
            'tag-A',
            JSON.stringify({ name: 'Apple', nameNormalized: 'apple' }),
            null,
            '2026-10-06T00:00:00.000Z',
            'dev-A',
          )
        d1.raw.prepare('UPDATE sync_revision_seq SET revision = revision + ?1 WHERE id = 1').run(1)
        d1.raw.exec('COMMIT')
      },
    })

    const out = await executePush(d1.db, [tag('tag-B', 'apple'), item('item-B')], 'dev-B')
    expect(out).toEqual({ ok: false, error: 'push-failed' })
    // B 的两条记录都从未落库
    expect(
      (d1.raw.prepare("SELECT COUNT(*) AS n FROM sync_records WHERE entity_id IN ('tag-B','item-B')").get() as {
        n: number
      }).n,
    ).toBe(0)
    // ⭐ 两次失败都没留下悬空计数器
    expectSeqEqualsMaxRevision(d1)
    // 恰好 2 次尝试（1 次正常 + 1 次重试），没有无限重试
    expect(d1.queryLog.filter((q) => q === 'BATCH')).toHaveLength(2)
  })

  it('重试成功时：重读拿到的 canonicalId 正确，且只发生 2 次 batch', async () => {
    // 与上一个测试相反：只在第一次 batch 前注入 → 重试时 preload 能看到它 → 合并成功
    let injected = false
    const d1 = createSqliteD1({
      onBeforeBatch: (index) => {
        if (index !== 1 || injected) return
        injected = true
        d1.raw.exec('BEGIN')
        d1.raw
          .prepare(
            `INSERT INTO sync_records
               (revision, entity, entity_id, payload, deleted_at, client_updated_at, device_id)
             VALUES ((SELECT revision FROM sync_revision_seq) + 1 + ?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .run(
            0,
            'tag',
            'tag-A',
            JSON.stringify({ name: 'Apple', nameNormalized: 'apple' }),
            null,
            '2026-10-06T00:00:00.000Z',
            'dev-A',
          )
        d1.raw.prepare('UPDATE sync_revision_seq SET revision = revision + ?1 WHERE id = 1').run(1)
        d1.raw.exec('COMMIT')
      },
    })

    // 同时带上一个正常 item，确保"重试批次"确实还要执行一次 batch
    const out = await executePush(d1.db, [tag('tag-B', 'apple'), item('item-B')], 'dev-B')
    expect(out.ok).toBe(true)
    if (!out.ok) return

    expect(out.result.dedupDirectives).toEqual([
      { kind: 'merge-tag-into', duplicateId: 'tag-B', canonicalId: 'tag-A' },
    ])
    // 第一次 batch 回滚 → 重试批次 = [item] + bump，共 2 次 batch
    expect(d1.queryLog.filter((q) => q === 'BATCH')).toHaveLength(2)
    expectSeqEqualsMaxRevision(d1)
  })

  it('不同名字的 tag 不触发重试（一次 batch 搞定）', async () => {
    const d1 = createSqliteD1()
    const out = await executePush(d1.db, [tag('t1', 'apple'), tag('t2', 'banana')], 'dev-A')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(d1.queryLog.filter((q) => q === 'BATCH')).toHaveLength(1)
    expect(out.result.dedupDirectives).toEqual([])
    expectSeqEqualsMaxRevision(d1)
  })
})

/* ---------------------------------------------------------------------- */
/* D. 冲突之后继续正常 push                                                */
/* ---------------------------------------------------------------------- */

describe('D. unique 冲突之后再正常 push', () => {
  it('★ 新 item 的 revision 必须 > 当前 MAX(revision)，不发生主键冲突', async () => {
    let n = 0
    const d1 = createSqliteD1({
      onBeforeBatch: (index) => {
        if (index !== 1) return
        n += 1
        d1.raw.exec('BEGIN')
        d1.raw
          .prepare(
            `INSERT INTO sync_records
               (revision, entity, entity_id, payload, deleted_at, client_updated_at, device_id)
             VALUES ((SELECT revision FROM sync_revision_seq) + 1 + ?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .run(
            0,
            'tag',
            `tag-A${n}`,
            JSON.stringify({ name: 'Apple', nameNormalized: 'apple' }),
            null,
            '2026-10-06T00:00:00.000Z',
            'dev-A',
          )
        d1.raw.prepare('UPDATE sync_revision_seq SET revision = revision + ?1 WHERE id = 1').run(1)
        d1.raw.exec('COMMIT')
      },
    })

    // 先制造一次冲突 + 重试
    const first = await executePush(d1.db, [tag('tag-B', 'apple'), item('item-B')], 'dev-B')
    expect(first.ok).toBe(true)
    const maxAfterRetry = (
      d1.raw.prepare('SELECT MAX(revision) AS m FROM sync_records').get() as { m: number }
    ).m

    // 再正常 push 一条新 item
    const second = await executePush(d1.db, [item('item-C')], 'dev-B')
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const newRow = d1.raw.prepare("SELECT revision FROM sync_records WHERE entity_id='item-C'").get() as {
      revision: number
    }
    expect(newRow.revision).toBeGreaterThan(maxAfterRetry)
    expect(second.result.currentRevision).toBe(maxAfterRetry + 1)

    // revision 全局唯一且连续
    const revs = revisionsOf(d1)
    expect(new Set(revs).size).toBe(revs.length)
    expect(revs).toEqual(revs.map((_, i) => i + 1))
    expectSeqEqualsMaxRevision(d1)
  })

  it('冲突重试不会让 seq 领先于 MAX(revision)（旧实现的悬空 bug）', async () => {
    let n = 0
    const d1 = createSqliteD1({
      onBeforeBatch: (index) => {
        if (index !== 1) return
        n += 1
        d1.raw.exec('BEGIN')
        d1.raw
          .prepare(
            `INSERT INTO sync_records
               (revision, entity, entity_id, payload, deleted_at, client_updated_at, device_id)
             VALUES ((SELECT revision FROM sync_revision_seq) + 1 + ?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .run(
            0,
            'tag',
            `tag-A${n}`,
            JSON.stringify({ name: 'Apple', nameNormalized: 'apple' }),
            null,
            '2026-10-06T00:00:00.000Z',
            'dev-A',
          )
        d1.raw.prepare('UPDATE sync_revision_seq SET revision = revision + ?1 WHERE id = 1').run(1)
        d1.raw.exec('COMMIT')
      },
    })

    await executePush(d1.db, [tag('tag-B', 'apple'), item('item-B'), item('item-C')], 'dev-B')

    // ⭐ 核心断言：旧实现（逐条 run + catch 里补bump）会在这里留下 seq > MAX
    expectSeqEqualsMaxRevision(d1)
    const revs = revisionsOf(d1)
    expect(revs.every((r, i) => r === i + 1)).toBe(true)
  })
})

/* ---------------------------------------------------------------------- */
/* 预算：不变量不被重试破坏                                                */
/* ---------------------------------------------------------------------- */

describe('重试的查询预算仍在 Free 额度内', () => {
  it('一次冲突重试的 SQL 总数 ≤ 50 queries/invocation', async () => {
    let n = 0
    const d1 = createSqliteD1({
      onBeforeBatch: (index) => {
        if (index !== 1) return
        n += 1
        d1.raw.exec('BEGIN')
        d1.raw
          .prepare(
            `INSERT INTO sync_records
               (revision, entity, entity_id, payload, deleted_at, client_updated_at, device_id)
             VALUES ((SELECT revision FROM sync_revision_seq) + 1 + ?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .run(
            0,
            'tag',
            `tag-A${n}`,
            JSON.stringify({ name: 'Apple', nameNormalized: 'apple' }),
            null,
            '2026-10-06T00:00:00.000Z',
            'dev-A',
          )
        d1.raw.prepare('UPDATE sync_revision_seq SET revision = revision + ?1 WHERE id = 1').run(1)
        d1.raw.exec('COMMIT')
      },
    })

    await executePush(d1.db, [tag('tag-B', 'apple'), item('i1'), item('i2')], 'dev-B')
    // queryLog 记的是 prepare/run 级调用；D1 的 batch 里每条语句各计一次
    expect(d1.queryLog.length).toBeLessThanOrEqual(50)
  })
})