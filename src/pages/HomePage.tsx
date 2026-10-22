import { Link, useLocation, useNavigate } from 'react-router'
import { childrenOf } from '../domain/categoryTree'
import { formatCents, formatCentsCompact, todayString } from '../domain/purchase'
import { categoryDistribution, dashboardStats, expiringWarranties, isOwned } from '../domain/lifecycle'
import { useCategories, useItemTagLinks, useItems, usePresetAssetMap, useTags } from '../features/data/hooks'
import { categoryNameOf, computeCategoryCounts, tagNamesOf } from '../features/data/viewModels'
import ItemCard from '../components/ItemCard'
import SectionHeader from '../components/SectionHeader'
import CategoryCard from '../components/CategoryCard'
import TagChip from '../components/TagChip'

function StatCell({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="min-w-0 flex-1 px-3.5 py-3.5 sm:px-6">
      <p className={`num text-item ${money ? 'text-money' : 'text-ink-primary'}`}>{value}</p>
      <p className="mt-1 text-caption text-ink-tertiary">{label}</p>
    </div>
  )
}

function DistributionBar({ name, count, ratio, onClick }: { name: string; count: number; ratio: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-h-11 w-full items-center gap-3 rounded-control px-1 text-left">
      <span className="w-24 shrink-0 truncate text-caption text-ink-secondary group-hover:text-accent" title={name}>{name}</span>
      <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-sunken">
        <span className="block h-full rounded-pill bg-accent" style={{ width: `${Math.max(4, Math.round(ratio * 100))}%` }} />
      </span>
      <span className="num w-6 shrink-0 text-right text-caption text-ink-tertiary">{count}</span>
    </button>
  )
}

