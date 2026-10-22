import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import ModalSheet from './ModalSheet'

const PanelContext = createContext<{
  close: RefObject<(() => void) | null>
  path: string
  restore: () => void
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
  return panel !== null
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
  // 首次入场等数据就绪，避免上滑途中替换占位内容和面板高度。
  const [entered, setEntered] = useState(false)
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
    <PanelContext.Provider value={{ close, path, restore }}>
      <div key={path} ref={content} tabIndex={-1} data-modal-autofocus className="item-panel-content outline-none" data-intent={route.current.intent}>{children}</div>
    </PanelContext.Provider>
  </ModalSheet>
}
