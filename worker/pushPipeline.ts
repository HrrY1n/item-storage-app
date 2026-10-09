/**
 * push 编排（Phase 3B 最终 runtime 修复）。
 *
 * ## 为什么要独立成文件
 *
 * `worker/index.ts` 里原本内联着整个 push 流程，导致：
 *   - bind 顺序（`?1..?8`）这种**只有运行期才暴露**的错误缺少测试抓手；
 *   - 唯一能验"revision 与写入同事务"的办法是端到端打真实 Worker。
 *
 * 把编排抽到这里后，`workerPushAssembly.test.ts` 可以用**真实 node:sqlite**
 * 驱动同一个 `executePush()`，逐位断言 bind 值、真实落库结果与重试后的原子性。
 * `worker/index.ts` 只剩下HTTP 装配（认证 /解析 / 响应）。
 *
 * ## ⭐ 唯一允许的写入路径：整批 + 最多一次完整重试
 *
 * ```
 * preload → 判定 → 构建 upserts → db.batch([...upserts, bump])
 *                ↓ 撞 tag 唯一索引（整批已回滚）
 *       重新 preload → 重新判定 → 从 offset 0 重建 → 再来一个完整的 batch
 *                ↓ 仍失败
 *             push-failed
 * ```
 *
 * ⚠️ **绝不逐条 `run()`**。逐条重试会让"成功的 upsert"与"计数器推进"
 *   处于不同 transaction：`sync_revision_seq` 不推进 → 下一次 push 会
 *   **重新分配已经用过的 revision** → 主键冲突或永久漏同步。
 *   这类"补丁式回退"必须整批重来，而不是拆开执行。
 */

import {
  buildUpsertBindValues,
  BUMP_REVISION_SQL,
  CATEGORY_GRAPH_SQL,
  CURRENT_REVISION_SQL,
  PRELOAD_CHUNK,
  PULL_TAG_KEYS_SQL,
  UPSERT_SQL,
  preloadSql,
  readNameNormalizedOf,
} from './syncSql'
import {
  decidePush,
  summarize,
  type ExistingRecord,
  type PushChange,
  findCategoryCycleQueueIds,
  type CategoryParent,
} from './syncLogic'
import { collectTagKeys, resolveTagDedup, type TagDedupDirective } from '../src/features/sync/tagDedup'

/* ---------------------------------------------------------------------- */
/* 最小结构化接口：真实 D1Database 天然满足；测试里的 sqlite 适配器也满足     */
/* ---------------------------------------------------------------------- */

export interface PushStatement {
  bind(...values: unknown[]): PushStatement
  run<T = unknown>(): Promise<D1Result<T>>
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<D1Result<T>>
}

export interface PushDatabase {
  prepare(query: string): PushStatement
  /** 一个 SQL transaction：语句顺序执行，任一失败整批回滚 */
  batch(statements: PushStatement[]): Promise<D1Result[]>
}

/* ---------------------------------------------------------------------- */
/* 结果形态                                                                */
/* ---------------------------------------------------------------------- */

export interface PushIgnored {
  queueId: string
  entity: string
  entityId: string
  reason: string
}

export type PushDedupDirective = TagDedupDirective & { queueId: string }

export interface PushAuthoritativeChange {
  revision: number
  entity: 'category'
  entityId: string
  payload: unknown
  deletedAt: string | null
  clientUpdatedAt: string
  deviceId: string
}

/** push 的业务结果（成功时原样作为响应体） */
export interface PushSuccess {
  accepted: number
  acceptedQueueIds: string[]
  ignored: PushIgnored[]
  dedupDirectives: PushDedupDirective[]
  authoritativeChanges: PushAuthoritativeChange[]
  conflicts: Array<Record<string, unknown>>
  currentRevision: number
}

export type PushOutcome =
  | { ok: true; result: PushSuccess }
  /** tag 唯一索引冲突且重试后仍失败 */
  | { ok: false; error: 'push-failed' }

