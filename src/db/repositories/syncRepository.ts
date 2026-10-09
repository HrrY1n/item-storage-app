import { ulid } from 'ulid'
import type { Table } from 'dexie'
import { db } from '../db'
import type {
  SyncConflict,
  SyncEntity,
  SyncQueueEntry,
  SyncQueueOp,
  SyncState,
} from '../../domain/types'

/**
 * 同步相关的本地状态读写（Phase 3B）。
 *
 * ⚠️ 本文件是 repository 层，是**唯一**允许 import db 的地方之一。
 *
 * 三张表全部是**纯本地状态**，都不进 ZIP 备份
 * （syncState 含 Bearer secret 明文 —— 详见 3B 计划 §6）。
 */

const STATE_KEY = 'sync'

export interface SyncSession {
  sessionEpoch: number
  deviceId: string
  keyId: string | null
  secret: string
}

/** 冲突记录保留条数上限（3B 规格 §0.1：保留最近 50 条） */
export const SYNC_CONFLICT_LIMIT = 50

/**
 * 幂等入队的核心逻辑。
 *
 * 刻意做成接收一个"表句柄"而不是直接用db —— 这样它既能用于独立调用，
 * 也能用于**业务写入的那个事务内部**（见 `enqueueWithTx`）。
 *
 * @param table syncQueue 表句柄（可能是 db.syncQueue，也可能是 tx.table('syncQueue')）
 */
async function upsertQueueEntry(
  table: Table<SyncQueueEntry, string>,
  entity: SyncEntity,
  entityId: string,
  op: SyncQueueOp = 'upsert',
  meta?: { deletedAt?: string | null; clientUpdatedAt?: string | null },
): Promise<void> {
  // 用 [entity+entityId] 唯一索引做幂等：同一实体改了 5 次仍只有 1 条待推。
  // ⚠️ 必须先删后插：新条目要反映**最新意图**
  //（例如先 upsert 再 delete，最终只该留下一条 delete）。
  await table.where('[entity+entityId]').equals([entity, entityId]).delete()
  const now = new Date().toISOString()
  await table.add({
    id: ulid(),
    entity,
    entityId,
    op,
    ...(op === 'delete'
      ? { deletedAt: meta?.deletedAt ?? now, clientUpdatedAt: meta?.clientUpdatedAt ?? meta?.deletedAt ?? now }
      : {}),
    createdAt: now,
  })
}

/** 未配置时的默认状态：同步**默认关闭** */
function defaultState(): SyncState {
  return {
    key: STATE_KEY,
    sessionEpoch: 0,
    deviceId: null,
    enabled: false,
    keyId: null,
    secret: null,
    lastPulledRevision: 0,
    lastSyncAt: null,
    lastError: null,
    pendingCount: 0,
  }
}

type SyncStatePatch = Partial<Omit<SyncState, 'key' | 'sessionEpoch'>>

