import { dailyCostOf, isDisposed, ownershipDaysOf, statusOf } from '../../domain/lifecycle'
import {
  calculateTotalCostCents,
  formatCentsCard,
  formatCentsCompact,
  formatPurchaseDate,
} from '../../domain/purchase'
import type { Item } from '../../domain/types'

/**
 * 物品卡片的**唯一展示模型**（Phase 2H.2 处置体验重设计）。
 *
 * ## 为什么需要这个模块
 *
 * 此前存在**两套卡片实现**，各自硬编码指标标签：
 * - `components/ItemCard.tsx`（HomePage / CategoryDetailPage 用）→ 恒为「总投入」
 * - `pages/ItemsListPage.tsx` 的本地 `GridCard`（处置列表用）→「实际成本」
 *
 * 结果：同一件已售出物品，在概览页显示「总投入 ¥1,474」、
 * 在处置页显示「实际成本 ¥568」—— 同一笔账两种说法。
 *
 * 本模块把"某个 Item 该显示什么"变成**纯函数**，
 * Grid / List / 概览 / 分类页全部消费同一个结果，
 * 从此不可能再分叉。**任何组件都不得再写 `sold ? 'xxx' : 'xxx'`。**
 *
 * 设计依据：`docs/DISPOSED_ITEM_UX_REDESIGN.md` §23 FINAL DESIGN CONTRACT。
 * 纯逻辑、无平台 API、全部可测。
 */

/**
 * 处置方式在**展示层**的四种取值。
 *
 *前三项与 domain 的 `DisposalMethod` 一一对应。
 * 第四项 `unspecified` 是**真实可能存在**的兜底，不是防御性想象：
 * - 备份导入的校验（`domain/backup.ts:242`）对 `disposalMethod === null`
 *   **无条件放行**，不要求 status 必须是 owned/wishlist
 * - 同步载荷解码（`domain/syncPayload.ts:184`）同样接受 null
 *
 * 因此 `status='disposed'` 且 `disposalMethod === null` 会真实落进数据库。
 * 按设计 §2：它显示中性的「已处置」，**不伪装成 other**，
 * 也不计入已售出 / 已丢弃 / 其他处置任何一类的数量。
 */
export type DispositionKind = 'sold' | 'discarded' | 'other' | 'unspecified'

/** 徽标文案。`unspecified` 是中性兜底，不暗示任何处置方式。 */
export const DISPOSITION_BADGE_LABELS: Record<DispositionKind, string> = {
  sold: '已售出',
  discarded: '已丢弃',
  other: '其他处置',
  unspecified: '已处置',
}

/** 图片区结果overlay 的文案 —— **只有出售有**（设计 §7.1） */
export const DISPOSITION_OVERLAY_LABELS = {
  sold: '售出',
} as const

/**
 * 该物品的处置方式（展示层）。
 * 非 disposed 返回 null（持有 / 心愿不参与处置表达）。
 */
export function dispositionKindOf(item: Item): DispositionKind | null {
  if (!isDisposed(item)) return null
  return item.disposalMethod ?? 'unspecified'
}

/** 一栏指标：数字在上、标签在下 */
export interface PresentationMetric {
  label: string
  value: string
  /** 用金额色（token `money`）而非正文色 */
  money?: boolean
}

/** 财务行的语义色调 —— 由组件映射到具体 class，本模块不碰 Tailwind */
export type FinanceTone = 'positive' | 'negative' | 'neutral'

export interface PresentationFinance {
  /** 恒为「盈亏」 */
  label: string
  /** 已把符号翻译成中文词：盈利 ¥200 / 亏损 ¥1,474 / 持平 */
  value: string
  tone: FinanceTone
}

export interface ItemPresentation {
  /** 处置方法徽标；持有 / 心愿为 null */
  badge: DispositionKind | null
  badgeText: string
  /** 图片结果 overlay 文案；仅 sold 非 null */
  overlay: string | null
  /** 副标题：处置态是「处置于 X」，其余是分类名 */
  subtitle: string
  /** 指标栏（已剔除 null 项，长度可能少于 3） */
  metrics: PresentationMetric[]
  /**
   * 毛投入（购买价 + 附加花费）的展示文本。
   *
   * 与 `metrics` 里的「总投入」是同一个数，但**独立暴露**：
   * sold 卡的三栏里没有「总投入」（那里是「出售回收」），
   * 财务行却需要显示它 —— 所以不能靠从 metrics 里找。
   */
  grossText: string | null
  /** 财务行；仅 sold 且可计算时非 null */
  finance: PresentationFinance | null
}

export interface PresentationContext {
  today: string
  /** 非处置态副标题用；处置态不使用 */
  categoryName: string
}

/**
 * 计算一件物品的卡片展示模型。
 *
 * ## 财务口径（全部委托给 domain，绝不重算）
 *
 * -总投入 = `calculateTotalCostCents(购买价, 附加花费)`
 * - 实际持有成本 = `effectiveCostCents`（已出售且填了金额时 = 总投入 − 出售金额，可为负）
 * - 日均成本 = `dailyCostOf`
 * - 持有天数 = `ownershipDaysOf`（已处置时冻结在 disposedAt）
 *
 * ## ⚠️ 盈亏方向（勘误 FIX-A，最容易搞反的一处）
 *
 *     netHoldingCost = grossTotal − salePrice      // 花费视角
 *     profitLoss     = salePrice − grossTotal      // 结果视角 = −netHoldingCost
 *
 * `profitLoss > 0` 才是**盈利**。禁止把 `grossTotal − salePrice > 0`
 * 显示成盈利 —— 那表示"确实花了钱"，与盈利相反。
 */
