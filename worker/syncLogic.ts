/**
 * Worker 侧的**纯逻辑**（无 D1、无 fetch，全部有测试）。
 *
 * Worker 入口（index.ts）只负责装配与IO；所有"会不会覆盖""删除能不能复活"
 * "哈希怎么比"这些容易出错的判断都在这里，可单元测试。
 */

/** 参与同步的实体种类 */
import { toBase64Url } from '../src/services/syncBytes'

/** 转出唯一实现，Worker 测试也从这个入口验证 */
export { toBase64Url }

export type SyncEntity = 'item' | 'category' | 'tag'

export const SYNC_ENTITIES: readonly SyncEntity[] = ['item', 'category', 'tag']

/** 只用于服务端检查分类父链的最小形态。 */
export interface CategoryParent {
  id: string
  parentId: string | null
}

/** 一次 push 里每条变更的请求形态 */
export interface PushChange {
  /** Client outbox entry id; all terminal push acknowledgements use this id. */
  queueId: string
  entity: SyncEntity
  entityId: string
  payload: unknown
  /** 该实体在本机被软删时传 ISO 时间，否则 null */
  deletedAt: string | null
  /** 设备侧 updatedAt，仅审计 */
  clientUpdatedAt: string
  /** 客户端最后已知的服务端 revision（乐观并发基线） */
  baseRevision: number
  /**
   * 显式恢复已删实体时才为true。
   * 这是**唯一**能让 tombstone 重新变成活记录的方式，
   * 保证「删除不被旧设备复活」不会被绕过。
   */
  undeleteIntent?: boolean
}

/** 服务端已有的记录形态 */
export interface ExistingRecord {
  revision: number
  deletedAt: string | null
  clientUpdatedAt: string
  deviceId: string
  payload: unknown
}

export type DecisionKind =
  /** 新记录 → 接受 */
  | 'accept-new'
  /** 客户端基于最新 → 接受 */
  | 'accept-fresh'
  /** 并发修改 → 服务端顺序优先覆盖，并回报冲突供「事后可查」 */
  | 'accept-conflict'
  /** 已被删除且无 undeleteIntent → 忽略，★ 删除不被复活 */
  | 'ignore-tombstone'
  /** 客户端声明的实体类型非法 */
  | 'ignore-invalid'

export interface Decision {
  kind: DecisionKind
  /** 本条将占用的 revision（仅 accept-* 时有值） */
  revision?: number
  /** 是否需要记一条覆盖记录（只有 accept-conflict 为 true） */
  recordConflict: boolean
  /** 给客户端看的忽略原因 */
  ignoreReason?: 'tombstoned' | 'invalid-entity'
}

export interface DecideInput {
  change: PushChange
  existing: ExistingRecord | null
  /** 本批分配到的 revision 区间的起始值 */
  revisionFrom: number
}

/**
 * 逐条判定：这条变更能不能覆盖服务端现有记录。
 *
 * 优先级（顺序不可调换）：
 * 1. 实体类型非法 → 忽略
 * 2. **已 tombstone 且无 undeleteIntent → 忽略** ★ 排在所有覆盖逻辑之前，
 *    这样无论客户端 baseRevision 多新、时钟多准，都无法让已删数据复活
 * 3. 服务端无记录 → 接受（新实体）
 * 4. 服务端 revision ≤ baseRevision → 接受（客户端基于最新，无并发）
 * 5. 服务端 revision > baseRevision → 冲突：仍覆盖（服务端顺序优先），但回报冲突
 */
export function decidePush(input: DecideInput): Decision {
  const { change, existing, revisionFrom } = input

  if (!SYNC_ENTITIES.includes(change.entity)) {
    return { kind: 'ignore-invalid', recordConflict: false, ignoreReason: 'invalid-entity' }
  }

  if (existing !== null && existing.deletedAt !== null && change.undeleteIntent !== true) {
    // ★ 关键规则：删除单调不可逆。除显式恢复，任何写入都不能复活它。
    return { kind: 'ignore-tombstone', recordConflict: false, ignoreReason: 'tombstoned' }
  }

  if (existing === null) {
    return { kind: 'accept-new', revision: revisionFrom, recordConflict: false }
  }

  if (existing.revision > change.baseRevision) {
    // 期间被别的设备写过：服务端顺序优先，但仍回报冲突供用户事后查看
    return { kind: 'accept-conflict', revision: revisionFrom, recordConflict: true }
  }

  return { kind: 'accept-fresh', revision: revisionFrom, recordConflict: false }
}

/**
 * 给「冲突事后可查」生成可读摘要。
 *
 * ⚠️ 刻意**只取少量字段**而不是整个 payload —— 这张本地表只保留最近 50 条，
 * 存全量 JSON 会让它随冲突数膨胀。
 */
export function summarize(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  const name = typeof p.name === 'string' ? p.name : ''
  const note = typeof p.note === 'string' ? p.note : ''
  if (name === '' && note === '') return null
  if (note === '') return name
  const clipped = note.length > 80 ? `${note.slice(0, 80)}…` : note
  return `${name} · ${clipped}`
}

