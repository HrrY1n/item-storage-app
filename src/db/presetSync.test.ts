import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { syncPresetAssets } from './seed'
import { PRESET_ICONS } from '../data/icons'
import type { Asset, Item } from '../domain/types'

/** 造一个"老库里的旧版 preset"：path 是过时的，createdAt 是历史时间 */
function legacyPreset(id: string): Asset {
  return {
    id,
    kind: 'preset',
    path: '/icons/items/legacy-stale-path.svg',
    blob: null,
    mime: 'image/svg+xml',
    width: 48,
    height: 48,
    styleVersion: null,
    promptVersion: null,
    sourceAssetId: null,
    createdAt: '2020-01-01T00:00:00.000Z',
  }
}

function userAsset(id: string): Asset {
  return {
    id,
    kind: 'ai_generated',
    path: null,
    blob: new Blob(['fake'], { type: 'image/png' }),
    mime: 'image/png',
    width: 512,
    height: 512,
    styleVersion: 'v1',
    promptVersion: 'p1',
    sourceAssetId: null,
    createdAt: '2024-05-05T00:00:00.000Z',
  }
}

function item(iconAssetId: string): Item {
  return {
    id: 'item-1',
    name: '我的 iPhone',
    categoryId: 'cat-1',
    note: '',
    iconAssetId,
    sourceType: 'preset',
    purchaseDate: null,
    purchasePriceCents: null,
    additionalCostCents: null,
    purchasePlatform: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

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

describe('syncPresetAssets', () => {
  it('老库已 seeded：新增的 preset 图标会自动补齐，无需重置数据库', async () => {
    // 模拟"只用过最初 12 个图标"的老库：只有一个旧 preset，且已 seeded
    await db.appMeta.put({ key: 'seeded', value: '1' })
    await db.assets.put(legacyPreset('preset-laptop'))
    await db.items.put(item('preset-phone'))

    const result = await syncPresetAssets()

    // 73 个图标里，1 个已存在（被更新），其余全部补齐
    expect(result.added).toBe(PRESET_ICONS.length - 1)
    expect(result.updated).toBe(1)
    expect(await db.assets.where('kind').equals('preset').count()).toBe(PRESET_ICONS.length)

    // 本轮的关键诉求：手机与平板是两个独立图标
    expect(await db.assets.get('preset-phone')).toBeTruthy()
    expect(await db.assets.get('preset-tablet')).toBeTruthy()
    expect(PRESET_ICONS.find((i) => i.key === 'phone')?.label).toBe('手机')
    expect(PRESET_ICONS.find((i) => i.key === 'tablet')?.label).toBe('平板电脑')
  })

  it('绝不删除或改动用户自定义资产（ai_generated / from_photo）', async () => {
    await db.assets.bulkPut([
      userAsset('user-ai-1'),
      legacyPreset('preset-laptop'),
      { ...userAsset('user-photo-1'), kind: 'from_photo' },
    ])

    await syncPresetAssets()

    const ai = await db.assets.get('user-ai-1')
    const photo = await db.assets.get('user-photo-1')
    expect(ai?.kind).toBe('ai_generated')
    expect(photo?.kind).toBe('from_photo')
    // blob 等二进制内容也原样保留
    expect(ai?.blob).toBeTruthy()
    expect(await db.assets.where('kind').equals('preset').count()).toBe(PRESET_ICONS.length)
  })

  it('不破坏已有 Item.iconAssetId', async () => {
    const before = item('preset-laptop')
    await db.items.put(before)
    await db.assets.put(legacyPreset('preset-laptop'))

    await syncPresetAssets()

    const after = await db.items.get(before.id)
    // 整行完全一致：sync 不应触碰 items 表
    expect(after).toEqual(before)
    expect(await db.items.count()).toBe(1)
  })

  it('幂等：重复执行不产生重复记录，第二次无任何变更', async () => {
    const first = await syncPresetAssets()
    expect(first.added).toBe(PRESET_ICONS.length)

    const second = await syncPresetAssets()
    const third = await syncPresetAssets()

    expect(second).toEqual({ added: 0, updated: 0 })
    expect(third).toEqual({ added: 0, updated: 0 })
    expect(await db.assets.count()).toBe(PRESET_ICONS.length)
    // id 不重复
    expect(new Set((await db.assets.toArray()).map((a) => a.id)).size).toBe(PRESET_ICONS.length)
  })

  it('preset 的 path / metadata 变化时就地更新，且保留原有 createdAt', async () => {
    await db.assets.put(legacyPreset('preset-laptop'))

    const result = await syncPresetAssets()

    const updated = await db.assets.get('preset-laptop')
    expect(result.updated).toBe(1)
    expect(updated?.path).toBe('/icons/items/laptop.svg')
    expect(updated?.width).toBe(96)
    expect(updated?.height).toBe(96)
    // 历史创建时间不被刷新（避免每次启动都像是"新资源"）
    expect(updated?.createdAt).toBe('2020-01-01T00:00:00.000Z')
    expect(await db.assets.count()).toBe(PRESET_ICONS.length)
  })

  it('已从代码中移除的 preset 保留在库中（可能仍被历史 Item 引用）', async () => {
    await db.assets.put({ ...legacyPreset('preset-removed-icon'), path: '/icons/items/removed.svg' })

    await syncPresetAssets()

    expect(await db.assets.get('preset-removed-icon')).toBeTruthy()
    expect(await db.assets.where('kind').equals('preset').count()).toBe(PRESET_ICONS.length + 1)
  })
})
