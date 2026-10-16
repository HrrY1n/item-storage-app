import { describe, expect, it } from 'vitest'
import { addCalendarMonths, clampCalendarDate } from './purchase'
import { DEFAULT_WARRANTY_MONTHS, validateWarranty, warrantyDate, warrantySelectionFromDates, type WarrantySelection } from './warranty'

describe('自然月保修', () => {
  it.each([
    ['2026-10-16', 3, '2027-01-16'],
    ['2026-10-16', 6, '2027-04-16'],
    ['2026-10-16', 12, '2027-10-16'],
    ['2026-10-16', 24, '2028-10-16'],
    ['2023-01-31', 1, '2023-02-28'],
    ['2024-01-31', 1, '2024-02-29'],
    ['2024-02-29', 12, '2025-02-28'],
    ['2024-02-29', 48, '2028-02-29'],
    ['2026-08-31', 6, '2027-02-28'],
    ['2026-03-08', 1, '2026-04-08'],
    ['2026-01-31', 0, '2026-01-31'],
  ])('%s + %i 个月 = %s', (date, months, expected) => {
    expect(addCalendarMonths(date, months)).toBe(expected)
  })

  it('年/月切换时只收敛无效的月末日期', () => {
    expect(clampCalendarDate(2024, 2, 31)).toBe('2024-02-29')
    expect(clampCalendarDate(2025, 2, 29)).toBe('2025-02-28')
    expect(clampCalendarDate(2025, 4, 16)).toBe('2025-04-16')
    expect(clampCalendarDate(2025, 13, 16)).toBeNull()
    expect(clampCalendarDate(2025, 4, 0)).toBeNull()
  })

  it('不把非法日期、非整数月数或溢出日期伪造成到期日', () => {
    expect(addCalendarMonths('2025-02-29', 12)).toBeNull()
    expect(addCalendarMonths('bad', 12)).toBeNull()
    expect(addCalendarMonths('2026-01-01', 1.5)).toBeNull()
    expect(addCalendarMonths('2026-01-01', -1)).toBeNull()
    expect(addCalendarMonths('9999-12-31', 1)).toBeNull()
  })

  it('默认 12 个月；购买日期缺省时不捏造购买日或保修日', () => {
    const selection: WarrantySelection = { kind: 'months', months: DEFAULT_WARRANTY_MONTHS }
    expect(warrantyDate('2026-10-16', selection)).toBe('2027-10-16')
    expect(warrantyDate('', selection)).toBeNull()
    expect(validateWarranty('', selection)).toBeNull()
  })

  it('自定义整月和不适用', () => {
    expect(warrantyDate('2026-01-31', { kind: 'custom', months: '18' })).toBe('2027-07-31')
    expect(warrantyDate('2026-01-31', { kind: 'none' })).toBeNull()
  })

  it.each(['', '0', '-1', '1.5', '1e2', '1201', 'abc'])('拒绝非法自定义月数 %s', months => {
    const selection: WarrantySelection = { kind: 'custom', months }
    expect(warrantyDate('2026-01-01', selection)).toBeNull()
    expect(validateWarranty('2026-01-01', selection, '2026-10-16')).toBe('保修月数请输入 1 至 1200 的整数')
  })

  it.each([
    ['2026-01-31', '2027-01-31'],
    ['2024-02-29', '2025-02-28'],
    ['2026-01-31', '2027-07-31'],
    ['2026-01-31', '2027-02-03'],
    [null, '2027-02-03'],
    ['2026-01-31', null],
    [null, null],
  ])('编辑历史记录时保留到期日：%s → %s', (purchaseDate, expiresAt) => {
    expect(warrantyDate(purchaseDate ?? '', warrantySelectionFromDates(purchaseDate, expiresAt))).toBe(expiresAt)
  })

  it('历史不规则日期保持手动模式，不自动套用默认一年', () => {
    expect(warrantySelectionFromDates('2026-01-31', '2027-02-03')).toEqual({ kind: 'date', date: '2027-02-03' })
    expect(warrantySelectionFromDates('2026-01-31', null)).toEqual({ kind: 'none' })
  })

  it('新增和转为持有共享日期校验', () => {
    expect(validateWarranty('2026-10-17', { kind: 'none' }, '2026-10-16')).toBe('购买日期不能晚于今天')
    expect(validateWarranty('bad', { kind: 'none' }, '2026-10-16')).toBe('购买日期无效')
    expect(validateWarranty('2026-10-16', { kind: 'date', date: '2026-10-15' }, '2026-10-16')).toBe('保修到期日不能早于购买日期')
    expect(validateWarranty('', { kind: 'date', date: '2027-02-30' }, '2026-10-16')).toBe('保修到期日无效')
    expect(validateWarranty('', { kind: 'date', date: '2027-02-28' }, '2026-10-16')).toBeNull()
  })
})
