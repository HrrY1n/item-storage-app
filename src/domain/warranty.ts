import { addCalendarMonths, parseDateToDayNumber, todayString } from './purchase'

export const WARRANTY_MONTH_OPTIONS = [3, 6, 12, 24] as const
export const DEFAULT_WARRANTY_MONTHS = 12

/** 仅用于表单；仍只保存既有的 warrantyExpiresAt。 */
export type WarrantySelection =
  | { kind: 'months'; months: number }
  | { kind: 'custom'; months: string }
  | { kind: 'date'; date: string }
  | { kind: 'none' }

function monthsOf(selection: WarrantySelection): number | null {
  if (selection.kind !== 'months' && selection.kind !== 'custom') return null
  if (selection.kind === 'custom' && !/^\d+$/.test(selection.months)) return null
  const months = Number(selection.months)
  return Number.isInteger(months) && months >= 1 && months <= 1200 ? months : null
}

export function warrantyDate(purchaseDate: string, selection: WarrantySelection): string | null {
  if (selection.kind === 'none') return null
  if (selection.kind === 'date') return selection.date || null
  const months = monthsOf(selection)
  return months === null ? null : addCalendarMonths(purchaseDate, months)
}

/** 精确匹配自然月时回显月数；历史指定日期和未填写状态保持原值。 */
export function warrantySelectionFromDates(purchaseDate: string | null, expiresAt: string | null): WarrantySelection {
  if (!expiresAt) return { kind: 'none' }
  if (purchaseDate && parseDateToDayNumber(purchaseDate) !== null && parseDateToDayNumber(expiresAt) !== null) {
    const [year, month] = purchaseDate.split('-').map(Number)
    const [endYear, endMonth] = expiresAt.split('-').map(Number)
    const months = (endYear - year) * 12 + endMonth - month
    if (months >= 1 && months <= 1200 && addCalendarMonths(purchaseDate, months) === expiresAt) {
      return WARRANTY_MONTH_OPTIONS.some(option => option === months)
        ? { kind: 'months', months }
        : { kind: 'custom', months: String(months) }
    }
  }
  return { kind: 'date', date: expiresAt }
}

export function validateWarranty(purchaseDate: string, selection: WarrantySelection, today = todayString()): string | null {
  if (purchaseDate && parseDateToDayNumber(purchaseDate) === null) return '购买日期无效'
  if (purchaseDate > today) return '购买日期不能晚于今天'
  if ((selection.kind === 'months' || selection.kind === 'custom') && monthsOf(selection) === null) {
    return '保修月数请输入 1 至 1200 的整数'
  }
  const expiresAt = warrantyDate(purchaseDate, selection)
  if (selection.kind === 'date' && (!expiresAt || parseDateToDayNumber(expiresAt) === null)) return '保修到期日无效'
  if (purchaseDate && selection.kind !== 'none' && expiresAt === null) return '无法计算保修到期日'
  if (expiresAt && purchaseDate && expiresAt < purchaseDate) return '保修到期日不能早于购买日期'
  return null
}