/** 从分类载荷读取父 id；结构校验由客户端/业务解码器继续负责。 */
export function readCategoryParentId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const value = (payload as Record<string, unknown>).parentId
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * 按请求顺序模拟本批分类更新，返回会形成环的 queue id。
 * 这只是快速业务反馈；最终一致性由 D1 trigger 在同一写事务内兜底。
 */
export function findCategoryCycleQueueIds(
  existing: ReadonlyArray<CategoryParent>,
  changes: ReadonlyArray<Pick<PushChange, 'queueId' | 'entity' | 'entityId' | 'payload' | 'deletedAt'>>,
): Set<string> {
  const graph = new Map(existing.map((category) => [category.id, category.parentId]))
  const categoryChanges = changes.filter((change) => change.entity === 'category')

  // Evaluate the batch's final graph, not an arbitrary request-order prefix.
  // Otherwise a same-batch A→B / B→A pair could accept one write and leave the
  // client with a local cycle after only the other write is rejected.
  for (const change of categoryChanges) {
    if (change.deletedAt !== null) graph.delete(change.entityId)
  }
  for (const change of categoryChanges) {
    if (change.deletedAt === null) graph.set(change.entityId, readCategoryParentId(change.payload))
  }

  const cycleIds = findCategoryCycleIds(graph)
  return new Set(categoryChanges.filter((change) => cycleIds.has(change.entityId)).map((change) => change.queueId))
}

function findCategoryCycleIds(graph: ReadonlyMap<string, string | null>): Set<string> {
  const cycleIds = new Set<string>()
  for (const start of graph.keys()) {
    const path: string[] = []
    const seen = new Map<string, number>()
    let cursor: string | null = start
    while (cursor !== null && graph.has(cursor)) {
      const cycleStart = seen.get(cursor)
      if (cycleStart !== undefined) {
        for (const id of path.slice(cycleStart)) cycleIds.add(id)
        break
      }
      seen.set(cursor, path.length)
      path.push(cursor)
      cursor = graph.get(cursor) ?? null
    }
  }
  return cycleIds
}

/* ---------------------------------------------------------------------- */
/* 认证                                                                    */
/* ---------------------------------------------------------------------- */

/** 从 Authorization 头里取出 Bearer token；格式不对返回 null */
export function parseBearer(header: string | null): string | null {
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (match === null) return null
  const token = match[1]!.trim()
  return token === '' ? null : token
}

/**
 * **常数时间**比较两个等长十六进制哈希。
 *
 * 为什么要手写：Cloudflare Workers **没有** `crypto.subtle.timingSafeEqual`
 * （WebCrypto 在 Workers 里只暴露 digest / 随机数 / HMAC / 签名等）。
 *
 * 关键细节：**长度不同也必须走完固定轮次**（按两者长度的最大值循环，
 * 缺失的一侧按 0 参与比较），否则"长度不同"这件事本身会通过耗时泄露。
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i += 1) {
    const ca = i < a.length ? a.charCodeAt(i) : 0
    const cb = i < b.length ? b.charCodeAt(i) : 0
    diff |= ca ^ cb
  }
  return diff === 0
}

/** 十六进制字节数组→ 小写 hex */
export function bytesToHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let out = ''
  for (const b of view) out += b.toString(16).padStart(2, '0')
  return out
}

/* ---------------------------------------------------------------------- */
/* 分页                                                                    */
/* ---------------------------------------------------------------------- */

export interface PageResult {
  changes: Array<{
    revision: number
    entity: SyncEntity
    entityId: string
    payload: unknown
    deletedAt: string | null
    clientUpdatedAt: string
    deviceId: string
  }>
  nextRevision: number
  hasMore: boolean
}

/**
 * 把一次查询结果整形成 pull 响应。
 *
 * ⚠️ nextRevision 取**本页最大 revision**，而不是请求的 after ——
 *    只有这样客户端推进游标才不会漏数据。
 */
export function buildPullPage(
  rows: Array<{
    revision: number
    entity: string
    entity_id: string
    payload: string
    deleted_at: string | null
    client_updated_at: string
    device_id: string
  }>,
  after: number,
  limit: number,
): PageResult {
  const changes = rows.map((r) => ({
    revision: r.revision,
    entity: r.entity as SyncEntity,
    entityId: r.entity_id,
    payload: safeParseJson(r.payload),
    deletedAt: r.deleted_at,
    clientUpdatedAt: r.client_updated_at,
    deviceId: r.device_id,
  }))
  const nextRevision = changes.length === 0 ? after : Math.max(...changes.map((c) => c.revision))
  // 多取一条用来判断 hasMore，因此实际返回要截回limit 条
  const hasMore = rows.length > limit
  return {
    changes: hasMore ? changes.slice(0, limit) : changes,
    nextRevision: hasMore ? changes[limit - 1]!.revision : nextRevision,
    hasMore,
  }
}

/** 载荷解析失败返回 null 而不是抛 —— 一条坏数据不该让整批 pull 失败 */
function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
