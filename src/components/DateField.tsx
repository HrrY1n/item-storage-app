import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clampCalendarDate, formatPurchaseDate, parseDateToDayNumber, todayString } from '../domain/purchase'

/** 年/月/日只修改草稿，明确点「确定」后才通知表单，避免依赖原生日期弹窗的提交时机。 */
export default function DateField({ label, value, onChange, min, max }: {
  label: string
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(todayString())
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const minimum = min && parseDateToDayNumber(min) !== null ? min : undefined
  const maximum = max && parseDateToDayNumber(max) !== null ? max : undefined

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        setOpen(false)
      }
      if (event.key !== 'Tab') return
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select')
      const first = controls?.[0]
      const last = controls?.[controls.length - 1]
      if (!dialogRef.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previousOverflow
      triggerRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  const [year, month, day] = draft.split('-').map(Number)
  const firstYear = Math.min(Number(minimum?.slice(0, 4) ?? 1900), year)
  const lastYear = Math.max(Number(maximum?.slice(0, 4) ?? (new Date().getFullYear() + 100)), year)
  const days = Number(clampCalendarDate(year, month, 31)?.slice(-2))
  const error = minimum && draft < minimum ? `不能早于${formatPurchaseDate(minimum)}`
    : maximum && draft > maximum ? `不能晚于${formatPurchaseDate(maximum)}` : null
  const selectClass = 'num h-12 w-full min-w-0 rounded-control border border-line-strong bg-surface-sunken px-2 text-[16px] text-ink-primary'

  return <>
    <button ref={triggerRef} type="button" aria-label={`选择${label}`} aria-haspopup="dialog" aria-expanded={open}
      data-date-field={label} data-date-value={value}
      onClick={() => {
        let next = parseDateToDayNumber(value) !== null ? value : todayString()
        if (!value) {
          if (minimum && next < minimum) next = minimum
          if (maximum && next > maximum) next = maximum
        }
        setDraft(next)
        setOpen(true)
      }}
      className="flex h-11 w-full items-center justify-between gap-3 rounded-control border border-line bg-surface-sunken px-3 text-left text-body text-ink-primary">
      <span className={value ? 'num' : 'text-ink-tertiary'}>{value ? formatPurchaseDate(value) : '请选择日期'}</span>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
    </button>
    {open && createPortal(
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} data-date-picker
        className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6">
        <div className="absolute inset-0 bg-overlay backdrop-blur-[2px]" onClick={() => setOpen(false)} />
        <div className="animate-drawer-up relative max-h-[90dvh] w-full max-w-[420px] overflow-y-auto rounded-t-sheet border border-line bg-surface-raised p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-sheet sm:rounded-sheet sm:pb-5">
          <h2 id={titleId} className="text-section text-ink-primary">{label}</h2>
          <p className="mt-1 text-caption text-ink-tertiary">选好年月日后，点「确定」生效。</p>
          <div className="mt-5 grid grid-cols-[1.2fr_1fr_1fr] gap-3">
            <label className="text-label text-ink-tertiary">年
              <select aria-label="年" value={year} className={`${selectClass} mt-2`} onChange={event => setDraft(clampCalendarDate(Number(event.target.value), month, day)!)}>
                {Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i).map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
            </label>
            <label className="text-label text-ink-tertiary">月
              <select aria-label="月" value={month} className={`${selectClass} mt-2`} onChange={event => setDraft(clampCalendarDate(year, Number(event.target.value), day)!)}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
              </select>
            </label>
            <label className="text-label text-ink-tertiary">日
              <select aria-label="日" value={day} className={`${selectClass} mt-2`} onChange={event => setDraft(clampCalendarDate(year, month, Number(event.target.value))!)}>
                {Array.from({ length: days }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}日</option>)}
              </select>
            </label>
          </div>
          <p className="num mt-4 text-body text-ink-primary" aria-live="polite">{formatPurchaseDate(draft)}</p>
          {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}
          <div className="mt-5 flex gap-2.5">
            <button ref={cancelRef} type="button" onClick={() => setOpen(false)} className="h-11 flex-1 rounded-control border border-line bg-surface text-secondary text-ink-secondary">取消</button>
            {value && <button type="button" onClick={() => { onChange(''); setOpen(false) }} className="h-11 rounded-control px-3 text-secondary text-ink-tertiary">清除</button>}
            <button type="button" disabled={!!error} onClick={() => { onChange(draft); setOpen(false) }} className="h-11 flex-1 rounded-control bg-ink-solid text-secondary font-medium text-ink-inverse disabled:opacity-40">确定</button>
          </div>
        </div>
      </div>, document.body,
    )}
  </>
}