/** 单次尝试的结果。`retryable` 表示"因 tag 唯一索引冲突整批回滚，可重试" */
type Attempt =
  | { status: 'ok'; upserts: PushStatement[]; payload: Omit<PushSuccess, 'currentRevision'> }
  | { status: 'retryable' }
  | { status: 'failed' }

/* ---------------------------------------------------------------------- */
/* 主入口                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * 执行一次 push。
 *
 * @param deviceId 本次请求的设备（写入 `device_id`，并作为冲突胜方标识）
 */
export async function executePush(
  db: PushDatabase,
  changes: PushChange[],
  deviceId: string,
): Promise<PushOutcome> {
  // ── 第一次：正常路径 ──────────────────────────────────────────────
  const first = await attemptPush(db, changes, deviceId)
  if (first.status === 'ok') {
    return { ok: true, result: { ...first.payload, currentRevision: await readCurrentRevision(db) } }
  }
  if (first.status === 'failed') return { ok: false, error: 'push-failed' }

  // ── 第二次：整批回滚后，**重新读取**再重建 ──────────────────────────
  // 关键点：不能沿用第一次的 tagKeys / decisions —— 冲突恰恰说明
  // 预加载已经过期（别的设备在同一瞬间提交了同名 tag）。
  // 重新 preload 后 resolveTagDedup 会把重复项转成 merge-tag-into。
  const second = await attemptPush(db, changes, deviceId)
  if (second.status !== 'ok') return { ok: false, error: 'push-failed' }

  return { ok: true, result: { ...second.payload, currentRevision: await readCurrentRevision(db) } }
}

/**
 * 一次完整尝试：preload → 判定 → 构建 → **一个** batch。
 *
 * ⚠️ 返回 `retryable` 时**数据库没有任何副作用**（batch 已整批回滚），
 *   调用方可以安全地从头再来一次。
 */
