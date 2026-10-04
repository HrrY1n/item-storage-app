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
import {
  SHARED_OBJECT_NAME,
  navigateWithViewTransition,
  supportsViewTransition,
} from '../features/ui/viewTransition'
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
    // 整页只保留一层入场位移（此前是 4 个分块各自动画）：动效更少，空间关系仍在
    <div className="animate-fade-rise pt-[calc(28px+env(safe-area-inset-top))]">
      {/* 页头：标题 + 计数。
          审计结论：删掉英文 eyebrow —— 它是装饰性信息，对私人工具不产生可用性价值。 */}
      <header className="px-5">
        <h1 className="text-page-title text-ink-primary">我的物品</h1>
        <p className="mt-2 text-secondary text-ink-tertiary">
          共 <span className="num text-item text-ink-primary">{items.length}</span> 件物品
        </p>
      </header>

      {/* 大搜索框（点击进入搜索页） */}
      <div className="mt-7 px-5">
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="group flex h-[52px] w-full items-center gap-3 rounded-card border border-line bg-white px-4 text-left shadow-card transition-[border-color] duration-200 ease-out-quint sm:hover:border-line-strong"
        >
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
            strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0 text-ink-tertiary"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.8-3.8" />
          </svg>
          <span className="text-body text-ink-tertiary">搜索物品、标签或分类……</span>
        </button>
      </div>

      {items.length === 0 ? (
        /* 空库：留白展台 + 明确行动点 */
        <div className="animate-fade-rise px-8 pt-6 text-center">
          <EmptyPlinthHero />
          <p className="mt-7 text-title-card text-ink-primary">还没有物品</p>
          <p className="mx-auto mt-2.5 max-w-[268px] text-body leading-relaxed text-ink-tertiary">
            添加第一件物品，开始建立你的私人物品库。
          </p>
          <Link
            to="/items/new"
            className="mt-7 inline-flex h-12 items-center gap-2 rounded-pill bg-neutral-900 px-7 text-body font-medium text-white shadow-fab transition-transform duration-200 ease-out-quint active:scale-[0.97] sm:hover:-translate-y-0.5"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加物品
          </Link>
        </div>
      ) : (
        <>
          {/* 最近添加 */}
          <section className="mt-10">
            <div className="px-5">
              <SectionHeader title="最近添加" />
            </div>
            <div className="no-scrollbar flex gap-3.5 overflow-x-auto px-5 pb-1">
              {items.slice(0, 8).map((item) => (
                <ItemCard
                  key={item.id}
                  to={`/items/${item.id}`}
                  name={item.name}
                  iconUrl={assetMap.get(item.iconAssetId) ?? '/icons/items/other.svg'}
                  categoryName={categoryNameOf(categories, item.categoryId)}
                  tagNames={tagNamesOf(item.id, links, tags)}
                  className="w-[152px] shrink-0"
                  onNavigate={(e) => {
                    // 卡片 → 详情：让"这一件物品"的图版连续过渡（不支持时普通跳转）
                    if (!supportsViewTransition()) return
                    e.preventDefault()
                    const plate = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(
                      '[data-object-plate]',
                    )
                    navigateWithViewTransition(
                      () => navigate(`/items/${item.id}`),
                      () => {
                        if (plate) plate.style.viewTransitionName = SHARED_OBJECT_NAME
                      },
                      () => {
                        if (plate) plate.style.viewTransitionName = ''
                      },
                    )
                  }}
                />
              ))}
            </div>
          </section>

          {/* 分类 */}
          <section className="mt-10 px-5">
            <SectionHeader
              title="分类"
              action={
                <Link
                  to="/categories"
                  className="group inline-flex items-center gap-1 text-secondary text-ink-tertiary transition-colors active:opacity-60 sm:hover:text-ink-primary"
                >
                  全部
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 ease-out-quint sm:group-hover:translate-x-0.5">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
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
            <section className="mt-10 px-5">
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

/** 首页空状态的原创插画（比通用空状态更大，作为第一印象的视觉锚点） */
function EmptyPlinthHero() {
  return (
    <svg width="188" height="132" viewBox="0 0 188 132" fill="none" className="mx-auto text-ink-faint" aria-hidden>
      <ellipse cx="94" cy="112" rx="54" ry="7" fill="rgba(23,23,23,0.05)" />
      <ellipse cx="94" cy="112" rx="30" ry="4" fill="rgba(23,23,23,0.045)" />
      <path d="M42 96h104" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M50 96v26M138 96v26" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
      <circle cx="94" cy="54" r="27" stroke="#B4553B" strokeWidth="1.4" strokeDasharray="3 7" strokeLinecap="round" opacity="0.75" />
      <circle cx="94" cy="54" r="3.4" fill="#B4553B" opacity="0.9" />
      <path d="M34 54h6M148 54h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
    </svg>
  )
}
