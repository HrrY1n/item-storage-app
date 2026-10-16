import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadRecentIcons, persistRecentIcons, pushRecentIcon } from '../features/ui/recentIcons'
import IconBrowser from './IconBrowser'

interface Props {
  open: boolean
  value: string
  onSelect: (assetId: string) => void
  onClose: () => void
}

export default function IconPickerSheet({ open, value, onSelect, onClose }: Props) {
  const [recent, setRecent] = useState<string[]>(() => loadRecentIcons())
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    setRecent(loadRecentIcons())
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 关闭按钮接收焦点，打开时不会唤起 iOS 键盘。
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
      if (event.key !== 'Tab') return
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button, input')
      const first = controls?.[0]
      const last = controls?.[controls.length - 1]
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target?.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  const handlePick = (assetId: string) => {
    const next = pushRecentIcon(assetId, recent)
    setRecent(next)
    persistRecentIcons(next)
    onSelect(assetId)
    onClose()
  }

  return createPortal(
    <div ref={dialogRef} className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="选择物品图标">
      <div className="animate-[pop-in_200ms_cubic-bezier(0.22,1,0.36,1)_both] absolute inset-0 bg-overlay backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-drawer-up relative flex h-[86dvh] w-full flex-col overflow-hidden rounded-t-sheet border border-line bg-surface-raised shadow-sheet sm:h-[80dvh] sm:max-w-[560px] sm:animate-pop-in sm:rounded-sheet">
        <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-pill bg-line-strong sm:hidden" />
        <header className="flex shrink-0 items-center justify-between px-5 pb-3 pt-3 sm:pt-5">
          <h2 className="text-section text-ink-primary">选择图标</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭" className="-mr-1.5 flex h-10 w-10 items-center justify-center rounded-pill text-ink-tertiary transition-colors active:bg-surface-sunken sm:hover:text-ink-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <IconBrowser value={value} recent={recent} onPick={handlePick} />
      </div>
    </div>,
    document.body,
  )
}
