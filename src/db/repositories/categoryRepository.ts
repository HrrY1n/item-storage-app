import { ulid } from 'ulid'
import { db } from '../db'
import type { Category } from '../../domain/types'
import { collectSubtreeIds, wouldCreateCycle } from '../../domain/categoryTree'
import { itemRepository } from './itemRepository'
import { syncRepository } from './syncRepository'

/**
 * Category repository —— 分类树 CRUD。
 * 业务不变量（循环引用、删除保护）由 domain/categoryTree 提供判定，这里负责执行。
 */

const notDeleted = (c: Category) => c.deletedAt === null

async function listActive(): Promise<Category[]> {
  const all = await db.categories.toArray()
  return all.filter(notDeleted).sort((a, b) => a.sortOrder - b.sortOrder)
}

export const categoryRepository = {
  listActive,

  async getActive(id: string): Promise<Category | undefined> {
    const c = await db.categories.get(id)
    return c && notDeleted(c) ? c : undefined
  },

  async create(name: string, parentId: string | null): Promise<Category> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('分类名称不能为空')
    const now = new Date().toISOString()
    const siblings = (await listActive()).filter((c) => c.parentId === parentId)
    const category: Category = {
      id: ulid(),
      parentId,
      name: trimmed,
      sortOrder: siblings.length + 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    // Phase 3B：分类变化与 outbox 入队同事务
    await db.transaction('rw', [db.categories, db.syncQueue], async (tx) => {
      await db.categories.add(category)
      await syncRepository.enqueueWithTx('category', category.id, tx)
    })
    return category
  },

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('分类名称不能为空')
    await db.transaction('rw', [db.categories, db.syncQueue], async (tx) => {
      await db.categories.update(id, { name: trimmed, updatedAt: new Date().toISOString() })
      await syncRepository.enqueueWithTx('category', id, tx)
    })
  },

  /**
   * 移动到新的父分类下。
   * @throws 会形成循环（自己 / 自己的后代）时拒绝
   */
  async move(id: string, newParentId: string | null): Promise<void> {
    const all = await listActive()
    if (!all.some((c) => c.id === id)) throw new Error('分类不存在')
    if (newParentId !== null && !all.some((c) => c.id === newParentId)) {
      throw new Error('目标父分类不存在')
    }
    if (wouldCreateCycle(all, id, newParentId)) {
      throw new Error('不能移动到自身或其子分类下')
    }
    const siblings = all.filter((c) => c.parentId === newParentId)
    await db.transaction('rw', [db.categories, db.syncQueue], async (tx) => {
      await db.categories.update(id, {
        parentId: newParentId,
        sortOrder: siblings.length + 1,
        updatedAt: new Date().toISOString(),
      })
      await syncRepository.enqueueWithTx('category', id, tx)
    })
  },

  /** 同级内上移/下移：与相邻兄弟交换 sortOrder */
  async reorder(id: string, direction: 'up' | 'down'): Promise<void> {
    const all = await listActive()
    const self = all.find((c) => c.id === id)
    if (!self) throw new Error('分类不存在')
    const siblings = all
      .filter((c) => c.parentId === self.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const index = siblings.findIndex((c) => c.id === id)
    const neighborIndex = direction === 'up' ? index - 1 : index + 1
    if (neighborIndex < 0 || neighborIndex >= siblings.length) return
    const neighbor = siblings[neighborIndex]
    const now = new Date().toISOString()
    // Phase 3B：排序交换影响两个分类，两个都要入队，否则云端顺序会与本地不一致
    await db.transaction('rw', [db.categories, db.syncQueue], async (tx) => {
      await db.categories.update(self.id, { sortOrder: neighbor.sortOrder, updatedAt: now })
      await db.categories.update(neighbor.id, { sortOrder: self.sortOrder, updatedAt: now })
      await syncRepository.enqueueWithTx('category', self.id, tx)
      await syncRepository.enqueueWithTx('category', neighbor.id, tx)
    })
  },

  /**
   * 删除保护：含子分类或含物品的分类不得删除。
   * @throws 带明确中文原因
   */
  async deleteGuarded(id: string): Promise<void> {
    const all = await listActive()
    const self = all.find((c) => c.id === id)
    if (!self) throw new Error('分类不存在')

    const hasChildren = all.some((c) => c.parentId === id)
    if (hasChildren) throw new Error('该分类包含子分类，请先移除子分类')

    const subtreeIds = collectSubtreeIds(all, id)
    let itemCount = 0
    for (const cid of subtreeIds) {
      itemCount += await itemRepository.countByCategoryId(cid)
    }
    if (itemCount > 0) throw new Error(`该分类下还有 ${itemCount} 件物品，请先移动或删除这些物品`)

    // Phase 3B：软删分类与 outbox 入队同事务
    await db.transaction('rw', [db.categories, db.syncQueue], async (tx) => {
      await db.categories.update(id, { deletedAt: new Date().toISOString() })
      await syncRepository.enqueueWithTx('category', id, tx)
    })
  },

  /** 收集含后代在内的分类 id 集合（供查询物品用） */
  subtreeIds(all: Category[], id: string): Set<string> {
    return collectSubtreeIds(all, id)
  },
}
