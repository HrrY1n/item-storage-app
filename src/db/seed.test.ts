import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { seedIfEmpty } from './seed'
import { PRESET_ICONS } from '../data/icons'

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.categories.clear(),
    db.tags.clear(),
    db.itemTags.clear(),
    db.assets.clear(),
    db.appMeta.clear(),
  ])
})

describe('seedIfEmpty', () => {
  it('空数据库首次初始化：写入默认分类与预置图标资产', async () => {
    await seedIfEmpty()
    const categories = await db.categories.toArray()
    expect(categories.length).toBe(21) // 6 个一级 + 15 个二级
    expect(categories.filter((c) => c.parentId === null)).toHaveLength(6)
    const assets = await db.assets.toArray()
    expect(assets.length).toBe(PRESET_ICONS.length)
    expect(assets.every((a) => a.kind === 'preset')).toBe(true)
    expect((await db.appMeta.get('schemaVersion'))?.value).toBe('2')
  })

  it('幂等：重复执行不会重复插入', async () => {
    await seedIfEmpty()
    await seedIfEmpty()
    await seedIfEmpty()
    expect(await db.categories.count()).toBe(21)
    expect(await db.assets.count()).toBe(PRESET_ICONS.length)
  })

  it('数据库非空时不覆盖现有分类', async () => {
    await db.categories.add({
      id: 'custom',
      parentId: null,
      name: '我的自定义分类',
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    })
    await seedIfEmpty()
    expect(await db.categories.count()).toBe(1)
    expect((await db.categories.get('custom'))?.name).toBe('我的自定义分类')
  })
})
