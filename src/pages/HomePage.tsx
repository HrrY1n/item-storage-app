import { Link, useNavigate } from 'react-router'
import { childrenOf } from '../domain/categoryTree'
import {
  useCategories,
  useItemTagLinks,
  useItems,
  usePresetAssetMap,
  useTags,
} from '../features/data/hooks'
import {
  categoryNameOf,
  computeCategoryCounts,
  frequentTags,
  tagNamesOf,
} from '../features/data/viewModels'
import ItemCard from '../components/ItemCard'
import CategoryCard from '../components/CategoryCard'
import SectionHeader from '../components/SectionHeader'
import TagChip from '../components/TagChip'

export default function HomePage() {
  const navigate = useNavigate()
  const items = useItems()
  const categories = useCategories()
  const tags = useTags()
  const links = useItemTagLinks()
  const assetMap = usePresetAssetMap()

  const loading = !items || !categories || !tags || !links || !assetMap
  if (loading) {
    return <div className="pt-[calc(16px+env(safe-area-inset-top))]" />
  }

  const counts = computeCategoryCounts(items, categories)
  const roots = childrenOf(categories, null)
  const frequent = frequentTags(items, links, tags, 8)

  return (
    <div className="pt-[calc(16px+env(safe-area-inset-top))]">
      {/* 顶部标题 */}
      <div className="px-5">
        <h1 className="text-page-title text-ink-primary">我的物品</h1>
        <p className="mt-1 text-caption text-ink-tertiary">{items.length} 件物品</p>
      </div>

      {/* 大搜索框（点击进入搜索页） */}
      <div className="mt-4 px-5">
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="flex h-12 w-full items-center gap-2.5 rounded-2xl border border-black/[0.05] bg-white px-4 text-left shadow-card transition-opacity active:opacity-70"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-tertiary">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.8-3.8" />
          </svg>
          <span className="text-body text-ink-tertiary">搜索物品、标签或分类……</span>
        </button>
      </div>

      {items.length === 0 ? (
        /* 空库 Empty State */
        <div className="mt-10 flex flex-col items-center px-8 text-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-neutral-100">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400">
              <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
              <path d="M3 8l9 5 9-5" />
              <path d="M12 13v8" />
            </svg>
          </div>
          <p className="text-item text-ink-secondary">还没有物品</p>
          <p className="mt-1.5 max-w-[240px] text-secondary leading-relaxed text-ink-tertiary">
            添加第一件物品，开始建立你的私人物品库。
          </p>
          <Link
            to="/items/new"
            className="mt-5 flex h-11 items-center rounded-full bg-neutral-900 px-6 text-secondary font-medium text-white transition-transform duration-100 active:scale-[0.97]"
          >
            添加物品
          </Link>
        </div>
      ) : (
        <>
          {/* 最近添加 */}
          <section className="mt-8">
            <div className="px-5">
              <SectionHeader title="最近添加" />
            </div>
            <div className="no-scrollbar flex gap-3 overflow-x-auto px-5 pb-1">
              {items.slice(0, 8).map((item) => (
                <ItemCard
                  key={item.id}
                  to={`/items/${item.id}`}
                  name={item.name}
                  iconUrl={assetMap.get(item.iconAssetId) ?? '/icons/items/other.svg'}
                  categoryName={categoryNameOf(categories, item.categoryId)}
                  tagNames={tagNamesOf(item.id, links, tags)}
                  className="w-[146px] shrink-0"
                />
              ))}
            </div>
          </section>

          {/* 分类 */}
          <section className="mt-8 px-5">
            <SectionHeader
              title="分类"
              action={
                <Link to="/categories" className="text-secondary text-ink-tertiary transition-opacity active:opacity-50">
                  全部
                </Link>
              }
            />
            <div className="grid grid-cols-2 gap-3">
              {roots.map((c) => (
                <CategoryCard key={c.id} category={c} count={counts.get(c.id) ?? 0} />
              ))}
            </div>
          </section>

          {/* 常用标签 */}
          {frequent.length > 0 && (
            <section className="mt-8 px-5">
              <SectionHeader title="常用标签" />
              <div className="flex flex-wrap gap-2">
                {frequent.map((tag) => (
                  <TagChip key={tag.id} name={tag.name} onClick={() => navigate(`/search?tag=${tag.id}`)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
