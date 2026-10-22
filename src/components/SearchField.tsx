import { useEffect, useRef, useState } from 'react'

/** 取消只退出聚焦；清空是独立动作，并保留输入焦点。 */
export default function SearchField({ value, onChange, placeholder, autoFocus = false }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoFocus?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!focused || !viewport) return
    const ensureVisible = () => {
      const rect = input.current?.getBoundingClientRect()
      if (rect && (rect.bottom > viewport.offsetTop + viewport.height || rect.top < viewport.offsetTop)) {
        input.current?.scrollIntoView({ block: 'nearest' })
      }
    }
    viewport.addEventListener('resize', ensureVisible)
    return () => viewport.removeEventListener('resize', ensureVisible)
  }, [focused])
  return <div className="search-control" data-focused={focused}>
    <div className="field-shell flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-control border border-line bg-surface px-3.5 transition-colors focus-within:border-line-strong">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-tertiary" aria-hidden>
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.8-3.8" />
      </svg>
      <input ref={input} value={value} autoFocus={autoFocus} type="search" enterKeyHint="search" aria-label="搜索物品" placeholder={placeholder}
        onChange={event => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); input.current?.blur() } }}
        className="min-w-0 flex-1 bg-transparent text-[16px] text-ink-primary outline-none placeholder:text-ink-faint" />
      {value && <button type="button" aria-label="清空" onPointerDown={event => event.preventDefault()}
        onClick={() => { onChange(''); input.current?.focus({ preventScroll: true }) }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-surface-sunken text-ink-secondary">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>}
    </div>
    <div className="search-cancel" inert={!focused} aria-hidden={!focused}>
      <button type="button" onPointerDown={event => event.preventDefault()} onClick={() => input.current?.blur()} className="h-11 w-14 text-secondary text-accent">取消</button>
    </div>
  </div>
}
