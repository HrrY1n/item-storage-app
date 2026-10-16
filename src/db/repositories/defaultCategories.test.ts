import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import type { Category } from '../../domain/types'
import { DEFAULT_CATEGORY_TREE } from '../../data/categories'
import { childrenOf } from '../../domain/categoryTree'
import { seedIfEmpty } from '../seed'
import { onSyncDirty, resetSyncDirtyListeners } from '../syncDirty'
import { upgradeDefaultCategories } from './categoryRepository'
import { syncRepository } from './syncRepository'
import { readSnapshot, replaceAllWithBackupAndDisableSync } from './backupRepository'
import { itemRepository } from './itemRepository'

const then = '2026-01-01T00:00:00.000Z'

async function legacyTree(): Promise<Category[]> {
  const categories: Category[] = []
  // 冻结旧版 6+15 定义，避免夹具跟着新版分类变化而掩盖兼容问题。
  const legacy = [
    { key: 'digital', name: '数码与电子', iconKey: 'laptop', children: [
      ['laptop', '电脑设备'], ['phone', '手机与平板'], ['earbuds', '音频设备'], ['hdd', '存储设备'], ['charger', '配件与线材'],
    ] },
    { key: 'office', name: '学习与办公', iconKey: 'book', children: [
      ['book', '书籍'], ['notebook', '笔记本与纸品'], ['pen', '文具'], ['folder', '文件资料'],
    ] },
    { key: 'apparel', name: '衣物与穿搭', iconKey: 'tshirt', children: [
      ['tshirt', '上衣'], ['pants', '裤装'], ['coat', '外套'], ['shoes', '鞋履'], ['backpack', '包袋'], ['hat', '配饰'],
    ] },
    { key: 'life', name: '生活用品', iconKey: 'bottle', children: [] },
    { key: 'hobby', name: '收藏与纪念', iconKey: 'backpack', children: [] },
    { key: 'other', name: '其他', iconKey: 'other', children: [] },
  ]
  for (const [index, root] of legacy.entries()) {
    const id = 'legacy-' + root.key
    categories.push({ id, parentId: null, name: root.name, iconKey: root.iconKey,
      sortOrder: index + 1, createdAt: then, updatedAt: then, deletedAt: null })
    root.children.forEach(([key, name], childIndex) => {
      categories.push({ id: id + '-' + key, parentId: id, name,
        sortOrder: childIndex + 1, createdAt: then, updatedAt: then, deletedAt: null })
    })
  }
  await db.categories.bulkAdd(categories)
  await db.appMeta.bulkPut([{ key: 'seeded', value: '1' }, { key: 'schemaVersion', value: '3' }])
  return categories
}

beforeEach(async () => {
  resetSyncDirtyListeners()
  await Promise.all([
    db.items.clear(), db.categories.clear(), db.tags.clear(), db.itemTags.clear(),
    db.assets.clear(), db.appMeta.clear(), db.syncQueue.clear(), db.syncState.clear(),
  ])
})

