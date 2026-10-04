import { Link } from 'react-router'
import type { Category, IconKey } from '../types'
import { getIconPath } from '../data/icons'

/**
 * 分类 tint：只作为极弱背景色。
 * 饱和度与对比度刻意低于 clay accent —— 它只用来区分"类别"，不承担强调；
 * 全部收敛到暖中性色域，避免出现第二个彩色系统。
 */
export const CATEGORY_TINT: Record<IconKey, string> = {
  laptop: 'bg-[#F4F4F2]',
  phone: 'bg-[#F4F4F2]',
  earbuds: 'bg-[#F4F4F2]',
  mouse: 'bg-[#F4F4F2]',
  keyboard: 'bg-[#F4F4F2]',
  book: 'bg-[#F6F3EF]',
  notebook: 'bg-[#F6F3EF]',
  tshirt: 'bg-[#F6F2F1]',
  shoes: 'bg-[#F6F2F1]',
  backpack: 'bg-[#F4F3F5]',
  bottle: 'bg-[#F2F5F3]',
  other: 'bg-[#F5F4F2]',
}

export function CategoryIconTile({ category, size = 40 }: { category: Category; size?: number }) {
  const key = category.iconKey ?? 'other'
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-control ${CATEGORY_TINT[key]}`}
      style={{ width: size, height: size }}
    >
      <img
        src={getIconPath(key)}
        alt=""
        className="h-full w-full object-contain p-0.5 mix-blend-multiply"
        draggable={false}
      />
    </div>
  )
}

export default function CategoryCard({ category, count }: { category: Category; count: number }) {
  return (
    <Link
      to={`/categories/${category.id}`}
      className="group flex items-center gap-3 rounded-card border border-line bg-white p-3.5 shadow-card transition-colors duration-150 ease-out-quint active:bg-neutral-50"
    >
      <CategoryIconTile category={category} size={42} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-item text-ink-primary">{category.name}</p>
        <p className="num mt-1 text-caption text-ink-tertiary">{count} 件</p>
      </div>
    </Link>
  )
}
