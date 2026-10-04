import { useState } from 'react'
import { Link } from 'react-router'
import type { Category } from '../types'
import { childrenOf } from '../domain/categoryTree'
import { useCategories, useItems } from '../features/data/hooks'
import { computeCategoryCounts } from '../features/data/viewModels'
import { CategoryIconTile } from '../components/CategoryCard'

function Chevron({ open }: { open?: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 text-neutral-300 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

/** 一级分类块：名称 + 数量 + 一行二级分类摘要 + 轻量图标底衬 */
function RootCategoryBlock({
  category,
  categories,
  counts,
}: {
  category: Category
  categories: Category[]
  counts: Map<string, number>
}) {
  const [expanded, setExpanded] = useState(false)
  const children = childrenOf(categories, category.id)
  const count = counts.get(category.id) ?? 0
  const summary = children
    .slice(0, 3)
    .map((c) => c.name)
    .join(' · ')

  const rowClass =
    'flex min-h-[68px] w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-neutral-50'
  const rowInner = (
    <>
      <CategoryIconTile category={category} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-item text-ink-primary">{category.name}</p>
        {children.length > 0 && (
          <p className="mt-1 truncate text-caption text-ink-tertiary">{summary}</p>
        )}
      </div>
      <span className="shrink-0 text-caption text-ink-tertiary">{count} 件</span>
      <Chevron open={children.length > 0 ? expanded : undefined} />
    </>
  )

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
      {children.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={rowClass}
        >
          {rowInner}
        </button>
      ) : (
        <Link to={`/categories/${category.id}`} className={rowClass}>
          {rowInner}
        </Link>
      )}

      {/* 展开/折叠（grid-rows 轻动画） */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-line-inner py-1">
            <Link
              to={`/categories/${category.id}`}
              className="flex min-h-[44px] items-center pl-[70px] pr-3.5 text-secondary text-ink-secondary transition-colors active:bg-neutral-50"
            >
              全部「{category.name}」
            </Link>
            {children.map((child) => (
              <Link
                key={child.id}
                to={`/categories/${child.id}`}
                className="flex min-h-[44px] items-center pl-[70px] pr-3.5 transition-colors active:bg-neutral-50"
              >
                <span className="flex-1 truncate text-secondary text-ink-secondary">{child.name}</span>
                <span className="mr-1.5 text-caption text-ink-tertiary">
                  {counts.get(child.id) ?? 0}
                </span>
                <Chevron />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CategoriesPage() {
  const categories = useCategories()
  const items = useItems()

  const loading = !categories || !items
  if (loading) {
    return <div className="pt-[calc(16px+env(safe-area-inset-top))]" />
  }

  const roots = childrenOf(categories, null)
  const counts = computeCategoryCounts(items, categories)

  return (
    <div className="pt-[calc(24px+env(safe-area-inset-top))]">
      <header className="animate-fade-rise flex items-baseline justify-between px-5">
        <div>
          <h1 className="text-page-title text-ink-primary">分类</h1>
          <p className="mt-2 text-secondary text-ink-tertiary">
            <span className="num text-item text-ink-primary">{categories.length}</span> 个分类 ·{' '}
            <span className="num text-item text-ink-primary">{items.length}</span> 件物品
          </p>
        </div>
        <Link
          to="/settings/categories"
          className="min-h-[32px] text-secondary text-ink-tertiary transition-colors active:opacity-60 sm:hover:text-ink-primary"
        >
          管理
        </Link>
      </header>

      <div className="stagger-in mt-5 flex flex-col gap-2.5 px-5">
        {roots.map((c) => (
          <RootCategoryBlock key={c.id} category={c} categories={categories} counts={counts} />
        ))}
      </div>
    </div>
  )
}
