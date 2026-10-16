import { useLayoutEffect, useRef, useState } from 'react'
import {
  ICON_CATEGORIES,
  iconsInCategory,
  presetIconOfAssetId,
  searchIcons,
  type IconCategory,
  type PresetIcon,
} from '../data/icons'
import IconGrid from './IconGrid'

const categories = ICON_CATEGORIES.map((category) => ({
  ...category,
  icons: iconsInCategory(category.key),
}))

interface Props {
  value?: string
  recent?: readonly string[]
  onPick?: (assetId: string) => void
}

/** 弹层与设置页共享分类、全局检索和滚动位置；选中后的业务行为由调用方负责。 */
export default function IconBrowser({ value, recent = [], onPick }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<IconCategory | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const positions = useRef<Record<string, number>>({})
  const searching = query.trim().length > 0
  const view = searching ? 'search' : category ? `category-${category}` : 'categories'
  const active = categories.find((entry) => entry.key === category)
  const icons = searching ? searchIcons(query) : active?.icons ?? []
  const recentIcons = recent.map(presetIconOfAssetId).filter((icon): icon is PresetIcon => !!icon)

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = view === 'search' ? 0 : positions.current[view] ?? 0
  }, [view, query])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-icon-browser>
      <div className="shrink-0 px-5 pb-3">
        <div className="field-shell flex h-11 items-center gap-2.5 rounded-control border border-line bg-surface px-3.5 focus-within:border-line-strong">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ink-tertiary" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.8-3.8" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索全部图标"
            placeholder="搜索图标，如 平板 / iPad / 电脑"
            type="search"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink-primary outline-none placeholder:text-ink-faint"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="清空搜索" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill text-ink-secondary">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} onScroll={(event) => { positions.current[view] = event.currentTarget.scrollTop }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(24px+env(safe-area-inset-bottom))]" data-icon-scroll>
        {searching ? (
          <>
            <p role="status" className="mb-3 text-caption text-ink-tertiary"><span className="num">{icons.length}</span> 个匹配</p>
            {icons.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-secondary text-ink-secondary">没有找到「{query.trim()}」</p>
                <p className="mt-2 text-caption text-ink-tertiary">换个日常叫法试试，如「平板」「充电头」</p>
              </div>
            )}
            <IconGrid icons={icons} value={value} onPick={onPick} />
          </>
        ) : active ? (
          <>
            <div className="mb-3 flex items-center gap-3">
              <button type="button" onClick={() => setCategory(null)} aria-label="返回图标分类" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-line text-ink-secondary">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m14 6-6 6 6 6" /></svg>
              </button>
              <h3 className="text-section text-ink-primary">{active.label}</h3>
              <span className="ml-auto text-caption text-ink-tertiary"><span className="num">{icons.length}</span> 个图标</span>
            </div>
            <IconGrid icons={icons} value={value} onPick={onPick} />
          </>
        ) : (
          <>
            {recentIcons.length > 0 && (
              <section className="mb-5" aria-label="最近使用">
                <h3 className="mb-3 text-caption text-ink-secondary">最近使用</h3>
                <IconGrid icons={recentIcons} value={value} onPick={onPick} />
              </section>
            )}
            <h3 className="mb-3 text-caption text-ink-secondary">按分类浏览</h3>
            <div className="grid grid-cols-3 gap-2.5" aria-label="图标分类">
              {categories.map((entry) => (
                <button key={entry.key} type="button" onClick={() => setCategory(entry.key)} className="plate-surface flex min-h-[120px] flex-col items-center justify-center rounded-card border border-line px-2 py-3 transition-colors active:border-accent" aria-label={`${entry.label}，${entry.icons.length} 个图标`}>
                  <img src={entry.icons[0].path} alt="" width="56" height="56" draggable={false} className="mb-1 h-14 w-14 object-contain" />
                  <span className="text-secondary text-ink-primary">{entry.label}</span>
                  <span className="mt-0.5 text-[11px] text-ink-tertiary"><span className="num">{entry.icons.length}</span> 个图标</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
