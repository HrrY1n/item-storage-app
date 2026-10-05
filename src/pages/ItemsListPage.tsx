import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { formatCents, formatCentsCompact, formatPurchaseDate, todayString } from '../domain/purchase'
import {
  DISPOSAL_METHOD_LABELS,
  ITEM_STATUS_LABELS,
  dailyCostOf,
  effectiveCostCents,
  ownershipDaysOf,
  statusOf,
  warrantyInfo,
} from '../domain/lifecycle'
import type { Item, ItemStatus } from '../domain/types'
import {
  useCategories,
  useItemTagLinks,
  useItems,
  usePresetAssetMap,
  useTags,
} from '../features/data/hooks'
import {
  categoryNameOf,
  filterAndSortItems,
  tagNamesOf,
  type ItemSortKey,
} from '../features/data/viewModels'
import { ObjectPlate } from '../components/ItemCard'
import { StatusChip } from '../components/StatusChip'
import WarrantyStrip from '../components/WarrantyStrip'
import TagChip from '../components/TagChip'
import EmptyState from '../components/EmptyState'

type ViewMode = 'grid' | 'list'

const SORTS: { key: ItemSortKey; label: string }[] = [
  { key: 'recent', label: '最近添加' },
  { key: 'name', label: '名称' },
  { key: 'cost', label: '总投入' },
  { key: 'daily', label: '日均成本' },
]

const STATUS_TABS: { key: ItemStatus; label: string }[] = [
  { key: 'owned', label: '持有' },
  { key: 'wishlist', label: '心愿' },
  { key: 'disposed', label: '处置' },
]

/** 卡片底部的一行小指标（数字在上、标签在下） */
function MiniMetric({ value, label, money }: { value: string; label: string; money?: boolean }) {
  return (
    <div className="min-w-0 flex-1 px-1 first:pl-0 last:pr-0">
      <p className={`num truncate text-caption ${money ? 'text-money' : 'text-ink-primary'}`}>{value}</p>
      <p className="mt-0.5 truncate text-[10px] leading-tight text-ink-tertiary">{label}</p>
    </div>
  )
}

/** 三种状态共用的卡片：图版是视觉中心，状态与关键指标按状态切换 */
function GridCard({
  item,
  to,
  iconUrl,
  categoryName,
  tagNames,
  today,
}: {
  item: Item
  to: string
  iconUrl: string
  categoryName: string
  tagNames: string[]
  today: string
}) {
  const status = statusOf(item)
  const days = ownershipDaysOf(item, today)
  const cost = effectiveCostCents(item)
  const daily = dailyCostOf(item, today)
  const sold = status === 'disposed' && item.disposalMethod === 'sold' && item.salePriceCents !== null

  const metrics =
    status === 'wishlist'
      ? []
      : [
          days !== null ? { v: `${days}`, l: status === 'disposed' ? '持有天数' : '持有天数' } : null,
          cost !== null
            ? { v: formatCentsCompact(cost), l: sold ? '实际成本' : '总投入' }
            : null,
          daily !== null ? { v: formatCentsCompact(daily), l: '日均成本', money: true } : null,
        ].filter((m): m is { v: string; l: string; money?: boolean } => m !== null)

  return (
    <Link
      to={to}
      className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-colors duration-150 ease-out-quint active:bg-surface-sunken"
    >
      <div className="relative">
        <ObjectPlate src={iconUrl} alt={item.name} className="aspect-[4/3] w-full" />
        {status !== 'owned' && (
          <span className="absolute left-2 top-2">
            <StatusChip status={status} size="sm" />
          </span>
        )}
        {/* 持有物品的保修信息由底部 WarrantyStrip 承担，图区不再叠加 chip */}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 min-h-[40px] text-item text-ink-primary">{item.name}</p>
        <p className="mt-0.5 truncate text-caption text-ink-tertiary">
          {status === 'disposed' && item.disposalMethod
            ? `${DISPOSAL_METHOD_LABELS[item.disposalMethod]} · ${
                item.disposedAt ? formatPurchaseDate(item.disposedAt) : '—'
              }`
            : categoryName}
        </p>
        {sold && (
          <p className="num mt-1 truncate text-caption text-success">
            出售回收 {formatCents(item.salePriceCents ?? 0)}
          </p>
        )}
        {tagNames.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tagNames.slice(0, 2).map((t) => (
              <TagChip key={t} name={t} size="sm" />
            ))}
          </div>
        )}
        {metrics.length > 0 && (
          <div
            className={`mt-auto grid border-t border-line-inner pt-2 ${
              metrics.length === 3 ? 'grid-cols-3 divide-x divide-line-inner' : 'grid-cols-2 gap-2'
            }`}
          >
            {metrics.map((m) => (
              <MiniMetric key={m.l} value={m.v} label={m.l} money={m.money} />
            ))}
          </div>
        )}
      </div>
      {/* 保修进度条：只有真正有保修数据的持有物品才出现，无保修卡片零空白 */}
      {status === 'owned' && item.warrantyExpiresAt !== null && (
        <WarrantyStrip item={item} today={today} />
      )}
    </Link>
  )
}

