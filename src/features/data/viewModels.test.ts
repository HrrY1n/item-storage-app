import { describe, expect, it } from 'vitest'
import { filterAndSortItems } from './viewModels'
import { makeItem } from '../../test/fixtures'
import type { Category, Tag } from '../../domain/types'

// ---------------------------------------------------------------- 列表筛选与排序

describe('filterAndSortItems：状态筛选 / 搜索 / 排序', () => {
  const categories: Category[] = [
    { id: 'c-digi', parentId: null, name: '数码与电子', sortOrder: 1, createdAt: '', updatedAt: '', deletedAt: null },
    { id: 'c-phone', parentId: 'c-digi', name: '手机与平板', sortOrder: 1, createdAt: '', updatedAt: '', deletedAt: null },
    { id: 'c-life', parentId: null, name: '生活用品', sortOrder: 2, createdAt: '', updatedAt: '', deletedAt: null },
  ]
  const tags: Tag[] = [
    { id: 't1', name: '常用', nameNormalized: '常用', createdAt: '', updatedAt: '' },
    { id: 't2', name: '摄影', nameNormalized: '摄影', createdAt: '', updatedAt: '' },
  ]
  const links = [
    { itemId: 'i1', tagId: 't1' },
    { itemId: 'i3', tagId: 't2' },
  ]
  const items = [
    makeItem({ id: 'i1', name: 'iPhone 15', categoryId: 'c-phone', createdAt: '2026-01-01T00:00:00.000Z', purchaseDate: '2025-01-01', purchasePriceCents: 600_000 }),
    makeItem({ id: 'i2', name: '电动牙刷', categoryId: 'c-life', createdAt: '2026-02-01T00:00:00.000Z', purchaseDate: '2025-06-01', purchasePriceCents: 30_000 }),
    makeItem({ id: 'i3', name: '尼康 Z fc', categoryId: 'c-digi', createdAt: '2026-03-01T00:00:00.000Z', purchaseDate: '2024-01-01', purchasePriceCents: 630_000 }),
    makeItem({ id: 'w1', name: '人体工学椅', categoryId: 'c-life', status: 'wishlist', createdAt: '2026-04-01T00:00:00.000Z' }),
    makeItem({ id: 'd1', name: '旧耳机', categoryId: 'c-digi', status: 'disposed', disposedAt: '2025-01-01', disposalMethod: 'discarded', purchaseDate: '2023-01-01', purchasePriceCents: 200_000, createdAt: '2026-05-01T00:00:00.000Z' }),
  ]
  const run = (q: Parameters<typeof filterAndSortItems>[4]) =>
    filterAndSortItems(items, categories, links, tags, { today: '2026-10-05', ...q })
  const ids = (list: ReturnType<typeof run>) => list.map((i) => i.id)

  it('按生命周期筛选：持有 / 心愿 / 处置互不串台', () => {
    // 默认排序是「最近添加」（createdAt 降序）
    expect(ids(run({ status: 'owned' }))).toEqual(['i3', 'i2', 'i1'])
    expect(ids(run({ status: 'wishlist' }))).toEqual(['w1'])
    expect(ids(run({ status: 'disposed' }))).toEqual(['d1'])
  })

  it('搜索命中名称 / 分类 / 标签，且大小写无关', () => {
    expect(ids(run({ status: 'owned', query: '尼康' }))).toEqual(['i3'])
    expect(ids(run({ status: 'owned', query: 'Z FC' }))).toEqual(['i3'])
    expect(ids(run({ status: 'owned', query: 'z fc' }))).toEqual(['i3'])
    // 分类名
    expect(ids(run({ status: 'owned', query: '生活用品' }))).toEqual(['i2'])
    // 标签名
    expect(ids(run({ status: 'owned', query: '常用' }))).toEqual(['i1'])
    expect(ids(run({ status: 'owned', query: '摄影' }))).toEqual(['i3'])
  })

  it('搜索 + 状态筛选可叠加', () => {
    expect(ids(run({ status: 'wishlist', query: '工学椅' }))).toEqual(['w1'])
    expect(ids(run({ status: 'wishlist', query: '人体' }))).toEqual(['w1'])
    expect(ids(run({ status: 'disposed', query: '尼康' }))).toEqual([])
  })

  it('分类筛选包含子分类', () => {
    // c-digi 的子树含 c-phone
    expect(ids(run({ status: 'owned', categoryId: 'c-digi' }))).toEqual(['i3', 'i1'])
    expect(ids(run({ status: 'owned', categoryId: 'c-phone' }))).toEqual(['i1'])
    expect(ids(run({ status: 'owned', categoryId: null }))).toEqual(['i3', 'i2', 'i1'])
  })

  it('排序：最近添加 / 名称 / 总投入 / 日均成本', () => {
    expect(ids(run({ status: 'owned', sort: 'recent' }))).toEqual(['i3', 'i2', 'i1'])
    // 名称排序跟随 localeCompare（中文按拼音、拉丁按字母），不硬编码平台相关的次序
    const byName = run({ status: 'owned', sort: 'name' }).map((i) => i.name)
    expect(byName).toEqual(
      [...byName].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    )
    expect(new Set(byName)).toEqual(new Set(['iPhone 15', '电动牙刷', '尼康 Z fc']))
    expect(ids(run({ status: 'owned', sort: 'cost' }))).toEqual(['i3', 'i1', 'i2'])
    // 日均成本（降序）：
    // i1 ≈ ¥6000/642 天 ≈ ¥9.3/天  > i3 ≈ ¥6300/978 天 ≈ ¥6.4/天  > i2 ≈ ¥300/491 天 ≈ ¥0.6/天
    expect(ids(run({ status: 'owned', sort: 'daily' }))).toEqual(['i1', 'i3', 'i2'])
  })

  it('已出售物品按净成本参与排序', () => {
    const withSale = [
      ...items,
      makeItem({ id: 's1', name: '已卖相机', categoryId: 'c-digi', status: 'disposed', disposedAt: '2025-01-01', disposalMethod: 'sold', purchaseDate: '2024-01-01', purchasePriceCents: 800_000, salePriceCents: 750_000, createdAt: '2026-06-01T00:00:00.000Z' }),
    ]
    const sorted = filterAndSortItems(withSale, categories, links, tags, { status: 'disposed', sort: 'cost', today: '2026-10-05' })
    // 按净成本降序：d1 = ¥2,000 > s1 净成本 ¥500，所以 d1 在前
    expect(sorted.map((i) => i.id)).toEqual(['d1', 's1'])
  })

  it('无匹配时返回空数组（不返回全部）', () => {
    expect(run({ status: 'owned', query: '不存在的物品' })).toEqual([])
  })

  it('不修改入参数组', () => {
    const snapshot = items.map((i) => i.id)
    run({ status: 'owned', sort: 'name' })
    run({ status: 'disposed' })
    expect(items.map((i) => i.id)).toEqual(snapshot)
  })
})
