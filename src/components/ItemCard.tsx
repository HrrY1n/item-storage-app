import { useId, useState } from 'react'
import { Link, useLocation } from 'react-router'
import TagChip from './TagChip'
import { DisposalChip, DisposalOverlay, FINANCE_TONES, StatusChip } from './StatusChip'
import WarrantyStrip from './WarrantyStrip'
import { statusOf } from '../domain/lifecycle'
import type { Item } from '../domain/types'
import {
  itemPresentation,
  metricValueClass,
  type PresentationFinance,
  type PresentationMetric,
} from '../features/data/itemPresentation'

interface Props {
  to: string
  name: string
  iconUrl: string
  categoryName: string
  /** 展示用标签名（不含 # 前缀），最多展示 2 个 */
  tagNames: string[]
  /**
   * 物品本体 —— 指标与处置语义全部由 `itemPresentation(item)` 推导。
   *
   * ⚠️ Phase 2H.2：此前本组件接收一个"已经算好"的 `metric` prop，
   * 标签**硬编码**为「持有天数 / 总投入 / 日均成本」，
   * 于是已售出物品在概览页显示「总投入」、在处置页显示「实际成本」——
   * 同一笔账两种说法。现在直接传 `item`，口径只剩一个出处。
   */
  item: Item
  /** 决定持有天数 / 日均成本是否冻结在处置日 */
  today: string
  className?: string
  /** 概览预览保留物品身份，完整指标由列表和详情承担。 */
  summary?: boolean
}

/**
 * ObjectPlate：物品陈列版面。
 *
 * 物品永远是整个界面里最抢眼的东西 —— UI 退后：
 * 底衬（plate）由主题决定明度与打光，图标本身是透明底的展示资产，
 * 因此同一套资源在浅色与深色下都成立。
 *
 * bare = true 时不铺底衬（用于详情页 Hero：物品直接落在 Hero 的打光盘面上，
 * 避免"底衬套底衬"的双层边框）。
 */
export function ObjectPlate({
  src,
  alt,
  className = '',
  plateStyle,
  bare = false,
}: {
  src: string
  alt: string
  className?: string
  /** 供 View Transitions 设置 view-transition-name（仅过渡期间存在） */
  plateStyle?: React.CSSProperties
  bare?: boolean
}) {
  return (
    <div
      className={`overflow-hidden ${bare ? '' : 'plate-surface'} ${className}`}
      style={plateStyle}
      data-object-plate=""
    >
      <img src={src} alt={alt} className="h-full w-full object-contain" draggable={false} />
    </div>
  )
}

/**
 * 指标格：标签和数字逐行对齐，金额保持完整可读。
 *
 * ⚠️ 数字**绝不加 truncate** —— 截断会把 `¥1,474` 变成 `¥1,47…`，
 * "数值不可读"比"轻微溢出"严重得多。
 * 溢出改由 `metricValueClass` 按字符长度降一档字号处理（F7）。
 */
