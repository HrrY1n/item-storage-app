import { describe, expect, it } from 'vitest'
import { makeItem } from '../../test/fixtures'
import { effectiveCostCents } from '../../domain/lifecycle'
import { formatCentsCard } from '../../domain/purchase'
import {
  DISPOSITION_BADGE_LABELS,
  dispositionCounts,
  dispositionKindOf,
  itemPresentation,
  matchesDispositionFilter,
  metricValueClass,
} from './itemPresentation'

/**
 * 处置卡片展示模型（Phase 2H.2）。
 *
 * 这个模块是 §4「消除双实现语义分叉」的核心：Grid / List / 概览 / 分类页
 * 全部消费它，因此对同一件物品必然得到相同的徽标、指标名、指标值与财务语义。
 *
 * 对应需求 §18 的 A~J 十项覆盖。
 */

const TODAY = '2026-10-01'
const CTX = { today: TODAY, categoryName: '数码与电子' }

/** 已出售：总投入 2042，出售回收 568 → 净成本 1474 → 亏损 */
const SOLD_LOSS = makeItem({
  status: 'disposed',
  disposalMethod: 'sold',
  disposedAt: '2026-09-14',
  purchaseDate: '2022-09-15',
  purchasePriceCents: 200_000,
  additionalCostCents: 4_200,
  salePriceCents: 56_800,
})

/** 已出售：总投入 1000，出售回收 1200 → 净成本 −200 → 盈利 */
const SOLD_PROFIT = makeItem({
  status: 'disposed',
  disposalMethod: 'sold',
  disposedAt: '2026-09-14',
  purchaseDate: '2026-01-01',
  purchasePriceCents: 100_000,
  additionalCostCents: 0,
  salePriceCents: 120_000,
})

/** 已出售：恰好回本 → 持平 */
const SOLD_EVEN = makeItem({
  status: 'disposed',
  disposalMethod: 'sold',
  disposedAt: '2026-09-14',
  purchaseDate: '2026-01-01',
  purchasePriceCents: 100_000,
  salePriceCents: 100_000,
})

const DISCARDED = makeItem({
  status: 'disposed',
  disposalMethod: 'discarded',
  disposedAt: '2026-03-02',
  purchaseDate: '2024-01-10',
  purchasePriceCents: 19_900,
})

const OTHER = makeItem({
  status: 'disposed',
  disposalMethod: 'other',
  disposedAt: '2025-11-08',
  purchaseDate: '2025-01-01',
  purchasePriceCents: 8_900,
})

/** 真实可能存在：有处置状态但没记录方式（备份校验与同步解码都放行 null） */
const DISPOSED_UNSPECIFIED = makeItem({
  status: 'disposed',
  disposalMethod: null,
  disposedAt: '2025-06-01',
  purchaseDate: '2024-01-01',
  purchasePriceCents: 5_000,
})

const labels = (p: ReturnType<typeof itemPresentation>) => p.metrics.map((m) => m.label)
const values = (p: ReturnType<typeof itemPresentation>) => p.metrics.map((m) => m.value)

/* ============================================================ *
 * A. sold 的三栏指标
 * ============================================================ */

describe('A. 已售出卡片的三栏指标', () => {
  it('指标顺序固定为 持有天数 / 出售回收 / 日均成本', () => {
    const p = itemPresentation(SOLD_LOSS, CTX)
    expect(labels(p)).toEqual(['持有天数', '出售回收', '日均成本'])
  })

  it('三栏值都不为空（持有天数与日均由 domain 算出）', () => {
    const p = itemPresentation(SOLD_LOSS, CTX)
    expect(values(p).every((v) => v !== '' && v !== null)).toBe(true)
  })

  it('出售回收显示真实出售金额', () => {
    const p = itemPresentation(SOLD_LOSS, CTX)
    const idx = labels(p).indexOf('出售回收')
    expect(p.metrics[idx].value).toBe('¥568')
  })

  it('持有天数冻结在处置日，不再随today 增长', () => {
    const a = itemPresentation(SOLD_LOSS, CTX)
    const b = itemPresentation(SOLD_LOSS, { ...CTX, today: '2026-12-31' })
    expect(labels(a)[0]).toBe('持有天数')
    // 冻结 ⇒ 两个"今天"算出的天数相同
    expect(a.metrics[0].value).toBe(b.metrics[0].value)
  })

  it('心愿物品不渲染任何指标', () => {
    const p = itemPresentation(makeItem({ status: 'wishlist' }), CTX)
    expect(p.metrics).toEqual([])
  })
})

