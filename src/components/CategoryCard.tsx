import { Link } from 'react-router'
import type { Category, IconKey } from '../types'
import { getIconPath } from '../data/icons'

/**
 * 极轻的分类 tint（低饱和、中性），仅用于图标底衬，不做大面积彩色。
 * 图标 SVG 自带浅底，用 mix-blend-multiply 让 tint 透出来。
 */
export const CATEGORY_TINT: Record<IconKey, string> = {
  laptop: 'bg-[#EEF2F7]',
  phone: 'bg-[#EEF2F7]',
  earbuds: 'bg-[#EEF2F7]',
  mouse: 'bg-[#EEF2F7]',
  keyboard: 'bg-[#EEF2F7]',
  book: 'bg-[#F3F0EA]',
  notebook: 'bg-[#F3F0EA]',
  tshirt: 'bg-[#F5EFF1]',
  shoes: 'bg-[#F5EFF1]',
  backpack: 'bg-[#F1EFF5]',
  bottle: 'bg-[#EDF2F0]',
  other: 'bg-[#F2F1EF]',
}

export function CategoryIconTile({ category, size = 40 }: { category: Category; size?: number }) {
  const key = category.iconKey ?? 'other'
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-xl ${CATEGORY_TINT[key]}`}
      style={{ width: size, height: size }}
    >
      <img
        src={getIconPath(key)}
        alt=""
        className="h-full w-full object-cover mix-blend-multiply"
        draggable={false}
      />
    </div>
  )
}

export default function CategoryCard({ category, count }: { category: Category; count: number }) {
  return (
    <Link
      to={`/categories/${category.id}`}
      className="group flex items-center gap-3 rounded-[18px] border border-line bg-white p-3.5 shadow-card transition-[transform,border-color] duration-200 ease-spring will-change-transform active:scale-[0.975] sm:hover:-translate-y-0.5 sm:hover:border-line-strong"
    >
      <CategoryIconTile category={category} size={42} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-item text-ink-primary">{category.name}</p>
        <p className="num mt-1 text-caption text-ink-tertiary">{count} 件</p>
      </div>
    </Link>
  )
}