/** 列表视图：一行一件，横向信息密度更高 */
function ListRow({
  item,
  to,
  iconUrl,
  categoryName,
  today,
}: {
  item: Item
  to: string
  iconUrl: string
  categoryName: string
  today: string
}) {
  const status = statusOf(item)
  const days = ownershipDaysOf(item, today)
  const cost = effectiveCostCents(item)
  const daily = dailyCostOf(item, today)
  const warranty = warrantyInfo(item.warrantyExpiresAt, today)

  return (
    <Link
      to={to}
      className="flex min-h-[76px] items-center gap-3.5 px-4 py-2.5 transition-colors duration-150 active:bg-surface-sunken sm:hover:bg-surface-sunken"
    >
      <ObjectPlate src={iconUrl} alt={item.name} className="h-14 w-14 shrink-0 rounded-control border border-line-inner" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-item text-ink-primary">{item.name}</p>
          {status !== 'owned' && <StatusChip status={status} size="sm" />}
        </div>
        <p className="mt-0.5 truncate text-caption text-ink-tertiary">
          {status === 'disposed' && item.disposalMethod
            ? `${DISPOSAL_METHOD_LABELS[item.disposalMethod]} · ${
                item.disposedAt ? formatPurchaseDate(item.disposedAt) : '—'
              }`
            : categoryName}
        </p>
        <div className="num mt-1 flex items-baseline gap-2.5 text-caption">
          {days !== null && <span className="text-ink-tertiary">{days} 天</span>}
          {cost !== null && <span className="text-ink-primary">{formatCentsCompact(cost)}</span>}
          {daily !== null && <span className="text-money">{formatCentsCompact(daily)}/天</span>}
          {warranty !== null && status === 'owned' && (
            <span
              className={
                warranty.state === 'expiring'
                  ? 'text-danger'
                  : warranty.state === 'expired'
                    ? 'text-ink-faint'
                    : 'text-success'
              }
            >
              {warranty.label}
            </span>
          )}
        </div>
      </div>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-faint">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </Link>
  )
}

/**
 * 完整物品列表 —— 浏览全部物品的地方（概览页不再承担这个职责）。
 *
 * 顶部第一层是**生命周期**切换：持有 / 心愿 / 处置。
 * 这三个 tab 对应真实的数据字段，不是纯 UI 筛选。
 */
