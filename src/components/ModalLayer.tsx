import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

let scrollLocks = 0
let previousOverflow = ''
let previousPaddingRight = ''

/** 原生 dialog 管理嵌套层级、焦点和 Escape；滚动锁持续到最后一层关闭。 */
export default function ModalLayer({ open, label, onClose, children }: {
  open: boolean
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const dialog = dialogRef.current!
    const previousFocus = document.activeElement as HTMLElement | null
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-modal-autofocus]')?.focus({ preventScroll: true })
    if (scrollLocks++ === 0) {
      previousOverflow = document.body.style.overflow
      previousPaddingRight = document.body.style.paddingRight
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbarWidth}px`
      document.body.style.overflow = 'hidden'
    }
    return () => {
      dialog.close()
      if (--scrollLocks === 0) {
        document.body.style.overflow = previousOverflow
        document.body.style.paddingRight = previousPaddingRight
      }
      if (previousFocus?.isConnected && !previousFocus.closest('dialog:not([open])')) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <dialog ref={dialogRef} className="modal-layer" role="dialog" aria-modal="true" aria-label={label}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        // 连续 Escape 的原生 cancel 可能不可取消，提前接管以保护未保存表单。
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) onClose()
      }}
      onCancel={event => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}>
      {children}
    </dialog>, document.body,
  )
}
