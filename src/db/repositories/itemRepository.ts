import { ulid } from 'ulid'
import { db } from '../db'
import { markSyncDirty } from '../syncDirty'
import { syncRepository } from './syncRepository'
import type { DisposalMethod, Item, ItemStatus, PurchasePlatform } from '../../domain/types'
import { restoreToOwnedFields, sanitizeLifecycle } from '../../domain/lifecycle'

/**
 * Item repository —— 唯一直接操作 items / itemTags 表的地方。
 * 所有列表查询默认排除 soft-deleted。
 */

export interface ItemInput {
  name: string
  categoryId: string
  iconAssetId: string
  note: string
  tagIds: string[]
  /** 生命周期状态；旧调用方不传时按 'owned' 处理 */
  status: ItemStatus
  /** 购买信息（全部可选） */
  purchaseDate: string | null
  purchasePriceCents: number | null
  additionalCostCents: number | null
  purchasePlatform: PurchasePlatform | null
  /** 保修到期日 YYYY-MM-DD；null = 未填写 */
  warrantyExpiresAt: string | null
  /** 处置信息（仅 status='disposed' 有效，写入前会被规范化） */
  disposedAt: string | null
  disposalMethod: DisposalMethod | null
  salePriceCents: number | null
  disposalNote: string | null
}

const notDeleted = (i: Item) => i.deletedAt === null

/** 生命周期字段的写入一律经过规范化，保证不变量在数据层就被强制 */
function lifeFields(input: ItemInput) {
  return sanitizeLifecycle({
    status: input.status,
    disposedAt: input.disposedAt,
    disposalMethod: input.disposalMethod,
    salePriceCents: input.salePriceCents,
    disposalNote: input.disposalNote,
  })
}