export function itemPresentation(item: Item, ctx: PresentationContext): ItemPresentation {
  const status = statusOf(item)
  const kind = dispositionKindOf(item)

  // ---- 处置态才有badge / overlay / 日期副标题 ----
  const badgeText = kind === null ? '' : DISPOSITION_BADGE_LABELS[kind]
  const overlay = kind === 'sold' ? DISPOSITION_OVERLAY_LABELS.sold : null

  const disposedAtText =
    item.disposedAt === null ? '日期未知' : formatPurchaseDate(item.disposedAt)
  const subtitle =
    status === 'disposed' ? `处置于 ${disposedAtText}` : ctx.categoryName

  // ---- 心愿物品不渲染指标（没有购买日期也必然算不出） ----
  if (status === 'wishlist') {
    return {
      badge: kind,
      badgeText,
      overlay,
      subtitle,
      metrics: [],
      grossText: null,
      finance: null,
    }
  }

  const days = ownershipDaysOf(item, ctx.today)
  const daily = dailyCostOf(item, ctx.today)
  const grossTotal = calculateTotalCostCents(item.purchasePriceCents, item.additionalCostCents)

  // 出售回收：仅sold 且确实记录了金额才存在。
  // ⚠️ 「出售但没填金额」≠「出售 0 元」—— 前者不计算盈亏（见 lifecycle.test.ts:174）。
  const saleRecovery =
    kind === 'sold' && item.salePriceCents !== null ? item.salePriceCents : null

  const metrics: PresentationMetric[] = []
  if (days !== null) metrics.push({ label: '持有天数', value: `${days} 天` })
  if (saleRecovery !== null) {
    metrics.push({ label: '出售回收', value: formatCentsCard(saleRecovery) })
  } else if (grossTotal !== null) {
    // 丢弃 / 其他 / 持有 / 心愿：投入即最终成本
    metrics.push({ label: '总投入', value: formatCentsCard(grossTotal) })
  }
  if (daily !== null) {
    metrics.push({ label: '日均成本', value: formatCentsCompact(daily), money: true })
  }

  // ---- 财务行：仅 sold ----
  let finance: PresentationFinance | null = null
  if (kind === 'sold' && grossTotal !== null && saleRecovery !== null) {
    const profitLoss = saleRecovery - grossTotal // ⚠️ FIX-A：结果视角
    if (profitLoss > 0) {
      finance = {
        label: '盈亏',
        value: `盈利 ${formatCentsCard(profitLoss)}`,
        tone: 'positive',
      }
    } else if (profitLoss < 0) {
      finance = {
        label: '盈亏',
        value: `亏损 ${formatCentsCard(-profitLoss)}`,
        tone: 'negative',
      }
    } else {
      finance = { label: '盈亏', value: '持平', tone: 'neutral' }
    }
  }

  return {
    badge: kind,
    badgeText,
    overlay,
    subtitle,
    metrics,
    grossText: grossTotal === null ? null : formatCentsCard(grossTotal),
    finance,
  }
}

/**
 * 处置筛选用的分桶计数（设计 §6）。
 *
 * `unspecified` **不计入**任何处置方式，只落在「全部」里——
 * 避免把"没记录方式"的物品错误归类为"其他处置"。
 */
export function dispositionCounts(items: readonly Item[]): Record<
  DispositionKind | 'all',
  number
> {
  const counts = { all: 0, sold: 0, discarded: 0, other: 0, unspecified: 0 }
  for (const item of items) {
    if (!isDisposed(item)) continue
    counts.all += 1
    const kind = dispositionKindOf(item)
    if (kind !== null) counts[kind] += 1
  }
  return counts
}

/**
 * 判断物品是否属于某个处置筛选。
 * `all` 匹配全部已处置；`unspecified` 只匹配没记录方式的。
 */
export function matchesDispositionFilter(
  item: Item,
  filter: DispositionKind | 'all',
): boolean {
  if (filter === 'all') return isDisposed(item)
  return dispositionKindOf(item) === filter
}

/**
 * 金额/数字的字号档位（设计 §14F7：溢出先降一档字号，仍溢出则降成 2 栏）。
 *
 * ## 为什么用"字符长度"而不是运行时测量
 *
 * CSS 无法可靠地知道文本会不会溢出（没有 ResizeObserver 就没有反馈），
 * 而 `truncate` 会把数字截成 `¥1,47…` —— 那比溢出更糟。
 * 所以这里用**确定性规则**：390px 下三栏栅格每栏约52px，
 * `text-caption`(13px) 的 tabular数字约 7.3px/字符 → 7 字符内安全；
 * 超过 7 字符就降一档到 11px（约 6.2px/字符 → 可容纳 8 字符）。
 *
 * 纯函数、可测；**任何情况下都不截断数字**。
 */
export function metricValueClass(value: string, cellCount: number): string {
  // 两栏时每栏宽裕，始终用标准字号
  if (cellCount <= 2) return 'text-caption'
  return value.length > 7 ? 'text-[11px]' : 'text-caption'
}