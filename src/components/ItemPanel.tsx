import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import ModalSheet from './ModalSheet'

const PanelContext = createContext<{
  close: RefObject<(() => void) | null>
  path: string
  active: boolean
  restore: () => void
  entering: boolean
} | null>(null)

/**
 * 页面仍负责草稿/返回语义，外层面板只负责呈现与位置交接。
 * 每个内容树各自拿到绑定自身路径的 context：restore 只在「本页是当前目标」时生效，
 * 因此前页面残留的就绪信号不会误触发揭示。active=false 表示本页已被新导航替代、
 * 正等待回收，页面应据此解除导航守卫（隐藏树不得拦截路由）。
 */
export function useItemPanel(onClose: () => void, ready = true) {
  const panel = useContext(PanelContext)
  useLayoutEffect(() => {
    if (!panel?.active) return
    panel.close.current = onClose
    return () => { if (panel.close.current === onClose) panel.close.current = null }
  }, [panel?.active, panel?.close, onClose])
  useLayoutEffect(() => {
    if (ready && panel?.active) panel.restore()
  }, [panel?.active, panel?.path, panel?.restore, ready])
  return { panel: panel !== null, entering: panel?.entering ?? false, active: panel ? panel.active : true }
}

type PanelIntent = 'open' | 'forward' | 'back'
type PanelEntry = { path: string; children: ReactNode; intent: PanelIntent; nonce: number }

/** 每个内容树独立的 context 值；active 随导航翻转，驱动恢复与关闭责任的交接。 */
function EntryScope({ entry, active, entering, close, markReady, children }: {
  entry: PanelEntry
  active: boolean
  entering: boolean
  close: RefObject<(() => void) | null>
  markReady: (path: string) => void
  children: ReactNode
}) {
  const value = useMemo(() => ({
    close,
    path: entry.path,
    active,
    restore: () => markReady(entry.path),
    entering,
  }), [close, entry.path, active, markReady, entering])
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>
}

export default function ItemPanel({ path, open, onExited, children }: {
  path: string
  open: boolean
  onExited: () => void
  children: ReactNode
}) {
  const close = useRef<(() => void) | null>(null)
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const positions = useRef(new Map<string, number>())
  const ready = useRef(false)
  const openRef = useRef(open)
  openRef.current = open
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

  /**
   * 内容切换状态机：路径变化时保留旧内容显示，新页面的数据就绪信号（restore）到达后
   * 才整体揭示——转场动画因此在真实内容的首帧启动，占位态全程不可见。
   * 表单路径永远重新初始化，保证放弃草稿后旧输入不会复活。
   */
  const [entries, setEntries] = useState<PanelEntry[]>(() => [{ path, children, intent: 'open', nonce: 0 }])
  const [revealed, setRevealed] = useState(path)
  const targetRef = useRef(path)
  targetRef.current = path
  const nextNonce = useRef(1)
  const lastPath = useRef(path)
  if (lastPath.current !== path) {
    lastPath.current = path
    if (open) {
      const intent: PanelIntent = path.endsWith('/edit') ? 'forward' : 'back'
      const isForm = path.endsWith('/edit') || path.endsWith('/new')
      ready.current = false
      setEntries(current => {
        const existing = current.find(entry => entry.path === path)
        if (existing && !isForm) return current.map(entry => entry.path === path ? { ...entry, intent } : entry)
        // 重新挂载的条目换新 nonce 改变 key：同一提交内「移除+追加」同 key 会被
        // React 视为移动而保留旧表单状态（例如已放弃的草稿）。
        return [...current.filter(entry => entry.path !== path), { path, children, intent, nonce: nextNonce.current++ }]
      })
    }
  }

  const markReady = useCallback((entryPath: string) => {
    if (!openRef.current || entryPath !== targetRef.current) return
    setRevealed(entryPath)
  }, [])

  // 揭示（含首次入场完成）后恢复面板滚动与焦点；pending 期间旧内容保持可见可交互。
  // 滚动恢复放在微任务里：揭示提交后浏览器才算完新可见内容的布局，
  // 同步设置会被未就绪的 scrollHeight 钳制（旧实现同为提交后微任务时机）。
  const restoreGeneration = useRef(0)
  useLayoutEffect(() => {
    if (!open || !entered) return
    const node = nodes.current.get(revealed)
    if (!node) return
    const run = ++restoreGeneration.current
    queueMicrotask(() => {
      if (run !== restoreGeneration.current || !node.isConnected) return
      const panel = node.closest<HTMLElement>('.modal-sheet-panel')
      if (!panel?.closest('dialog')?.open || panel.closest('.modal-sheet')?.getAttribute('data-state') === 'closing') return
      panel.scrollTop = positions.current.get(revealed) ?? 0
      ready.current = true
      node.focus({ preventScroll: true })
    })
  }, [revealed, open, entered])

  useLayoutEffect(() => {
    const node = nodes.current.get(revealed)
    const panel = node?.closest<HTMLElement>('.modal-sheet-panel')
    if (!panel) return
    const save = () => { if (ready.current) positions.current.set(revealed, panel.scrollTop) }
    panel.addEventListener('scroll', save, { passive: true })
    return () => { panel.removeEventListener('scroll', save) }
  }, [revealed])

  // 揭示完成后回收旧内容树；期间再次导航会重置计时，被隐藏的树继续充当显示内容。
  useEffect(() => {
    if (revealed !== path || entries.length < 2) return
    const timer = window.setTimeout(() => {
      setEntries(current => current.filter(entry => entry.path === revealed))
    }, 320)
    return () => window.clearTimeout(timer)
  }, [entries, revealed, path])

  const label = path.endsWith('/new') ? '新增物品' : path.endsWith('/edit') ? '编辑物品' : '物品详情'
  return <ModalSheet open={open} ready={entered} label={label} onClose={() => close.current?.()} onExited={onExited} variant="detail">
    {entries.map(entry => (
      <EntryScope key={`${entry.path}#${entry.nonce}`} entry={entry} active={entry.path === path} entering={entering} close={close} markReady={markReady}>
        <div
          ref={node => {
            if (node) nodes.current.set(entry.path, node)
            else nodes.current.delete(entry.path)
          }}
          tabIndex={-1}
          data-modal-autofocus={entry.path === revealed || undefined}
          className="item-panel-content outline-none"
          data-intent={entry.path === revealed ? entry.intent : undefined}
          hidden={entry.path !== revealed}
        >
          {entry.path === path ? children : entry.children}
        </div>
      </EntryScope>
    ))}
  </ModalSheet>
}
