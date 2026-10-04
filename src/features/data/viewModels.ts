import type { Category, Item, ItemTag, Tag } from '../../domain/types'
import {
  calculateDailyCostCents,
  calculateOwnershipDays,
  calculateTotalCostCents,
  formatCentsCompact,
} from '../../domain/purchase'

/**
 * 视图模型辅助：把多张表 join 成页面需要的形状。
 * 纯函数，方便测试与复用。
 */

export function categoryNameOf(categories: Category[], id: string): string {
  return categories.find((c) => c.id === id)?.name ?? '未分类'
}

export function tagNamesOf(itemId: string, links: ItemTag[], tags: Tag[]): string[] {
  const byId = new Map(tags.map((t) => [t.id, t.name]))
  return links
    .filter((l) => l.itemId === itemId)
    .map((l) => byId.get(l.tagId))
    .filter((n): n is string => typeof n === 'string')
}

/** 每个分类（含后代）下的活跃物品数量：沿物品的祖先链向上累计，O(items × 树深) */
export function computeCategoryCounts(items: Item[], categories: Category[]): Map<string, number> {
  const counts = new Map<string, number>(categories.map((c) => [c.id, 0]))
  const byId = new Map(categories.map((c) => [c.id, c]))
  for (const item of items) {
    let cursor = byId.get(item.categoryId)
    const guard = categories.length + 1
    for (let i = 0; i < guard && cursor; i++) {
      counts.set(cursor.id, (counts.get(cursor.id) ?? 0) + 1)
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
  }
  return counts
}

/** 常用标签：按关联活跃物品数排序 */
export function frequentTags(items: Item[], links: ItemTag[], tags: Tag[], n: number): Tag[] {
  const activeIds = new Set(items.map((i) => i.id))
  const counts = new Map<string, number>()
  for (const l of links) {
    if (activeIds.has(l.itemId)) counts.set(l.tagId, (counts.get(l.tagId) ?? 0) + 1)
  }
  return [...tags]
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
    .slice(0, n)
}

/** 某标签下的活跃物品 */
export function itemsWithTag(items: Item[], links: ItemTag[], tagId: string): Item[] {
  const ids = new Set(links.filter((l) => l.tagId === tagId).map((l) => l.itemId))
  return items.filter((i) => ids.has(i.id))
}

// ---------------------------------------------------------------- 指标

/** 一条物品的成本指标（用于卡片与详情的数字层级） */
export interface ItemMetric {
  /** 持有天数（无购买日期时为 null） */
  days: number | null
  /** 总投入（购买价格 + 附加花费），无数据时为 null */
  totalCents: number | null
  /** 日均使用成本 */
  dailyCents: number | null
  /** 紧凑展示文本，交由 UI 直接渲染 */
  daysText: string | null
  totalText: string | null
  dailyText: string | null
}

/**
 * 计算一条物品的成本指标；四个购买字段全空时返回 null
 * （卡片据此决定是否渲染指标行 —— 没有数据就不占位，避免出现一排 ¥0.00）。
 */
export function itemMetric(item: Item, today?: string): ItemMetric | null {
  const hasAny =
    item.purchaseDate !== null ||
    item.purchasePriceCents !== null ||
    item.additionalCostCents !== null
  if (!hasAny) return null

  const totalCents = calculateTotalCostCents(item.purchasePriceCents, item.additionalCostCents)
  const days = item.purchaseDate ? calculateOwnershipDays(item.purchaseDate, today) : null
  const dailyCents = calculateDailyCostCents(totalCents, item.purchaseDate, today)

  return {
    days,
    totalCents,
    dailyCents,
    daysText: days !== null ? `${days} 天` : null,
    totalText: totalCents !== null ? formatCentsCompact(totalCents) : null,
    dailyText: dailyCents !== null ? formatCentsCompact(dailyCents) : null,
  }
}

/** 物品库概览：全部由真实数据推导，无数据时对应字段为 null（UI 不渲染该块） */
export interface LibraryOverview {
  itemCount: number
  categoryCount: number
  tagCount: number
  /** 已记录价格的物品数 */
  pricedCount: number
  /** 总投入（仅统计有价格/附加花费的物品） */
  totalCents: number | null
  /** 日均总价（仅统计能算出日均成本的物品之和） */
  dailyCents: number | null
  totalText: string | null
  dailyText: string | null
}

export function libraryOverview(
  items: Item[],
  categories: Category[],
  tags: Tag[],
  today?: string,
): LibraryOverview {
  let totalCents = 0
  let dailySum = 0
  let pricedCount = 0

  for (const item of items) {
    const m = itemMetric(item, today)
    if (!m || m.totalCents === null) continue
    pricedCount++
    totalCents += m.totalCents
    if (m.dailyCents !== null) dailySum += m.dailyCents
  }

  return {
    itemCount: items.length,
    categoryCount: categories.length,
    tagCount: tags.length,
    pricedCount,
    totalCents: pricedCount > 0 ? totalCents : null,
    dailyCents: pricedCount > 0 ? dailySum : null,
    totalText: pricedCount > 0 ? formatCentsCompact(totalCents) : null,
    dailyText: pricedCount > 0 ? formatCentsCompact(dailySum) : null,
  }
}