function normalizeSessionEpoch(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function normalizeState(row: Partial<SyncState>): SyncState {
  const state = { ...defaultState(), ...row, key: STATE_KEY }
  return { ...state, sessionEpoch: normalizeSessionEpoch(state.sessionEpoch) }
}

async function readStateFromTable(table: Table<SyncState, string>): Promise<SyncState | null> {
  const row = await table.get(STATE_KEY)
  return row ? normalizeState(row) : null
}

function nextSessionEpoch(state: SyncState): number {
  if (state.sessionEpoch >= Number.MAX_SAFE_INTEGER) {
    throw new Error('sync session epoch exhausted')
  }
  return state.sessionEpoch + 1
}

function identityChanged(current: SyncState, patch: SyncStatePatch): boolean {
  return (
    (patch.enabled !== undefined && patch.enabled !== current.enabled) ||
    (patch.deviceId !== undefined && patch.deviceId !== current.deviceId) ||
    (patch.keyId !== undefined && patch.keyId !== current.keyId) ||
    (patch.secret !== undefined && patch.secret !== current.secret)
  )
}

export function isCurrentSession(state: SyncState | null, session: SyncSession): boolean {
  return (
    state !== null &&
    state.enabled &&
    state.sessionEpoch === session.sessionEpoch &&
    state.deviceId === session.deviceId &&
    state.keyId === session.keyId &&
    state.secret === session.secret
  )
}

export async function isSessionCurrentInTransaction(
  stateTable: Table<SyncState, string>,
  session: SyncSession,
): Promise<boolean> {
  return isCurrentSession(await readStateFromTable(stateTable), session)
}

export async function setStateInTransaction(
  stateTable: Table<SyncState, string>,
  patch: SyncStatePatch,
): Promise<SyncState> {
  const current = (await readStateFromTable(stateTable)) ?? defaultState()
  const next: SyncState = {
    ...current,
    ...patch,
    key: STATE_KEY,
    ...(identityChanged(current, patch) ? { sessionEpoch: nextSessionEpoch(current) } : {}),
  }
  await stateTable.put(next)
  return next
}

type CredentialInitOptions = Partial<Pick<SyncState, 'enabled' | 'lastPulledRevision' | 'lastSyncAt'>>

export async function initCredentialsInTransaction(
  stateTable: Table<SyncState, string>,
  secret: string,
  keyId: string,
  options: CredentialInitOptions = {},
): Promise<SyncState> {
  const current = (await readStateFromTable(stateTable)) ?? defaultState()
  const next: SyncState = {
    ...current,
    ...options,
    deviceId: ulid(),
    secret,
    keyId,
    lastError: null,
    sessionEpoch: nextSessionEpoch(current),
    key: STATE_KEY,
  }
  await stateTable.put(next)
  return next
}

export async function disableInTransaction(
  stateTable: Table<SyncState, string>,
): Promise<SyncState | null> {
  const current = await readStateFromTable(stateTable)
  if (!current) return null
  const next: SyncState = {
    ...current,
    enabled: false,
    secret: null,
    keyId: null,
    lastPulledRevision: 0,
    lastSyncAt: null,
    lastError: null,
    sessionEpoch: nextSessionEpoch(current),
    key: STATE_KEY,
  }
  await stateTable.put(next)
  return next
}

export const syncRepository = {
  /* ------------------------------------------------------------------ */
  /* syncState                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * 读取同步状态。**没有行就返回 null** —— 调用方据此判断"从未启用过"，
   * 这是"同步默认关闭、不影响既有 App"的判断依据。
   */
  async getState(): Promise<SyncState | null> {
    return readStateFromTable(db.syncState)
  },

  /** 便捷方法：是否已启用且已配好凭据。引擎每次同步前都会问它。 */
  async isActive(): Promise<boolean> {
    const s = await this.getState()
    return s !== null && s.enabled && s.secret !== null
  },

  async setState(patch: SyncStatePatch): Promise<SyncState> {
    return db.transaction('rw', [db.syncState], () => setStateInTransaction(db.syncState, patch))
  },

  /**
   * 初始化配对信息（首次启用同步）。
   * 生成 deviceId 并写入凭据；**调用方负责在配对流程中决定 enabled 的时机**。
   */
  async initCredentials(
    secret: string,
    keyId: string,
    options: CredentialInitOptions = {},
  ): Promise<SyncState> {
    return db.transaction('rw', [db.syncState], () =>
      initCredentialsInTransaction(db.syncState, secret, keyId, options),
    )
  },

  /** 关闭同步：清凭据与游标，但**保留 outbox**（用户的数据不该因为关掉同步而丢） */
  async disable(): Promise<void> {
    await db.transaction('rw', [db.syncState], () => disableInTransaction(db.syncState))
  },

  /** 记录一次成功同步 */
  async markSynced(pullRevision: number): Promise<void> {
    const current = await this.getState()
    await this.setState({
      lastPulledRevision: Math.max(pullRevision, current?.lastPulledRevision ?? 0),
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    })
  },

  /** 记录一次失败（仅用于 UI 展示，不阻塞任何本地操作） */
  async markError(message: string): Promise<void> {
    await this.setState({ lastError: message })
  },

  /** 在会话仍然有效的同一事务里记录游标，旧响应不能推进新会话。 */
  async markSyncedForSession(session: SyncSession, pullRevision: number): Promise<boolean> {
    return db.transaction('rw', [db.syncState], async () => {
      const current = await readStateFromTable(db.syncState)
      if (!isCurrentSession(current, session)) return false
      await db.syncState.put({
        ...current!,
        lastPulledRevision: Math.max(pullRevision, current!.lastPulledRevision),
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      })
      return true
    })
  },

  /** 在会话仍然有效的同一事务里记录错误，旧请求不能污染新会话状态。 */
  async markErrorForSession(session: SyncSession, message: string): Promise<boolean> {
    return db.transaction('rw', [db.syncState], async () => {
      const current = await readStateFromTable(db.syncState)
      if (!isCurrentSession(current, session)) return false
      await db.syncState.put({ ...current!, lastError: message })
      return true
    })
  },

  /* ------------------------------------------------------------------ */
  /* syncQueue (outbox)                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * 把一个实体加入 outbox（独立调用，用于测试与运维场景）。
   *
   * ⚠️ **业务写入路径必须用 `enqueueWithTx`**，否则无法保证与业务写入原子。
   */
  async enqueue(entity: SyncEntity, entityId: string): Promise<void> {
    await upsertQueueEntry(db.syncQueue, entity, entityId)
  },

  /**
   * ⭐ 在事务内登记一条**删除**。
   *
   * 用途：tag 这类**物理删除**的实体。业务表里记录已经没了，
   * 但同步必须让另一台设备也把它消失 —— 所以「删除事实」要留在 outbox 里。
   *
   * @param deletedAt 删除时刻（软删用业务表的 deletedAt；物理删除用此刻）
   */
  async enqueueDeleteWithTx(
    entity: SyncEntity,
    entityId: string,
    tx: { table: (name: string) => Table<SyncQueueEntry, string> },
    deletedAt?: string | null,
    clientUpdatedAt?: string | null,
  ): Promise<void> {
    await upsertQueueEntry(tx.table('syncQueue'), entity, entityId, 'delete', {
      deletedAt,
      clientUpdatedAt,
    })
  },

  /** 事务外的删除登记（测试与运维用；业务路径请用 enqueueDeleteWithTx） */
  async enqueueDelete(entity: SyncEntity, entityId: string): Promise<void> {
    await upsertQueueEntry(db.syncQueue, entity, entityId, 'delete')
  },

  /**
   * ⭐ 在**调用方已经开启的 Dexie 事务**内入队。
   *
   * 这是业务写入路径唯一正确的用法：把 outbox 写入和业务表写入放进同一个事务，
   * 从根本上消除「业务写成功、outbox 写失败 → 变更永久丢失且无人察觉」的窗口。
   *
   * @param entity实体类型
   * @param entityId 实体 id
   * @param tx 调用方事务（通常由 `db.transaction('rw', [db.items, db.syncQueue], ...)` 产生）
   */
  async enqueueWithTx(
    entity: SyncEntity,
    entityId: string,
    tx: { table: (name: string) => Table<SyncQueueEntry, string> },
  ): Promise<void> {
    await upsertQueueEntry(tx.table('syncQueue'), entity, entityId)
  },

  /** 取出全部待推条目（按入队时间从旧到新，保证变更按时间序上云） */
  async listQueue(): Promise<SyncQueueEntry[]> {
    return db.syncQueue.orderBy('createdAt').toArray()
  },

  /** 待推条数（设置页展示用） */
  async pendingCount(): Promise<number> {
    return db.syncQueue.count()
  },

  /** 删除已成功推送的条目 */
  async dequeue(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    await db.syncQueue.bulkDelete([...ids])
  },

  /** 只在同一会话仍有效时出队；syncState 与 outbox 处于同一事务边界。 */
  async dequeueForSession(session: SyncSession, ids: readonly string[]): Promise<boolean> {
    return db.transaction('rw', [db.syncState, db.syncQueue], async () => {
      const current = await readStateFromTable(db.syncState)
      if (!isCurrentSession(current, session)) return false
      if (ids.length > 0) await db.syncQueue.bulkDelete([...ids])
      return true
    })
  },

  /**
   * 清除某个实体的 outbox 条目 —— **回声防护的关键**。
   *
   * apply 远端变更时，必须在同一事务里调用它：否则「我 pull 到的别人的变更」
   * 会留在 outbox 里，稍后又被当成「我改的」推回去，形成无限回环。
   */
  async clearEntity(entity: SyncEntity, entityId: string): Promise<void> {
    await db.syncQueue.where('[entity+entityId]').equals([entity, entityId]).delete()
  },

  /**
   * 清空 outbox（恢复备份后用：恢复出来的数据要全量重推，
   * 旧的待推条目已无意义）。
   */
  async clearQueue(): Promise<void> {
    await db.syncQueue.clear()
  },

  /** 把当前全部业务实体填入 outbox（首次启用同步 / 恢复备份后） */
  async enqueueAll(options: { preserveDeletes?: boolean } = {}): Promise<number> {
    const [items, categories, tags] = await Promise.all([
      db.items.toArray(),
      db.categories.toArray(),
      db.tags.toArray(),
    ])
    const currentKeys = new Set([
      ...items.map((row) => `item:${row.id}`),
      ...categories.map((row) => `category:${row.id}`),
      ...tags.map((row) => `tag:${row.id}`),
    ])
    const preservedDeletes = options.preserveDeletes
      ? (await db.syncQueue.toArray()).filter(
          (entry) => entry.op === 'delete' && !currentKeys.has(`${entry.entity}:${entry.entityId}`),
        )
      : []
    await db.syncQueue.clear()
    const now = new Date().toISOString()
    const rows: SyncQueueEntry[] = [
      ...items.map((r) => ({ id: ulid(), entity: 'item' as const, entityId: r.id, createdAt: now })),
      ...categories.map((r) => ({
        id: ulid(),
        entity: 'category' as const,
        entityId: r.id,
        createdAt: now,
      })),
      ...tags.map((r) => ({ id: ulid(), entity: 'tag' as const, entityId: r.id, createdAt: now })),
    ]
    await db.syncQueue.bulkAdd([...preservedDeletes, ...rows])
    return preservedDeletes.length + rows.length
  },

  /* ------------------------------------------------------------------ */
  /* syncConflicts（「冲突事后可查」的本地落点）                          */
  /* ------------------------------------------------------------------ */

  /**
   * 记一条覆盖记录。
   *
   * 只在**覆盖方**设备落库（被覆盖方下次 pull 自然拿到最终值，
   * 它对本次覆盖无感 —— 这是第一版不弹人工合并窗的取舍）。
   */
  async recordConflict(conflict: Omit<SyncConflict, 'id'>): Promise<void> {
    await db.syncConflicts.add({ ...conflict, id: ulid() })
    await this.pruneConflicts()
  },

  /** 冲突记录也不能由已经失效的网络响应写入新会话。 */
  async recordConflictForSession(
    session: SyncSession,
    conflict: Omit<SyncConflict, 'id'>,
  ): Promise<boolean> {
    return db.transaction('rw', [db.syncState, db.syncConflicts], async () => {
      const current = await readStateFromTable(db.syncState)
      if (!isCurrentSession(current, session)) return false
      await db.syncConflicts.add({ ...conflict, id: ulid() })
      await this.pruneConflicts()
      return true
    })
  },

  /** 超出上限时删除最旧的记录，保证这张表不会无限膨胀 */
  async pruneConflicts(): Promise<void> {
    const count = await db.syncConflicts.count()
    if (count <= SYNC_CONFLICT_LIMIT) return
    const excess = await db.syncConflicts.orderBy('detectedAt').limit(count - SYNC_CONFLICT_LIMIT).primaryKeys()
    if (excess.length > 0) await db.syncConflicts.bulkDelete(excess)
  },

  /** 最近的覆盖记录（新的在前） */
  async listConflicts(limit = 20): Promise<SyncConflict[]> {
    return db.syncConflicts.orderBy('detectedAt').reverse().limit(limit).toArray()
  },

  async clearConflicts(): Promise<void> {
    await db.syncConflicts.clear()
  },

  async deleteConflict(id: string): Promise<void> {
    await db.syncConflicts.delete(id)
  },

  async conflictCount(): Promise<number> {
    return db.syncConflicts.count()
  },
}
