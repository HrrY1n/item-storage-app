import { Link, useNavigate } from 'react-router'
import { childrenOf } from '../domain/categoryTree'
import { formatCents, formatCentsCompact, todayString } from '../domain/purchase'
import { categoryDistribution, dashboardStats, expiringWarranties, isOwned } from '../domain/lifecycle'
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
  itemMetric,
  tagNamesOf,
} from '../features/data/viewModels'
import ItemCard from '../components/ItemCard'
import {
  SHARED_OBJECT_NAME,
  navigateWithViewTransition,
  supportsViewTransition,
} from '../features/ui/viewTransition'
import SectionHeader from '../components/SectionHeader'
import CategoryCard from '../components/CategoryCard'
import TagChip from '../components/TagChip'

/** 概览格：数字在上、标签在下。刻意压低字号——它们是背景信息，不是结论 */
function StatCell({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="min-w-0 flex-1 px-3.5 py-3">
      <p className={`num truncate text-item ${money ? 'text-money' : 'text-ink-primary'}`}>{value}</p>
      <p className="mt-1 truncate text-caption text-ink-tertiary">{label}</p>
    </div>
  )
}

/** 分类分布条：纯 CSS，不引入任何图表库 */
function DistributionBar({
  name,
  count,
  ratio,
  onClick,
}: {
  name: string
  count: number
  ratio: number
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 py-1.5 text-left">
      <span className="w-[68px] shrink-0 truncate text-caption text-ink-secondary">{name}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-sunken">
        <span
          className="block h-full rounded-pill bg-accent transition-[width] duration-500 ease-out-quint"
          style={{ width: `${Math.max(4, Math.round(ratio * 100))}%` }}
        />
      </span>
      <span className="num w-6 shrink-0 text-right text-caption text-ink-tertiary">{count}</span>
    </button>
  )
}

