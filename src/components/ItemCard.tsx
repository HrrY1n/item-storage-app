import { Link } from 'react-router'
import TagChip from './TagChip'

interface Props {
  to: string
  name: string
  iconUrl: string
  categoryName: string
  /** 展示用标签名（不含 # 前缀），最多展示 2 个 */
  tagNames: string[]
  className?: string
  /** 传入时启用「卡片 → 详情」的物体连续性过渡（View Transitions 渐进增强） */
  onNavigate?: (e: React.MouseEvent<HTMLAnchorElement>) => void
}

/**
 * ObjectPlate：物品陈列版面。
 *
 * 物品永远是整个界面里最抢眼的东西 —— UI 退后：
 * 暖白底衬 + object-contain + 内留白，让物品像档案册里的一幅图版，
 * 而不是铺满卡片的电商封面。未来替换为 1:1 AI 插画时布局无需改动。
 */
export function ObjectPlate({
  src,
  alt,
  className = '',
  plateStyle,
}: {
  src: string
  alt: string
  className?: string
  /** 供 View Transitions 设置 view-transition-name（仅过渡期间存在） */
  plateStyle?: React.CSSProperties
}) {
  return (
    <div
      className={`overflow-hidden bg-plate ${className}`}
      style={plateStyle}
      data-object-plate=""
    >
      {/* 铺满式展示：物体直接占满底衬，不做内缩留白 ——
          避免与资产自带底色形成"双层边框"；未来 1:1 插画（暖白底）会自动与底衬融合。 */}
      <img src={src} alt={alt} className="h-full w-full object-cover" draggable={false} />
    </div>
  )
}

/**
 * ItemCard：档案册中的一条物品条目。
 * 结构固定为「图版 → 名称 → 分类 → ≤2 个标签」，不出现 ID / 时间 / 备注 / 按钮。
 */
export default function ItemCard({
  to,
  name,
  iconUrl,
  categoryName,
  tagNames,
  className = '',
  onNavigate,
}: Props) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`group block rounded-card border border-line bg-white p-2.5 shadow-card transition-colors duration-150 ease-out-quint active:bg-neutral-50 ${className}`}
    >
      <ObjectPlate
        src={iconUrl}
        alt={name}
        className="aspect-square rounded-control border border-line-inner"
      />
      <div className="px-1 pt-2.5">
        {/* 名称允许两行：档案册里"物品叫什么"比整齐的单行截断更重要 */}
        <p className="line-clamp-2 min-h-[42px] text-item text-ink-primary">{name}</p>
        <p className="mt-1 truncate text-caption text-ink-tertiary">{categoryName}</p>
      </div>
      {tagNames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 px-1">
          {tagNames.slice(0, 2).map((t) => (
            <TagChip key={t} name={t} size="sm" />
          ))}
        </div>
      )}
    </Link>
  )
}
