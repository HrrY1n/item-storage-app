import { describe, expect, it } from 'vitest'
import {
  DISPOSAL_METHOD_LABELS,
  ITEM_STATUS_LABELS,
  categoryDistribution,
  dashboardStats,
  dailyCostOf,
  effectiveCostCents,
  expiringWarranties,
  isDisposed,
  isOwned,
  isWishlist,
  ownershipDaysOf,
  restoreToOwnedFields,
  sanitizeLifecycle,
  statusOf,
  validateDisposal,
  warrantyInfo,
} from './lifecycle'
import { formatCents, formatCentsCompact } from './purchase'
import { makeItem } from '../test/fixtures'
import type { Category } from './types'

const TODAY = '2026-10-05'
const D = (s: string) => s

// ---------------------------------------------------------------- 生命周期状态

describe('生命周期状态', () => {
  it('wishlist → owned → disposed → owned 全链路可表达', () => {
    const base = makeItem()
    expect(statusOf(makeItem({ status: 'wishlist' }))).toBe('wishlist')
    expect(statusOf(makeItem({ status: 'owned' }))).toBe('owned')
    expect(statusOf(makeItem({ status: 'disposed' }))).toBe('disposed')
    expect(statusOf(base)).toBe('owned')

    expect(isWishlist(makeItem({ status: 'wishlist' }))).toBe(true)
    expect(isOwned(makeItem({ status: 'owned' }))).toBe(true)
    expect(isDisposed(makeItem({ status: 'disposed' }))).toBe(true)
  })

  it('未迁移的历史数据（status 缺失/脏值）一律按 owned 处理', () => {
    const legacy = { ...makeItem(), status: undefined as unknown as never }
    expect(statusOf(legacy)).toBe('owned')
    const dirty = { ...makeItem(), status: 'nonsense' as never }
    expect(statusOf(dirty)).toBe('owned')
  })

  it('三种状态与三种处置方式都有中文标签', () => {
    expect(Object.keys(ITEM_STATUS_LABELS)).toEqual(['wishlist', 'owned', 'disposed'])
    expect(Object.keys(DISPOSAL_METHOD_LABELS)).toEqual(['sold', 'discarded', 'other'])
  })

  it('心愿物品允许完全没有购买信息', () => {
    const wish = makeItem({ status: 'wishlist' })
    expect(ownershipDaysOf(wish, TODAY)).toBeNull()
    expect(effectiveCostCents(wish)).toBeNull()
    expect(dailyCostOf(wish, TODAY)).toBeNull()
  })
})

// ---------------------------------------------------------------- 持有天数冻结

describe('持有天数', () => {
  const bought = D('2024-05-17')

  it('持有中：算到今天', () => {
    const n = ownershipDaysOf(makeItem({ purchaseDate: bought }), TODAY)
    expect(n).toBe(872) // 2024-05-17 → 2026-10-05 含首尾
  })

  it('已处置：冻结在处置日，一年后再看也不变', () => {
    const item = makeItem({
      purchaseDate: bought,
      status: 'disposed',
      disposedAt: '2024-05-20',
      disposalMethod: 'discarded',
    })
    const n1 = ownershipDaysOf(item, TODAY)
    const n2 = ownershipDaysOf(item, '2030-01-01')
    expect(n1).toBe(4) // 05-17 → 05-20 含首尾
    expect(n2).toBe(4) // 关键：不再增长
  })

  it('恢复为持有后重新按今天计算', () => {
    const disposed = makeItem({
      purchaseDate: bought,
      status: 'disposed',
      disposedAt: '2024-05-20',
      disposalMethod: 'discarded',
    })
    const restored = makeItem({ ...disposed, ...restoreToOwnedFields() })
    expect(restored.status).toBe('owned')
    expect(ownershipDaysOf(restored, TODAY)).toBe(872)
  })

  it('脏数据优雅降级为 null，不崩溃', () => {
    // 已处置但没有处置日期
    expect(ownershipDaysOf(makeItem({ purchaseDate: bought, status: 'disposed' }), TODAY)).toBeNull()
    // 处置日期早于购买日期
    expect(
      ownershipDaysOf(
        makeItem({
          purchaseDate: bought,
          status: 'disposed',
          disposedAt: '2024-01-01',
          disposalMethod: 'other',
        }),
        TODAY,
      ),
    ).toBeNull()
    // 没有购买日期
    expect(ownershipDaysOf(makeItem(), TODAY)).toBeNull()
    // 非法日期
    expect(ownershipDaysOf(makeItem({ purchaseDate: '2024-13-40' }), TODAY)).toBeNull()
  })
})