/* ============================================================ *
 * B. sold 的总投入必须是 gross cost，不是 effectiveCostCents
 * ============================================================ */

describe('B. 总投入用毛投入，不是净成本', () => {
  it('总投入 = 购买价 + 附加花费（不受出售回收影响）', () => {
    const p = itemPresentation(SOLD_LOSS, CTX)
    expect(p.grossText).toBe('¥2,042')
  })

  it('⚠️ 同一件物品：grossText ≠ effectiveCostCents（这正是旧 bug 的根源）', () => {
    const net = effectiveCostCents(SOLD_LOSS)
    const p = itemPresentation(SOLD_LOSS, CTX)
    // 净成本是 1474（= 2042 − 568），总投入必须是 2042
    expect(net).toBe(147_400)
    expect(p.grossText).toBe('¥2,042')
    expect(p.grossText).not.toBe('¥1,474')
  })

  it('持有物品的总投入也在指标里显示', () => {
    const owned = makeItem({ purchaseDate: '2026-01-01', purchasePriceCents: 50_000 })
    const p = itemPresentation(owned, CTX)
    expect(labels(p)).toContain('总投入')
    expect(values(p)[labels(p).indexOf('总投入')]).toBe('¥500')
  })
})

/* ============================================================ *
 * C. 盈亏三分支（勘误 FIX-A 的核心）
 * ============================================================ */

describe('C. 盈亏方向（FIX-A）', () => {
  it('sale > gross → 盈利', () => {
    const p = itemPresentation(SOLD_PROFIT, CTX)
    expect(p.finance).not.toBeNull()
    expect(p.finance!.value).toBe('盈利 ¥200')
    expect(p.finance!.tone).toBe('positive')
  })

  it('sale < gross → 亏损，且显示绝对值', () => {
    const p = itemPresentation(SOLD_LOSS, CTX)
    expect(p.finance!.value).toBe('亏损 ¥1,474')
    expect(p.finance!.tone).toBe('negative')
  })

  it('sale === gross → 持平', () => {
    const p = itemPresentation(SOLD_EVEN, CTX)
    expect(p.finance!.value).toBe('持平')
    expect(p.finance!.tone).toBe('neutral')
  })

  it('⚠️ 禁止把「净成本为正」显示成盈利（FIX-A 原始 bug）', () => {
    // SOLD_LOSS 净成本为正1474 → 必须显示"亏损"，绝不能是"盈利"
    const p = itemPresentation(SOLD_LOSS, CTX)
    expect(p.finance!.value).not.toContain('盈利')
  })

  it('⚠️ 净成本为负 → 必须显示盈利（最容易搞反的那一格）', () => {
    // 总投入 1000 / 出售回收 1200 → 净成本 −200 → 盈利 200
    expect(effectiveCostCents(SOLD_PROFIT)).toBe(-20_000)
    const p = itemPresentation(SOLD_PROFIT, CTX)
    expect(p.finance!.value).toBe('盈利 ¥200')
  })

  it('出售但未记录金额 → 不计算盈亏（留空 ≠ ¥0）', () => {
    const noAmount = makeItem({
      status: 'disposed',
      disposalMethod: 'sold',
      disposedAt: '2026-09-14',
      purchaseDate: '2026-01-01',
      purchasePriceCents: 100_000,
      salePriceCents: null,
    })
    const p = itemPresentation(noAmount, CTX)
    expect(p.finance).toBeNull()
    // 且不出现"出售回收"这一栏（没有金额就没有回收）
    expect(labels(p)).not.toContain('出售回收')
  })
})

/* ============================================================ *
 * D. 负净成本不被 clamp
 * ============================================================ */

