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
 * 图片区「已售出」贴纸 —— **只有出售有**（设计 §7.1）。
 *
 * 为什么只有出售：出售有一个明确的**结果**（回收了钱）值得视觉锚点；
 * 丢弃 / 其他没有这种结果，叠字只是噪音。
 *
 * ## 形态：斜向浅贴纸（取代旧版底部实心胶囊）
 *
 * 旧版是「图片底部居中、实心墨色、pill 形状」的胶囊，视觉上像**从图片外面
 * 凸起来的一个控件**——贴着图片下沿、与图片边缘平行，于是读成按钮或 tooltip，
 * 而不是"贴在物品上的标签"。这一版改成：
 *
 * - **斜置 `-20°`**：不与图片边缘平行 → 立刻从"控件"变成"贴纸/封条"
 * - **小圆角矩形**（`rounded-[3px]` 而非 `rounded-pill`）：比胶囊更薄更平，
 *   不像电商大促条幅
 * - **半透明深灰**（`bg-sold-label`，浅色 0.82 / 深色 0.78）：能微微透出底下图标，
 *   有"贴纸压在图上"的层次，而不是一块盖住图形的实色块
 * - **一道 1px 浅色内描边**（`border-sold-label-edge`）：给贴纸一个"纸边"，
 *   在深色主题下不至于和 plate 糊在一起
 * - **压在物品主体中部**（`top-1/2` 居中偏下）而非贴底：贴底会压住图标下缘轮廓，
 *   中部穿过反而更像"贴在物品上"
 *
 * ## 为什么不用 opacity 修饰符
 *
 * 本项目颜色 token 一律 `var(--color-*)`，而 **Tailwind 的 opacity 修饰符对
 * `var()` 颜色不生成 CSS** —— `bg-ink-solid/80` 在产物里没有对应规则，
 * 实测 computed `background-color` 是全透明。因此透明度**做进 token 里**
 * （`--color-sold-label` 本身就是 rgba），`bg-sold-label` 拿到的是真实颜色。
 *
 * ## 对比度
 *
 * 两套主题都是「深底 + 白字」这一个组合，不做明暗反转：
 * - light：`rgba(23,23,23,.82)` 底 + `#ffffff` 字 → 约 **12:1**（压在最浅的 plate 上仍 ≥ 9:1）
 * - dark ：`rgba(14,14,16,.78)` 底 + `#ffffff` 字 → 约 **11:1**
 * 刻意**不用** `bg-ink-solid`（它在深色下会翻成浅色实心块 + 深色字，
 * 那正是旧版最刺眼的地方），也不用 `text-ink-inverse`（深色下会变成深字）。
 */
export function DisposalOverlay({ text }: { text: string }) {
  return (
    <span
      className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-[42%] justify-center"
      aria-hidden="false"
    >
      <span className="-rotate-[20deg] shrink-0 rounded-[3px] border border-sold-label-edge bg-sold-label px-[9px] py-[3px] text-[11px] font-semibold leading-none tracking-[0.06em] text-white shadow-[0_1px_2px_rgba(0,0,0,0.18)]">
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
