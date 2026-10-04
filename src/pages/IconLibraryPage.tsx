import { useMemo, useState } from 'react'
import { ICON_CATEGORIES, PRESET_ICONS, searchIcons, type IconCategory } from '../data/icons'
import PageHeader from '../components/PageHeader'
import IconGrid from '../components/IconGrid'
import EmptyState from '../components/EmptyState'

type Tab = IconCategory | 'all'

/**
 * 物品图标库：正式的内容页，而不是"开发中的占位页"。
 *
 * 图标是随应用打包的展示资产（透明底 + 统一描边与调色板），
 * 底衬由主题负责，所以同一套图标在浅色与深色下都成立。
 */
export default function IconLibraryPage() {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('all')

  const searching = query.trim().length > 0

  const icons = useMemo(() => {
    if (searching) return searchIcons(query)
    if (tab === 'all') return PRESET_ICONS
    return PRESET_ICONS.filter((i) => i.category === tab)
  }, [query, searching, tab])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: '全部' },
    ...ICON_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
  ]

  return (
    <div>
      <PageHeader title="物品图标库" />

      <div className="animate-fade-rise px-5 pt-5">
        <p className="text-secondary leading-relaxed text-ink-tertiary">
          共 <span className="num text-ink-primary">{PRESET_ICONS.length}</span> 个内置图标，
          统一风格、透明底衬，浅色与深色主题共用同一套资源。
          在「新增物品」中点击图标即可从这里挑选。
        </p>

        {/* 搜索 */}
        <div className="mt-4">
          <div className="field-shell flex h-11 items-center gap-2.5 rounded-control border border-line bg-surface px-3.5 transition-colors focus-within:border-line-strong">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-tertiary">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.8-3.8" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索图标，如 平板 / iPad / 电脑"
              type="search"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-ink-primary outline-none placeholder:text-ink-faint"
            />
            {searching && (
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
        </div>

        {/* 分类 */}
        {!searching && (
          <div className="no-scrollbar -mx-5 mt-3 overflow-x-auto px-5">
            <div className="flex gap-1.5">
              {tabs.map((t) => {
                const active = tab === t.key
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    aria-pressed={active}
                    className={`flex min-h-[32px] shrink-0 items-center whitespace-nowrap rounded-pill px-3 text-caption transition-colors duration-150 ease-out-quint ${
                      active ? 'bg-ink-solid font-medium text-ink-inverse' : 'bg-surface-sunken text-ink-secondary'
                    }`}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {icons.length === 0 ? (
          <EmptyState
            title={`没有找到「${query.trim()}」`}
            subtitle="换个日常叫法试试，例如「平板」「充电头」「话筒」"
          />
        ) : (
          <>
            {searching && (
              <p className="mt-4 text-caption text-ink-tertiary">
                <span className="num">{icons.length}</span> 个匹配
              </p>
            )}
            <div className="mt-4 pb-4">
              <IconGrid icons={icons} columnsClass="grid-cols-4 sm:grid-cols-5 lg:grid-cols-6" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
