import { warrantyInfo, warrantyProgressOf } from '../domain/lifecycle'
import type { Item } from '../domain/types'

const SEGMENTS = 12

/**
 * WarrantyStrip：保修期进度条（Phase 2H）。
 *
 * 学习 MarkItem 的"把时间距离图形化"，但配色遵循本项目语义：
 * - 已流逝部分 → expiring 时 danger 调、正常时 money 调（时间在燃烧，不是错误）
 * - 剩余部分 → success
 * - 已过保 → 全部中性灰（没有可行动性，不该继续报警）
 *
 * 纯 CSS 分段，不引入图表库；只有真正有 warrantyExpiresAt 的物品才渲染。
 * 进度无法计算（缺购买日期）时优雅降级为纯文字，绝不显示假数据。
 */
export default function WarrantyStrip({
  item,
  today,
}: {
  item: Item
  today: string
}) {
  const info = warrantyInfo(item.warrantyExpiresAt, today)
  if (info === null) return null

  const progress = warrantyProgressOf(item, today)
  const expired = info.state === 'expired'
  const expiring = info.state === 'expiring'

  // 每段的颜色：先算已流逝段数
  const elapsedSegments =
    progress.ratio !== null ? Math.round(SEGMENTS * (1 - progress.ratio)) : 0

  const elapsedClass = expired
    ? 'bg-line-strong'
    : expiring
      ? 'bg-danger'
      : 'bg-money'
  const remainClass = expired ? 'bg-line-strong' : 'bg-success'

  // 卡片宽度有限：标签压到最短（MarkItem 式"7月"），完整描述由 chip / 详情页承担
  const label = expired
    ? '已过保'
    : expiring
      ? `${info.daysLeft}天`
      : `${Math.max(1, Math.round(info.daysLeft / 30.44))}月`

  return (
    <div
      className="flex items-center gap-2.5 border-t border-line-inner bg-surface-sunken px-3 py-2"
      data-warranty-strip={info.state}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={expired ? 'shrink-0 text-ink-faint' : expiring ? 'shrink-0 text-danger' : 'shrink-0 text-success'}
      >
        <path d="M12 3 5 6v5c0 4.6 3 8.4 7 10 4-1.6 7-5.4 7-10V6z" />
      </svg>
      <span
        className={`num shrink-0 text-[10px] leading-none ${
          expired ? 'text-ink-faint' : expiring ? 'text-danger' : 'text-success'
        }`}
      >
        {label}
      </span>
      {progress.ratio !== null && !expired && (
        <span
          className="flex min-w-0 flex-1 gap-[2px]"
          role="img"
          aria-label={`保修剩余 ${Math.round(progress.ratio * 100)}%`}
        >
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={`h-[5px] flex-1 rounded-pill ${
                i < elapsedSegments ? elapsedClass : remainClass
              }`}
            />
          ))}
        </span>
      )}
      {progress.ratio !== null && !expired && (
        <span className="num shrink-0 text-[10px] leading-none text-ink-tertiary">
          {Math.round(progress.ratio * 100)}%
        </span>
      )}
    </div>
  )
}
