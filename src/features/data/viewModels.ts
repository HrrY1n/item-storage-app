import type { Category, Item, ItemStatus, ItemTag, Tag } from '../../domain/types'
import {
  calculateTotalCostCents,
  formatCentsCard,
  formatCentsCompact,
  todayString,
} from '../../domain/purchase'
import { collectSubtreeIds } from '../../domain/categoryTree'
import {
  dailyCostOf,
  effectiveCostCents,
  isDisposed,
  isOwned,
  ownershipDaysOf,
  statusOf,
} from '../../domain/lifecycle'

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

/**
 * 一条物品的成本指标（用于卡片与详情的数字层级）。
 *
 * 全部委托给 domain/lifecycle，因此卡片与详情页**用的是同一套口径**：
 * - 已处置物品的持有天数冻结在处置日
 * - 已出售物品的「总投入」是**净成本**（总投入 − 出售金额，可为负）
 */
export interface ItemMetric {
  /** 持有天数（已处置则冻结在处置日） */
  days: number | null
  /** 总投入；已出售时为净成本（总投入 − 出售金额，可为负） */
  totalCents: number | null
  /** 日均成本（可为负） */
  dailyCents: number | null
  daysText: string | null
  totalText: string | null
  dailyText: string | null
}

/**
 * 计算一条物品的成本指标。
 *
 * 心愿物品、或四项数据全空时返回 null —— 卡片据此决定是否渲染指标行，
 * 没有数据就不占位，更不会显示一排 ¥0.00。
 */
export function itemMetric(item: Item, today?: string): ItemMetric | null {
  if (!isOwned(item) && !isDisposed(item)) return null

  const hasAny =
    item.purchaseDate !== null ||
    item.purchasePriceCents !== null ||
    item.additionalCostCents !== null
  if (!hasAny) return null

  const totalCents = effectiveCostCents(item)
  const days = ownershipDaysOf(item, today)
  const dailyCents = dailyCostOf(item, today)

  return {
    days,
    totalCents,
    dailyCents,
    daysText: days !== null ? `${days} 天` : null,
    totalText: totalCents !== null ? formatCentsCard(totalCents) : null,
    dailyText: dailyCents !== null ? formatCentsCompact(dailyCents) : null,
  }
}

/** 毛投入（购买价格 + 附加花费），不受出售回收影响 —— 明细表用这个 */
export function grossCostCents(item: Item): number | null {
  return calculateTotalCostCents(item.purchasePriceCents, item.additionalCostCents)
}

/** 物品库概览：全部由真实数据推导，无数据时对应字段为 null（UI 不渲染该块） */
export interface LibraryOverview {
  itemCount: number
  categoryCount: number
  tagCount: number
  /** 已记录价格的持有中物品数 */
  pricedCount: number
  /** 总投入（仅统计有价格/附加花费的持有中物品） */
  totalCents: number | null
  /** 日均总价（仅统计能算出日均成本的持有中物品之和） */
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
    if (!isOwned(item)) continue
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
    totalText: pricedCount > 0 ? formatCentsCard(totalCents) : null,
    dailyText: pricedCount > 0 ? formatCentsCompact(dailySum) : null,
  }
}

// ---------------------------------------------------------------- 列表筛选与排序

export type ItemSortKey = 'recent' | 'name' | 'cost' | 'daily'

export interface ListQuery {
  /** 生命周期筛选 */
  status: ItemStatus
  /** 关键词（名称 / 分类 / 标签，大小写无关） */
  query?: string
  /** 分类 id；含其子分类 */
  categoryId?: string | null
  sort?: ItemSortKey
  today?: string
}

/**
 * 物品列表的筛选 + 排序（纯函数）。
 *
 * 抽出来而不是留在组件里，是为了让"状态筛选 / 搜索 / 排序"这三件最容易被改坏的行为
 * 有直接的回归保护。
 */
export function filterAndSortItems(
  items: Item[],
  categories: Category[],
  links: ItemTag[],
  tags: Tag[],
  q: ListQuery,
): Item[] {
  const today = q.today ?? todayString()
  const keyword = (q.query ?? '').trim().toLowerCase()
  const catIds = q.categoryId ? collectSubtreeIds(categories, q.categoryId) : null

  const filtered = items.filter((i) => {
    if (statusOf(i) !== q.status) return false
    if (catIds && !catIds.has(i.categoryId)) return false
    if (keyword === '') return true
    const tagText = tagNamesOf(i.id, links, tags).join(' ').toLowerCase()
    return (
      i.name.toLowerCase().includes(keyword) ||
      categoryNameOf(categories, i.categoryId).toLowerCase().includes(keyword) ||
      tagText.includes(keyword)
    )
  })

  const sort = q.sort ?? 'recent'
  const cmp: Record<ItemSortKey, (a: Item, b: Item) => number> = {
    recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
    name: (a, b) => a.name.localeCompare(b.name, 'zh-CN'),
    cost: (a, b) => (effectiveCostCents(b) ?? -Infinity) - (effectiveCostCents(a) ?? -Infinity),
    daily: (a, b) => (dailyCostOf(b, today) ?? -Infinity) - (dailyCostOf(a, today) ?? -Infinity),
  }
  return [...filtered].sort(cmp[sort])
}
