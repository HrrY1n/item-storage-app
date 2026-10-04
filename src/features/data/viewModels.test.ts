import { describe, expect, it } from 'vitest'
import { itemMetric, libraryOverview } from './viewModels'
import type { Category, Item, Tag } from '../../domain/types'

const TODAY = '2026-06-13'

function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    name: '物品',
    categoryId: 'c1',
    note: '',
    iconAssetId: 'preset-other',
    sourceType: 'preset',
    purchaseDate: null,
    purchasePriceCents: null,
    additionalCostCents: null,
    purchasePlatform: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...over,
  }
}

function makeCategory(id: string): Category {
  return {
    id,
    parentId: null,
    name: `分类${id}`,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

function makeTag(id: string): Tag {
  return {
    id,
    name: `标签${id}`,
    nameNormalized: `标签${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('itemMetric', () => {
  it('没有购买信息的物品返回 null（UI 不渲染指标行，不制造 ¥0.00）', () => {
    expect(itemMetric(makeItem(), TODAY)).toBeNull()
  })

  it('有价格与日期时给出天数、总投入与日均', () => {
    // ¥5000 买入，持有 1 天 → 日均 ¥5000。紧凑格式：≥¥1000 省小数
    const m = itemMetric(
      makeItem({ purchaseDate: TODAY, purchasePriceCents: 500_000 }),
      TODAY,
    )
    expect(m).not.toBeNull()
    expect(m!.days).toBe(1)
    expect(m!.totalCents).toBe(500_000)
    expect(m!.dailyCents).toBe(500_000)
    expect(m!.daysText).toBe('1 天')
    expect(m!.totalText).toBe('¥5,000')
    expect(m!.dailyText).toBe('¥5,000')
  })

  it('附加花费计入总投入', () => {
    const m = itemMetric(
      makeItem({
        purchaseDate: '2026-06-12',
        purchasePriceCents: 100_000,
        additionalCostCents: 50_000,
      }),
      TODAY,
    )
    expect(m!.totalCents).toBe(150_000)
    expect(m!.days).toBe(2)
    expect(m!.dailyCents).toBe(75_000)
  })

  it('只有日期没有价格：能算出持有天数，但不编造金额', () => {
    const m = itemMetric(makeItem({ purchaseDate: '2026-06-08' }), TODAY)
    expect(m!.days).toBe(6)
    expect(m!.totalCents).toBeNull()
    expect(m!.dailyCents).toBeNull()
    expect(m!.totalText).toBeNull()
  })

  it('只有价格没有日期：显示总投入，但不显示日均成本', () => {
    const m = itemMetric(makeItem({ purchasePriceCents: 88_888 }), TODAY)
    expect(m!.days).toBeNull()
    expect(m!.dailyCents).toBeNull()
    expect(m!.dailyText).toBeNull()
    expect(m!.totalText).toBe('¥888.88')
  })
})

describe('libraryOverview', () => {
  it('没有任何价格数据时不产出总投入（避免出现 ¥0）', () => {
    const overview = libraryOverview([makeItem({ id: 'a' })], [makeCategory('c1')], [], TODAY)
    expect(overview.itemCount).toBe(1)
    expect(overview.pricedCount).toBe(0)
    expect(overview.totalCents).toBeNull()
    expect(overview.dailyCents).toBeNull()
    expect(overview.totalText).toBeNull()
  })

  it('只统计有价格的物品，并汇总日均', () => {
    const items = [
      makeItem({ id: 'a', purchaseDate: '2026-06-12', purchasePriceCents: 200_000 }),
      makeItem({ id: 'b', purchaseDate: '2026-06-12', purchasePriceCents: 100_000 }),
      makeItem({ id: 'c' }), // 无价格，忽略
    ]
    const overview = libraryOverview(items, [makeCategory('c1'), makeCategory('c2')], [makeTag('t1')], TODAY)
    expect(overview.itemCount).toBe(3)
    expect(overview.categoryCount).toBe(2)
    expect(overview.tagCount).toBe(1)
    expect(overview.pricedCount).toBe(2)
    expect(overview.totalCents).toBe(300_000)
    // 两件都是 2 天：1000/天 + 500/天
    expect(overview.dailyCents).toBe(150_000)
    expect(overview.totalText).toBe('¥3,000')
  })
})
