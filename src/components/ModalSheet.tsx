import { useEffect, useRef, useState, type ReactNode } from 'react'
import ModalLayer from './ModalLayer'

export interface ItemPanelProps {
  open: boolean
  onExited: () => void
}

export default function ModalSheet({ open, label, onClose, onExited, variant, children }: {
  open: boolean
  label: string
  onClose: () => void
  onExited?: () => void
  variant: 'detail' | 'picker'
  children: ReactNode
}) {
  const [present, setPresent] = useState(open)
  const openRef = useRef(open)
  const presentRef = useRef(open)
  const exitedRef = useRef(onExited)
  openRef.current = open
  exitedRef.current = onExited
  presentRef.current = open || present

  const finishExit = () => {
    if (openRef.current || !presentRef.current) return
    presentRef.current = false
    setPresent(false)
    exitedRef.current?.()
  }
  const requestClose = () => { if (openRef.current) onClose() }

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
    <div className="modal-sheet" data-sheet={variant} data-state={open ? 'open' : 'closing'}>
      <div className="modal-sheet-backdrop bg-overlay backdrop-blur-[2px]" onClick={requestClose} />
      <section className="modal-sheet-panel" inert={!open} onTransitionEnd={event => {
        if (event.target === event.currentTarget && event.propertyName === 'transform') finishExit()
      }}>
        <div className="modal-sheet-handle" aria-hidden="true" />
        {children}
      </section>
    </div>
  </ModalLayer>
}
