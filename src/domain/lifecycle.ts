import type { Category, DisposalMethod, Item, ItemStatus } from './types'
import {
  calculateTotalCostCents,
  parseDateToDayNumber,
  todayString,
} from './purchase'

/**
 * 生命周期与真实持有成本（domain 纯函数，全部有测试）。
 *
 * 三条不可动摇的规则：
 *
 * 1. **持有天数会冻结**
 *    持有中 = 今天 - 购买日期 + 1；已处置 = 处置日期 - 购买日期 + 1。
 *    一年后再看同一件已出售的物品，天数不能继续增长。
 *
 * 2. **出售要抵扣，且允许负数**
 *    实际持有成本 = 总投入 - 出售金额。
 *    卖得比买的多 → 负成本，代表实际收益。**绝不**做 Math.max(0) 截断。
 *
 * 3. **缺失字段优雅降级**
 *    任何一个环节数据不足都返回 null，由 UI 静默隐藏该指标，
 *    绝不显示 ¥0.00 这类误导性结果，也绝不让页面崩溃。
 */

/** 保修到期前的提醒窗口（天） */
export const WARRANTY_WARN_DAYS = 30

// ---------------------------------------------------------------- 读取器

/**
 * 读取 status，兼容未迁移的历史数据。
 * 任何未知值（脏数据 / 旧备份）一律按 'owned' 处理 —— 这是最安全的默认值。
 */
export function statusOf(item: Item): ItemStatus {
  return item.status === 'wishlist' || item.status === 'disposed' ? item.status : 'owned'
}

export function isOwned(item: Item): boolean {
  return statusOf(item) === 'owned'
}

export function isWishlist(item: Item): boolean {
  return statusOf(item) === 'wishlist'
}

export function isDisposed(item: Item): boolean {
  return statusOf(item) === 'disposed'
}

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  wishlist: '心愿',
  owned: '持有',
  disposed: '处置',
}

export const DISPOSAL_METHOD_LABELS: Record<DisposalMethod, string> = {
  sold: '出售',
  discarded: '丢弃',
  other: '其他',
}

export const ITEM_STATUSES: ItemStatus[] = ['owned', 'wishlist', 'disposed']

// ---------------------------------------------------------------- 持有天数

/**
 * 持有天数。
 * - 已处置：以 `disposedAt` 为终点**冻结**；`disposedAt` 缺失或早于购买日期 → null
 * - 持有中：算到今天
 * - 心愿：没有购买日期就必然是 null
 */
export function ownershipDaysOf(item: Item, today: string = todayString()): number | null {
  if (item.purchaseDate === null) return null
  const purchase = parseDateToDayNumber(item.purchaseDate)
  if (purchase === null) return null

  if (statusOf(item) === 'disposed') {
    if (item.disposedAt === null) return null
    const disposed = parseDateToDayNumber(item.disposedAt)
    if (disposed === null) return null
    const days = disposed - purchase + 1
    return days >= 1 ? days : null
  }

  const now = parseDateToDayNumber(today)
  if (now === null) return null
  const days = now - purchase + 1
  return days >= 1 ? days : null
}

/** 「截止到某天」的持有天数（今天 / 处置日期），供 UI 显示「截至处置日」 */
export function ownershipDaysUntil(item: Item, endDate: string): number | null {
  if (item.purchaseDate === null) return null
  const purchase = parseDateToDayNumber(item.purchaseDate)
  const end = parseDateToDayNumber(endDate)
  if (purchase === null || end === null) return null
  const days = end - purchase + 1
  return days >= 1 ? days : null
}

// ---------------------------------------------------------------- 成本

/**
 * 实际持有成本（单位：分，**可为负**）。
 *
 * - 心愿 / 未记录价格 → null（不制造 ¥0.00）
 * - 持有中 → 总投入
 * - 已出售（disposalMethod='sold' 且填了出售金额）→ 总投入 - 出售金额
 * - 已丢弃 / 其他 → 总投入（没有回收价值）
 *
 * 出售金额为空时**不计算**净成本，退回总投入。
 */
export function effectiveCostCents(item: Item): number | null {
  const total = calculateTotalCostCents(item.purchasePriceCents, item.additionalCostCents)
  if (total === null) return null
  if (statusOf(item) !== 'disposed') return total
  if (item.disposalMethod !== 'sold') return total
  if (item.salePriceCents === null) return total
  if (!Number.isFinite(item.salePriceCents) || item.salePriceCents < 0) return total
  // 刻意不夹逼到 0：卖得比买得多 = 实际收益
  return total - item.salePriceCents
}

