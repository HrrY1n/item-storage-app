import type { PurchasePlatform } from './types'

/**
 * 购买信息与日均使用成本（domain 纯函数，全部有测试）。
 *
 * 关键约定：日期按**日历日**计算，不做毫秒差。
 * 把 YYYY-MM-DD 转成「UTC 日序号」再相减，避免本地时区 / UTC 造成差一天。
 */

// ---------------------------------------------------------------- 日期基础

/** 把 YYYY-MM-DD 解析为 UTC 日序号（1970-01-01 = 0）；非法格式/非法日期返回 null */
export function parseDateToDayNumber(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const ms = Date.UTC(y, mo - 1, d)
  // Date.UTC 会静默归一化（如 2 月 31 日 → 3 月），回读校验确保是真实日历日
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null
  }
  return Math.floor(ms / 86_400_000)
}

/** 本地当前日期 → YYYY-MM-DD（用本地年月日拼，不用 toISOString，避免时区偏移） */
export function todayString(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** dayNumber → YYYY-MM-DD */
export function dayNumberToString(dayNumber: number): string {
  const d = new Date(dayNumber * 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

// ---------------------------------------------------------------- 持有天数 & 日均成本

/**
 * 持有天数：从购买日期到今天的自然日数，含购买当天（今天买 = 1 天）。
 * 未来日期 / 非法日期 → null（历史脏数据不崩溃，由 UI 静默处理）。
 */
export function calculateOwnershipDays(
  purchaseDate: string,
  today: string = todayString(),
): number | null {
  const purchase = parseDateToDayNumber(purchaseDate)
  const now = parseDateToDayNumber(today)
  if (purchase === null || now === null) return null
  const days = now - purchase + 1
  return days >= 1 ? days : null
}

/**
 * 日均使用成本（单位：分，可为小数，展示时再格式化）。
 * purchaseDate 或 purchasePriceCents 为 null → null。
 * 价格为 0（赠品）→ 0。
 */
export function calculateDailyCostCents(
  purchasePriceCents: number | null,
  purchaseDate: string | null,
  today: string = todayString(),
): number | null {
  if (purchaseDate === null || purchasePriceCents === null) return null
  if (!Number.isFinite(purchasePriceCents) || purchasePriceCents < 0) return null
  const days = calculateOwnershipDays(purchaseDate, today)
  if (days === null) return null
  return purchasePriceCents / days
}

// ---------------------------------------------------------------- 展示格式化

/** 分 → ¥1,499.00 */
export function formatCents(cents: number): string {
  const yuan = cents / 100
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** YYYY-MM-DD → 2026年1月1日 */
export function formatPurchaseDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return dateStr
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`
}

/** 用户输入价格 → 整数分；空串 / 非法 / 负数 / 超过两位小数 → null */
export function parsePriceInput(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const cents = Math.round(Number(t) * 100)
  if (!Number.isFinite(cents) || cents < 0) return null
  return cents
}

/** 整数分 → 输入框回填文本（149900 → "1499"，149990 → "1499.9"，149999 → "1499.99"） */
export function centsToPriceInput(cents: number): string {
  return String(cents / 100)
}

// ---------------------------------------------------------------- 平台

export const PURCHASE_PLATFORM_LABELS: Record<PurchasePlatform, string> = {
  jd: '京东',
  taobao: '淘宝',
  pinduoduo: '拼多多',
  zhuanzhuan: '转转',
  aihuishou: '爱回收',
  other: '其他',
}

export const PURCHASE_PLATFORMS = Object.keys(PURCHASE_PLATFORM_LABELS) as PurchasePlatform[]

export function platformLabel(platform: PurchasePlatform | null): string {
  return platform ? PURCHASE_PLATFORM_LABELS[platform] : ''
}
