import { ulid } from 'ulid'
import type { Transaction } from 'dexie'
import { db } from '../db'
import { markSyncDirty } from '../syncDirty'
import type { Category } from '../../domain/types'
import { collectSubtreeIds, wouldCreateCycle } from '../../domain/categoryTree'
import { itemRepository } from './itemRepository'
import { syncRepository } from './syncRepository'
import { DEFAULT_CATEGORIES_VERSION, DEFAULT_CATEGORY_TREE } from '../../data/categories'

/**
 * Category repository —— 分类树 CRUD。
 * 业务不变量（循环引用、删除保护）由 domain/categoryTree 提供判定，这里负责执行。
 */

const notDeleted = (c: Category) => c.deletedAt === null

/** 旧默认树的一次性补充；恢复备份时可与替换数据共用同一事务。 */
export async function upgradeDefaultCategoriesInTransaction(tx: Transaction): Promise<number> {
  const version = await db.appMeta.get('defaultCategoriesVersion')
  if (Number(version?.value ?? 0) >= DEFAULT_CATEGORIES_VERSION) return 0
  const all = await db.categories.toArray()
  const roots = all.filter((c) => c.parentId === null)
  const legacy = DEFAULT_CATEGORY_TREE.filter((root) => root.legacyName)
  const originalOrder = roots.length === legacy.length && legacy.every((definition, index) =>
    roots.some((root) => root.deletedAt === null && root.name === definition.legacyName && root.sortOrder === index + 1),
  )
  // 完全自定义的分类树不套用默认分类；改名的旧根节点用原封面识别。
  const activeRoots = roots.filter(notDeleted)
  const recognized = legacy.some((definition) => definition.key !== 'other' && activeRoots.some((root) =>
    root.name === definition.legacyName || root.name === definition.name,
  )) || legacy.every((definition) => activeRoots.some((root) => root.iconKey === definition.legacyIconKey))
  let changed = 0
  const now = new Date().toISOString()
  const put = async (category: Category) => {
    await db.categories.put(category)
    await syncRepository.enqueueWithTx('category', category.id, tx)
    const index = all.findIndex((c) => c.id === category.id)
    if (index < 0) all.push(category)
    else all[index] = category
    changed++
  }
  if (recognized) for (const [index, definition] of DEFAULT_CATEGORY_TREE.entries()) {
    const stableId = `default-category-${definition.key}`
    const byIcon = roots.filter((root) => root.iconKey === definition.legacyIconKey)
    let root = all.find((c) => c.id === stableId)
      ?? roots.find((c) => c.name === definition.name || c.name === definition.legacyName)
      ?? (definition.legacyIconKey && byIcon.length === 1 ? byIcon[0] : undefined)
    if (!root) {
      // 不重建用户移除的旧一级分类；只增加本次引入的「家居与厨房」。
      if (definition.legacyName) continue
      root = {
        id: stableId, parentId: null, name: definition.name, iconKey: definition.iconKey,
        sortOrder: originalOrder ? index + 1 : Math.max(0, ...roots.map((c) => c.sortOrder)) + 1,
        createdAt: now, updatedAt: now, deletedAt: null,
      }
      await put(root)
    }
    if (root.deletedAt !== null) continue
    const nextRoot = {
      ...root,
      name: root.name === definition.legacyName ? definition.name : root.name,
      iconKey: root.iconKey === undefined || root.iconKey === definition.legacyIconKey ? definition.iconKey : root.iconKey,
      sortOrder: originalOrder ? index + 1 : root.sortOrder,
    }
    if (nextRoot.name !== root.name || nextRoot.iconKey !== root.iconKey || nextRoot.sortOrder !== root.sortOrder) {
      root = { ...nextRoot, updatedAt: now }
      await put(root)
    }
    for (const child of definition.children) {
      const id = `default-category-${root.id}-${child.iconKeys[0]}`
      const current = all.find((c) => c.id === id)
        ?? all.find((c) => c.parentId === root.id && (c.name === child.name || c.name === child.legacyName))
      if (current) {
        if (current.deletedAt !== null) continue
        const name = current.name === child.legacyName ? child.name : current.name
        if (current.iconKey === undefined || name !== current.name) {
          await put({ ...current, name, iconKey: current.iconKey ?? child.iconKeys[0], updatedAt: now })
        }
      } else if (!child.legacyName) {
        // 旧二级分类缺失可能是用户主动删除或改名，不能按默认名称重新创建。
        await put({
          id, parentId: root.id, name: child.name, iconKey: child.iconKeys[0],
          sortOrder: Math.max(0, ...all.filter((c) => c.parentId === root.id).map((c) => c.sortOrder)) + 1,
          createdAt: now, updatedAt: now, deletedAt: null,
        })
      }
    }
  }
  await db.appMeta.put({ key: 'defaultCategoriesVersion', value: String(DEFAULT_CATEGORIES_VERSION) })
  return changed
}

export async function upgradeDefaultCategories(): Promise<number> {
  const changed = await db.transaction('rw', [db.categories, db.appMeta, db.syncQueue], upgradeDefaultCategoriesInTransaction)
  if (changed > 0) markSyncDirty()
  return changed
}

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
    markSyncDirty()
    return category
  },

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('分类名称不能为空')
    await db.transaction('rw', [db.categories, db.syncQueue], async (tx) => {
      await db.categories.update(id, { name: trimmed, updatedAt: new Date().toISOString() })
      await syncRepository.enqueueWithTx('category', id, tx)
    })
    markSyncDirty()
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
    markSyncDirty()
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
    markSyncDirty()
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
    markSyncDirty()
  },

  /** 收集含后代在内的分类 id 集合（供查询物品用） */
  subtreeIds(all: Category[], id: string): Set<string> {
    return collectSubtreeIds(all, id)
  },
}