async function attemptPush(db: PushDatabase, changes: PushChange[], deviceId: string): Promise<Attempt> {
  const { records: existingMap, tagKeys } = await preloadExisting(db, changes)
  const graphRows = await db.prepare(CATEGORY_GRAPH_SQL).bind().all<{ entity_id: string; payload: string }>()
  const existingCategories: CategoryParent[] = (graphRows.results ?? []).map((row) => ({
    id: row.entity_id,
    parentId: readCategoryParent(row.payload),
  }))
  const cycleQueueIds = findCategoryCycleQueueIds(existingCategories, changes)

  const ignored: PushIgnored[] = changes
    .filter((change) => cycleQueueIds.has(change.queueId))
    .map((change) => ({
      queueId: change.queueId,
      entity: change.entity,
      entityId: change.entityId,
      reason: 'category-cycle',
    }))
  const acceptedQueueIds: string[] = []
  const conflicts: Array<Record<string, unknown>> = []
  const dedupDirectives: PushDedupDirective[] = []
  const authoritativeChanges: PushAuthoritativeChange[] = []
  const rejectedAt = new Date().toISOString()
  for (const change of changes) {
    if (!cycleQueueIds.has(change.queueId)) continue
    const existing = existingMap.get(`${change.entity}:${change.entityId}`)
    if (existing !== undefined) {
      authoritativeChanges.push({
        revision: existing.revision,
        entity: 'category',
        entityId: change.entityId,
        payload: parseJsonPayload(existing.payload),
        deletedAt: existing.deletedAt,
        clientUpdatedAt: existing.clientUpdatedAt,
        deviceId: existing.deviceId,
      })
    } else {
      // A same-batch cycle can consist entirely of new local categories. There
      // is no server row to echo, so return an authoritative tombstone; the
      // client can dequeue the rejected write without retaining a local cycle.
      authoritativeChanges.push({
        revision: 0,
        entity: 'category',
        entityId: change.entityId,
        payload: change.payload,
        deletedAt: rejectedAt,
        clientUpdatedAt: change.clientUpdatedAt,
        deviceId: 'server',
      })
    }
  }
  /** 本批要写库的 upsert。offset 从 0 连续编号，revision 因此连续 */
  const upserts: PushStatement[] = []
  let hasTagChange = false

  for (const change of changes) {
    if (cycleQueueIds.has(change.queueId)) continue
    const existing = existingMap.get(`${change.entity}:${change.entityId}`) ?? null
    const decision = decidePush({ change, existing, revisionFrom: 1 })

    if (decision.kind === 'ignore-tombstone' || decision.kind === 'ignore-invalid') {
      ignored.push({
        queueId: change.queueId,
        entity: String(change.entity),
        entityId: String(change.entityId),
        reason: decision.ignoreReason ?? 'ignored',
      })
      continue
    }

    // tag 同名归一：云端已有同名 tag 时不写重复记录，改由客户端合并
    if (change.entity === 'tag') {
      hasTagChange = true
      const dedup = resolveTagDedup(change, tagKeys)
      if (dedup !== null) {
        dedupDirectives.push({ ...dedup, queueId: change.queueId })
        continue
      }
    }

    // tombstone 二次判定：应用层给出准确的 ignored 回报；
    // 即便这里漏判，UPSERT_SQL 的 WHERE 也会在数据库层挡住。
    if (existing !== null && existing.deletedAt !== null && change.undeleteIntent !== true) {
      ignored.push({ queueId: change.queueId, entity: change.entity, entityId: change.entityId, reason: 'tombstoned' })
      continue
    }

    // ⭐ 唯一的 bind 装配入口 —— 顺序由 buildUpsertBindValues 单点定义
    upserts.push(
      db.prepare(UPSERT_SQL).bind(...buildUpsertBindValues(change, deviceId, upserts.length)),
    )
    acceptedQueueIds.push(change.queueId)

    if (decision.recordConflict && existing !== null) {
      // 本请求的设备是**胜方**（覆盖方），existing 是**败方**（被覆盖的那条）。
      conflicts.push({
        queueId: change.queueId,
        entity: change.entity,
        entityId: change.entityId,
        loserUpdatedAt: existing.clientUpdatedAt,
        loserDeviceId: existing.deviceId,
        winnerUpdatedAt: change.clientUpdatedAt,
        winnerDeviceId: deviceId,
        loserSummary: summarize(existing.payload),
        winnerSummary: summarize(change.payload),
        detectedAt: new Date().toISOString(),
      })
    }
  }

  if (upserts.length === 0) {
    return { status: 'ok', upserts, payload: { accepted: acceptedQueueIds.length, acceptedQueueIds, ignored, dedupDirectives, authoritativeChanges, conflicts } }
  }

  try {
    // ⚠️ 顺序是 `[...upserts, bump]`，见 syncSql.ts 顶部推导 —— 唯一正确顺序。
    //   revision 分配与记录写入因此处于同一 transaction。
    await db.batch([...upserts, db.prepare(BUMP_REVISION_SQL).bind(upserts.length)])
  } catch (err) {
    if ((hasTagChange && isTagUniqueConflict(err)) || isCategoryCycleConflict(err)) return { status: 'retryable' }
    return { status: 'failed' }
  }

  return { status: 'ok', upserts, payload: { accepted: acceptedQueueIds.length, acceptedQueueIds, ignored, dedupDirectives, authoritativeChanges, conflicts } }
}

function readCategoryParent(payload: string): string | null {
  try {
    const value = JSON.parse(payload) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const parentId = (value as Record<string, unknown>).parentId
    return typeof parentId === 'string' && parentId !== '' ? parentId : null
  } catch {
    return null
  }
}

function parseJsonPayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload
  try {
    return JSON.parse(payload) as unknown
  } catch {
    return null
  }
}

export function isCategoryCycleConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('category-cycle')
}

