import { ITEM_STATUS_LABELS, DISPOSAL_METHOD_LABELS, warrantyInfo } from '../domain/lifecycle'
import type { Item, ItemStatus } from '../domain/types'

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

/** 处置方式徽标（已处置物品用） */
export function DisposalChip({ method }: { method: NonNullable<Item['disposalMethod']> }) {
  return (
    <span className="inline-flex items-center rounded-pill bg-surface-sunken px-2.5 py-1 text-caption leading-none text-ink-secondary">
      {DISPOSAL_METHOD_LABELS[method]}
    </span>
  )
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
