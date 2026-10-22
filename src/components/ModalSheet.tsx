import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import ModalLayer from './ModalLayer'
import { sheetDragDirection, shouldDismissSheet, type SheetPoint } from '../features/ui/sheetGesture'

export default function ModalSheet({ open, label, onClose, onExited, variant, size, children }: {
  open: boolean
  label: string
  onClose: () => void
  onExited?: () => void
  variant: 'detail' | 'picker'
  size?: 'compact' | 'content' | 'tall'
  children: ReactNode
}) {
  const [present, setPresent] = useState(open)
  const openRef = useRef(open)
  const presentRef = useRef(open)
  const exitedRef = useRef(onExited)
  const closeRef = useRef(onClose)
  const sheetRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const measuredHeight = useRef<number | null>(null)
  const sizeAnimation = useRef<Animation | null>(null)
  const visible = open || present
  openRef.current = open
  exitedRef.current = onExited
  closeRef.current = onClose
  presentRef.current = open || present

  const finishExit = () => {
    if (openRef.current || !presentRef.current) return
    presentRef.current = false
    setPresent(false)
    exitedRef.current?.()
  }
  const requestClose = () => { if (openRef.current) onClose() }

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!visible || !panel) return
    const from = measuredHeight.current
    sizeAnimation.current?.cancel()
    const to = panel.getBoundingClientRect().height
    if (from !== null && Math.abs(from - to) > 1 && openRef.current && panel.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sizeAnimation.current = panel.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    }
    measuredHeight.current = to
  }, [size, visible])
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!visible || !panel || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { measuredHeight.current = panel.getBoundingClientRect().height })
    observer.observe(panel)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const reduce = () => { if (reduced.matches) sizeAnimation.current?.cancel() }
    reduced.addEventListener('change', reduce)
    return () => { observer.disconnect(); reduced.removeEventListener('change', reduce); sizeAnimation.current?.cancel(); measuredHeight.current = null }
  }, [visible])

  useLayoutEffect(() => {
    const sheet = sheetRef.current, panel = panelRef.current
    if (!visible || !sheet || !panel) return
    let gesture: { id: number; kind: 'touch' | 'pointer'; start: SheetPoint; base: number; distance: number; dragging: boolean; samples: SheetPoint[] } | undefined
    let releaseFrame = 0
    const topmost = () => {
      const dialogs = document.querySelectorAll('dialog[open]')
      return openRef.current && panel.closest('dialog') === dialogs[dialogs.length - 1]
    }
    const reset = () => {
      cancelAnimationFrame(releaseFrame)
      releaseFrame = 0
      gesture = undefined
      delete sheet.dataset.dragging
      sheet.style.removeProperty('--sheet-drag-y')
      sheet.style.removeProperty('--sheet-drag-progress')
    }
    const start = (target: EventTarget | null, point: SheetPoint, id: number, kind: 'touch' | 'pointer') => {
      if (!topmost() || !(target instanceof Element) || target.closest('button,a,input,textarea,select,[contenteditable="true"],[role="slider"]')) return
      const header = target.closest('header,[data-sheet-grip]')
      if (kind === 'pointer' && !header) return
      if (!header) {
        // 一根手指从已滚动的内容开始时，整段手势交给内容，不在途中抢走。
        for (let node: Element | null = target; node && panel.contains(node); node = node.parentElement) {
          if (node.scrollTop > 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return
          if (node === panel) break
        }
      }
      const base = Math.max(0, new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42)
      gesture = { id, kind, start: point, base, distance: base, dragging: false, samples: [point] }
    }
    const move = (point: SheetPoint, event: Event) => {
      if (!gesture) return
      if (!topmost()) { reset(); return }
      if (!gesture.dragging) {
        const direction = sheetDragDirection(gesture.start, point)
        if (direction === 'pending') return
        if (direction === 'scroll') { reset(); return }
        gesture.dragging = true
      }
      if (event.cancelable) event.preventDefault()
      gesture.samples.push(point)
      while (gesture.samples.length > 2 && point.time - gesture.samples[0].time > 100) gesture.samples.shift()
      gesture.distance = Math.max(0, gesture.base + point.y - gesture.start.y)
      sheet.dataset.dragging = 'true'
      sheet.style.setProperty('--sheet-drag-y', `${gesture.distance}px`)
      sheet.style.setProperty('--sheet-drag-progress', String(Math.min(1, gesture.distance / panel.clientHeight)))
    }
    const finish = (point?: SheetPoint) => {
      const current = gesture
      const sample = current?.samples[0]
      const velocity = point && sample ? (point.y - sample.y) / Math.max(1, point.time - sample.time) : 0
      const dismiss = !!(point && current?.dragging && topmost() && shouldDismissSheet(current.distance, panel.clientHeight, velocity))
      if (dismiss) {
        gesture = undefined
        delete sheet.dataset.dragging
        closeRef.current()
        // 先让关闭/确认状态提交，再清理拖动终值，避免退出前归零。
        releaseFrame = requestAnimationFrame(() => { releaseFrame = 0; reset() })
      } else reset()
    }
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { finish(); return }
      const touch = event.touches[0]
      start(event.target, { x: touch.clientX, y: touch.clientY, time: event.timeStamp }, touch.identifier, 'touch')
    }
    const touchMove = (event: TouchEvent) => {
      if (gesture?.kind !== 'touch') return
      if (event.touches.length !== 1) { finish(); return }
      const touch = event.touches[0]
      if (touch.identifier === gesture.id) move({ x: touch.clientX, y: touch.clientY, time: event.timeStamp }, event)
    }
    const touchEnd = (event: TouchEvent) => {
      if (gesture?.kind !== 'touch') return
      const touch = Array.from(event.changedTouches).find(touch => touch.identifier === gesture?.id)
      finish(event.touches.length === 0 && touch ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp } : undefined)
    }
    const pointerStart = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.button !== 0) return
      start(event.target, { x: event.clientX, y: event.clientY, time: event.timeStamp }, event.pointerId, 'pointer')
      if (gesture?.kind === 'pointer') panel.setPointerCapture(event.pointerId)
    }
    const pointerMove = (event: PointerEvent) => {
      if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) move({ x: event.clientX, y: event.clientY, time: event.timeStamp }, event)
    }
    const pointerEnd = (event: PointerEvent) => {
      if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) finish({ x: event.clientX, y: event.clientY, time: event.timeStamp })
    }
    const cancel = () => finish()
    panel.addEventListener('touchstart', touchStart, { passive: true })
    // passive:false 只在判定为下拉面板后阻止原生滚动，其余方向保留浏览器行为。
    panel.addEventListener('touchmove', touchMove, { passive: false })
    panel.addEventListener('touchend', touchEnd)
    panel.addEventListener('touchcancel', cancel)
    panel.addEventListener('pointerdown', pointerStart)
    panel.addEventListener('pointermove', pointerMove)
    panel.addEventListener('pointerup', pointerEnd)
    panel.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      reset()
      panel.removeEventListener('touchstart', touchStart)
      panel.removeEventListener('touchmove', touchMove)
      panel.removeEventListener('touchend', touchEnd)
      panel.removeEventListener('touchcancel', cancel)
      panel.removeEventListener('pointerdown', pointerStart)
      panel.removeEventListener('pointermove', pointerMove)
      panel.removeEventListener('pointerup', pointerEnd)
      panel.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [visible])

  useEffect(() => {
    if (open) {
      setPresent(true)
      return
    }
    if (!present) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishExit()
      return
    }
    // 动画被取消或暂停时也要释放弹层和滚动锁。
    const timer = window.setTimeout(finishExit, 460)
    return () => window.clearTimeout(timer)
  }, [open, present])

  return <ModalLayer open={open || present} label={label} onClose={requestClose}>
    <div ref={sheetRef} className="modal-sheet" data-sheet={variant} data-size={size ?? (variant === 'picker' ? 'tall' : undefined)} data-state={open ? 'open' : 'closing'}>
      <div className="modal-sheet-backdrop bg-overlay backdrop-blur-[2px]" onClick={requestClose} />
      <section ref={panelRef} className="modal-sheet-panel" inert={!open} onTransitionEnd={event => {
        if (event.target === event.currentTarget && event.propertyName === 'transform') finishExit()
      }}>
        <div className="modal-sheet-grip" data-sheet-grip aria-hidden="true"><div className="modal-sheet-handle" /></div>
        {children}
      </section>
    </div>
  </ModalLayer>
}
