import { warrantyInfo, warrantyProgressOf } from '../domain/lifecycle'
import type { Item } from '../domain/types'

const SEGMENTS = 12

/**
 * 用户希望保留的点阵保修条：时间与剩余百分比在上，12 段胶囊在下。
 * 已流逝部分为暖色、剩余部分为绿色；过保后中性化，缺购买日期不虚构比例。
 * 点阵表示整个保修期的等分，边界段保留实际比例，不按月份数取整。
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
  const percent = progress.ratio === null ? null : Math.round(progress.ratio * 100)
  const elapsedPosition = progress.ratio === null ? 0 : (1 - progress.ratio) * SEGMENTS
  const tone = expired ? 'text-ink-faint' : expiring ? 'text-danger' : 'text-success'

  const label = expired
    ? '已过保'
    : info.daysLeft === 0
      ? '今天到期'
      : expiring
        ? `剩余 ${info.daysLeft} 天`
        : `剩余 ${Math.max(1, Math.round(info.daysLeft / 30.44))} 个月`

  return (
    <div
      className={`border-t border-line-inner px-3 py-2.5 ${expired ? 'bg-surface-sunken' : expiring ? 'bg-danger-soft' : 'bg-success-soft'}`}
      data-warranty-strip={info.state}
    >
      <div className={`flex items-center justify-between gap-2 ${tone}`}>
        <span className="flex min-w-0 items-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
            <path d="M12 3 5 6v5c0 4.6 3 8.4 7 10 4-1.6 7-5.4 7-10V6z" />
          </svg>
          <span className="num text-[11px] leading-none">{label}</span>
        </span>
        {percent !== null && <span className="num shrink-0 text-[10px] font-medium leading-none">{percent}%</span>}
      </div>
      {percent !== null && (
        <span
          className="mt-1.5 flex gap-[3px]"
          role="progressbar"
          aria-label="保修剩余"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${info.detail}，剩余 ${percent}%`}
        >
          {Array.from({ length: SEGMENTS }, (_, index) => {
            const remaining = Math.min(1, Math.max(0, index + 1 - elapsedPosition))
            const elapsedColor = expired ? 'bg-line-strong' : expiring ? 'bg-danger' : index < elapsedPosition / 2 ? 'bg-danger' : 'bg-warranty-elapsed'
            return (
              <span key={index} data-warranty-dot="" aria-hidden="true" className="relative h-[5px] min-w-0 flex-1 overflow-hidden rounded-pill bg-line">
                <span className={`absolute inset-y-0 left-0 rounded-pill ${elapsedColor}`} style={{ width: `${(1 - remaining) * 100}%` }} />
                <span data-warranty-remaining="" className="absolute inset-y-0 right-0 rounded-pill bg-success" style={{ width: `${remaining * 100}%`, opacity: Math.max(0.38, 1 - Math.max(0, index - Math.floor(elapsedPosition)) / SEGMENTS * 0.65) }} />
              </span>
            )
          })}
        </span>
      )}
    </div>
  )
}
