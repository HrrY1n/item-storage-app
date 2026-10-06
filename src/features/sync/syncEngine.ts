import { db } from '../../db/db'
import { syncRepository } from '../../db/repositories/syncRepository'
import { itemRepository } from '../../db/repositories/itemRepository'
import {
  buildItemTagRows,
  decodeCategoryPayload,
  decodeItemPayload,
  decodeTagIds,
  decodeTagPayload,
  encodeCategoryPayload,
  encodeItemPayload,
  encodeTagPayload,
  type SyncEntity,
} from '../../domain/syncPayload'
import type { Category, Item, Tag } from '../../domain/types'
import {
  chunk,
  shouldRequestSync,
  syncSummaryToMessage,
  type SyncErrorKind,
  type SyncReason,
  type SyncStatusSummary,
  SYNC_PUSH_BATCH_SIZE,
  summarizeSync,
} from './syncPolicy'
import { SyncTransport, type PushConflict, type RemoteChange, type TransportHost } from './syncTransport'

/**
 * 同步引擎：编排 push / pull / apply。
 *
 * ## 不可违反的三条
 *
 * 1. **绝不阻塞、不修改用户的本地业务数据**。同步失败只记 lastError（供 UI 展示），
 *    任何情况下都不删本地数据、不回滚本地写入、不弹阻塞对话框。
 * 2. **apply 远端变更必须与清除 outbox 残留同事务**。否则「我pull 到的别人的变更」
 *    会留在 outbox 里被当成「我改的」推回去，形成无限回环。
 * 3. **删除单向传播**。远端 deletedAt 非空时，本地也置 deletedAt（不做物理删除），
 *    本地已有的更新**不会**把远端删除复活（那是 Worker 侧 tombstone 规则的职责）。
 */

export interface SyncEngineHost extends TransportHost {
  now(): number
}

export interface SyncOutcome {
  ok: boolean
  pushed: number
  pulled: number
  conflicts: number
  errorKind: SyncErrorKind | null
}

export interface SyncEngineOptions {
  baseUrl: string
}

export class SyncEngine {
  private readonly host: SyncEngineHost
  private readonly options: SyncEngineOptions
  private inFlight = false
  private lastAttemptAt: number | null = null
  private retryCount = 0
  private listeners = new Set<() => void>()