/**
 * 概览 / Dashboard。
 *
 * 定位：**不再承担"完整物品列表"的职责**（那是 /items 的活）。
 * 它回答四个问题：我的东西投入了多少 / 有多少 / 有什么要马上处理 / 最近在做什么。
 *
 * 信息层级（从高到低）：
 *   ① 持有中总投入（唯一的大数字）
 *   ② 三个关键指标
 *   ③ 保修到期提醒（**有事才出现**）
 *   ④ 分类分布
 *   ⑤ 最近添加
 *   ⑥ 出售回收摘要 / 分类速览 / 常用标签（最低权重）
 */
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

  const today = todayString()
  const stats = dashboardStats(items, categories, today)
  const distribution = categoryDistribution(items, categories)
  const expiring = expiringWarranties(items, today)
  const recent = items.slice(0, 6)
  const roots = childrenOf(categories, null)
  const owned = items.filter(isOwned)
  // 分类计数要**包含子分类**（computeCategoryCounts 会沿 parentId 向上累加），
  // 否则「数码与电子」这类父分类会显示成 0 件。
  const categoryCounts = computeCategoryCounts(owned, categories)

  const totalText =
    stats.totalInvestmentCents !== null ? formatCentsCompact(stats.totalInvestmentCents) : null
  const dailyText = stats.dailyTotalCents !== null ? formatCentsCompact(stats.dailyTotalCents) : null

  return (
    <div className="animate-fade-rise pt-[calc(24px+env(safe-area-inset-top))]">
      {/* 页头：标题 + 副标题 + 齿轮（设置从底栏移到这里） */}
      <header className="flex items-start gap-3 px-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-page-title text-ink-primary">概览</h1>
          <p className="mt-1.5 text-secondary text-ink-tertiary">
            共 <span className="num text-ink-primary">{items.length}</span> 件物品
            {stats.wishlistCount > 0 && <> · 心愿 {stats.wishlistCount}</>}
            {stats.disposedCount > 0 && <> · 已处置 {stats.disposedCount}</>}
          </p>
        </div>
        <Link
          to="/settings"
          aria-label="设置"
          className="-mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-pill text-ink-tertiary transition-colors duration-150 active:bg-surface-sunken sm:hover:text-ink-primary"
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.1 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9v-.1a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="animate-fade-rise px-8 pt-10 text-center">
          <EmptyPlinthHero />
          <p className="mt-7 text-title-card text-ink-primary">还没有物品</p>
          <p className="mx-auto mt-2.5 max-w-[268px] text-body leading-relaxed text-ink-tertiary">
            添加第一件物品，开始建立你的私人物品库。
          </p>
          <Link
            to="/items/new"
            className="mt-7 inline-flex h-12 items-center gap-2 rounded-pill bg-ink-solid px-7 text-body font-medium text-ink-inverse shadow-fab transition-transform duration-200 ease-out-quint active:scale-[0.97] sm:hover:-translate-y-0.5"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加物品
          </Link>
        </div>
      ) : (
        <>
          {/* ① 持有中总投入 + ② 三个关键指标 */}
          <section className="mt-6 px-5">
            <div className="overflow-hidden rounded-surface border border-line bg-surface shadow-card">
              <div className="px-4 pb-4 pt-4">
                <p className="text-label text-money-deep">持有中总投入</p>
                {totalText !== null ? (
                  <>
                    <p className="num mt-1.5 text-metric-lg text-ink-primary">{totalText}</p>
                    <p className="mt-1.5 text-caption text-ink-tertiary">
                      来自 <span className="num">{stats.pricedOwnedCount}</span> 件已记录价格的物品
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-body leading-relaxed text-ink-tertiary">
                    还没有记录价格 —— 给物品补上购买价格，这里会显示总投入。
                  </p>
                )}
              </div>
              <div className="flex divide-x divide-line-inner border-t border-line">
                <StatCell label="持有物品" value={String(stats.ownedCount)} />
                <StatCell label="分类数量" value={String(stats.categoryCount)} />
                <StatCell label="日均总成本" value={dailyText ?? '—'} money={dailyText !== null} />
              </div>
            </div>
          </section>

          {/* ③ 保修 / 到期提醒：只统计持有中，且只在有事时出现 */}
          {expiring.length > 0 && (
            <section className="mt-3 px-5">
              <div className="rounded-surface border border-danger-soft bg-danger-soft px-4 py-3.5">
                <p className="text-label text-danger">
                  <span className="num">{expiring.length}</span> 件物品将在 30 天内过保
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {expiring.slice(0, 4).map(({ item, info }) => (
                    <Link
                      key={item.id}
                      to={`/items/${item.id}`}
                      className="inline-flex items-center gap-1.5 rounded-pill bg-surface px-2.5 py-1 text-caption text-ink-secondary transition-colors active:bg-surface-sunken"
                    >
                      <span className="max-w-[112px] truncate">{item.name}</span>
                      <span className="num text-ink-tertiary">{info.detail}</span>
                    </Link>
                  ))}
                  {expiring.length > 4 && (
                    <span className="num self-center text-caption text-danger">
                      +{expiring.length - 4}
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ④ 分类分布：纯 CSS 条 */}
          {distribution.length > 0 && (
            <section className="mt-8 px-5">
              <SectionHeader title="分类分布" />
              <div className="rounded-surface border border-line bg-surface px-3.5 py-2.5 shadow-card">
                {distribution.slice(0, 5).map((d) => (
                  <DistributionBar
                    key={d.categoryId}
                    name={d.name}
                    count={d.count}
                    ratio={d.ratio}
                    onClick={() => navigate(`/categories/${d.categoryId}`)}
                  />
                ))}
                {distribution.length > 5 && (
                  <p className="pt-2 text-caption text-ink-tertiary">
                    另有 {distribution.length - 5} 个分类
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ⑤ 最近添加 */}
          <section className="mt-8">
            <div className="px-5">
              <SectionHeader
                title="最近添加"
                action={
                  <Link
                    to="/items"
                    className="group inline-flex items-center gap-1 text-secondary text-ink-tertiary transition-colors active:opacity-60 sm:hover:text-ink-primary"
                  >
                    全部
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 ease-out-quint sm:group-hover:translate-x-0.5">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </Link>
                }
              />
            </div>
            <div className="no-scrollbar flex items-stretch gap-3.5 overflow-x-auto px-5 pb-1">
              {recent.map((item) => {
                const m = itemMetric(item, today)
                return (
                  <ItemCard
                    key={item.id}
                    to={`/items/${item.id}`}
                    name={item.name}
                    iconUrl={assetMap.get(item.iconAssetId) ?? '/icons/items/other.svg'}
                    categoryName={categoryNameOf(categories, item.categoryId)}
                    tagNames={tagNamesOf(item.id, links, tags)}
                    metric={
                      m && { daysText: m.daysText, totalText: m.totalText, dailyText: m.dailyText }
                    }
                    className="w-[204px] shrink-0"
                    onNavigate={(e) => {
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
                )
              })}
            </div>
          </section>

          {/* ⑤b 出售回收摘要：低视觉权重，不与主指标争注意力 */}
          {stats.saleCount > 0 && (
            <section className="mt-6 px-5">
              <div className="flex items-center justify-between rounded-surface border border-line bg-surface px-4 py-3 shadow-card">
                <div>
                  <p className="text-caption text-ink-tertiary">累计出售回收</p>
                  <p className="num mt-1 text-item text-ink-primary">
                    {formatCents(stats.saleProceedsCents ?? 0)}
                  </p>
                </div>
                <p className="text-caption text-ink-tertiary">
                  已出售 <span className="num text-ink-secondary">{stats.saleCount}</span> 件
                </p>
              </div>
            </section>
          )}

          {/* ⑥ 分类速览：只列出真正有持有物品的分类 */}
          {roots.some((c) => (categoryCounts.get(c.id) ?? 0) > 0) && (
            <section className="mt-8 px-5">
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
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {roots
                  .filter((c) => (categoryCounts.get(c.id) ?? 0) > 0)
                  .slice(0, 6)
                  .map((c) => (
                    <CategoryCard key={c.id} category={c} count={categoryCounts.get(c.id) ?? 0} />
                  ))}
              </div>
            </section>
          )}

          {/* 常用标签 */}
          {tags.length > 0 && (
            <section className="mt-8 px-5">
              <SectionHeader title="常用标签" />
              <div className="flex flex-wrap gap-2">
                {tags.slice(0, 8).map((tag) => (
                  <TagChip
                    key={tag.id}
                    name={tag.name}
                    onClick={() => navigate(`/search?tag=${tag.id}`)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** 空状态的原创插画（比通用空状态更大，作为第一印象的视觉锚点） */
function EmptyPlinthHero() {
  return (
    <svg width="188" height="132" viewBox="0 0 188 132" fill="none" className="mx-auto text-ink-faint" aria-hidden>
      <ellipse cx="94" cy="112" rx="54" ry="7" className="fill-ink-primary opacity-[0.06]" />
      <ellipse cx="94" cy="112" rx="30" ry="4" className="fill-ink-primary opacity-[0.05]" />
      <path d="M42 96h104" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M50 96v26M138 96v26" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
      <circle cx="94" cy="54" r="27" className="stroke-accent" strokeWidth="1.4" strokeDasharray="3 7" strokeLinecap="round" opacity="0.8" />
      <circle cx="94" cy="54" r="3.4" className="fill-accent" opacity="0.95" />
      <path d="M34 54h6M148 54h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
    </svg>
  )
}
