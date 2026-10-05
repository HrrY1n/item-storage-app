import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ICON_CATEGORIES,
  PRESET_ICONS,
  presetIconOfAssetId,
  searchIcons,
  type IconCategory,
  type PresetIcon,
} from '../data/icons'
import { loadRecentIcons, persistRecentIcons, pushRecentIcon } from '../features/ui/recentIcons'
import IconGrid from './IconGrid'

interface Props {
  open: boolean
  /** 当前选中的 assetId（preset-<key>） */
  value: string
  onSelect: (assetId: string) => void
  onClose: () => void
}

/**
 * 图标选择器。
 *
 * 为什么是浮层而不是内联网格：图标库已从 12 个增长到 70+，
 * 把它铺在表单里会把"新增物品"这条最高频的路径撑成一条长走廊。
 *
 * 结构：搜索 → 分类（最近使用 / 七个分类）→ 网格。
 * 检索走 icons.ts 的元数据（名称 + 关键词 + key），所以 iPad、充电头、话筒这类
 * 日常叫法也能命中正确的图标。
 */
export default function IconPickerSheet({ open, value, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>(() => loadRecentIcons())
  const [category, setCategory] = useState<IconCategory | 'recent'>('recent')
  const inputRef = useRef<HTMLInputElement>(null)

  // 每次打开都重置为「最近使用」，并把焦点交给搜索框（移动端不自动弹键盘）
  useEffect(() => {
    if (!open) return
    setQuery('')
    const recentNow = loadRecentIcons()
    setRecent(recentNow)
    setCategory(recentNow.length > 0 ? 'recent' : 'digital')
    const t = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const searching = query.trim().length > 0

  const grid: PresetIcon[] = useMemo(() => {
    if (searching) return searchIcons(query)
    if (category === 'recent') {
      return recent
        .map((id) => presetIconOfAssetId(id))
        .filter((i): i is PresetIcon => Boolean(i))
    }
    return PRESET_ICONS.filter((i) => i.category === category)
  }, [query, searching, category, recent])

  if (!open) return null

  const handlePick = (assetId: string) => {
    const next = pushRecentIcon(assetId, recent)
    setRecent(next)
    persistRecentIcons(next)
    onSelect(assetId)
    onClose()
  }

  const recentIcons = recent
    .map((id) => presetIconOfAssetId(id))
    .filter((i): i is PresetIcon => Boolean(i))

  const tabs: { key: IconCategory | 'recent'; label: string }[] = [
    ...(recentIcons.length > 0 ? [{ key: 'recent' as const, label: '最近使用' }] : []),
    ...ICON_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
  ]

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="选择物品图标"
    >
      <div
        className="animate-[pop-in_200ms_cubic-bezier(0.22,1,0.36,1)_both] absolute inset-0 bg-overlay backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div className="animate-drawer-up relative flex h-[86dvh] w-full flex-col overflow-hidden rounded-t-sheet border border-line bg-surface-raised shadow-sheet sm:h-auto sm:max-h-[80dvh] sm:max-w-[560px] sm:animate-pop-in sm:rounded-sheet">
        {/* 抓取把手：移动端暗示"可下滑关闭" */}
        <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-pill bg-line-strong sm:hidden" />

        <header className="flex shrink-0 items-center justify-between px-5 pb-2 pt-3 sm:pt-5">
          <h2 className="text-section text-ink-primary">选择图标</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="-mr-1.5 flex h-9 w-9 items-center justify-center rounded-pill text-ink-tertiary transition-colors active:bg-surface-sunken sm:hover:text-ink-primary"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* 搜索 */}
        <div className="shrink-0 px-5 pb-3">
          <div className="field-shell flex h-11 items-center gap-2.5 rounded-control border border-line bg-surface px-3.5 transition-colors focus-within:border-line-strong">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-tertiary">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.8-3.8" />
            </svg>
            <input
              ref={inputRef}
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

        {/* 分类（搜索时隐藏，避免与结果争夺注意力） */}
        {!searching && (
          <div className="no-scrollbar shrink-0 overflow-x-auto px-5 pb-3">
            <div className="flex gap-1.5">
              {tabs.map((t) => {
                const active = category === t.key
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setCategory(t.key)}
                    aria-pressed={active}
                    className={`flex min-h-[32px] shrink-0 items-center whitespace-nowrap rounded-pill px-3 text-caption transition-colors duration-150 ease-out-quint ${
                      active
                        ? 'bg-accent font-medium text-ink-inverse'
                        : 'bg-surface-sunken text-ink-secondary'
                    }`}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* 网格 */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(24px+env(safe-area-inset-bottom))] sm:pb-5">
          {grid.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-secondary text-ink-secondary">没有找到「{query.trim()}」</p>
              <p className="mt-1.5 text-caption text-ink-tertiary">
                换个日常叫法试试，例如「平板」「充电头」「话筒」
              </p>
            </div>
          ) : (
            <>
              {searching && (
                <p className="mb-2.5 text-caption text-ink-tertiary">
                  <span className="num">{grid.length}</span> 个匹配
                </p>
              )}
              <IconGrid
                icons={grid}
                value={value}
                onPick={handlePick}
                columnsClass="grid-cols-4 sm:grid-cols-6"
              />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
