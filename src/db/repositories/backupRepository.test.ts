import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { readSnapshot, replaceAllWithBackup } from './backupRepository'
import { buildBackupArchive, readAndValidateBackup, restoreFromPayload } from '../../services/backupService'
import type { Snapshot } from './backupRepository'

async function clearAll() {
  await Promise.all([
    db.items.clear(),
    db.categories.clear(),
    db.tags.clear(),
    db.itemTags.clear(),
    db.assets.clear(),
    db.appMeta.clear(),
  ])
}

async function seedTwoItems(): Promise<void> {
  await db.appMeta.put({ key: 'seeded', value: '1' })
  await db.categories.add({
    id: 'cat-1',
    parentId: null,
    name: '音频设备',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  })
  await db.tags.add({
    id: 'tag-1',
    name: '随身',
    nameNormalized: '随身',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  await db.items.add({
    id: 'item-1',
    name: 'AirPods Pro 2',
    categoryId: 'cat-1',
    note: '通勤用',
    iconAssetId: 'preset-earbuds',
    sourceType: 'preset',
    purchaseDate: '2026-01-01',
    purchasePriceCents: 149_900,
    additionalCostCents: null,
    purchasePlatform: 'jd',
    status: 'owned',
    warrantyExpiresAt: null,
    disposedAt: null,
    disposalMethod: null,
    salePriceCents: null,
    disposalNote: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  })
  await db.items.add({
    id: 'item-2',
    name: 'MacBook Pro 14',
    categoryId: 'cat-1',
    note: '工作主力机',
    iconAssetId: 'preset-laptop',
    sourceType: 'preset',
    purchaseDate: null,
    purchasePriceCents: null,
    additionalCostCents: null,
    purchasePlatform: null,
    status: 'owned',
    warrantyExpiresAt: null,
    disposedAt: null,
    disposalMethod: null,
    salePriceCents: null,
    disposalNote: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
  })
  await db.itemTags.add({ itemId: 'item-1', tagId: 'tag-1' })
}

describe('readSnapshot', () => {
  beforeEach(clearAll)

  it('读取全量数据并只导出可迁移的 appMeta', async () => {
    await seedTwoItems()
    await db.appMeta.put({ key: 'someUiPref', value: 'do-not-migrate' })

    const snap: Snapshot = await readSnapshot()
    expect(snap.items).toHaveLength(2)
    expect(snap.categories).toHaveLength(1)
    expect(snap.tags).toHaveLength(1)
    expect(snap.itemTags).toHaveLength(1)
    expect(snap.appMeta.seeded).toBe('1')
    expect(snap.appMeta.someUiPref).toBeUndefined()
  })
})

describe('replaceAllWithBackup：Replace Restore', () => {
  beforeEach(clearAll)

  it('完整替换现有数据（不合并）', async () => {
    await seedTwoItems()
    const before = await readSnapshot()

    // 清空后写入完全不同的一份数据，模拟"恢复到某个备份"
    await clearAll()
    await replaceAllWithBackup({
      ...before,
      items: [before.items[0]],
      itemTags: [],
    })

    expect(await db.items.count()).toBe(1)
    expect((await db.items.get('item-1'))?.name).toBe('AirPods Pro 2')
    expect(await db.items.get('item-2')).toBeUndefined()
    expect(await db.itemTags.count()).toBe(0)
    expect(await db.appMeta.get('seeded')).toEqual({ key: 'seeded', value: '1' })
  })

  it('导出 → 清空 → 恢复，数据完全一致', async () => {
    await seedTwoItems()
    const { zip } = await buildBackupArchive()

    // 彻底抹掉现有数据（模拟"删除全部测试数据"）
    await clearAll()
    expect(await db.items.count()).toBe(0)
    expect(await db.categories.count()).toBe(0)

    const r = await readAndValidateBackup(await zip.generateAsync({ type: 'uint8array' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    await restoreFromPayload(r.payload)

    expect(await db.items.count()).toBe(2)
    expect((await db.items.get('item-1'))?.note).toBe('通勤用')
    expect((await db.items.get('item-1'))?.iconAssetId).toBe('preset-earbuds')
    expect((await db.items.get('item-2'))?.note).toBe('工作主力机')
    expect(await db.categories.count()).toBe(1)
    expect((await db.categories.get('cat-1'))?.name).toBe('音频设备')
    expect(await db.tags.count()).toBe(1)
    expect((await db.tags.get('tag-1'))?.nameNormalized).toBe('随身')
    expect(await db.itemTags.count()).toBe(1)
  })

  it('恢复后 seeded 标记存在，不会被重新 seed', async () => {
    await clearAll()
    await replaceAllWithBackup({
      items: [],
      categories: [],
      tags: [],
      itemTags: [],
      assets: [],
      appMeta: { seeded: '1' },
    })
    expect((await db.appMeta.get('seeded'))?.value).toBe('1')
  })

  it('写入失败时整体回滚，不会出现清空一半的状态', async () => {
    await seedTwoItems()

    // 构造违反 tags.nameNormalized 唯一索引的数据，触发事务失败
    const brokenPayload = {
      items: [],
      categories: [],
      tags: [
        {
          id: 't1',
          name: '重复',
          nameNormalized: '重复',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 't2',
          name: '重复',
          nameNormalized: '重复',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      itemTags: [],
      assets: [],
      appMeta: {},
    }

    await expect(replaceAllWithBackup(brokenPayload)).rejects.toThrow()

    // 关键断言：原有数据必须原封不动
    expect(await db.items.count()).toBe(2)
    expect(await db.categories.count()).toBe(1)
    expect(await db.tags.count()).toBe(1)
    expect((await db.items.get('item-1'))?.name).toBe('AirPods Pro 2')
  })
})