describe('默认分类增量升级', () => {
  it('旧 21 节点补齐到 56，保留原 ID、物品归属和已有待同步条目', async () => {
    const before = await legacyTree()
    const item = await itemRepository.create({
      name: '旧 Pocket', categoryId: 'legacy-digital-laptop', iconAssetId: 'preset-djipocket',
      note: '不自动改归属', tagIds: [], status: 'owned', purchaseDate: null, purchasePriceCents: null,
      additionalCostCents: null, purchasePlatform: null, warrantyExpiresAt: null,
      disposedAt: null, disposalMethod: null, salePriceCents: null, disposalNote: null,
    })
    const existingQueue = await db.syncQueue.toArray()
    let notifiedInsideTransaction = true
    const dirty = vi.fn(() => { notifiedInsideTransaction = Boolean(Dexie.currentTransaction) })
    const unsubscribe = onSyncDirty(dirty)
    expect(await upgradeDefaultCategories()).toBeGreaterThan(35)
    unsubscribe()
    expect(dirty).toHaveBeenCalledOnce()
    expect(notifiedInsideTransaction).toBe(false)
    const all = await db.categories.toArray()
    expect(all).toHaveLength(56)
    expect(childrenOf(all, null).map((root) => root.name)).toEqual(DEFAULT_CATEGORY_TREE.map((root) => root.name))
    for (const category of before) {
      const current = all.find((c) => c.id === category.id)
      expect(current?.createdAt).toBe(then)
      expect(current?.parentId).toBe(category.parentId)
    }
    expect(await db.items.get(item.id)).toEqual(item)
    for (const queue of existingQueue) expect(await db.syncQueue.get(queue.id)).toEqual(queue)
    expect((await db.syncQueue.toArray()).filter((q) => q.entity === 'category').length).toBeGreaterThan(35)
    expect(all.every((category) => category.iconKey)).toBe(true)
    expect((await db.appMeta.get('defaultCategoriesVersion'))?.value).toBe('2')
  })

  it('重复与并发启动不重复分类、不重写 outbox', async () => {
    await legacyTree()
    const results = await Promise.all([upgradeDefaultCategories(), upgradeDefaultCategories()])
    expect(results.filter((n) => n > 0)).toHaveLength(1)
    const categories = await db.categories.toArray()
    const queue = await db.syncQueue.toArray()
    expect(await upgradeDefaultCategories()).toBe(0)
    expect(categories).toHaveLength(56)
    expect(await db.categories.toArray()).toEqual(categories)
    expect(await db.syncQueue.toArray()).toEqual(queue)
  })

  it('保留自定义根名称、排序、旧子类改名和已有同名新分类', async () => {
    await legacyTree()
    await db.categories.update('legacy-digital', { name: '我的设备', sortOrder: 80 })
    await db.categories.update('legacy-life', { name: '我的生活' })
    await db.categories.update('legacy-digital-earbuds', { name: '我常用的耳机', iconKey: 'speaker', sortOrder: 90 })
    const photo = { id: 'my-photo', parentId: 'legacy-digital', name: '摄影摄像', iconKey: 'lens',
      sortOrder: 40, createdAt: then, updatedAt: then, deletedAt: null }
    await db.categories.add(photo)
    const customized = await db.categories.bulkGet(['legacy-digital', 'legacy-life', 'legacy-digital-earbuds'])
    await upgradeDefaultCategories()
    expect(await db.categories.bulkGet(['legacy-digital', 'legacy-life', 'legacy-digital-earbuds'])).toEqual(customized)
    expect(await db.categories.get('my-photo')).toEqual(photo)
    expect((await db.categories.where('parentId').equals('legacy-digital').toArray()).filter((c) => c.name === '摄影摄像')).toHaveLength(1)
    expect((await db.categories.get('default-category-home'))?.sortOrder).toBe(81)
    expect((await db.categories.where('parentId').equals('legacy-digital').toArray()).some((c) => c.name === '音频设备')).toBe(false)
  })

  it('不复活已删根节点、旧二级分类或同名新分类的 tombstone', async () => {
    await legacyTree()
    await db.categories.update('legacy-life', { deletedAt: then })
    await db.categories.update('legacy-digital-hdd', { deletedAt: then })
    const deleted = { id: 'deleted-photo', parentId: 'legacy-digital', name: '摄影摄像',
      sortOrder: 6, createdAt: then, updatedAt: then, deletedAt: then }
    await db.categories.add(deleted)
    await upgradeDefaultCategories()
    expect(await db.categories.get('deleted-photo')).toEqual(deleted)
    expect((await db.categories.get('legacy-digital-hdd'))?.deletedAt).toBe(then)
    expect((await db.categories.get('legacy-life'))?.name).toBe('生活用品')
    expect(await db.categories.where('parentId').equals('legacy-life').count()).toBe(0)
    expect((await db.categories.toArray()).filter((c) => c.name === '摄影摄像')).toHaveLength(1)
  })

  it('升级后的改名、移动和删除不会被下次启动撤销', async () => {
    await legacyTree()
    await upgradeDefaultCategories()
    const photo = (await db.categories.toArray()).find((c) => c.name === '摄影摄像')!
    await db.categories.update(photo.id, { name: '我的拍摄设备', parentId: 'legacy-hobby', sortOrder: 100 })
    const home = (await db.categories.toArray()).find((c) => c.name === '家具与陈设')!
    await db.categories.update(home.id, { deletedAt: then })
    await db.categories.update('default-category-home', { parentId: 'legacy-life', name: '我的厨房', sortOrder: 200 })
    const before = await db.categories.toArray()
    expect(await upgradeDefaultCategories()).toBe(0)
    expect(await db.categories.toArray()).toEqual(before)
    // 即使旧备份没有版本标记，稳定 ID 也能识别已改名/移动/删除的新增分类。
    await db.appMeta.delete('defaultCategoriesVersion')
    await upgradeDefaultCategories()
    expect(await db.categories.toArray()).toEqual(before)
  })

  it('完全自定义的树或已删除全部默认根节点时不插入默认分类', async () => {
    await db.categories.add({ id: 'custom', parentId: null, name: '我的器材', iconKey: 'laptop',
      sortOrder: 1, createdAt: then, updatedAt: then, deletedAt: null })
    expect(await upgradeDefaultCategories()).toBe(0)
    expect(await db.categories.count()).toBe(1)
    await db.appMeta.delete('defaultCategoriesVersion')
    await legacyTree()
    for (const category of await db.categories.toArray()) await db.categories.update(category.id, { deletedAt: then })
    expect(await upgradeDefaultCategories()).toBe(0)
    expect(await db.categories.count()).toBe(22)
  })

  it('入队失败时分类、版本标记和原有 outbox 一起回滚', async () => {
    const before = await legacyTree()
    await syncRepository.enqueue('item', 'already-pending')
    const queue = await db.syncQueue.toArray()
    const enqueue = vi.spyOn(syncRepository, 'enqueueWithTx').mockRejectedValueOnce(new Error('queue write failed'))
    try {
      await expect(upgradeDefaultCategories()).rejects.toThrow('queue write failed')
    } finally {
      enqueue.mockRestore()
    }
    expect((await db.categories.toArray()).sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)))
    expect(await db.appMeta.get('defaultCategoriesVersion')).toBeUndefined()
    expect(await db.syncQueue.toArray()).toEqual(queue)
  })

  it('新安装或将来更高的分类版本无需再补齐', async () => {
    await seedIfEmpty()
    expect(await upgradeDefaultCategories()).toBe(0)
    expect(await db.syncQueue.count()).toBe(0)
    await db.appMeta.put({ key: 'defaultCategoriesVersion', value: '3' })
    expect(await upgradeDefaultCategories()).toBe(0)
    expect((await db.appMeta.get('defaultCategoriesVersion'))?.value).toBe('3')
  })

  it('旧备份恢复事务同时补齐分类，新备份保留版本与自定义删除', async () => {
    await legacyTree()
    const oldBackup = await readSnapshot()
    await upgradeDefaultCategories()
    await replaceAllWithBackupAndDisableSync(oldBackup)
    expect(await db.categories.count()).toBe(56)
    expect(await db.syncQueue.count()).toBe(0)
    expect((await db.appMeta.get('defaultCategoriesVersion'))?.value).toBe('2')
    const photo = (await db.categories.toArray()).find((c) => c.name === '摄影摄像')!
    await db.categories.update(photo.id, { deletedAt: then })
    const newBackup = await readSnapshot()
    expect(newBackup.appMeta.defaultCategoriesVersion).toBe('2')
    await replaceAllWithBackupAndDisableSync(newBackup)
    expect(await db.categories.toArray()).toEqual(newBackup.categories)
  })
})
