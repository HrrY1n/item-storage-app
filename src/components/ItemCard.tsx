import { Link } from 'react-router'
import TagChip from './TagChip'

interface Props {
  to: string
  name: string
  iconUrl: string
  categoryName: string
  /** 展示用标签名（不含 # 前缀），最多展示 2 个 */
  tagNames: string[]
  /** 关键指标；无购买数据时不传，卡片自动收紧 */
  metric?: { daysText: string | null; totalText: string | null; dailyText: string | null } | null
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

/** 指标格：数字在上、标签在下。数字是结论，标签只是单位说明。
 *  横向 padding 压到最小 —— 卡片宽度有限，三栏数字必须完整显示而不是被截断。 */
function MetricCell({ value, label, money }: { value: string; label: string; money?: boolean }) {
  return (
    <div className="min-w-0 px-1 first:pl-0 last:pr-0">
      <p className={`num truncate text-caption ${money ? 'text-money' : 'text-ink-primary'}`}>
        {value}
      </p>
      <p className="mt-0.5 truncate text-[10px] leading-tight text-ink-tertiary">{label}</p>
    </div>
  )
}

/**
 * ItemCard：档案册中的一条物品条目。
 *
 * 结构固定为「图版 → 名称 → 分类 → ≤2 个标签 → 三栏指标」，
 * 不出现 ID / 时间 / 备注 / 按钮。
 * 整卡 flex-col + 指标行 mt-auto：同一行内多张卡片等高，指标始终贴底对齐。
 *
 * 关于瀑布流：参考图用的是左右不等高的 masonry。这里刻意保留等高 grid ——
 * 卡片结构统一、等高才能让"持有天数 / 总投入 / 日均成本"三栏数字横向对齐比较，
 * 而瀑布流会破坏这种比较性，也破坏"最近添加"按时间从上到下阅读的可预期性。
 */
export default function ItemCard({
  to,
  name,
  iconUrl,
  categoryName,
  tagNames,
  metric,
  className = '',
  onNavigate,
}: Props) {
  const cells = [
    metric?.daysText ? { value: metric.daysText, label: '持有天数' } : null,
    metric?.totalText ? { value: metric.totalText, label: '总投入' } : null,
    metric?.dailyText ? { value: metric.dailyText, label: '日均成本', money: true } : null,
  ].filter((c): c is { value: string; label: string; money?: boolean } => c !== null)

  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-colors duration-150 ease-out-quint active:bg-surface-sunken ${className}`}
    >
      <ObjectPlate
        src={iconUrl}
        alt={name}
        className="aspect-[4/3] w-full shrink-0 border-b border-line-inner"
      />
      <div className="flex flex-1 flex-col p-3">
        {/* 名称允许两行：档案册里"物品叫什么"比整齐的单行截断更重要 */}
        <p className="line-clamp-2 min-h-[40px] text-item text-ink-primary">{name}</p>
        <p className="mt-0.5 truncate text-caption text-ink-tertiary">{categoryName}</p>
        {tagNames.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tagNames.slice(0, 2).map((t) => (
              <TagChip key={t} name={t} size="sm" />
            ))}
          </div>
        )}
        {cells.length > 0 && (
          <div
            className={`mt-auto grid border-t border-line-inner pt-2 ${
              cells.length === 3 ? 'grid-cols-3 divide-x divide-line-inner' : 'grid-cols-2 gap-2'
            }`}
          >
            {cells.map((c) => (
              <MetricCell key={c.label} value={c.value} label={c.label} money={c.money} />
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
