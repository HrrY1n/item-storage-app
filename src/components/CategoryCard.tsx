import { Link } from 'react-router'
import type { Category } from '../types'
import { getIconPath } from '../data/icons'

/**
 * 分类图标底衬。
 *
 * 审计结论：此前每个 key 一个 tint 色（64+ 条目）既难维护，又和"只有一个强调色"的
 * 设计纪律冲突。改成统一使用物品底衬（plate）—— 图标本身已经带颜色，
 * 底衬只需要安静地把它托起来；深浅主题靠同一个 token 自动成立。
 */
export function CategoryIconTile({ category, size = 40 }: { category: Category; size?: number }) {
  const key = category.iconKey ?? 'other'
  return (
    <div
      className="shrink-0 overflow-hidden rounded-control border border-line-inner bg-plate"
      style={{ width: size, height: size }}
    >
      <img
        src={getIconPath(key)}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
    </div>
  )
}

export default function CategoryCard({ category, count }: { category: Category; count: number }) {
  return (
    <Link
      to={`/categories/${category.id}`}
      className="group flex items-center gap-3 rounded-card border border-line bg-surface p-3.5 shadow-card transition-colors duration-150 ease-out-quint active:bg-surface-sunken sm:hover:border-line-strong"
    >
      <CategoryIconTile category={category} size={42} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-item text-ink-primary">{category.name}</p>
        <p className="num mt-1 text-caption text-ink-tertiary">{count} 件</p>
      </div>
    </Link>
  )
}
