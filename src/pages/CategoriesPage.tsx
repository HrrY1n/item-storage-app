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
      className={'shrink-0 text-ink-faint transition-transform duration-200 ' + (open ? 'rotate-90' : '')}
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

/** 默认展开真实二级分类；名称、封面与数量都来自当前分类树。 */
function RootCategoryBlock({
  category,
  categories,
  counts,
}: {
  category: Category
  categories: Category[]
  counts: Map<string, number>
}) {
  const [expanded, setExpanded] = useState(true)
  const children = childrenOf(categories, category.id)
  const count = counts.get(category.id) ?? 0
  const directCount = count - children.reduce((sum, child) => sum + (counts.get(child.id) ?? 0), 0)
  const panelId = 'category-children-' + category.id
  const rowClass =
    'flex min-h-[76px] w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-surface-sunken'
  const rowInner = (
    <>
      <CategoryIconTile category={category} size={44} />
      <div className="min-w-0 flex-1">
        <p className="text-item text-ink-primary">{category.name}</p>
        {children.length > 0 && (
          <p className="mt-1 text-caption text-ink-tertiary">{children.length} 个子分类</p>
        )}
      </div>
      <span className="num shrink-0 text-caption text-ink-tertiary">{count} 件</span>
      <Chevron open={children.length > 0 ? expanded : undefined} />
    </>
  )

  return (
    <section className="overflow-hidden rounded-surface border border-line bg-surface shadow-card">
      {children.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          className={rowClass}
        >
          {rowInner}
        </button>
      ) : (
        <Link to={'/categories/' + category.id} className={rowClass}>
          {rowInner}
        </Link>
      )}

      {children.length > 0 && expanded && (
        <div id={panelId} className="border-t border-line-inner px-3.5 pb-2.5 pt-3">
          <div className="grid grid-cols-2 gap-2">
            {children.map((child) => (
              <Link
                key={child.id}
                to={'/categories/' + child.id}
                className="flex min-h-[68px] min-w-0 items-center gap-2 rounded-card border border-line-inner bg-surface-raised p-2.5 transition-colors active:bg-surface-sunken"
              >
                <CategoryIconTile category={child} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-caption text-ink-secondary">{child.name}</p>
                  <p className="num mt-1 text-caption text-ink-tertiary">{counts.get(child.id) ?? 0} 件</p>
                </div>
              </Link>
            ))}
          </div>
          <Link
            to={'/categories/' + category.id}
            className="mt-2 flex min-h-[44px] items-center justify-between gap-2 text-caption text-ink-secondary transition-colors active:text-ink-primary"
          >
            <span>全部「{category.name}」</span>
            <Chevron />
          </Link>
          {directCount > 0 && (
            <p className="pb-1 text-caption text-ink-tertiary">另有 {directCount} 件物品直接归入此大类</p>
          )}
        </div>
      )}
    </section>
  )
}

export default function CategoriesPage() {
  const categories = useCategories()
  const items = useItems()
  if (!categories || !items) {
    return <div className="pt-[calc(16px+env(safe-area-inset-top))]" />
  }

  const roots = childrenOf(categories, null)
  const counts = computeCategoryCounts(items, categories)

  return (
    <div className="pt-[calc(24px+env(safe-area-inset-top))]">
      <header className="animate-fade-rise flex items-baseline justify-between gap-3 px-5">
        <div className="min-w-0">
          <h1 className="text-page-title text-ink-primary">分类</h1>
          <p className="mt-2 text-secondary text-ink-tertiary">
            <span className="num text-item text-ink-primary">{roots.length}</span> 个一级 ·{' '}
            <span className="num text-item text-ink-primary">{categories.length - roots.length}</span> 个子分类
          </p>
          <p className="mt-1 text-caption text-ink-tertiary">共 {items.length} 件物品 · 分类件数含子分类</p>
        </div>
        <Link
          to="/settings/categories"
          className="shrink-0 text-secondary text-ink-secondary transition-colors active:text-ink-primary"
        >
          管理
        </Link>
      </header>

      <div className="mt-5 flex flex-col gap-3 px-5">
        {roots.map((category) => (
          <RootCategoryBlock key={category.id} category={category} categories={categories} counts={counts} />
        ))}
      </div>
    </div>
  )
}