export default function ItemsListPage() {
  const items = useItems()
  const categories = useCategories()
  const tags = useTags()
  const links = useItemTagLinks()
  const assetMap = usePresetAssetMap()

  const [status, setStatus] = useState<ItemStatus>('owned')
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [sort, setSort] = useState<ItemSortKey>('recent')
  const [view, setView] = useState<ViewMode>('grid')

  // ⚠️ hooks 必须在任何 early return 之前全部调用完，否则顺序随加载状态变化会炸。
  // 筛选/排序逻辑本身在 viewModels.filterAndSortItems（纯函数，有回归测试）。
  const visible = useMemo(() => {
    if (!items || !categories || !links || !tags) return []
    return filterAndSortItems(items, categories, links, tags, {
      status,
      query,
      categoryId,
      sort,
    })
  }, [items, categories, links, tags, status, query, categoryId, sort])

  const loading = !items || !categories || !tags || !links || !assetMap
  if (loading) return null

  const today = todayString()

  const counts = {
    owned: items.filter((i) => statusOf(i) === 'owned').length,
    wishlist: items.filter((i) => statusOf(i) === 'wishlist').length,
    disposed: items.filter((i) => statusOf(i) === 'disposed').length,
  } satisfies Record<ItemStatus, number>

  const allCategories = categories.filter((c) => c.parentId === null)

  return (
    <div className="animate-fade-rise pt-[calc(24px+env(safe-area-inset-top))]">
      <header className="px-5">
        <h1 className="text-page-title text-ink-primary">物品管理</h1>
        <p className="mt-1.5 text-secondary text-ink-tertiary">
          <span className="num text-ink-primary">{counts[status]}</span> 件
          {ITEM_STATUS_LABELS[status]}物品
        </p>
      </header>

      {/* 生命周期切换：持有 / 心愿 / 处置 —— 对应真实数据字段 */}
      <div className="mt-5 px-5">
        <div className="flex gap-1.5">
          {STATUS_TABS.map((t) => {
            const active = status === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatus(t.key)}
                aria-pressed={active}
                className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-pill text-secondary transition-colors duration-150 ease-out-quint ${
                  active ? 'bg-ink-solid font-medium text-ink-inverse' : 'bg-surface-sunken text-ink-secondary'
                }`}
              >
                {t.label}
                <span className={`num text-[11px] ${active ? 'text-ink-inverse opacity-70' : 'text-ink-tertiary'}`}>
                  {counts[t.key]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 工具栏：搜索 / 分类 / 排序 / 视图 */}
      <div className="mt-4 px-5">
        <div className="field-shell flex h-11 items-center gap-2.5 rounded-control border border-line bg-surface px-3.5 transition-colors focus-within:border-line-strong">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-tertiary">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.8-3.8" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称、分类或标签"
            type="search"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink-primary outline-none placeholder:text-ink-faint"
          />
          {query !== '' && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清空"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-surface-sunken text-ink-secondary"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="no-scrollbar -mx-5 mt-3 flex items-center gap-1.5 overflow-x-auto px-5">
          <FilterChip active={categoryId === null} onClick={() => setCategoryId(null)}>
            全部分类
          </FilterChip>
          {allCategories.map((c) => (
            <FilterChip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
              {c.name}
            </FilterChip>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {SORTS.map((s) => (
              <FilterChip key={s.key} active={sort === s.key} onClick={() => setSort(s.key)}>
                {s.label}
              </FilterChip>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            aria-label={view === 'grid' ? '切换为列表视图' : '切换为网格视图'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-secondary transition-colors active:bg-surface-sunken"
          >
            {view === 'grid' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
                <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
                <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
                <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* 结果 */}
      <div className="mt-4 px-5">
        {visible.length === 0 ? (
          <EmptyState
            title={items.length === 0 ? '还没有物品' : `没有${ITEM_STATUS_LABELS[status]}物品`}
            subtitle={
              query !== ''
                ? `没有匹配「${query.trim()}」的物品`
                : status === 'wishlist'
                  ? '把将来想买的东西记下来，购入后再转为持有'
                  : status === 'disposed'
                    ? '处置掉的物品会留在这里，持有天数已冻结'
                    : '点右下角的 + 添加第一件物品'
            }
          />
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 gap-3 pb-2 lg:grid-cols-3">
            {visible.map((item) => (
              <GridCard
                key={item.id}
                item={item}
                to={`/items/${item.id}`}
                iconUrl={assetMap.get(item.iconAssetId) ?? '/icons/items/other.svg'}
                categoryName={categoryNameOf(categories, item.categoryId)}
                tagNames={tagNamesOf(item.id, links, tags)}
                today={today}
              />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-line-inner overflow-hidden rounded-surface border border-line bg-surface shadow-card">
            {visible.map((item) => (
              <ListRow
                key={item.id}
                item={item}
                to={`/items/${item.id}`}
                iconUrl={assetMap.get(item.iconAssetId) ?? '/icons/items/other.svg'}
                categoryName={categoryNameOf(categories, item.categoryId)}
                today={today}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-8 shrink-0 items-center whitespace-nowrap rounded-pill px-3 text-caption transition-colors duration-150 ease-out-quint ${
        active ? 'bg-ink-solid font-medium text-ink-inverse' : 'bg-surface-sunken text-ink-secondary'
      }`}
    >
      {children}
    </button>
  )
}