/** 实际日均成本（分/天，可为负） */
export function dailyCostOf(item: Item, today: string = todayString()): number | null {
  const cost = effectiveCostCents(item)
  if (cost === null) return null
  const days = ownershipDaysOf(item, today)
  if (days === null) return null
  return cost / days
}

// ---------------------------------------------------------------- 保修

export type WarrantyState = 'active' | 'expiring' | 'expired'

export interface WarrantyInfo {
  expiresAt: string
  state: WarrantyState
  /** 剩余天数；已过期为负数（-32 = 已过保 32 天） */
  daysLeft: number
  /** 状态标签：保修中 / 即将到期 / 已过保 */
  label: string
  /** 补充说明：还有 23 天到期 / 保修剩余 7 个月 / 已过保 32 天 */
  detail: string
}

/**
 * 保修状态。`warrantyExpiresAt` 为空或非法 → null（整个保修模块不显示）。
 * 30 天以内到期视为「即将到期」。
 */
export function warrantyInfo(
  expiresAt: string | null,
  today: string = todayString(),
  warnDays: number = WARRANTY_WARN_DAYS,
): WarrantyInfo | null {
  if (expiresAt === null) return null
  const expiry = parseDateToDayNumber(expiresAt)
  const now = parseDateToDayNumber(today)
  if (expiry === null || now === null) return null

  const daysLeft = expiry - now
  const state: WarrantyState = daysLeft < 0 ? 'expired' : daysLeft <= warnDays ? 'expiring' : 'active'

  let detail: string
  if (state === 'expired') {
    detail = `已过保 ${-daysLeft} 天`
  } else if (state === 'expiring') {
    detail = daysLeft === 0 ? '今天到期' : `还有 ${daysLeft} 天到期`
  } else {
    const months = Math.max(1, Math.round(daysLeft / 30.44))
    detail = `保修剩余 ${months} 个月`
  }

  return {
    expiresAt,
    state,
    daysLeft,
    label: state === 'expired' ? '已过保' : state === 'expiring' ? '即将到期' : '保修中',
    detail,
  }
}

export function warrantyOf(item: Item, today: string = todayString()): WarrantyInfo | null {
  return warrantyInfo(item.warrantyExpiresAt, today)
}

// ---------------------------------------------------------------- 不变量

export interface LifecycleInput {
  status: ItemStatus
  disposedAt: string | null
  disposalMethod: DisposalMethod | null
  salePriceCents: number | null
  disposalNote: string | null
}

export interface ValidationResult {
  ok: boolean
  error?: string
}

/**
 * 处置业务校验。
 * - 处置日期不能早于购买日期
 * - 出售金额必须 ≥ 0（允许 0）
 * - 只有「出售」才允许有出售金额
 */
export function validateDisposal(input: {
  disposedAt: string | null
  purchaseDate: string | null
  disposalMethod: DisposalMethod | null
  salePriceCents: number | null
}): ValidationResult {
  const { disposedAt, purchaseDate, disposalMethod, salePriceCents } = input

  if (disposalMethod === null) return { ok: false, error: '请选择处置方式' }
  if (disposedAt === null) return { ok: false, error: '请填写处置日期' }
  if (parseDateToDayNumber(disposedAt) === null) return { ok: false, error: '处置日期格式无效' }
  if (purchaseDate !== null && parseDateToDayNumber(purchaseDate) !== null) {
    const d = parseDateToDayNumber(disposedAt)!
    const p = parseDateToDayNumber(purchaseDate)!
    if (d < p) return { ok: false, error: '处置日期不能早于购买日期' }
  }
  if (salePriceCents !== null) {
    if (!Number.isFinite(salePriceCents) || salePriceCents < 0) {
      return { ok: false, error: '出售金额不能为负数' }
    }
    if (disposalMethod !== 'sold') {
      return { ok: false, error: '只有「出售」方式才能填写出售金额' }
    }
  }
  return { ok: true }
}

/**
 * 生命周期字段的**规范化**（写入前统一走这里）。
 *
 * 不变量由数据层强制，而不是靠每个调用点自觉：
 * - 非 disposed 状态 → 一律清空全部处置字段
 * - 非 sold 方式 → salePriceCents 清空
 * - 处置日期非法 → 置 null（不写入脏日期）
 * - 出售金额为负 → 置 null
 *
 * 这样 repository / 备份导入 / 恢复为持有 三条路径共享同一套规则。
 */