export const itemRepository = {
  async listActive(): Promise<Item[]> {
    const all = await db.items.toArray()
    return all.filter(notDeleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },

  async getActive(id: string): Promise<Item | undefined> {
    const item = await db.items.get(id)
    return item && notDeleted(item) ? item : undefined
  },

  async recent(n: number): Promise<Item[]> {
    const list = await this.listActive()
    return list.slice(0, n)
  },

  async countActive(): Promise<number> {
    return db.items.filter(notDeleted).count()
  },

  /** 某分类（含子分类 id 集合，由调用方提供）下的活跃物品 */
  async listByCategoryIds(categoryIds: ReadonlySet<string>): Promise<Item[]> {
    const all = await db.items.where('categoryId').anyOf([...categoryIds]).toArray()
    return all.filter(notDeleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },

  async countByCategoryId(categoryId: string): Promise<number> {
    return db.items.where('categoryId').equals(categoryId).filter(notDeleted).count()
  },

  async create(input: ItemInput): Promise<Item> {
    const name = input.name.trim()
    if (!name) throw new Error('名称不能为空')
    const now = new Date().toISOString()
    const life = lifeFields(input)
    const item: Item = {
      id: ulid(),
      name,
      categoryId: input.categoryId,
      note: input.note.trim(),
      iconAssetId: input.iconAssetId,
      sourceType: 'preset',
      status: life.status,
      purchaseDate: input.purchaseDate,
      purchasePriceCents: input.purchasePriceCents,
      additionalCostCents: input.additionalCostCents,
      purchasePlatform: input.purchasePlatform,
      warrantyExpiresAt: input.warrantyExpiresAt,
      disposedAt: life.disposedAt,
      disposalMethod: life.disposalMethod,
      salePriceCents: life.salePriceCents,
      disposalNote: life.disposalNote,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    // ⚠️ syncQueue 在同一个事务里：保证「业务写入成功但 outbox 没写」这种
    //    静默丢改动的窗口不存在（Phase 3B 步4硬要求）
    await db.transaction('rw', [db.items, db.itemTags, db.syncQueue], async (tx) => {
      await db.items.add(item)
      if (input.tagIds.length > 0) {
        await db.itemTags.bulkAdd(input.tagIds.map((tagId) => ({ itemId: item.id, tagId })))
      }
      await syncRepository.enqueueWithTx('item', item.id, tx)
    })
    // ⭐ Phase 3B.1：事务**已提交**之后才通知同步层（事务内绝不碰网络/定时器）
    markSyncDirty()
    return item
  },

  async update(id: string, input: ItemInput): Promise<void> {
    const name = input.name.trim()
    if (!name) throw new Error('名称不能为空')
    const now = new Date().toISOString()
    const life = lifeFields(input)
    await db.transaction('rw', [db.items, db.itemTags, db.syncQueue], async (tx) => {
      const existing = await db.items.get(id)
      if (!existing || existing.deletedAt) throw new Error('物品不存在')
      await db.items.update(id, {
        name,
        categoryId: input.categoryId,
        note: input.note.trim(),
        iconAssetId: input.iconAssetId,
        status: life.status,
        purchaseDate: input.purchaseDate,
        purchasePriceCents: input.purchasePriceCents,
        additionalCostCents: input.additionalCostCents,
        purchasePlatform: input.purchasePlatform,
        warrantyExpiresAt: input.warrantyExpiresAt,
        disposedAt: life.disposedAt,
        disposalMethod: life.disposalMethod,
        salePriceCents: life.salePriceCents,
        disposalNote: life.disposalNote,
        updatedAt: now,
      })
      // 重写关联：先删后插
      await db.itemTags.where('itemId').equals(id).delete()
      if (input.tagIds.length > 0) {
        await db.itemTags.bulkAdd(input.tagIds.map((tagId) => ({ itemId: id, tagId })))
      }
      await syncRepository.enqueueWithTx('item', id, tx)
    })
    markSyncDirty()
  },

  /** 读取某物品当前的标签 id 集合（供只改部分字段的操作复用，避免误清空标签） */
  async tagIdsOf(id: string): Promise<string[]> {
    const links = await db.itemTags.where('itemId').equals(id).toArray()
    return links.map((l) => l.tagId)
  },

  /**
   * 心愿 → 持有：只改状态与购买信息，**保留原有标签**。
   * 不删除任何已有字段。
   */
  async convertToOwned(id: string, purchase: {
    purchaseDate: string | null
    purchasePriceCents: number | null
    additionalCostCents: number | null
    purchasePlatform: PurchasePlatform | null
    warrantyExpiresAt: string | null
  }): Promise<void> {
    const item = await this.getActive(id)
    if (!item) throw new Error('物品不存在')
    await this.update(id, {
      name: item.name,
      categoryId: item.categoryId,
      iconAssetId: item.iconAssetId,
      note: item.note,
      tagIds: await this.tagIdsOf(id),
      status: 'owned',
      ...purchase,
      disposedAt: null,
      disposalMethod: null,
      salePriceCents: null,
      disposalNote: null,
    })
  },

  /** 恢复为持有：清空全部处置字段，**保留**购买数据；持有天数重新按今天计算 */
  async restoreToOwned(id: string): Promise<void> {
    const item = await this.getActive(id)
    if (!item) throw new Error('物品不存在')
    const life = restoreToOwnedFields()
    // Phase 3B：走事务，生命周期变化必须与 outbox 入队原子发生
    await db.transaction('rw', [db.items, db.syncQueue], async (tx) => {
      await db.items.update(id, {
        status: life.status,
        disposedAt: life.disposedAt,
        disposalMethod: life.disposalMethod,
        salePriceCents: life.salePriceCents,
        disposalNote: life.disposalNote,
        updatedAt: new Date().toISOString(),
      })
      await syncRepository.enqueueWithTx('item', id, tx)
    })
    markSyncDirty()
  },

  /**
   * 软删。
   *
   * ⚠️ 原本只是一次 db.items.update（没有事务）。Phase 3B 给它补上事务，
   *    让「置deletedAt」与「outbox 入队」原子发生 —— 否则软删可能同步不出去，
   *    而同步设计明确要求删除一旦发生就不被旧设备复活，删除必须可靠上云。
   */
  async softDelete(id: string): Promise<void> {
    const now = new Date().toISOString()
    await db.transaction('rw', [db.items, db.syncQueue], async (tx) => {
      await db.items.update(id, { deletedAt: now, updatedAt: now })
      await syncRepository.enqueueWithTx('item', id, tx)
    })
    markSyncDirty()
  },
}