function MetricCell({
  value,
  label,
  money,
  stacked,
}: {
  value: string
  label: string
  money?: boolean
  stacked: boolean
}) {
  return (
    <div className={`flex min-w-0 ${stacked ? 'items-baseline justify-between gap-2' : 'flex-col-reverse items-center gap-1'}`}>
      <p className={`${stacked ? 'text-[11px]' : 'text-[10px]'} leading-tight text-ink-tertiary`}>{label}</p>
      <p
        className={`num min-w-0 break-words ${stacked ? 'text-right' : 'text-center font-semibold'} tabular-nums ${metricValueClass(value, stacked ? 1 : 3)} ${
          money && stacked ? 'text-money' : 'text-ink-primary'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * 窄卡片逐行排指标，保留完整标签和金额。
 */
export function MetricRow({ cells }: { cells: PresentationMetric[] }) {
  if (cells.length === 0) return null
  const stacked = cells.some(cell => cell.value.length > 7)
  return (
    <div
      className={stacked ? 'space-y-1.5' : 'grid gap-1'} style={stacked ? undefined : { gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells.map((c) => (
        <MetricCell
          key={c.label}
          value={c.value}
          label={c.label}
          money={c.money}
          stacked={stacked}
        />
      ))}
    </div>
  )
}

/**
 * 财务行：**总投入 + 盈亏**（仅已售出）。
 *
 * ⚠️ 刻意**不显示「实际持有成本」**—— 它与盈亏互为相反数
 * （`netHoldingCost = grossTotal − salePrice`，`profitLoss = salePrice − grossTotal`），
 * 同时展示是同一笔账的两种符号。
 * 完整账目留给详情页。
 */
export function FinanceLine({
  grossText,
  finance,
}: {
  grossText: string | null
  finance: PresentationFinance | null
}) {
  if (grossText === null && finance === null) return null
  return (
    <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-line-inner pt-2">
      {grossText !== null && (
        <p className="num tabular-nums text-caption text-ink-tertiary">
          总投入 <span className="text-ink-secondary">{grossText}</span>
        </p>
      )}
      {finance !== null && (
        <p className={`num tabular-nums text-caption ${FINANCE_TONES[finance.tone]}`}>
          {finance.value}
        </p>
      )}
    </div>
  )
}

/** 处置方法徽标（图区左上 / 缩略图右下角共用） */
export function DisposalBadge({
  kind,
  size = 'sm',
}: {
  kind: NonNullable<ReturnType<typeof itemPresentation>['badge']>
  size?: 'sm' | 'md'
}) {
  return <DisposalChip method={kind} size={size} />
}

/**
 * ItemCard：档案册中的一条物品条目。
 *
 * 结构为「图版 → 名称 → 副标题 → ≤2 个标签 → 可收起的指标（+ 财务行）」。
 * 明细默认展开，保修点阵始终可见；展开按钮独立于导航链接，避免嵌套交互元素。
 *
 * 处置态的全部差异都来自 `itemPresentation(item)`（唯一展示模型）：
 * - 图区左上方法徽标（已售出 / 已丢弃 / 其他处置 / 已处置兜底）
 * - 出售额外叠加图片 overlay「售出」
 * - 副标题换成「处置于 X」
 * - 指标与财务行按处置方式切换
 *
 */
export default function ItemCard({
  to,
  name,
  iconUrl,
  categoryName,
  tagNames,
  item,
  today,
  className = '',
  summary = false,
}: Props) {
  const location = useLocation()
  const [expanded, setExpanded] = useState(!summary)
  const detailsId = useId()
  const p = itemPresentation(item, { today, categoryName })
  const cells: PresentationMetric[] = p.metrics
  const hasDetails = !summary && (cells.length > 0 || p.finance !== null)

  return (
    <article className={`relative min-w-0 ${summary ? 'h-full' : 'self-start'}`} data-item-card="" data-layout-id={item.id} data-expanded={expanded}>
      <Link
        to={to}
        state={{ itemBackground: location }}
        aria-label={`查看${name}详情`}
        className={`item-card group flex h-full flex-col overflow-hidden rounded-surface border border-line bg-surface active:bg-surface-sunken ${className}`}
      >
        <div className="relative p-2.5 pb-0">
          <ObjectPlate
            src={iconUrl}
            alt={name}
            className="item-art aspect-[1.15/1] w-full shrink-0 rounded-card"
          />
          {/* 处置方法徽标：图区左上。pointer-events-none，不影响整卡点击。 */}
          {p.badge !== null && (
            <span className="absolute left-2 top-2">
              <DisposalChip method={p.badge} size="sm" />
            </span>
          )}
          {statusOf(item) !== 'disposed' && !summary && (
            <span className="absolute left-3.5 top-3.5"><StatusChip status={statusOf(item)} size="sm" /></span>
          )}
          {/* 图片结果 overlay：仅出售。物品图标保持 opacity 1，不灰化 / 不加叉。 */}
          {p.overlay !== null && <DisposalOverlay text={p.overlay} />}
        </div>
        <div className="flex flex-1 flex-col px-3 pb-3 pt-2.5 sm:px-3.5">
          {/* 名称允许两行：档案册里"物品叫什么"比整齐的单行截断更重要 */}
          <p className="line-clamp-2 text-item font-semibold text-ink-primary">{name}</p>
          <p className="mt-1.5 max-w-full truncate self-start rounded-pill bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-tertiary">{p.subtitle}</p>
          {tagNames.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {tagNames.slice(0, 2).map((t) => (
                <TagChip key={t} name={t} size="sm" />
              ))}
            </div>
          )}
          {hasDetails && (
            <div id={detailsId} className="item-card-details" data-expanded={expanded} aria-hidden={!expanded}>
              <div className="min-h-0 overflow-hidden">
                <div className="pt-3.5">
                  {cells.length > 0 && <MetricRow cells={cells} />}
                  {p.finance !== null && <FinanceLine grossText={p.grossText} finance={p.finance} />}
                </div>
              </div>
            </div>
          )}
        </div>
        {!summary && statusOf(item) === 'owned' && item.warrantyExpiresAt !== null && <WarrantyStrip item={item} today={today} />}
      </Link>
      {hasDetails && (
        <button
          type="button"
          className="item-card-toggle absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-pill text-ink-secondary transition-colors hover:text-accent active:text-accent"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? '收起' : '展开'}${name}的详细信息`}
          onClick={() => setExpanded(value => !value)}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-pill border border-line bg-chrome backdrop-blur-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </button>
      )}
    </article>
  )
}