  constructor(host: SyncEngineHost, options: SyncEngineOptions) {
    this.host = host
    this.options = options
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  /** 决策：此刻该不该同步（含未启用/未配好/离线/节流判断） */
  async shouldSync(reason: SyncReason, online: boolean): Promise<boolean> {
    const state = await syncRepository.getState()
    return shouldRequestSync({
      reason,
      enabled: state?.enabled === true,
      configured: state?.secret !== null && state !== null && state.secret !== undefined,
      online,
      now: this.host.now(),
      lastAttemptAt: this.lastAttemptAt,
      inFlight: this.inFlight,
    })
  }

  /**
   * 执行一次完整同步。
   *
   * 顺序刻意是 **先 push 后 pull**：本地改动先上云，随后拉取就会把自己这一批
   * 也算进返回结果（服务端 revision 已推进），从而顺带确认"云端确实收到了"。
   */
  async run(): Promise<SyncOutcome> {
    if (this.inFlight) {
      return { ok: false, pushed: 0, pulled: 0, conflicts: 0, errorKind: null }
    }
    this.inFlight = true
    this.lastAttemptAt = this.host.now()
    this.emit()

    let pushed = 0
    let pulled = 0
    let conflicts = 0
    let errorKind: SyncErrorKind | null = null

    try {
      const state = await syncRepository.getState()
      if (state === null || state.secret === null || state.deviceId === null) {
        return { ok: false, pushed: 0, pulled: 0, conflicts: 0, errorKind: null }
      }

      const transport = new SyncTransport(this.host, {
        baseUrl: this.options.baseUrl,
        deviceId: state.deviceId,
        secret: state.secret,
      })

      // ---- push ----
      const queue = await syncRepository.listQueue()
      if (queue.length > 0) {
        const batches = chunk(queue, SYNC_PUSH_BATCH_SIZE)
        for (const batch of batches) {
          const changes = await this.buildPushChanges(batch)
          const result = await transport.push(changes)
          if (!result.ok) {
            errorKind = result.kind
            break
          }
          // 被服务端接受的条目才出队；被忽略的（tombstone）也出队，
          // 否则它们会永远卡在 outbox 里反复重试。
          await syncRepository.dequeue(batch.map((r) => r.id))
          pushed += result.accepted

          for (const c of result.conflicts) {
            await this.recordConflicts(c)
            conflicts += 1
          }
        }
      }

      // ---- pull（push 失败时也尝试 pull：拉取是幂等的，且可能带回别人的更新）----
      let cursor = (await syncRepository.getState())?.lastPulledRevision ?? 0
      for (;;) {
        const result = await transport.pull(cursor)
        if (!result.ok) {
          errorKind = result.kind
          break
        }
        if (result.changes.length === 0) break
        await this.applyRemote(result.changes)
        cursor = result.nextRevision
        pulled += result.changes.length
        if (!result.hasMore) break
      }
      await syncRepository.markSynced(cursor)

      if (errorKind === null) {
        this.retryCount = 0
      }
      return { ok: errorKind === null, pushed, pulled, conflicts, errorKind }
    } catch {
      // 兜底：任何意外都不得影响App 使用
      return { ok: false, pushed, pulled, conflicts, errorKind: 'unknown' }
    } finally {
      this.inFlight = false
      if (errorKind !== null) {
        this.retryCount += 1
        void syncRepository.markError(errorKind)
      } else {
        this.retryCount = 0
      }
      this.emit()
    }
  }

  /** 把 outbox 条目组装成 push 请求（含从业务表读当前值） */
  private async buildPushChanges(
    batch: Array<{ entity: SyncEntity; entityId: string }>,
  ): Promise<
    Array<{
      entity: SyncEntity
      entityId: string
      payload: unknown
      deletedAt: string | null
      clientUpdatedAt: string
      baseRevision: number
    }>
  > {
    const state = await syncRepository.getState()
    const baseRevision = state?.lastPulledRevision ?? 0
    const out: Array<{
      entity: SyncEntity
      entityId: string
      payload: unknown
      deletedAt: string | null
      clientUpdatedAt: string
      baseRevision: number
    }> = []

    for (const entry of batch) {
      if (entry.entity === 'item') {
        const item = await db.items.get(entry.entityId)
        if (item === undefined) {
          // 本地已被物理删除（只可能来自 restoreFromPayload）：跳过，
          // 留一条删除标记让云端也清掉
          out.push({
            entity: 'item',
            entityId: entry.entityId,
            payload: {},
            deletedAt: new Date().toISOString(),
            clientUpdatedAt: new Date().toISOString(),
            baseRevision,
          })
          continue
        }
        const tagIds = await itemRepository.tagIdsOf(item.id)
        out.push({
          entity: 'item',
          entityId: item.id,
          payload: encodeItemPayload(item, tagIds),
          deletedAt: item.deletedAt,
          clientUpdatedAt: item.updatedAt,
          baseRevision,
        })
      } else if (entry.entity === 'category') {
        const category = await db.categories.get(entry.entityId)
        if (category === undefined) continue
        out.push({
          entity: 'category',
          entityId: category.id,
          payload: encodeCategoryPayload(category),
          deletedAt: category.deletedAt,
          clientUpdatedAt: category.updatedAt,
          baseRevision,
        })
      } else {
        const tag = await db.tags.get(entry.entityId)
        if (tag === undefined) continue
        out.push({
          entity: 'tag',
          entityId: tag.id,
          payload: encodeTagPayload(tag),
          deletedAt: null,
          clientUpdatedAt: tag.updatedAt,
          baseRevision,
        })
      }
    }
    return out
  }

  /** 落一条冲突记录（只在覆盖方） */
  private async recordConflicts(c: PushConflict): Promise<void> {
    await syncRepository.recordConflict({
      entity: c.entity as SyncEntity,
      entityId: c.entityId,
      detectedAt: c.detectedAt,
      loserUpdatedAt: c.loserUpdatedAt,
      winnerDeviceId: c.winnerDeviceId,
      winnerUpdatedAt: c.winnerUpdatedAt,
      loserSummary: c.loserSummary,
      winnerSummary: c.winnerSummary,
    })
  }

  /**
   * ⭐ 在**单个事务**里应用一批远端变更。
   *
   * 同一事务内做两件事，缺一不可：
   * - 写入业务表
   * - 清除该实体在 outbox 里的残留条目（回声防护）
   */
  private async applyRemote(changes: RemoteChange[]): Promise<void> {
    await db.transaction(
      'rw',
      [db.items, db.itemTags, db.categories, db.tags, db.syncQueue],
      async () => {
        for (const change of changes) {
          const entity = change.entity as SyncEntity
          // 回声防护：无论本次是新增还是更新，都先清掉本实体的待推条目
          await syncRepository.clearEntity(entity, change.entityId)

          if (entity === 'item') {
            await this.applyRemoteItem(change)
          } else if (entity === 'category') {
            await this.applyRemoteCategory(change)
          } else if (entity === 'tag') {
            await this.applyRemoteTag(change)
          }
        }
      },
    )
  }

  private async applyRemoteItem(change: RemoteChange): Promise<void> {
    const deletedAt = change.deletedAt
    const item: Item | null = decodeItemPayload(change.entityId, change.payload)

    // ★ 删除信息独立于 payload 处理。
    //   远端可能只发来一条"这个物品被删了"（payload 为空或已损坏），
    //   此时若因为解不出 payload 就return，删除就永远不会传播到本机——
    //   "删除不被复活"这条不变量会出现漏洞，物品会在另一台设备上永远留着。
    if (item === null) {
      if (deletedAt !== null) {
        await db.items.update(change.entityId, { deletedAt })
      }
      return
    }

    const tagIds = decodeTagIds(change.payload)
    const existing = await db.items.get(change.entityId)
    if (existing !== undefined) {
      await db.items.update(change.entityId, { ...item, deletedAt })
    } else {
      // 远端已删而本地完全没有该记录：不凭空造出一条僵尸数据
      if (deletedAt === null) await db.items.add({ ...item, deletedAt })
    }
    // 重写关联（用复合主键，先删后插；远端重复的 tagId 已在 decodeTagIds 去重）
    await db.itemTags.where('itemId').equals(change.entityId).delete()
    const rows = buildItemTagRows(change.entityId, tagIds)
    if (rows.length > 0) await db.itemTags.bulkAdd(rows)
  }

  private async applyRemoteCategory(change: RemoteChange): Promise<void> {
    const deletedAt = change.deletedAt
    const category: Category | null = decodeCategoryPayload(change.entityId, change.payload)
    // 与 item 同理：删除信息独立于 payload，纯删除时也要能传播
    if (category === null) {
      if (deletedAt !== null) {
        await db.categories.update(change.entityId, { deletedAt })
      }
      return
    }
    const existing = await db.categories.get(change.entityId)
    if (existing !== undefined) {
      await db.categories.update(change.entityId, { ...category, deletedAt })
    } else if (deletedAt === null) {
      // 远端已删而本地没有 → 不凭空创建
      await db.categories.add({ ...category, deletedAt })
    }
  }

  private async applyRemoteTag(change: RemoteChange): Promise<void> {
    const tag: Tag | null = decodeTagPayload(change.entityId, change.payload)
    if (tag === null) return
    const existing = await db.tags.get(change.entityId)
    if (existing !== undefined) {
      // 不覆盖 updatedAt：远端 updatedAt 可能比本地旧（冲突时是它赢），
      // 直接写会让本地看起来"更新过"，影响后续展示。
      await db.tags.update(change.entityId, {
        name: tag.name,
        nameNormalized: tag.nameNormalized,
      })
    } else {
      await db.tags.add(tag)
    }
  }

  /** 当前状态摘要（设置页展示） */
  async summary(online: boolean): Promise<SyncStatusSummary> {
    const state = await syncRepository.getState()
    const pendingCount = await syncRepository.pendingCount()
    return summarizeSync({
      enabled: state?.enabled === true,
      configured: state !== null && typeof state.secret === 'string' && state.secret !== '',
      online,
      pendingCount,
      syncing: this.inFlight,
      lastSyncAt: state?.lastSyncAt ?? null,
      lastError: state?.lastError ?? null,
    })
  }

  /** 设置页用：把状态翻成一句中文 */
  async statusMessage(online: boolean): Promise<string> {
    const s = await this.summary(online)
    return syncSummaryToMessage(s, this.host.now())
  }
}