// ---------------------------------------------------------------- 净成本

describe('实际持有成本（出售抵扣）', () => {
  const sold = makeItem({
    purchaseDate: '2024-06-01',
    purchasePriceCents: 800_000, // ¥8,000
    status: 'disposed',
    disposedAt: '2026-05-20', // 持有 720 天
    disposalMethod: 'sold',
    salePriceCents: 450_000, // ¥4,500
  })

  it('已出售：实际持有成本 = 总投入 − 出售金额', () => {
    expect(effectiveCostCents(sold)).toBe(350_000) // ¥3,500
  })

  it('已出售：实际日均成本 = 净成本 ÷ 冻结天数', () => {
    const days = ownershipDaysOf(sold, TODAY)
    expect(days).toBe(719)
    // 350000 分 ÷ 719 天 = 486.79 分/天 = ¥4.87/天
    const daily = dailyCostOf(sold, TODAY)
    expect(daily).toBeCloseTo(350_000 / 719, 6)
    expect(formatCents(Math.round(daily!))).toBe('¥4.87')
  })

  it('出售金额 > 总投入 → 允许负成本（实际收益），绝不夹逼到 0', () => {
    const profit = makeItem({
      purchaseDate: '2024-06-01',
      purchasePriceCents: 100_000,
      status: 'disposed',
      disposedAt: '2024-06-11',
      disposalMethod: 'sold',
      salePriceCents: 150_000,
    })
    expect(effectiveCostCents(profit)).toBe(-50_000) // -¥500
    // 持有 11 天（06-01 → 06-11 含首尾）：-50000 ÷ 11 = -4545.45 分/天
    expect(dailyCostOf(profit, TODAY)).toBeCloseTo(-50_000 / 11, 6)
    // 格式化必须把负号放在 ¥ 前面
    expect(formatCents(-50_000)).toBe('-¥500.00')
    expect(formatCentsCompact(-50_000)).toBe('-¥500.00')
  })

  it('出售金额为 0 视为白送：净成本 = 总投入', () => {
    const gift = makeItem({
      purchaseDate: '2024-06-01',
      purchasePriceCents: 100_000,
      status: 'disposed',
      disposedAt: '2024-06-11',
      disposalMethod: 'sold',
      salePriceCents: 0,
    })
    expect(effectiveCostCents(gift)).toBe(100_000)
  })

  it('出售金额留空 → 不计算净成本，退回总投入', () => {
    const noPrice = makeItem({
      purchaseDate: '2024-06-01',
      purchasePriceCents: 800_000,
      status: 'disposed',
      disposedAt: '2024-06-11',
      disposalMethod: 'sold',
      salePriceCents: null,
    })
    expect(effectiveCostCents(noPrice)).toBe(800_000)
  })

  it('丢弃 / 其他：没有回收概念，成本 = 总投入，但天数仍冻结', () => {
    const discarded = makeItem({
      purchaseDate: '2024-06-01',
      purchasePriceCents: 800_000,
      status: 'disposed',
      disposedAt: '2024-06-11',
      disposalMethod: 'discarded',
      // 脏数据：即使 salePriceCents 有值，discarded 也不得计入
      salePriceCents: 400_000,
    })
    const sanitized = { ...discarded, ...sanitizeLifecycle({
      status: 'disposed',
      disposedAt: discarded.disposedAt,
      disposalMethod: discarded.disposalMethod,
      salePriceCents: discarded.salePriceCents,
      disposalNote: null,
    }) }
    expect(sanitized.salePriceCents).toBeNull()
    expect(effectiveCostCents(sanitized)).toBe(800_000)
    expect(ownershipDaysOf(sanitized, TODAY)).toBe(11)
  })
})

// ---------------------------------------------------------------- 业务校验与规范化