export function sanitizeLifecycle(input: LifecycleInput): LifecycleInput {
  const base: LifecycleInput = {
    status: input.status,
    disposedAt: null,
    disposalMethod: null,
    salePriceCents: null,
    disposalNote: null,
  }
  if (input.status !== 'disposed') return base

  const disposalMethod = input.disposalMethod
  const disposedAt =
    input.disposedAt !== null && parseDateToDayNumber(input.disposedAt) !== null
      ? input.disposedAt
      : null
  const salePriceCents =
    disposalMethod === 'sold' &&
    input.salePriceCents !== null &&
    Number.isFinite(input.salePriceCents) &&
    input.salePriceCents >= 0
      ? input.salePriceCents
      : null
  const disposalNote =
    input.disposalNote !== null && input.disposalNote.trim() !== ''
      ? input.disposalNote.trim()
      : null

  return { status: 'disposed', disposedAt, disposalMethod, salePriceCents, disposalNote }
}

/** 恢复为持有：清空全部处置字段，但**绝不删除**购买数据 */
export function restoreToOwnedFields(): LifecycleInput {
  return {
    status: 'owned',
    disposedAt: null,
    disposalMethod: null,
    salePriceCents: null,
    disposalNote: null,
  }
}

// ---------------------------------------------------------------- Dashboard 聚合

export interface DashboardStats {
  ownedCount: number
  wishlistCount: number
  disposedCount: number
  categoryCount: number
  /** 持有中总投入（分）；无任何价格数据时为 null */
  totalInvestmentCents: number | null
  /** 持有中"日均总成本"（分/天）= 各件日均之和；null = 无有效数据 */
  dailyTotalCents: number | null
  /** 有价格数据的持有物品数 */
  pricedOwnedCount: number
  totalInvestmentText: string | null
  dailyTotalText: string | null
  /** 处置回收：已出售物品的出售金额合计（分）；无出售记录为 null */
  saleProceedsCents: number | null
  saleCount: number
}

export function dashboardStats(
  items: Item[],
  categories: Category[],
  today: string = todayString(),
): DashboardStats {
  let owned = 0
  let wishlist = 0
  let disposed = 0
  let totalInvestment = 0
  let dailyTotal = 0
  let pricedOwned = 0
  let saleProceeds = 0
  let saleCount = 0

  for (const item of items) {
    const status = statusOf(item)
    if (status === 'wishlist') {
      wishlist++
      continue
    }
    if (status === 'disposed') {
      disposed++
      if (item.disposalMethod === 'sold' && item.salePriceCents !== null) {
        saleProceeds += item.salePriceCents
        saleCount++
      }
      continue
    }

    owned++
    const cost = effectiveCostCents(item)
    if (cost !== null) {
      totalInvestment += cost
      pricedOwned++
    }
    const daily = dailyCostOf(item, today)
    if (daily !== null) dailyTotal += daily
  }

  return {
    ownedCount: owned,
    wishlistCount: wishlist,
    disposedCount: disposed,
    categoryCount: categories.length,
    totalInvestmentCents: pricedOwned > 0 ? totalInvestment : null,
    dailyTotalCents: pricedOwned > 0 ? dailyTotal : null,
    pricedOwnedCount: pricedOwned,
    totalInvestmentText: null,
    dailyTotalText: null,
    saleProceedsCents: saleCount > 0 ? saleProceeds : null,
    saleCount,
  }
}

export interface ExpiringWarranty {
  item: Item
  info: WarrantyInfo
}

/**
 * 保修到期提醒：**只统计持有中**的物品（心愿与已处置不参与）。
 * 按剩余天数升序 —— 最紧急的排最前。
 */
export function expiringWarranties(
  items: Item[],
  today: string = todayString(),
  warnDays: number = WARRANTY_WARN_DAYS,
): ExpiringWarranty[] {
  const out: ExpiringWarranty[] = []
  for (const item of items) {
    if (!isOwned(item)) continue
    const info = warrantyInfo(item.warrantyExpiresAt, today, warnDays)
    if (info === null) continue
    if (info.state === 'active') continue
    out.push({ item, info })
  }
  return out.sort((a, b) => a.info.daysLeft - b.info.daysLeft)
}

export interface CategorySlice {
  categoryId: string
  name: string
  count: number
  /** 0–1 的占比，用于 CSS bar 宽度 */
  ratio: number
}

/**
 * 分类分布（仅持有中物品）。用原生 CSS bar 渲染，不引入任何图表库。
 * 计数为 0 的分类不出现。
 */
export function categoryDistribution(
  items: Item[],
  categories: Category[],
): CategorySlice[] {
  const counts = new Map<string, number>()
  let total = 0
  for (const item of items) {
    if (!isOwned(item)) continue
    counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1)
    total++
  }
  if (total === 0) return []

  return categories
    .filter((c) => (counts.get(c.id) ?? 0) > 0)
    .map((c) => {
      const count = counts.get(c.id) ?? 0
      return { categoryId: c.id, name: c.name, count, ratio: count / total }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