/**
 * 判断错误是否为 tag 规范化名的部分唯一索引冲突。
 *
 * 这是**唯一预期内**的批失败原因：两台设备真正同时创建了同名 tag。
 * 属于正常业务情形，处理方式是重试（重读后转成合并指令），不是报错。
 *
 * ⚠️ 其他失败（NOT NULL、CHECK、外键…）一律 `failed`，绝不重试 ——
 *   重试只会把同一个 bug 再撞一遍，并浪费 50 queries/invocation 的额度。
 */
export function isTagUniqueConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  // D1 与 SQLite 都把部分唯一索引冲突报成：
  //   UNIQUE constraint failed: index 'idx_sync_tag_normalized'
  return message.includes('UNIQUE constraint failed') && message.includes('idx_sync_tag_normalized')
}

/** 回读计数器末值（仅用于响应里的 currentRevision 提示，不参与分配） */
async function readCurrentRevision(db: PushDatabase): Promise<number> {
  const row = await db.prepare(CURRENT_REVISION_SQL).bind().first<{ revision: number }>()
  return row?.revision ?? 0
}

/* ---------------------------------------------------------------------- */
/* 预加载                                                                  */
/* ---------------------------------------------------------------------- */

/** 预加载现有记录（按 id 分片）+ tag nameNormalized 映射 */
async function preloadExisting(
  db: PushDatabase,
  changes: PushChange[],
): Promise<{ records: Map<string, ExistingRecord>; tagKeys: Map<string, { entityId: string }> }> {
  const tagKeys = await preloadTagKeys(db, changes)
  const out = new Map<string, ExistingRecord>()
  const ids = [...new Set(changes.map((c) => c.entityId))]
  const entities = [...new Set(changes.map((c) => c.entity))]

  for (let i = 0; i < ids.length; i += PRELOAD_CHUNK) {
    const idSlice = ids.slice(i, i + PRELOAD_CHUNK)
    // 参数数 = 实体种类(≤3) + 本片 id 数 ≤ 93 < 100 ✅
    const rows = await db
      .prepare(preloadSql(entities.length, idSlice.length))
      .bind(...entities, ...idSlice)
      .all<{
        entity: string
        entity_id: string
        revision: number
        deleted_at: string | null
        client_updated_at: string
        device_id: string
        payload: string
      }>()
    for (const r of rows.results ?? []) {
      out.set(`${r.entity}:${r.entity_id}`, {
        revision: r.revision,
        deletedAt: r.deleted_at,
        clientUpdatedAt: r.client_updated_at,
        deviceId: r.device_id,
        payload: r.payload,
      })
    }
  }
  return { records: out, tagKeys }
}

/**
 * 预加载 tag 的 nameNormalized → entityId。
 *
 * ⚠️ nameNormalized 在 JSON 里无法建索引，因此扫描 `entity='tag'` 后在内存比对。
 *   tags 规模远小于 items（个人使用下通常几十条），可接受。
 *
 * ⚠️ 这是"预加载 + 判断"模式，**天然有并发窗口**：两台设备真正同时创建同名
 *   tag 时可能都先看到"不存在"。这个窗口不再试图用应用层消除，而是交给
 *   数据库的部分唯一索引 + `executePush` 的整批重试兜住。
 */
async function preloadTagKeys(
  db: PushDatabase,
  changes: PushChange[],
): Promise<Map<string, { entityId: string }>> {
  const wanted = collectTagKeys(changes)
  const out = new Map<string, { entityId: string }>()
  if (wanted.size === 0) return out

  const rows = await db
    .prepare(PULL_TAG_KEYS_SQL)
    .bind()
    .all<{ entity_id: string; payload: string }>()
  for (const r of rows.results ?? []) {
    const key = readNameNormalizedOf(r.payload)
    if (key !== null && wanted.has(key) && !out.has(key)) {
      out.set(key, { entityId: r.entity_id })
    }
  }
  return out
}
