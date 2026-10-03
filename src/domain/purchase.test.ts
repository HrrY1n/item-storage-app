import { describe, expect, it } from 'vitest'
import {
  calculateDailyCostCents,
  calculateOwnershipDays,
  centsToPriceInput,
  formatCents,
  formatPurchaseDate,
  parseDateToDayNumber,
  parsePriceInput,
  platformLabel,
  todayString,
} from './purchase'

describe('parseDateToDayNumber', () => {
  it('合法日期转 UTC 日序号', () => {
    expect(parseDateToDayNumber('1970-01-01')).toBe(0)
    expect(parseDateToDayNumber('1970-01-02')).toBe(1)
  })

  it('非法格式 / 非法日历日返回 null', () => {
    expect(parseDateToDayNumber('2026-1-1')).toBeNull()
    expect(parseDateToDayNumber('2026/01/01')).toBeNull()
    expect(parseDateToDayNumber('2026-13-01')).toBeNull()
    expect(parseDateToDayNumber('2026-02-30')).toBeNull()
    expect(parseDateToDayNumber('')).toBeNull()
  })
})

describe('calculateOwnershipDays（按日历日，含购买当天）', () => {
  it('今天购买 = 1 天', () => {
    expect(calculateOwnershipDays('2026-10-03', '2026-10-03')).toBe(1)
  })

  it('昨天购买 = 2 天', () => {
    expect(calculateOwnershipDays('2026-10-02', '2026-10-03')).toBe(2)
  })

  it('跨月', () => {
    expect(calculateOwnershipDays('2026-09-30', '2026-10-03')).toBe(4)
  })

  it('跨年', () => {
    expect(calculateOwnershipDays('2025-12-31', '2026-01-02')).toBe(3)
  })

  it('闰年：2024-02-29 → 2024-03-01 = 2 天', () => {
    expect(calculateOwnershipDays('2024-02-29', '2024-03-01')).toBe(2)
  })

  it('长周期：2026-01-01 → 2026-10-03 = 276 天', () => {
    expect(calculateOwnershipDays('2026-01-01', '2026-10-03')).toBe(276)
  })

  it('未来日期 → null', () => {
    expect(calculateOwnershipDays('2026-10-04', '2026-10-03')).toBeNull()
  })

  it('非法日期 → null（不抛错）', () => {
    expect(calculateOwnershipDays('not-a-date', '2026-10-03')).toBeNull()
  })
})

describe('calculateDailyCostCents', () => {
  it('基本：¥1000 / 今天购买 = 100000 分/天', () => {
    expect(calculateDailyCostCents(100_000, '2026-10-03', '2026-10-03')).toBe(100_000)
  })

  it('¥1499 / 276 天 ≈ 543.1 分', () => {
    const cost = calculateDailyCostCents(149_900, '2026-01-01', '2026-10-03')
    expect(cost).not.toBeNull()
    expect(Math.round(cost!)).toBe(543)
  })

  it('价格为 0（赠品）→ 0', () => {
    expect(calculateDailyCostCents(0, '2026-01-01', '2026-10-03')).toBe(0)
  })

  it('缺价格或缺日期 → null', () => {
    expect(calculateDailyCostCents(null, '2026-01-01')).toBeNull()
    expect(calculateDailyCostCents(100, null)).toBeNull()
    expect(calculateDailyCostCents(null, null)).toBeNull()
  })

  it('未来日期 / 负价格 → null', () => {
    expect(calculateDailyCostCents(100, '2027-01-01', '2026-10-03')).toBeNull()
    expect(calculateDailyCostCents(-1, '2026-01-01', '2026-10-03')).toBeNull()
  })
})

describe('parsePriceInput / centsToPriceInput', () => {
  it('支持整数 / 一位小数 / 两位小数', () => {
    expect(parsePriceInput('1499')).toBe(149_900)
    expect(parsePriceInput('1499.9')).toBe(149_990)
    expect(parsePriceInput('1499.99')).toBe(149_999)
    expect(parsePriceInput('0')).toBe(0)
  })

  it('空串 / 非法 / 三位小数 / 负数 → null', () => {
    expect(parsePriceInput('')).toBeNull()
    expect(parsePriceInput('  ')).toBeNull()
    expect(parsePriceInput('abc')).toBeNull()
    expect(parsePriceInput('12.999')).toBeNull()
    expect(parsePriceInput('-5')).toBeNull()
    expect(parsePriceInput('1.2.3')).toBeNull()
  })

  it('回填：分 → 输入文本', () => {
    expect(centsToPriceInput(149_900)).toBe('1499')
    expect(centsToPriceInput(149_990)).toBe('1499.9')
    expect(centsToPriceInput(149_999)).toBe('1499.99')
  })
})

describe('格式化与平台映射', () => {
  it('formatCents', () => {
    expect(formatCents(149_900)).toBe('¥1,499.00')
    expect(formatCents(543)).toBe('¥5.43')
    expect(formatCents(0)).toBe('¥0.00')
  })

  it('formatPurchaseDate', () => {
    expect(formatPurchaseDate('2026-01-01')).toBe('2026年1月1日')
    expect(formatPurchaseDate('2026-12-25')).toBe('2026年12月25日')
  })

  it('platformLabel', () => {
    expect(platformLabel('jd')).toBe('京东')
    expect(platformLabel('taobao')).toBe('淘宝')
    expect(platformLabel('pinduoduo')).toBe('拼多多')
    expect(platformLabel('zhuanzhuan')).toBe('转转')
    expect(platformLabel('aihuishou')).toBe('爱回收')
    expect(platformLabel('other')).toBe('其他')
    expect(platformLabel(null)).toBe('')
  })

  it('todayString 用本地年月日拼接', () => {
    expect(todayString(new Date(2026, 9, 3))).toBe('2026-10-03')
  })
})
