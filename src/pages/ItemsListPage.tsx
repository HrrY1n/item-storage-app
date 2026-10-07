import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
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
import { FinanceLine, MetricRow, ObjectPlate } from '../components/ItemCard'
import { DisposalChip, DisposalOverlay, FINANCE_TONES, StatusChip } from '../components/StatusChip'
import WarrantyStrip from '../components/WarrantyStrip'
import SegmentedControl from '../components/SegmentedControl'
import TagChip from '../components/TagChip'
import EmptyState from '../components/EmptyState'

type ViewMode = 'grid' | 'list'

const SORTS: { key: ItemSortKey; label: string }[] = [
  { key: 'recent', label: '最近添加' },
  { key: 'name', label: '名称' },
  // ⚠️ 这���的标签**随 lifecycle 变**（见 §12）：cost 实际按 `effectiveCostCents` 排，
  //   对已出售物品而言那是**净成本**，标成「总投入」是错的。
  { key: 'cost', label: '总投入' },
  { key: 'daily', label: '日均成本' },
]

const STATUS_TABS: { key: ItemStatus; label: string }[] = [
  { key: 'owned', label: '持有' },
  { key: 'wishlist', label: '心愿' },
  { key: 'disposed', label: '处置' },
]

/**
 * Large Title 与副标题的词表（设计 §5.1）。
 *
 * ⚠️ 刻意**不做** `${title}物品` 这种拼接 —— 那会产出「已处置物品物品」。
 * 每种lifecycle 的两个词都显式给出，副标题只拼数量。
 */
const PAGE_WORDS: Record<ItemStatus, { title: string; unit: string }> = {
  owned: { title: '我的物品', unit: '持有物品' },
  wishlist: { title: '心愿物品', unit: '心愿物品' },
  disposed: { title: '已处置物品', unit: '已处置物品' },
}

/** 处置二级筛选项（设计 §6）—— 文案取自 domain 的三个真实枚举值 */
const DISPOSITION_FILTERS: { key: DispositionKind | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'sold', label: DISPOSITION_BADGE_LABELS.sold },
  { key: 'discarded', label: DISPOSITION_BADGE_LABELS.discarded },
  { key: 'other', label: DISPOSITION_BADGE_LABELS.other },
]

/**
 * ⚠️ `MiniMetric` 已删除。
 *
 * 它带 `truncate`，会把金额截成 `¥1,47…`（设计 §14 F1），
 * 且它自己的标签是硬编码的 —— 正是 §1.4 语义分叉的来源之一。
 * 现在统一改用 `ItemCard` 导出的 `MetricRow` / `FinanceLine`，
 * 与 `components/ItemCard` 逐像素同源。
 */

/**
 * 三种状态共用的卡片：图版是视觉中心，状态与关键指标按状态切换。
 *
 * Phase 2H.2：全部展示逻辑来自 `itemPresentation(item)` ——
 * **本地不再有任何 `sold ? 'xxx' : 'xxx'` 的硬编码**（§1.4 的语义分叉根因）。
 * 与 `components/ItemCard` 共用 `MetricRow` / `FinanceLine`，逐像素同源。
 */
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
  const p = itemPresentation(item, { today, categoryName })

  return (
    <Link
      to={to}
      className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-colors duration-150 ease-out-quint active:bg-surface-sunken"
    >
      <div className="relative">
        <ObjectPlate src={iconUrl} alt={item.name} className="aspect-[4/3] w-full" />
        {/* 处置方法徽标（左上）。心愿仍用 StatusChip —— 它是生命周期状态而非处置方式。*/}
        {p.badge !== null ? (
          <span className="absolute left-2 top-2">
            <DisposalChip method={p.badge} size="sm" />
          </span>
        ) : (
          statusOf(item) !== 'owned' && (
            <span className="absolute left-2 top-2">
              <StatusChip status={statusOf(item)} size="sm" />
            </span>
          )
        )}
        {/* 图片结果 overlay：仅出售。物品图标保持清晰，不灰化 / 不加叉。 */}
        {p.overlay !== null && <DisposalOverlay text={p.overlay} />}
        {/* 持有物品的保修信息由底部 WarrantyStrip 承担，图区不再叠加 chip */}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 min-h-[40px] text-item text-ink-primary">{item.name}</p>
        <p className="mt-0.5 truncate text-caption text-ink-tertiary">{p.subtitle}</p>
        {tagNames.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tagNames.slice(0, 2).map((t) => (
              <TagChip key={t} name={t} size="sm" />
            ))}
          </div>
        )}
        <MetricRow cells={p.metrics} />
        {p.finance !== null && <FinanceLine grossText={p.grossText} finance={p.finance} />}
      </div>
      {/* 保修进度条：只有真正有保修数据的**持有**物品才出现，无保修卡片零空白。
          已处置物品不显示 —— 保修是持有期语义（设计 §15）。*/}
      {statusOf(item) === 'owned' && item.warrantyExpiresAt !== null && (
        <WarrantyStrip item={item} today={today} />
      )}
    </Link>
  )
}

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
  const p = itemPresentation(item, { today, categoryName })
  const warranty = warrantyInfo(item.warrantyExpiresAt, today)
  const isDisposed = p.badge !== null

  return (
    <Link
      to={to}
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
   * 不写 URL、不写 IndexedDB、不进 sync/D1（它不是业务数据，设计 §6.1）。
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

  return (
    <div className="animate-fade-rise pt-[calc(24px+env(safe-area-inset-top))]">
      <header className="px-5">
        {/* Large Title 随 lifecycle 动态（设计 §5.1）：「物品管理」是 section 总称，
            这里的三个 tab 是生命周期状态，用状态名更贴合 Large Title 的语义。 */}
        <h1 className="text-page-title text-ink-primary">{words.title}</h1>
        <p className="mt-1.5 text-secondary text-ink-tertiary">
          <span className="num text-ink-primary">{counts[status]}</span> 件{words.unit}
        </p>
      </header>

      {/* 生命周期切换：持有 / 心愿 / 处置 —— 对应真实数据字段。
          复用全站唯一的 SegmentedControl，与设置页的外观模式保持同一套控件语言。 */}
      <div className="mt-5 px-5">
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

      {/* 处置二级筛选：**仅处置 tab 出现**（设计 §6）。
          视觉上与生命周期控件成组（间距 mt-2，比下方工具栏的 mt-4 更紧），
          读起来是"生命周期轴的下钻"而不是另一个平级筛选器。
          0 数量显示但禁用 —— 隐藏会让控件宽度在切换时跳动。*/}
      {status === 'disposed' && dispCounts !== null && (
        <div className="mt-2 overflow-x-auto px-5">
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
                {/* ⚠️ cost 实际按 `effectiveCostCents` 排 —— 对已出售物品那是**净成本**，
                   标成「总投入」是错的（设计 §13.3 / §12）。比较函数不动，只改标签。*/}
                {s.key === 'cost' && status === 'disposed' ? '实际持有成本' : s.label}
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
        active ? 'bg-accent font-medium text-ink-inverse' : 'bg-surface-sunken text-ink-secondary'
      }`}
    >
      {children}
    </button>
  )
}
