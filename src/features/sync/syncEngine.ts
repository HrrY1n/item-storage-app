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
  summarizeSync,
} from './syncPolicy'
import { SYNC_PUSH_BATCH_SIZE } from './syncLimits'
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
      //
      // ⚠️ Local-first 硬不变量（Phase 3B 复审第 6 条）：
      //   push 一旦失败，本轮**立刻停止**，绝不继续 pull。
      //   因为本地还有未成功上云的修改，若继续 pull，apply 会用远端旧值
      //   覆盖它们、再清掉 outbox 条目 → 用户的本地改动凭空消失且无法找回。
      const queue = await syncRepository.listQueue()
      // 本轮成功提交的 outbox entry id 集合（用于精确 dequeue 与精确回声防护）
      const succeededEntryIds = new Set<string>()
      if (queue.length > 0) {
        const batches = chunk(queue, SYNC_PUSH_BATCH_SIZE)
        for (const batch of batches) {
          const changes = await this.buildPushChanges(batch)
          const result = await transport.push(changes)
          if (!result.ok) {
            errorKind = result.kind
            break
          }
          // ⚠️ 出队只认**entry id**，绝不按 entityId 匹配。
          //
          //   原因：outbox 的 enqueue 是「先删后插」，所以同一次 push 飞行期间
          //   用户再编辑同一实体时，V1（老 id）被删、V2（新 id）被插入。
          //   若按 entityId 匹配出队，V2 会被一起删掉 → 那次编辑永远同步不上。
          //
          //   因此这里校验：本批entry 的 id 是否**仍然是 outbox 里那一条**
          //（V1 若已被 V2 顶掉，就不该再出队），是则精确删除它。
          const currentIds = new Set((await syncRepository.listQueue()).map((r) => r.id))
          const doneEntries = batch.filter((r) => currentIds.has(r.id))
          for (const e of doneEntries) succeededEntryIds.add(e.id)
          await syncRepository.dequeue(doneEntries.map((r) => r.id))
          pushed += result.accepted

          // ⭐ tag 跨设备去重（复审第 9 条）：把本地的重复 tag 合并到云端既有那条
          for (const d of result.dedupDirectives) {
            await this.mergeDuplicateTag(d.duplicateId, d.canonicalId)
          }

          for (const c of result.conflicts) {
            await this.recordConflicts(c)
            conflicts += 1
          }
        }
      }

      // ---- pull：只在 push 全部成功（或本轮没有待推）时才执行 ----
      if (errorKind !== null) {
        // 保留 outbox 原样，不动游标，等下次联网重试
        return { ok: false, pushed, pulled: 0, conflicts, errorKind }
      }

      // 本轮真正出队的 entry id 集合。
      // apply 时按 **entry id** 判断是否清除该实体的 outbox 条目 ——
      // 只有"本批那个 entry"仍然在场时才清，绝不碰用户飞行期间新产生的那条。
      const currentAfterPush = new Set((await syncRepository.listQueue()).map((r) => r.id))
      const succeededEntities = new Set<string>()
      for (const entry of queue) {
        if (!succeededEntryIds.has(entry.id)) continue
        if (!currentAfterPush.has(entry.id)) continue
        succeededEntities.add(`${entry.entity}:${entry.entityId}`)
      }

      let cursor = (await syncRepository.getState())?.lastPulledRevision ?? 0
      for (;;) {
        const result = await transport.pull(cursor)
        if (!result.ok) {
          errorKind = result.kind
          break
        }
        if (result.changes.length === 0) break
        await this.applyRemote(result.changes, succeededEntities)
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
    batch: Array<{ entity: SyncEntity; entityId: string; op?: 'upsert' | 'delete'; deletedAt?: string | null; clientUpdatedAt?: string | null }>,
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
      // ⭐ 物理删除（tag 删��/ 合并）：业务表里读不到数据，
      //   删除时间等信息必须来自 outbox 条目本身。
      if (entry.op === 'delete') {
        out.push({
          entity: entry.entity,
          entityId: entry.entityId,
          payload: {},
          deletedAt: entry.deletedAt ?? new Date().toISOString(),
          clientUpdatedAt: entry.clientUpdatedAt ?? entry.deletedAt ?? new Date().toISOString(),
          baseRevision,
        })
        continue
      }

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

  /**
   * 把本地的重复 tag 合并到云端既有的那条。
   *
   * 两台设备各自离线建了同名 tag 时用。步骤（**单个事务**）：
   *  1. 引用重复 tag 的所有物品，把tagId 换成既有的 id
   *  2. 删除重复 tag 本身
   *  3. 受影响的物品重新入队（它们的 tagIds 变了）
   *
   * itemTags 的复合主键是 [itemId+tagId]，因此若物品同时已关联既有 tag，
   * 直接 bulkAdd 会撞约束 —— 先查再决定 put还是跳过。
   */
  private async mergeDuplicateTag(duplicateId: string, canonicalId: string): Promise<void> {
    await db.transaction('rw', [db.items, db.itemTags, db.tags, db.syncQueue], async (tx) => {
      const dup = await db.tags.get(duplicateId)
      // 重复的tag 已不存在 → 无需合并（幂等）
      if (dup === undefined) return

      const links = await db.itemTags.where('tagId').equals(duplicateId).toArray()
      for (const link of links) {
        const already = await db.itemTags.get([link.itemId, canonicalId])
        if (already === undefined) {
          await db.itemTags.put({ itemId: link.itemId, tagId: canonicalId })
        }
        await db.itemTags.delete([link.itemId, duplicateId])
        // 该物品的 tagIds 变了 → 重新入队
        await syncRepository.enqueueWithTx('item', link.itemId, tx)
      }
      await db.tags.delete(duplicateId)
    })
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
  private async applyRemote(
    changes: RemoteChange[],
    /**
     * 本轮 push **成功提交**的实体集合（形如 `item:i1`）。
     * 只有这些实体的 outbox 条目才允许在 apply 时被清除。
     */
    succeededQueueIds: Set<string> | null,
  ): Promise<void> {
    await db.transaction(
      'rw',
      [db.items, db.itemTags, db.categories, db.tags, db.syncQueue],
      async (tx) => {
        // ⚠️ 顺序很重要：**先处理删除，再处理 upsert**。
        //   若某物品的旧载荷（tagIds 里还带着已删的 tag-x）先被应用，
        //   它会把关联重新建回来；随后 tag 删除才清一次 —— 但如果 item 因为
        //   "仍有待推条目"被跳过，关联就永久残留。
        //   先做删除则不存在这个次序问题：删除已经把关联清干净，
        //   后续 item 的 apply 只会写它自己的载荷。
        const ordered = [...changes].sort((a, b) => {
          const aDel = a.deletedAt !== null ? 0 : 1
          const bDel = b.deletedAt !== null ? 0 : 1
          return aDel - bDel
        })

        for (const change of ordered) {
          const entity = change.entity as SyncEntity

          // ⭐⭐ 最关键的一条（复审第 6 条）：**该实体仍有待推条目时，完全不碰它**。
          //
          //   场景：push V1 飞行中用户又改了同一实体 → outbox 里是 V2。
          //   云端此刻是 V1，pull 回来的也是 V1。若无条件 apply，
          //   V1 会覆盖本地刚编辑出的 V2 → 用户的编辑凭空消失，
          //   而且 V2 还在 outbox 里，下一轮又会被推一次，来回震荡。
          //
          //   因此这里检查 outbox：只要这个实体还有未推送的改动，
          //   就跳过 apply（本地版本比云端新，理应优先）。
          const pending = await db.syncQueue
            .where('[entity+entityId]')
            .equals([entity, change.entityId])
            .count()
          if (pending > 0) {
            // 该实体有本地未推送的改动 → 不应用远端版本。
            // ⚠️ 但**远端的删除仍然必须落地**：本地那条待推记录是我们自己
            //    的旧改动，它不该阻止"另一台设备已经把它删了"这个事实生效。
            //    否则物品/标签会在本机永久残留，而且 outbox 里那条旧记录
            //    每轮都会被推上去、被服务端忽略（tombstone），永远出不了队。
            if (change.deletedAt !== null) {
              // 本地删除即可（物理删除的实体）或标记软删（软删的实体）
              if (entity === 'item') {
                await db.items.update(change.entityId, { deletedAt: change.deletedAt })
                await db.itemTags.where('itemId').equals(change.entityId).delete()
              } else if (entity === 'category') {
                await db.categories.update(change.entityId, { deletedAt: change.deletedAt })
              } else if (entity === 'tag') {
                await db.tags.delete(change.entityId)
                const links = await db.itemTags.where('tagId').equals(change.entityId).toArray()
                await db.itemTags.where('tagId').equals(change.entityId).delete()
                // ⚠️ 关键：受影响物品的 **itemTags 之外**，其上传载荷里的
                //   tagIds 字段也必须剔除该 tag。否则这些物品在下一轮 push 时
                //   会把已删的 tagId 再带上云，形成"幽灵引用"。
                //   （这些物品的本地数据本身不动，只是重写入队让载荷刷新。）
                for (const link of links) {
                  const item = await db.items.get(link.itemId)
                  if (item !== undefined && item.deletedAt === null) {
                    await syncRepository.enqueueWithTx('item', link.itemId, tx)
                  }
                }
              }
              // 顺带清掉这个实体的 outbox：它已被服务端 tombstone，再推也是被忽略
              await syncRepository.clearEntity(entity, change.entityId)
            }
            continue
          }

          // 回声防护：只有本轮确实推送成功过的实体，才清它的 outbox 条目
          if (succeededQueueIds !== null && succeededQueueIds.has(`${entity}:${change.entityId}`)) {
            await syncRepository.clearEntity(entity, change.entityId)
          }

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
    const deletedAt = change.deletedAt

    // ⭐ tag 是物理删除，远端删除后本地必须**真的删掉**，
    //   否则另一台设备会永远保留已删标签，且它的旧副本还能把它"复活"。
    //   （本地 Dexie 的 nameNormalized 唯一索引保证不会残留重名标签。）
    if (deletedAt !== null) {
      await db.tags.delete(change.entityId)
      // 连带清掉引用它的关联（等价于本地 delete 的效果）
      await db.itemTags.where('tagId').equals(change.entityId).delete()
      return
    }

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