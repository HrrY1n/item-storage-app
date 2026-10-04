import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { searchItems } from '../domain/searchItems'
import { categoryPath } from '../domain/categoryTree'
import type { Item } from '../types'
import {
  useCategories,
  useItemTagLinks,
  useItems,
  usePresetAssetMap,
  useTags,
} from '../features/data/hooks'
import { frequentTags, itemsWithTag } from '../features/data/viewModels'
import TagChip from '../components/TagChip'
import { ObjectPlate } from '../components/ItemCard'
import EmptyState from '../components/EmptyState'

const RECENT_KEY = 'pil.recentSearches'
const RECENT_MAX = 5

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function persistRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* 忽略隐私模式等写入失败 */
  }
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tagParam = searchParams.get('tag')

  const items = useItems()
  const categories = useCategories()
  const tags = useTags()
  const links = useItemTagLinks()
  const assetMap = usePresetAssetMap()

  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>(() => loadRecent())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 150ms 防抖实时搜索
  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 150)
    return () => clearTimeout(t)
  }, [input])

  const ready = items && categories && tags && links && assetMap
  const activeTag = tagParam && tags ? tags.find((t) => t.id === tagParam) : undefined

  const results = useMemo(
    () => (ready && query ? searchItems(query, items, categories, tags, links) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, query, items, categories, tags, links],
  )
  const tagResults = useMemo(
    () => (ready && activeTag ? itemsWithTag(items, links, activeTag.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, activeTag, items, links],
  )
  const frequent = ready ? frequentTags(items, links, tags, 8) : []

  const rememberQuery = (raw: string) => {
    const q = raw.trim()
    if (!q) return
    setRecent((prev) => {
      const next = [q, ...prev.filter((v) => v !== q)].slice(0, RECENT_MAX)
      persistRecent(next)
      return next
    })
  }

  const clearRecent = () => {
    setRecent([])
    persistRecent([])
  }

  if (!ready) {
    return <div className="pt-[calc(16px+env(safe-area-inset-top))]" />
  }

  return (
    <div>
      {/* 搜索框：页面绝对视觉中心 */}
      <div className="chrome sticky top-0 z-10 border-b border-line px-5 pb-3 pt-[calc(16px+env(safe-area-inset-top))]">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            rememberQuery(input)
          }}
        >
          <div className="flex h-12 items-center gap-2.5 rounded-card border border-line bg-white px-4 shadow-card">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-tertiary">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.8-3.8" />
            </svg>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                if (tagParam) setSearchParams({})
              }}
              placeholder="搜索物品、标签或分类……"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-ink-primary outline-none placeholder:text-ink-tertiary"
              type="search"
              enterKeyHint="search"
            />
            {input && (
              <button
                type="button"
                onClick={() => setInput('')}
                aria-label="清空"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 text-ink-secondary active:opacity-60"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="px-5">
        {/* 标签筛选模式 */}
        {activeTag && (
          <div className="pt-2">
            <div className="mb-3 flex items-center gap-2">
              <TagChip name={activeTag.name} selected onClick={() => setSearchParams({})} />
              <span className="text-caption text-ink-tertiary">
                {tagResults.length} 件 · 点击标签取消筛选
              </span>
            </div>
            <ResultRows
              rows={tagResults.map((item) => ({
                item,
                matchedVia: categoryPath(categories, item.categoryId),
              }))}
              iconOf={(item) => assetMap.get(item.iconAssetId) ?? '/icons/items/other.svg'}
            />
          </div>
        )}

        {/* 初始状态 */}
        {!activeTag && !query.trim() && (
          <div className="pt-3">
            <p className="text-label text-ink-tertiary">试试搜索名称、标签、分类或备注</p>

            {recent.length > 0 && (
              <section className="mt-7">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-label text-ink-tertiary">最近搜索</h2>
                  <button
                    type="button"
                    onClick={clearRecent}
                    className="text-caption text-neutral-300 transition-opacity active:opacity-50"
                  >
                    清除
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        setInput(q)
                        setQuery(q)
                      }}
                      className="flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-white px-3 text-caption text-ink-secondary transition-colors active:bg-neutral-50"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-300">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7.5V12l3 2" />
                      </svg>
                      {q}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {frequent.length > 0 && (
              <section className="mt-7">
                <h2 className="mb-3 text-label text-ink-faint">常用标签</h2>
                <div className="flex flex-wrap gap-2">
                  {frequent.map((tag) => (
                    <TagChip key={tag.id} name={tag.name} onClick={() => setSearchParams({ tag: tag.id })} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* 有结果 */}
        {!activeTag && query.trim() && results.length > 0 && (
          <div className="pt-3">
            <p className="mb-3 text-label text-ink-faint">
              <span className="num">{results.length}</span> 个结果
            </p>
            <ResultRows
              rows={results}
              iconOf={(item) => assetMap.get(item.iconAssetId) ?? '/icons/items/other.svg'}
              onSelect={() => rememberQuery(query)}
            />
          </div>
        )}

        {/* 无结果 */}
        {!activeTag && query.trim() && results.length === 0 && (
          <EmptyState
            title={`没有找到「${query.trim()}」`}
            subtitle="换个关键词试试，比如物品名称、标签或分类"
          />
        )}
      </div>
    </div>
  )
}

function ResultRows({
  rows,
  iconOf,
  onSelect,
}: {
  rows: { item: Item; matchedVia: string }[]
  iconOf: (item: Item) => string
  onSelect?: () => void
}) {
  return (
    <div className="divide-y divide-line-inner overflow-hidden rounded-surface border border-line bg-white shadow-card">
      {rows.map(({ item, matchedVia }) => (
        <Link
          key={item.id}
          to={`/items/${item.id}`}
          onClick={onSelect}
          className="group flex min-h-[72px] items-center gap-3.5 px-4 py-3 transition-colors active:bg-neutral-50 sm:hover:bg-neutral-50/70"
        >
          <ObjectPlate
            src={iconOf(item)}
            alt={item.name}
            className="h-12 w-12 shrink-0 rounded-control border border-line-inner"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-item text-ink-primary">{item.name}</p>
            <p className="mt-1 truncate text-caption text-ink-tertiary">{matchedVia}</p>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-faint transition-transform duration-300 ease-out-quint group-active:translate-x-0.5 sm:group-hover:translate-x-0.5">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      ))}
    </div>
  )
}