export default function HomePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const items = useItems()
  const categories = useCategories()
  const tags = useTags()
  const links = useItemTagLinks()
  const assetMap = usePresetAssetMap()

  if (!items || !categories || !tags || !links || !assetMap) {
    return <div className="pt-[calc(24px+env(safe-area-inset-top))]" />
  }

  const today = todayString()
  const stats = dashboardStats(items, categories, today)
  const distribution = categoryDistribution(items, categories)
  const expiring = expiringWarranties(items, today)
  const recent = items.slice(0, 6)
  const roots = childrenOf(categories, null)
  const owned = items.filter(isOwned)
  const displayItems = owned.slice(0, 3)
  const categoryCounts = computeCategoryCounts(owned, categories)
  const totalText = stats.totalInvestmentCents !== null ? formatCentsCompact(stats.totalInvestmentCents) : null
  const dailyText = stats.dailyTotalCents !== null ? formatCentsCompact(stats.dailyTotalCents) : null

  return (
    <div className="animate-fade-rise px-5 pt-[calc(28px+env(safe-area-inset-top))] sm:px-7 lg:pt-7">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page-title text-ink-primary">概览</h1>
          <p className="mt-2 text-secondary text-ink-tertiary">
            共 <span className="num text-ink-secondary">{items.length}</span> 件物品
            {stats.wishlistCount > 0 && <> · 心愿 {stats.wishlistCount}</>}
            {stats.disposedCount > 0 && <> · 已处置 {stats.disposedCount}</>}
          </p>
        </div>
        <Link to="/settings" aria-label="设置" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-line bg-surface text-ink-secondary transition-colors active:bg-surface-sunken hover:text-accent lg:hidden">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" className="fill-surface" /><circle cx="15" cy="17" r="3" className="fill-surface" />
          </svg>
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="mx-auto max-w-lg pb-10 pt-16 text-center sm:pt-24">
          <EmptyPlinthHero />
          <h2 className="mt-8 text-title-card text-ink-primary">还没有物品</h2>
          <p className="mx-auto mt-3 max-w-[280px] text-body text-ink-tertiary">从一件喜欢的物品开始，慢慢建立你的私人物品档案。</p>
          <Link to="/items/new" className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-pill bg-ink-solid px-7 text-secondary font-medium text-ink-inverse transition-transform active:scale-[0.97]">
            <span aria-hidden className="text-xl">＋</span>添加物品
          </Link>
        </div>
      ) : (
        <>
          <section aria-label="持有概况" className="hero-surface mt-6 overflow-hidden rounded-sheet border border-hero-line">
            <div className={`grid items-center gap-2 px-5 py-5 sm:gap-5 sm:px-7 sm:py-6 ${displayItems.length > 0 ? 'grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:grid-cols-2' : ''}`}>
              <div className="relative z-[2] min-w-0">
                <p className="text-caption text-money-deep">持有中总投入</p>
                {totalText !== null ? (
                  <>
                    <p className="num mt-3 break-words text-metric-lg text-ink-primary">{totalText}</p>
                    <p className="mt-3 max-w-[240px] text-caption leading-relaxed text-ink-secondary">来自 <span className="num">{stats.pricedOwnedCount}</span> 件已记录价格的物品</p>
                  </>
                ) : (
                  <p className="mt-3 max-w-xs text-secondary leading-relaxed text-ink-secondary">给物品补上购买价格，在这里了解你的投入。</p>
                )}
              </div>
              {displayItems.length > 0 && (
                <div className="overview-objects" aria-hidden>
                  {displayItems.map(item => <img key={item.id} src={assetMap.get(item.iconAssetId) ?? '/icons/items/other.webp'} alt="" className="overview-object" draggable={false} />)}
                </div>
              )}
            </div>
            <div className="flex divide-x divide-hero-line border-t border-hero-line">
              <StatCell label="持有物品" value={String(stats.ownedCount)} />
              <StatCell label="分类数量" value={String(stats.categoryCount)} />
              <StatCell label="日均总成本" value={dailyText ?? '—'} money={dailyText !== null} />
            </div>
          </section>

          {expiring.length > 0 && (
            <section aria-label="保修提醒" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-danger-soft px-4 py-3">
              <p className="shrink-0 text-caption text-danger"><span className="num">{expiring.length}</span> 件物品将在 30 天内过保</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {expiring.slice(0, 4).map(({ item, info }) => (
                  <Link key={item.id} to={`/items/${item.id}`} state={{ itemBackground: location }} className="inline-flex min-h-6 items-center gap-1.5 text-caption text-ink-secondary underline decoration-line-strong underline-offset-4 hover:text-danger">
                    <span className="max-w-[120px] truncate">{item.name}</span><span className="num text-ink-tertiary">{info.detail}</span>
                  </Link>
                ))}
                {expiring.length > 4 && <span className="num text-caption text-danger">+{expiring.length - 4}</span>}
              </div>
            </section>
          )}

          <div className="mt-8 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className="min-w-0" aria-labelledby="recent-items-title">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h2 id="recent-items-title" className="text-section text-ink-primary">最近添加</h2>
                <Link to="/items" className="inline-flex min-h-8 items-center gap-2 text-caption text-ink-secondary transition-colors hover:text-accent">查看全部<span aria-hidden>↗</span></Link>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                {recent.map(item => (
                  <ItemCard
                    key={item.id}
                    to={`/items/${item.id}`}
                    name={item.name}
                    iconUrl={assetMap.get(item.iconAssetId) ?? '/icons/items/other.webp'}
                    categoryName={categoryNameOf(categories, item.categoryId)}
                    tagNames={tagNamesOf(item.id, links, tags)}
                    item={item}
                    today={today}
                    summary
                  />
                ))}
              </div>
            </section>

            <aside className="min-w-0 space-y-7" aria-label="物品洞察">
              {distribution.length > 0 && (
                <section>
                  <SectionHeader title="分类分布" />
                  <div className="rounded-surface border border-line bg-surface px-4 py-2">
                    {distribution.slice(0, 5).map(d => <DistributionBar key={d.categoryId} name={d.name} count={d.count} ratio={d.ratio} onClick={() => navigate(`/categories/${d.categoryId}`)} />)}
                    {distribution.length > 5 && <p className="pb-2 pt-1 text-caption text-ink-tertiary">另有 {distribution.length - 5} 个分类</p>}
                  </div>
                </section>
              )}
              {stats.saleCount > 0 && (
                <section className="flex items-center justify-between gap-3 rounded-surface border border-line bg-surface px-4 py-4">
                  <div><h2 className="text-caption text-ink-secondary">累计出售回收</h2><p className="num mt-2 text-section text-ink-primary">{formatCents(stats.saleProceedsCents ?? 0)}</p></div>
                  <p className="text-caption text-ink-tertiary">已出售 {stats.saleCount} 件</p>
                </section>
              )}
              {tags.length > 0 && (
                <section>
                  <SectionHeader title="常用标签" />
                  <div className="flex flex-wrap gap-2">{tags.slice(0, 8).map(tag => <TagChip key={tag.id} name={tag.name} onClick={() => navigate(`/search?tag=${tag.id}`)} />)}</div>
                </section>
              )}
            </aside>
          </div>

          {roots.some(c => (categoryCounts.get(c.id) ?? 0) > 0) && (
            <section className="mt-9">
              <SectionHeader title="分类" action={<Link to="/categories" className="inline-flex min-h-8 items-center gap-2 text-caption text-ink-secondary hover:text-accent">全部分类<span aria-hidden>↗</span></Link>} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {roots.filter(c => (categoryCounts.get(c.id) ?? 0) > 0).slice(0, 6).map(c => <CategoryCard key={c.id} category={c} count={categoryCounts.get(c.id) ?? 0} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function EmptyPlinthHero() {
  return (
    <svg width="188" height="132" viewBox="0 0 188 132" fill="none" className="mx-auto text-ink-faint" aria-hidden>
      <ellipse cx="94" cy="112" rx="54" ry="7" className="fill-ink-primary opacity-[0.06]" />
      <path d="M42 96h104M50 96v26M138 96v26" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="94" cy="54" r="27" className="stroke-accent" strokeWidth="1.4" strokeDasharray="3 7" strokeLinecap="round" opacity="0.8" />
      <circle cx="94" cy="54" r="3.4" className="fill-accent" />
    </svg>
  )
}
