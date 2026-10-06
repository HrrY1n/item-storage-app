import { ulid } from 'ulid'
import type { Table } from 'dexie'
import { db } from '../db'
import type { SyncConflict, SyncEntity, SyncQueueEntry, SyncState } from '../../domain/types'

/**
 * 同步相关的本地状态读写（Phase 3B）。
 *
 * ⚠️ 本文件是 repository 层，是**唯一**允许 import db 的地方之一。
 *
 * 三张表全部是**纯本地状态**，都不进 ZIP 备份
 * （syncState 含 Bearer secret 明文 —— 详见 3B 计划 §6）。
 */

const STATE_KEY = 'sync'

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
async function upsertQueueEntry(table: Table<SyncQueueEntry, string>, entity: SyncEntity, entityId: string): Promise<void> {
  // 用 [entity+entityId] 唯一索引做幂等：同一实体改了 5 次仍只有 1 条待推
  await table.where('[entity+entityId]').equals([entity, entityId]).delete()
  await table.add({
    id: ulid(),
    entity,
    entityId,
    createdAt: new Date().toISOString(),
  })
}

/** 未配置时的默认状态：同步**默认关闭** */
function defaultState(): SyncState {
  return {
    key: STATE_KEY,
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

export const syncRepository = {
  /* ------------------------------------------------------------------ */
  /* syncState                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * 读取同步状态。**没有行就返回 null** —— 调用方据此判断"从未启用过"，
   * 这是"同步默认关闭、不影响既有 App"的判断依据。
   */
  async getState(): Promise<SyncState | null> {
    const row = await db.syncState.get(STATE_KEY)
    if (!row) return null
    // 补齐可能缺失的字段，容忍旧行结构
    return { ...defaultState(), ...row, key: STATE_KEY }
  },

  /** 便捷方法：是否已启用且已配好凭据。引擎每次同步前都会问它。 */
  async isActive(): Promise<boolean> {
    const s = await this.getState()
    return s !== null && s.enabled && s.secret !== null
  },

  async setState(patch: Partial<Omit<SyncState, 'key'>>): Promise<SyncState> {
    const current = await this.getState()
    const next: SyncState = { ...(current ?? defaultState()), ...patch, key: STATE_KEY }
    await db.syncState.put(next)
    return next
  },

  /**
   * 初始化配对信息（首次启用同步）。
   * 生成 deviceId 并写入凭据；**调用方负责在配对流程中决定 enabled 的时机**。
   */
  async initCredentials(secret: string, keyId: string): Promise<SyncState> {
    return this.setState({
      deviceId: ulid(),
      secret,
      keyId,
      // 启用与否由调用方显式决定（A 设备配对时要等 B 确认）
      lastError: null,
    })
  },

  /** 关闭同步：清凭据与游标，但**保留 outbox**（用户的数据不该因为关掉同步而丢） */
  async disable(): Promise<void> {
    const current = await this.getState()
    if (!current) return
    await this.setState({
      enabled: false,
      secret: null,
      keyId: null,
      lastPulledRevision: 0,
      lastSyncAt: null,
      lastError: null,
    })
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
  async enqueueAll(): Promise<number> {
    const [items, categories, tags] = await Promise.all([
      db.items.toArray(),
      db.categories.toArray(),
      db.tags.toArray(),
    ])
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
    await db.syncQueue.bulkAdd(rows)
    return rows.length
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