describe('D. 负值纪律', () => {
  it('净成本为负时保持负值（domain 口径不被 UI 改写）', () => {
    expect(effectiveCostCents(SOLD_PROFIT)).toBeLessThan(0)
  })

  it('盈利时金额本身不带负号', () => {
    const p = itemPresentation(SOLD_PROFIT, CTX)
    expect(p.finance!.value).not.toContain('-')
  })

  it('亏损时显示绝对值、不带负号（语义由"亏损"这个词承担）', () => {
    const p = itemPresentation(SOLD_LOSS, CTX)
    expect(p.finance!.value).toBe('亏损 ¥1,474')
    expect(p.finance!.value).not.toContain('-¥')
  })
})

/* ============================================================ *
 * E/F. discarded / other 不得出现任何出售相关字段
 * ============================================================ */

describe('E. 已丢弃卡片', () => {
  const p = () => itemPresentation(DISCARDED, CTX)

  it('指标为 持有天数 / 总投入 / 日均成本', () => {
    expect(labels(p())).toEqual(['持有天数', '总投入', '日均成本'])
  })

  it('⚠️ 绝不出现出售回收 / 出售价格 / 盈亏', () => {
    expect(labels(p())).not.toContain('出售回收')
    expect(p().finance).toBeNull()
  })

  it('⚠️ 绝不出现 ¥0 占位', () => {
    // 注意不能用 `join(' ').not.toContain('¥0')` —— 那是子串匹配，
    // 会把合法的「¥0.25 日均成本」误判成 ¥0 占位。逐个值精确比对。
    expect(values(p())).not.toContain('¥0')
    expect(values(p())).not.toContain('¥0.00')
    expect(values(p()).every((v) => v !== '¥0' && v !== '¥0.00')).toBe(true)
  })
})

