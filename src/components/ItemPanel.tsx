import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import ModalSheet from './ModalSheet'

const PanelContext = createContext<{
  close: RefObject<(() => void) | null>
  path: string
  restore: () => void
  entering: boolean
} | null>(null)

/** 页面仍负责草稿/返回语义，外层面板只负责呈现与位置交接。 */
export function useItemPanel(onClose: () => void, ready = true) {
  const panel = useContext(PanelContext)
  useLayoutEffect(() => {
    if (!panel) return
    panel.close.current = onClose
    return () => { if (panel.close.current === onClose) panel.close.current = null }
  }, [panel?.close, onClose])
  useLayoutEffect(() => { if (ready) panel?.restore() }, [panel?.path, ready])
  return { panel: panel !== null, entering: panel?.entering ?? false }
}

export default function ItemPanel({ path, open, onExited, children }: {
  path: string
  open: boolean
  onExited: () => void
  children: ReactNode
}) {
  const close = useRef<(() => void) | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, number>())
  const ready = useRef(false)
  // 首次绘制前启动入场，独立于异步内容。
  const [entered, setEntered] = useState(false)
  useLayoutEffect(() => {
    setEntered(true)
  }, [])
  // 等入场开始后再提交内容，避免长任务阻塞过渡启动。
  const [entering, setEntering] = useState(true)
  useEffect(() => {
    if (!open || !entered) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setEntering(false)
      return
    }
    let frame = 0
    const stopAtThirdFrame = () => { cancelAnimationFrame(frame); window.clearTimeout(fallback); setEntering(false) }
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(stopAtThirdFrame)
      })
    })
    const fallback = window.setTimeout(stopAtThirdFrame, 240)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(fallback)
    }
  }, [open, entered])
  const generation = useRef(0)
  const route = useRef({ path, intent: 'open' })
  if (route.current.path !== path) {
    route.current = { path, intent: path.endsWith('/edit') ? 'forward' : 'back' }
    generation.current++
    ready.current = false
  }
  const restore = useCallback(() => {
    const run = ++generation.current
    queueMicrotask(() => {
      const node = content.current
      const panel = node?.closest<HTMLElement>('.modal-sheet-panel')
      if (run !== generation.current || !panel?.closest('dialog')?.open || panel.closest('.modal-sheet')?.getAttribute('data-state') === 'closing') return
      setEntered(true)
      panel.scrollTop = positions.current.get(path) ?? 0
      ready.current = true
      node?.focus({ preventScroll: true })
    })
  }, [path])
  useLayoutEffect(() => {
    if (entered && open) content.current?.focus({ preventScroll: true })
  }, [entered, open])
  useLayoutEffect(() => {
    const panel = content.current?.closest('.modal-sheet-panel')
    if (!panel) return
    const save = () => { if (ready.current) positions.current.set(path, panel.scrollTop) }
    panel.addEventListener('scroll', save, { passive: true })
    return () => { panel.removeEventListener('scroll', save); generation.current++ }
  }, [path])
  const label = path.endsWith('/new') ? '新增物品' : path.endsWith('/edit') ? '编辑物品' : '物品详情'
  return <ModalSheet open={open} ready={entered} label={label} onClose={() => close.current?.()} onExited={onExited} variant="detail">
    <PanelContext.Provider value={{ close, path, restore, entering }}>
      <div key={path} ref={content} tabIndex={-1} data-modal-autofocus className="item-panel-content outline-none" data-intent={route.current.intent}>{children}</div>
    </PanelContext.Provider>
  </ModalSheet>
}
