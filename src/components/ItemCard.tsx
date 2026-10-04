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
}

/**
 * ItemCard：物品图片是第一视觉主体。
 * 结构固定为「图 → 名称 → 分类 → ≤2 个标签」，不出现 ID / 时间 / 备注 / 按钮。
 * 按压时整体轻微下沉、图像微微放大，形成"拿起来"的手感。
 */
export default function ItemCard({ to, name, iconUrl, categoryName, tagNames, className = '' }: Props) {
  return (
    <Link
      to={to}
      className={`group block rounded-2xl border border-line bg-white p-3 shadow-card transition-transform duration-200 ease-spring will-change-transform active:scale-[0.975] sm:hover:-translate-y-0.5 ${className}`}
    >
      <div className="mb-3 aspect-square overflow-hidden rounded-xl">
        <img
          src={iconUrl}
          alt={name}
          className="h-full w-full object-cover transition-transform duration-300 ease-out-quint group-active:scale-[1.04] sm:group-hover:scale-[1.04]"
          draggable={false}
        />
      </div>
      <p className="truncate text-item text-ink-primary">{name}</p>
      <p className="mt-0.5 truncate text-caption text-ink-tertiary">{categoryName}</p>
      {tagNames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tagNames.slice(0, 2).map((t) => (
            <TagChip key={t} name={t} size="sm" />
          ))}
        </div>
      )}
    </Link>
  )
}