describe('F. 其他处置卡片', () => {
  const p = () => itemPresentation(OTHER, CTX)

  it('与 discarded 同构：持有天数 / 总投入 / 日均成本', () => {
    expect(labels(p())).toEqual(['持有天数', '总投入', '日均成本'])
  })

  it('⚠️ 绝不出现出售回收 / 盈亏 / ¥0', () => {
    expect(labels(p())).not.toContain('出售回收')
    expect(p().finance).toBeNull()
    // 精确比对，不能用子串匹配（`¥0.29` 里也含 `¥0`）
    expect(values(p())).not.toContain('¥0')
    expect(values(p())).not.toContain('¥0.00')
  })

  it('⚠️ 绝不虚构 subtype（domain 只有 method，没有原因字段）', () => {
    const text = p().badgeText + p().subtitle
    for (const forbidden of ['赠送', '报废', '退役', '损坏', '丢失']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('⚠️ 不解析 disposalNote 去猜测原因', () => {
    const withNote = makeItem({
      status: 'disposed',
      disposalMethod: 'other',
      disposedAt: '2025-11-08',
      purchaseDate: '2025-01-01',
      purchasePriceCents: 8_900,
      disposalNote: '送给朋友了',
    })
    const p2 = itemPresentation(withNote, CTX)
    expect(p2.badgeText).toBe(DISPOSITION_BADGE_LABELS.other)
    expect(p2.badgeText).not.toContain('赠送')
  })
})

/* ============================================================ *
 * G/H. 徽标与 overlay
 * ============================================================ */

describe('G. 处置方法徽标', () => {
  it('三种方法各有独立文案', () => {
    expect(itemPresentation(SOLD_LOSS, CTX).badgeText).toBe('已售出')
    expect(itemPresentation(DISCARDED, CTX).badgeText).toBe('已丢弃')
    expect(itemPresentation(OTHER, CTX).badgeText).toBe('其他处置')
  })

  it('持有 / 心愿没有处置徽标', () => {
    expect(itemPresentation(makeItem(), CTX).badge).toBeNull()
    expect(itemPresentation(makeItem({ status: 'wishlist' }), CTX).badge).toBeNull()
  })

  it('dispositionKindOf 正确映射', () => {
    expect(dispositionKindOf(SOLD_LOSS)).toBe('sold')
    expect(dispositionKindOf(DISCARDED)).toBe('discarded')
    expect(dispositionKindOf(OTHER)).toBe('other')
    expect(dispositionKindOf(makeItem())).toBeNull()
  })
})

describe('H. 图片overlay 只有出售有', () => {
  it('已售出 → overlay = 售出', () => {
    expect(itemPresentation(SOLD_LOSS, CTX).overlay).toBe('售出')
  })

  it('已丢弃 / 其他处置 → 无 overlay', () => {
    expect(itemPresentation(DISCARDED, CTX).overlay).toBeNull()
    expect(itemPresentation(OTHER, CTX).overlay).toBeNull()
  })
})

/* ============================================================ *
 * I. 单一展示模型 = 不可能再分叉
 * ============================================================ */

describe('I. 同一物品在任意调用点得到完全相同的结果', () => {
  it('不同调用方传入不同 categoryName 时，处置态结果不受影响', () => {
    // 概览页与处置页的分类上下文不同，但处置卡的指标/财务必须一致
    const fromHome = itemPresentation(SOLD_LOSS, { today: TODAY, categoryName: '数码与电子' })
    const fromList = itemPresentation(SOLD_LOSS, { today: TODAY, categoryName: '' })
    expect(fromList.metrics).toEqual(fromHome.metrics)
    expect(fromList.finance).toEqual(fromHome.finance)
    expect(fromList.badge).toBe(fromHome.badge)
    expect(fromList.badgeText).toBe(fromHome.badgeText)
  })

  it('处置态副标题只含处置日期，不含分类名', () => {
    const p = itemPresentation(SOLD_LOSS, { today: TODAY, categoryName: '数码与电子' })
    expect(p.subtitle).toBe('处置于 2026年9月14日')
    expect(p.subtitle).not.toContain('数码与电子')
  })

  it('非处置态副标题才用分类名', () => {
    const p = itemPresentation(makeItem(), { today: TODAY, categoryName: '数码与电子' })
    expect(p.subtitle).toBe('数码与电子')
  })

  it('处置日期缺失时给出明确兜底而不是 "undefined"', () => {
    const noDate = makeItem({ status: 'disposed', disposalMethod: 'discarded' })
    const p = itemPresentation(noDate, CTX)
    expect(p.subtitle).not.toContain('undefined')
    expect(p.subtitle).not.toContain('null')
  })
})

/* ============================================================ *
 * J. 金额不被截断
 * ============================================================ */

describe('J. 金额完整可读', () => {
  it('总投入：常见金额在卡片模式下完整显示（无省略号 / 无 compact 记法）', () => {
    // 总投入 =购买价 + 附加花费，按domain 口径**恒非负**，
    // 所以负数情形要靠"日均成本为负"（卖出赚了的物品）来覆盖。
    const cases: Array<[number, string]> = [
      [47_600, '¥476'],
      [147_400, '¥1,474'],
      [1_299_900, '¥12,999'],
      [12_345_700, '¥123,457'],
    ]
    for (const [cents, expected] of cases) {
      const item = makeItem({ purchaseDate: '2026-01-01', purchasePriceCents: cents })
      const p = itemPresentation(item, CTX)
      expect(p.metrics[p.metrics.findIndex((m) => m.label === '总投入')].value).toBe(expected)
    }
  })

  it('负数金额真的带负号（卖出赚了 → 日均成本为负）', () => {
    // SOLD_PROFIT：净成本 −200，天数 ≈ 273 → 日均为负
    const p = itemPresentation(SOLD_PROFIT, CTX)
    const daily = p.metrics[p.metrics.findIndex((m) => m.label === '日均成本')].value
    expect(daily.startsWith('-¥')).toBe(true)
    expect(daily).not.toContain('…')
  })

  it('设计要求覆盖的 6 个金额都能被现有 formatter 完整表达（FIX-C：不改 formatter）', () => {
    // 直接锁住 formatter 契约：卡片用 formatCentsCard，禁止 compact 记法与省略号
    expect(formatCentsCard(47_600)).toBe('¥476')
    expect(formatCentsCard(147_400)).toBe('¥1,474')
    expect(formatCentsCard(1_299_900)).toBe('¥12,999')
    expect(formatCentsCard(12_345_700)).toBe('¥123,457')
    expect(formatCentsCard(-147_400)).toBe('-¥1,474')
    expect(formatCentsCard(-1_234_600)).toBe('-¥12,346')
    for (const v of [
      formatCentsCard(47_600),
      formatCentsCard(12_345_700),
      formatCentsCard(-1_234_600),
    ]) {
      expect(v).not.toContain('…')
      expect(v).not.toMatch(/[kK]/)
      expect(v).not.toContain('万')
    }
  })

  it('metricValueClass：长金额降一档字号，短金额用标准字号', () => {
    expect(metricValueClass('¥476', 3)).toBe('text-caption')
    expect(metricValueClass('¥1,474', 3)).toBe('text-caption')
    expect(metricValueClass('¥123,457', 3)).toBe('text-[11px]')
    expect(metricValueClass('-¥123,457', 3)).toBe('text-[11px]')
  })

  it('metricValueClass：两栏时不降档（空间充裕）', () => {
    expect(metricValueClass('¥123,457', 2)).toBe('text-caption')
  })

  it('⚠️ 三栏时金额字符串永不含省略号 —— 降档只改字号不改数值', () => {
    for (const v of ['¥476', '¥1,474', '¥12,999', '¥123,457', '-¥123,457']) {
      expect(v).not.toContain('…')
      expect(v).not.toContain('...')
      expect(metricValueClass(v, 3)).toBeDefined()
    }
  })
})

/* ============================================================ *
 * null disposalMethod 的中性兜底
 * ============================================================ */

describe('null disposalMethod（真实存在的数据形态）', () => {
  it('归为 unspecified，显示中性「已处置」，不伪装成 other', () => {
    const p = itemPresentation(DISPOSED_UNSPECIFIED, CTX)
    expect(p.badge).toBe('unspecified')
    expect(p.badgeText).toBe('已处置')
    expect(p.badgeText).not.toBe('其他处置')
  })

  it('指标与 discarded 同构（投入即最终成本），无出售字段', () => {
    const p = itemPresentation(DISPOSED_UNSPECIFIED, CTX)
    expect(labels(p)).toEqual(['持有天数', '总投入', '日均成本'])
    expect(p.finance).toBeNull()
    expect(p.overlay).toBeNull()
  })

  it('分桶计数：只进「全部」，不计入任何处置方式', () => {
    const counts = dispositionCounts([
      SOLD_LOSS,
      DISCARDED,
      OTHER,
      DISPOSED_UNSPECIFIED,
      makeItem(),
    ])
    expect(counts.all).toBe(4)
    expect(counts.sold).toBe(1)
    expect(counts.discarded).toBe(1)
    expect(counts.other).toBe(1)
    expect(counts.unspecified).toBe(1)
  })

  it('筛选：all 命中它，三种方式都不命中', () => {
    expect(matchesDispositionFilter(DISPOSED_UNSPECIFIED, 'all')).toBe(true)
    expect(matchesDispositionFilter(DISPOSED_UNSPECIFIED, 'sold')).toBe(false)
    expect(matchesDispositionFilter(DISPOSED_UNSPECIFIED, 'discarded')).toBe(false)
    expect(matchesDispositionFilter(DISPOSED_UNSPECIFIED, 'other')).toBe(false)
  })
})

/* ============================================================ *
 * 处置筛选
 * ============================================================ */

describe('处置二级筛选', () => {
  const all = [SOLD_LOSS, SOLD_PROFIT, DISCARDED, OTHER, DISPOSED_UNSPECIFIED, makeItem()]

  it('all 只匹配已处置，不匹配持有中', () => {
    expect(matchesDispositionFilter(SOLD_LOSS, 'all')).toBe(true)
    expect(matchesDispositionFilter(makeItem(), 'all')).toBe(false)
  })

  it('各方式只匹配自己', () => {
    expect(matchesDispositionFilter(SOLD_LOSS, 'sold')).toBe(true)
    expect(matchesDispositionFilter(DISCARDED, 'discarded')).toBe(true)
    expect(matchesDispositionFilter(OTHER, 'other')).toBe(true)
    expect(all.filter((i) => matchesDispositionFilter(i, 'sold'))).toHaveLength(2)
  })
})
