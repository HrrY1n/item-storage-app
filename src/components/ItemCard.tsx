import { Link } from 'react-router'
import TagChip from './TagChip'
import { DisposalChip, DisposalOverlay, FINANCE_TONES } from './StatusChip'
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
  /** 传入时启用「卡片 → 详情」的物体连续性过渡（View Transitions 渐进增强） */
  onNavigate?: (e: React.MouseEvent<HTMLAnchorElement>) => void
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
 * 指标格：数字在上、标签在下。数字是结论，标签只是单位说明。
 *
 * ⚠️ 数字**绝不加 truncate** —— 截断会把 `¥1,474` 变成 `¥1,47…`，
 * "数值不可读"比"轻微溢出"严重得多（设计 §14 F1）。
 * 溢出改由 `metricValueClass` 按字符长度降一档字号处理（F7）。
 */
function MetricCell({
  value,
  label,
  money,
  cellCount,
}: {
  value: string
  label: string
  money?: boolean
  cellCount: number
}) {
  return (
    <div className="min-w-0 px-1 first:pl-0 last:pr-0">
      <p
        className={`num tabular-nums ${metricValueClass(value, cellCount)} ${
          money ? 'text-money' : 'text-ink-primary'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-[10px] leading-tight text-ink-tertiary">{label}</p>
    </div>
  )
}

/**
 * 指标行：三栏（或两栏）栅格。
 *
 * 导出给 `ItemsListPage` 的网格卡与列表行复用 —— **同一份渲染逻辑**，
 * 保证 Grid 与 List 的指标口径与视觉完全一致（勘误 FIX-B）。
 */
export function MetricRow({ cells }: { cells: PresentationMetric[] }) {
  if (cells.length === 0) return null
  return (
    <div
      className={`mt-auto grid border-t border-line-inner pt-2 ${
        cells.length === 3 ? 'grid-cols-3 divide-x divide-line-inner' : 'grid-cols-2 gap-2'
      }`}
    >
      {cells.map((c) => (
        <MetricCell
          key={c.label}
          value={c.value}
          label={c.label}
          money={c.money}
          cellCount={cells.length}
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
 * 同时展示是同一笔账的两种符号（设计 §9.1 / 勘误 FIX-A、FIX-B）。
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
 * 结构固定为「图版 → 名称 → 副标题 → ≤2 个标签 → 三栏指标（+ 财务行）」，
 * 不出现 ID / 时间 / 备注 / 按钮。
 * 整卡 flex-col + 指标行 mt-auto：同一行内多张卡片等高，指标始终贴底对齐。
 *
 * 处置态的全部差异都来自 `itemPresentation(item)`（唯一展示模型）：
 * - 图区左上方法徽标（已售出 / 已丢弃 / 其他处置 / 已处置兜底）
 * - 出售额外叠加图片 overlay「售出」
 * - 副标题换成「处置于 X」
 * - 指标与财务行按处置方式切换
 *
 * 关于瀑布流：参考图用的是左右不等高的 masonry。这里刻意保留等高 grid ——
 * 卡片结构统一、等高才能让三栏数字横向对齐比较，
 * 而瀑布流会破坏这种比较性，也破坏"最近添加"按时间从上到下阅读的可预期性。
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
  onNavigate,
}: Props) {
  const p = itemPresentation(item, { today, categoryName })
  const cells: PresentationMetric[] = p.metrics

  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-colors duration-150 ease-out-quint active:bg-surface-sunken ${className}`}
    >
      <div className="relative">
        <ObjectPlate
          src={iconUrl}
          alt={name}
          className="aspect-[4/3] w-full shrink-0 border-b border-line-inner"
        />
        {/* 处置方法徽标：图区左上。pointer-events-none，不影响整卡点击。 */}
        {p.badge !== null && (
          <span className="absolute left-2 top-2">
            <DisposalChip method={p.badge} size="sm" />
          </span>
        )}
        {/* 图片结果 overlay：仅出售。物品图标保持 opacity 1，不灰化 / 不加叉。 */}
        {p.overlay !== null && <DisposalOverlay text={p.overlay} />}
      </div>
      <div className="flex flex-1 flex-col p-3">
        {/* 名称允许两行：档案册里"物品叫什么"比整齐的单行截断更重要 */}
        <p className="line-clamp-2 min-h-[40px] text-item text-ink-primary">{name}</p>
        <p className="mt-0.5 truncate text-caption text-ink-tertiary">{p.subtitle}</p>
        {tagNames.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tagNames.slice(0, 2).map((t) => (
              <TagChip key={t} name={t} size="sm" />
            ))}
          </div>
        )}
        {cells.length > 0 && (
          <MetricRow cells={cells} />
        )}
        {p.finance !== null && <FinanceLine grossText={p.grossText} finance={p.finance} />}
      </div>
    </Link>
  )
}