describe('处置校验与规范化', () => {
  it('处置日期不能早于购买日期', () => {
    expect(
      validateDisposal({
        disposedAt: '2024-01-01',
        purchaseDate: '2024-06-01',
        disposalMethod: 'sold',
        salePriceCents: null,
      }),
    ).toEqual({ ok: false, error: '处置日期不能早于购买日期' })
    expect(
      validateDisposal({
        disposedAt: '2024-06-02',
        purchaseDate: '2024-06-01',
        disposalMethod: 'sold',
        salePriceCents: null,
      }).ok,
    ).toBe(true)
  })

  it('出售金额必须 ≥ 0（允许 0）', () => {
    expect(
      validateDisposal({
        disposedAt: '2024-06-02',
        purchaseDate: null,
        disposalMethod: 'sold',
        salePriceCents: -1,
      }).ok,
    ).toBe(false)
    expect(
      validateDisposal({
        disposedAt: '2024-06-02',
        purchaseDate: null,
        disposalMethod: 'sold',
        salePriceCents: 0,
      }).ok,
    ).toBe(true)
  })

  it('只有「出售」才允许填写出售金额', () => {
    for (const m of ['discarded', 'other'] as const) {
      expect(
        validateDisposal({
          disposedAt: '2024-06-02',
          purchaseDate: null,
          disposalMethod: m,
          salePriceCents: 100,
        }).ok,
      ).toBe(false)
    }
  })

  it('必须选择处置方式与处置日期', () => {
    expect(validateDisposal({ disposedAt: '2024-06-02', purchaseDate: null, disposalMethod: null, salePriceCents: null })).toEqual({
      ok: false,
      error: '请选择处置方式',
    })
    expect(validateDisposal({ disposedAt: null, purchaseDate: null, disposalMethod: 'sold', salePriceCents: null })).toEqual({
      ok: false,
      error: '请填写处置日期',
    })
  })

  it('sanitizeLifecycle：非处置状态强制清空全部处置字段', () => {
    const s = sanitizeLifecycle({
      status: 'owned',
      disposedAt: '2024-06-02',
      disposalMethod: 'sold',
      salePriceCents: 100,
      disposalNote: 'x',
    })
    expect(s).toEqual({
      status: 'owned',
      disposedAt: null,
      disposalMethod: null,
      salePriceCents: null,
      disposalNote: null,
    })
  })

  it('sanitizeLifecycle：非法日期 / 负数金额 / 非出售方式都被清理', () => {
    const s = sanitizeLifecycle({
      status: 'disposed',
      disposedAt: '2024-13-45',
      disposalMethod: 'discarded',
      salePriceCents: 500,
      disposalNote: '   ',
    })
    expect(s.disposedAt).toBeNull()
    expect(s.salePriceCents).toBeNull()
    expect(s.disposalNote).toBeNull()

    const neg = sanitizeLifecycle({
      status: 'disposed',
      disposedAt: '2024-06-02',
      disposalMethod: 'sold',
      salePriceCents: -5,
      disposalNote: null,
    })
    expect(neg.salePriceCents).toBeNull()
  })
})

// ---------------------------------------------------------------- 保修

describe('保修状态', () => {
  it('未填写保修日期 → null（整个模块不显示）', () => {
    expect(warrantyInfo(null, TODAY)).toBeNull()
    expect(warrantyInfo('2024-13-01', TODAY)).toBeNull()
  })

  it('保修中 / 即将到期（30 天内） / 已过保 三态', () => {
    expect(warrantyInfo('2027-05-17', TODAY)?.state).toBe('active')
    expect(warrantyInfo('2026-10-20', TODAY)?.state).toBe('expiring')
    expect(warrantyInfo('2026-10-05', TODAY)?.state).toBe('expiring') // 当天到期也算临期
    expect(warrantyInfo('2026-09-01', TODAY)?.state).toBe('expired')
  })

  it('30 天边界：第 30 天仍算临期，第 31 天不算', () => {
    expect(warrantyInfo('2026-11-04', TODAY)?.state).toBe('expiring')
    expect(warrantyInfo('2026-11-05', TODAY)?.state).toBe('active')
  })

  it('文案正确表达剩余/已过保天数', () => {
    expect(warrantyInfo('2026-10-28', TODAY)?.detail).toBe('还有 23 天到期')
    expect(warrantyInfo('2026-10-05', TODAY)?.detail).toBe('今天到期')
    expect(warrantyInfo('2026-09-03', TODAY)?.detail).toBe('已过保 32 天')
    expect(warrantyInfo('2027-05-17', TODAY)?.detail).toMatch(/保修剩余 \d+ 个月/)
  })

  it('临期提醒只统计持有中：心愿与已处置不参与', () => {
    const items = [
      makeItem({ id: 'a', warrantyExpiresAt: '2026-10-20' }),
      makeItem({ id: 'b', status: 'wishlist', warrantyExpiresAt: '2026-10-10' }),
      makeItem({ id: 'c', status: 'disposed', disposedAt: '2024-01-01', disposalMethod: 'other', warrantyExpiresAt: '2026-10-11' }),
      makeItem({ id: 'd', warrantyExpiresAt: '2030-01-01' }), // 保修中，不提醒
    ]
    const list = expiringWarranties(items, TODAY)
    expect(list.map((x) => x.item.id)).toEqual(['a'])
  })

  it('临期列表按剩余天数升序（最紧急在前）', () => {
    const items = [
      makeItem({ id: 'later', warrantyExpiresAt: '2026-10-30' }),
      makeItem({ id: 'sooner', warrantyExpiresAt: '2026-10-10' }),
      makeItem({ id: 'expired', warrantyExpiresAt: '2026-09-01' }),
    ]
    expect(expiringWarranties(items, TODAY).map((x) => x.item.id)).toEqual([
      'expired',
      'sooner',
      'later',
    ])
  })
})

