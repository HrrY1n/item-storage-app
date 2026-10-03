import { ulid } from 'ulid'
import { db } from '../db'
import type { Item, PurchasePlatform } from '../../domain/types'

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
  /** 购买信息（全部可选） */
  purchaseDate: string | null
  purchasePriceCents: number | null
  additionalCostCents: number | null
  purchasePlatform: PurchasePlatform | null
}

const notDeleted = (i: Item) => i.deletedAt === null

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
    const item: Item = {
      id: ulid(),
      name,
      categoryId: input.categoryId,
      note: input.note.trim(),
      iconAssetId: input.iconAssetId,
      sourceType: 'preset',
      purchaseDate: input.purchaseDate,
      purchasePriceCents: input.purchasePriceCents,
      additionalCostCents: input.additionalCostCents,
      purchasePlatform: input.purchasePlatform,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    await db.transaction('rw', [db.items, db.itemTags], async () => {
      await db.items.add(item)
      if (input.tagIds.length > 0) {
        await db.itemTags.bulkAdd(input.tagIds.map((tagId) => ({ itemId: item.id, tagId })))
      }
    })
    return item
  },

  async update(id: string, input: ItemInput): Promise<void> {
    const name = input.name.trim()
    if (!name) throw new Error('名称不能为空')
    const now = new Date().toISOString()
    await db.transaction('rw', [db.items, db.itemTags], async () => {
      const existing = await db.items.get(id)
      if (!existing || existing.deletedAt) throw new Error('物品不存在')
      await db.items.update(id, {
        name,
        categoryId: input.categoryId,
        note: input.note.trim(),
        iconAssetId: input.iconAssetId,
        purchaseDate: input.purchaseDate,
        purchasePriceCents: input.purchasePriceCents,
        additionalCostCents: input.additionalCostCents,
        purchasePlatform: input.purchasePlatform,
        updatedAt: now,
      })
      // 重写关联：先删后插
      await db.itemTags.where('itemId').equals(id).delete()
      if (input.tagIds.length > 0) {
        await db.itemTags.bulkAdd(input.tagIds.map((tagId) => ({ itemId: id, tagId })))
      }
    })
  },

  /** soft delete：仅标记 deletedAt */
  async softDelete(id: string): Promise<void> {
    const now = new Date().toISOString()
    await db.items.update(id, { deletedAt: now, updatedAt: now })
  },
}
