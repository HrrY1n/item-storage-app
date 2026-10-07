import { ITEM_STATUS_LABELS, warrantyInfo } from '../domain/lifecycle'
import type { Item, ItemStatus } from '../domain/types'
import {
  DISPOSITION_BADGE_LABELS,
  type DispositionKind,
  type FinanceTone,
} from '../features/data/itemPresentation'

/**
 * 状态徽标：持有 / 心愿 / 处置。
 *
 * 颜色纪律：**默认状态（持有）不染色** —— 绝大多数物品都是持有中，
 * 给它们上色等于满屏噪音。只有"例外状态"才需要被一眼看见：
 * - 心愿：还没到手 → 用品牌强调色（它是一种"想要"的信号）
 * - 处置：已成历史 → 中性灰，安静地退到背景里
 */
export function StatusChip({ status, size = 'md' }: { status: ItemStatus; size?: 'sm' | 'md' }) {
  const tone =
    status === 'wishlist'
      ? 'bg-accent-soft text-accent'
      : status === 'disposed'
        ? 'bg-surface-sunken text-ink-tertiary'
        : 'bg-success-soft text-success'
  const base =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded-pill px-2 py-[3px] text-[10px] leading-none'
      : 'inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-caption leading-none'
  return <span className={`${base} ${tone}`}>{ITEM_STATUS_LABELS[status]}</span>
}

/**
 * 处置方式徽标（已处置物品用）。
 *
 * Phase 2H.2 复活并扩展：此前已定义但全仓零使用（死代码），
 * 而处置体验重设计需要的正是它—— 不新造重复组件。
 *
 * ## 颜色纪律（设计 §9 / §12）
 *
 * 处置是**正常生命周期的结果**，不是错误 —— 因此**全���禁用 danger / danger-soft**。
 * 卖出回收了钱（success 语义）、随手丢弃（中性）、其他原因（冷调中性）
 * 三者靠**低饱和语义底色**区分，而不是靠鲜艳程度。
 * 明暗两套都在 `index.css` 里有对应 token，未新增任何颜色。
 */
const DISPOSITION_TONES: Record<DispositionKind, string> = {
  sold: 'bg-success-soft text-success',
  discarded: 'bg-surface-sunken text-ink-secondary',
  other: 'bg-info-soft text-info',
  // 兜底：数据库里真实存在的「有处置状态但没记录方式」。
  // 用比 discarded 更弱一档的墨色，视觉上不与「已丢弃」争。
  unspecified: 'bg-surface-sunken text-ink-tertiary',
}

const CHIP_BASE = {
  sm: 'inline-flex items-center rounded-pill px-2 py-[3px] text-[10px] leading-none',
  md: 'inline-flex items-center rounded-pill px-2.5 py-1 text-caption leading-none',
} as const

export function DisposalChip({
  method,
  size = 'md',
}: {
  method: DispositionKind
  size?: 'sm' | 'md'
}) {
  return (
    <span className={`${CHIP_BASE[size]} ${DISPOSITION_TONES[method]}`}>
      {DISPOSITION_BADGE_LABELS[method]}
    </span>
  )
}

/**
 * 图片区「处置结果」overlay —— **只有出售有**（设计 §7.1）。
 *
 * 为什么只有出售：出售有一个明确的**结果**（回收了钱）值得视觉锚点；
 * 丢弃 / 其他没有这种结果，叠字只是噪音。
 *
 * ⚠️ 高度 ≤ 图片区 22%，不遮挡物品本体；物品图标保持opacity 1，
 * 绝不降透明度 / 灰化 / 加红叉（设计 §16）。
 *
 * ## ⚠️ 为什么用 `bg-ink-solid` 而不是设计稿写的 `bg-ink-primary/72`
 *
 * 本项目颜色 token 一律是 `var(--color-*)`，而 **Tailwind 的 opacity 修饰符
 * 对 `var()` 颜色不生成 CSS** —— `bg-ink-primary/72` 在构建产物里**根本没有
 * 对应规则**，实测 computed `background-color` 是 `rgba(0, 0, 0, 0)`（全透明）。
 * 那会让 overlay 退化成"白字直接压在图标上"，遇到浅色 plate 时**白字白底
 * 完全不可读**。视觉验证正是在这里抓到这个缺陷 —— 也就是设计 §20 预留的未决点。
 *
 * 改用**已存在且确实会生成 CSS** 的 `bg-ink-solid`（实心，无透明度）：
 * - light：`#171717` 底 + `#ffffff` 字 → **17.93:1**
 * - dark ：`#f4f4f2` 底 + `#0e0e10` 字 → **17.51:1**
 * 两者都是"底与字互为反色"，跨主题自动成立，远超 WCAG AA 4.5:1。
 * 实心胶囊只有 40×18px，丢失透明度在视觉上可忽略。
 * `backdrop-blur-sm` 一并去掉 —— 没有透明度时它没有意义，只白烧 GPU。
 */
export function DisposalOverlay({ text }: { text: string }) {
  return (
    <span
      className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
      aria-hidden="false"
    >
      <span className="rounded-pill bg-ink-solid px-2 py-[3px] text-caption leading-none text-ink-inverse">
        {text}
      </span>
    </span>
  )
}

/**
 * 财务行的语义色调 → class。
 *
 * 盈利 = success；亏损 = **money（暖色）而非 danger**——
 * 亏损是交易结果，不是故障，用红色会让"卖亏了"读起来像"数据出错"。
 */
export const FINANCE_TONES: Record<FinanceTone, string> = {
  positive: 'text-success',
  negative: 'text-money',
  neutral: 'text-ink-tertiary',
}

/**
 * 保修徽标：保修中 / 即将到期 / 已过保。
 *
 * 颜色即语义：
 * - 保修中 → 绿（正向状态，还需要留意但不必焦虑）
 * - 即将到期 → 红（需要行动，30 天窗口）
 * - 已过保 → 中性灰（已经没有可行动性，不该继续报警）
 * 没填保修日期时返回 null —— 整个模块不显示，而不是显示一个"无保修"的假徽标。
 */
export function WarrantyChip({
  item,
  today,
  withDetail = false,
  size = 'md',
}: {
  item: Item
  today?: string
  withDetail?: boolean
  size?: 'sm' | 'md'
}) {
  const info = warrantyInfo(item.warrantyExpiresAt, today)
  if (info === null) return null
  const tone =
    info.state === 'expired'
      ? 'bg-surface-sunken text-ink-tertiary'
      : info.state === 'expiring'
        ? 'bg-danger-soft text-danger'
        : 'bg-success-soft text-success'
  const base =
    size === 'sm'
      ? 'inline-flex items-center rounded-pill px-2 py-[3px] text-[10px] leading-none'
      : 'inline-flex items-center rounded-pill px-2.5 py-1 text-caption leading-none'
  return (
    <span className={`${base} ${tone}`}>
      {withDetail ? `${info.label} · ${info.detail}` : info.label}
    </span>
  )
}