// ---------------------------------------------------------------- Dashboard 聚合

const cat = (id: string, name: string): Category => ({
  id,
  parentId: null,
  name,
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
})

describe('Dashboard 计算', () => {
  it('只统计持有中：心愿与已处置不进入总投入与物品数', () => {
    const items = [
      makeItem({ id: 'o1', purchaseDate: '2025-01-01', purchasePriceCents: 100_000 }),
      makeItem({ id: 'w1', status: 'wishlist', purchasePriceCents: 999_000 }),
      makeItem({
        id: 'd1',
        status: 'disposed',
        disposedAt: '2025-06-01',
        disposalMethod: 'sold',
        purchaseDate: '2025-01-01',
        purchasePriceCents: 50_000,
        salePriceCents: 80_000,
      }),
    ]
    const s = dashboardStats(items, [cat('c1', '数码'), cat('c2', '生活')], TODAY)
    expect(s.ownedCount).toBe(1)
    expect(s.wishlistCount).toBe(1)
    expect(s.disposedCount).toBe(1)
    // 已出售那件按净成本（-¥300）不计入持有总投入
    expect(s.totalInvestmentCents).toBe(100_000)
    expect(s.pricedOwnedCount).toBe(1)
  })

  it('无价格数据时不产出总投入（不显示 ¥0.00）', () => {
    const s = dashboardStats([makeItem({ id: 'a' })], [], TODAY)
    expect(s.totalInvestmentCents).toBeNull()
    expect(s.dailyTotalCents).toBeNull()
    expect(s.ownedCount).toBe(1)
  })

  it('出售回收单独统计，不与总投入混在一起', () => {
    const items = [
      makeItem({
        id: 'd1',
        status: 'disposed',
        disposedAt: '2025-06-01',
        disposalMethod: 'sold',
        purchaseDate: '2025-01-01',
        purchasePriceCents: 50_000,
        salePriceCents: 30_000,
      }),
      makeItem({
        id: 'd2',
        status: 'disposed',
        disposedAt: '2025-06-01',
        disposalMethod: 'discarded',
        purchaseDate: '2025-01-01',
        purchasePriceCents: 20_000,
      }),
    ]
    const s = dashboardStats(items, [], TODAY)
    expect(s.saleCount).toBe(1)
    expect(s.saleProceedsCents).toBe(30_000)
  })

  it('分类分布：只统计持有中，按数量降序', () => {
    const items = [
      makeItem({ id: '1', categoryId: 'c1' }),
      makeItem({ id: '2', categoryId: 'c1' }),
      makeItem({ id: '3', categoryId: 'c2' }),
      makeItem({ id: '4', categoryId: 'c1', status: 'wishlist' }),
    ]
    const dist = categoryDistribution(items, [cat('c1', '数码'), cat('c2', '生活'), cat('c3', '空')])
    expect(dist.map((d) => d.categoryId)).toEqual(['c1', 'c2'])
    expect(dist[0].count).toBe(2)
    expect(dist[0].ratio).toBeCloseTo(2 / 3, 6)
    // 计数为 0 的分类不出现
    expect(dist.find((d) => d.categoryId === 'c3')).toBeUndefined()
  })

  it('没有任何持有物品时分布为空', () => {
    expect(categoryDistribution([makeItem({ status: 'wishlist' })], [cat('c1', '数码')])).toEqual([])
  })
})
