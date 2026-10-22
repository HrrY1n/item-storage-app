import { useCallback, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { todayString } from '../domain/purchase'
import {
  ITEM_STATUS_LABELS,
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
import {
  DISPOSITION_BADGE_LABELS,
  dispositionCounts,
  itemPresentation,
  matchesDispositionFilter,
  type DispositionKind,
} from '../features/data/itemPresentation'
import ItemCard, { ObjectPlate } from '../components/ItemCard'
import { DisposalChip, FINANCE_TONES, StatusChip } from '../components/StatusChip'
import SegmentedControl from '../components/SegmentedControl'
import EmptyState from '../components/EmptyState'

type ViewMode = 'grid' | 'list'

const SORTS: { key: ItemSortKey; label: string }[] = [
  { key: 'recent', label: '最近添加' },
  { key: 'name', label: '名称' },
  // 已售出物品按净成本排序，标签随状态切换。
  { key: 'cost', label: '总投入' },
  { key: 'daily', label: '日均成本' },
]

const STATUS_TABS: { key: ItemStatus; label: string }[] = [
  { key: 'owned', label: '持有' },
  { key: 'wishlist', label: '心愿' },
  { key: 'disposed', label: '处置' },
]

/**
 * Large Title 与副标题的词表。
 *
 * ⚠️ 刻意**不做** `${title}物品` 这种拼接 —— 那会产出「已处置物品物品」。
 * 每种lifecycle 的两个词都显式给出，副标题只拼数量。
 */
const PAGE_WORDS: Record<ItemStatus, { title: string; unit: string }> = {
  owned: { title: '我的物品', unit: '持有物品' },
  wishlist: { title: '心愿物品', unit: '心愿物品' },
  disposed: { title: '已处置物品', unit: '已处置物品' },
}

/** 处置二级筛选项，文案取自 domain 的三个真实枚举值。 */
const DISPOSITION_FILTERS: { key: DispositionKind | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'sold', label: DISPOSITION_BADGE_LABELS.sold },
  { key: 'discarded', label: DISPOSITION_BADGE_LABELS.discarded },
  { key: 'other', label: DISPOSITION_BADGE_LABELS.other },
]

/**
 * 列表视图：一行一件，横向信息密度更高。
 *
 * ⚠️ Phase 2H.2（勘误 FIX-B）：**与 Grid Card 使用同一个 `itemPresentation`**，
 * 因此指标与财务口径**完全一致** —— Grid 与 List 只能改布局，不能改口径。
 * 列表行额外加回分类名（横向有空间），且**不**在缩略图上叠文字 overlay
 * （52px 上放字不可读），方法语义交给缩略图右下角的 sm 徽标。
 */
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
  const location = useLocation()
  const p = itemPresentation(item, { today, categoryName })
  const warranty = warrantyInfo(item.warrantyExpiresAt, today)
  const isDisposed = p.badge !== null

  return (
    <Link
      to={to}
      state={{ itemBackground: location }}
      className="flex min-h-[76px] items-center gap-3.5 px-4 py-2.5 transition-colors duration-150 active:bg-surface-sunken sm:hover:bg-surface-sunken"
    >
      <div className="relative shrink-0">
        <ObjectPlate
          src={iconUrl}
          alt={item.name}
          className="h-14 w-14 rounded-control border border-line-inner"
        />
        {/* 处置方法徽标放缩略图右下角；心愿仍用生命周期 chip */}
        {isDisposed ? (
          <span className="absolute -bottom-1 -right-1">
            <DisposalChip method={p.badge!} size="sm" />
          </span>
        ) : (
          statusOf(item) !== 'owned' && (
            <span className="absolute -bottom-1 -right-1">
              <StatusChip status={statusOf(item)} size="sm" />
            </span>
          )
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-item text-ink-primary">{item.name}</p>
        {/* 处置态补回分类名（横向空间够）；非处置态就是分类名 */}
        <p className="mt-0.5 truncate text-caption text-ink-tertiary">
          {isDisposed ? `${p.subtitle} · ${categoryName}` : p.subtitle}
        </p>
        {/* 指标：与 Grid 完全相同的口径，仅排版改为内联 */}
        {p.metrics.length > 0 && (
          <div className="num mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-caption">
            {p.metrics.map((m) => (
              <span key={m.label} className="inline-flex items-baseline gap-1">
                <span className={m.money ? 'text-money' : 'text-ink-primary'}>{m.value}</span>
                <span className="text-ink-tertiary">{m.label}</span>
              </span>
            ))}
            {warranty !== null && statusOf(item) === 'owned' && (
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
        )}
        {/* 财务行：仅已售出。同样不显示「实际持有成本」。*/}
        {p.finance !== null && (
          <div className="num mt-0.5 flex items-baseline gap-2.5 text-caption">
            {p.grossText !== null && (
              <span className="text-ink-tertiary">
                总投入 <span className="text-ink-secondary">{p.grossText}</span>
              </span>
            )}
            <span className={FINANCE_TONES[p.finance.tone]}>{p.finance.value}</span>
          </div>
        )}
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
  /**
   * 处置二级筛选 —— **纯 React UI 状态**。
   * 不写 URL、不写 IndexedDB、不进 sync/D1，因为它不是业务数据。
   */
  const [disposition, setDisposition] = useState<DispositionKind | 'all'>('all')

  /** 切换生命周期时重置处置筛选，避免"心愿 tab 下遗留 sold 筛选"这种隐藏态 */
  const handleStatusChange = useCallback((next: ItemStatus) => {
    setStatus(next)
    setDisposition('all')
  }, [])

  // ⚠️ hooks 必须在任何 early return 之前全部调用完，否则顺序随加载状态变化会炸。
  // 筛选/排序逻辑本身在 viewModels.filterAndSortItems（纯函数，有回归测试）。
  const visible = useMemo(() => {
    if (!items || !categories || !links || !tags) return []
    const base = filterAndSortItems(items, categories, links, tags, {
      status,
      query,
      categoryId,
      sort,
    })
    // 处置二级筛选：仅在处置 tab 生效
    return status === 'disposed'
      ? base.filter((i) => matchesDispositionFilter(i, disposition))
      : base
  }, [items, categories, links, tags, status, query, categoryId, sort, disposition])

  /**
   * 处置方式分桶计数（仅处置 tab 用）。
   *
   * ⚠️⚠️ 必须放在 `if (loading) return null` **之前** ——
   *   放在之后会构成 hooks 顺序违规（React error #310：
   *   "rendered more hooks than during the previous render"），
   *   首屏 loading 时返回、第二次渲染才调用useMemo，hook 数量对不上 → 整页白屏。
   *   这个坑 typecheck 和 vitest 都抓不到，只有真浏览器能发现。
   */
  const dispCounts = useMemo(
    () => (items == null ? null : dispositionCounts(items)),
    [items],
  )

  const loading = !items || !categories || !tags || !links || !assetMap
  if (loading) return null

  const today = todayString()

  const counts = {
    owned: items.filter((i) => statusOf(i) === 'owned').length,
    wishlist: items.filter((i) => statusOf(i) === 'wishlist').length,
    disposed: items.filter((i) => statusOf(i) === 'disposed').length,
  } satisfies Record<ItemStatus, number>

  const words = PAGE_WORDS[status]
  const allCategories = categories.filter((c) => c.parentId === null)
  const filtered = query.trim() !== '' || categoryId !== null || (status === 'disposed' && disposition !== 'all')

  return (
    <div className="animate-fade-rise px-5 pt-[calc(28px+env(safe-area-inset-top))] sm:px-7 lg:pt-7">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-page-title text-ink-primary">{words.title}</h1>
          <p className="mt-1.5 text-secondary text-ink-tertiary">
            <span className="num text-ink-primary">{counts[status]}</span> 件{words.unit}
          </p>
        </div>
        <div className="w-full sm:max-w-[300px]">
          <SegmentedControl
            ariaLabel="物品状态"
            value={status}
            onChange={handleStatusChange}
            options={STATUS_TABS.map((t) => ({
              value: t.key,
              label: t.label,
              hint: String(counts[t.key]),
            }))}
          />
        </div>
      </header>

      {/* 处置二级筛选：**仅处置 tab 出现**。
          视觉上与生命周期控件成组（间距 mt-2，比下方工具栏的 mt-4 更紧），
          读起来是"生命周期轴的下钻"而不是另一个平级筛选器。
          0 数量显示但禁用 —— 隐藏会让控件宽度在切换时跳动。*/}
      {status === 'disposed' && dispCounts !== null && (
        <div className="mt-3 sm:ml-auto sm:max-w-[360px]">
          <SegmentedControl
            ariaLabel="处置方式"
            value={disposition}
            onChange={setDisposition}
            options={DISPOSITION_FILTERS.map((f) => ({
              value: f.key,
              label: f.label,
              hint: String(dispCounts[f.key]),
              // 0 数量显示但禁用；「全部」永远可选
              disabled: f.key !== 'all' && dispCounts[f.key] === 0,
            }))}
          />
        </div>
      )}

      {/* 工具栏：搜索 / 分类 / 排序 / 视图 */}
      <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center lg:gap-3">
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
            aria-label="搜索物品"
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

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_42px] gap-2 lg:mt-0">
          <select aria-label="分类筛选" value={categoryId ?? ''} onChange={(event) => setCategoryId(event.target.value || null)} className="collection-select">
            <option value="">全部分类</option>
            {allCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <select aria-label="物品排序" value={sort} onChange={(event) => setSort(event.target.value as ItemSortKey)} className="collection-select">
            {SORTS.map(option => <option key={option.key} value={option.key}>{option.key === 'cost' && status === 'disposed' ? '实际持有成本' : option.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            aria-label={view === 'grid' ? '切换为列表视图' : '切换为网格视图'}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-control border border-line bg-surface text-ink-secondary transition-colors active:bg-surface-sunken hover:text-accent"
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
      <div className="mt-5">
        {filtered && (
          <div className="mb-4 flex min-h-8 items-center justify-between gap-3 text-caption">
            <p role="status" className="text-ink-tertiary">找到 <span className="num text-ink-secondary">{visible.length}</span> 件物品</p>
            <button type="button" onClick={() => { setQuery(''); setCategoryId(null); setDisposition('all') }} className="min-h-8 text-accent hover:underline">重置筛选</button>
          </div>
        )}
        {visible.length === 0 ? (
          <EmptyState
            title={filtered ? '没有匹配的物品' : items.length === 0 ? '还没有物品' : `没有${ITEM_STATUS_LABELS[status]}物品`}
            subtitle={
              query !== ''
                ? `没有匹配「${query.trim()}」的物品`
                : filtered
                  ? '试试其他分类，或重置筛选查看全部物品'
                  : status === 'wishlist'
                  ? '把将来想买的东西记下来，购入后再转为持有'
                  : status === 'disposed'
                    ? '处置掉的物品会留在这里，持有天数已冻结'
                    : '通过「新增物品」记录第一件物品'
            }
          />
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 gap-3 pb-2 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
            {visible.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                name={item.name}
                to={`/items/${item.id}`}
                iconUrl={assetMap.get(item.iconAssetId) ?? '/icons/items/other.webp'}
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
                iconUrl={assetMap.get(item.iconAssetId) ?? '/icons/items/other.webp'}
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
