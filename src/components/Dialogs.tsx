import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 遮罩 + 入场，所有对话框共用。渲染到 body，避免被祖先的 overflow / transform 裁剪。 */
function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center px-8">
      <div
        className="animate-[pop-in_200ms_cubic-bezier(0.22,1,0.36,1)_both] absolute inset-0 bg-overlay backdrop-blur-[2px]"
        onClick={onClose}
      />
      {children}
    </div>,
    document.body,
  )
}

const btnBase =
  'flex h-11 flex-1 items-center justify-center rounded-control text-secondary transition-colors duration-150 ease-out-quint active:opacity-70'

interface ConfirmProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作（删除/放弃）用红色主按钮 */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** 确认对话框（放弃修改 / 删除确认等） */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  if (!open) return null
  return (
    <Overlay onClose={onCancel}>
      <div className="animate-pop-in relative w-full max-w-[312px] rounded-sheet border border-line bg-surface-raised p-6 shadow-sheet">
        <p className="text-center text-section text-ink-primary">{title}</p>
        {message && (
          <p className="mt-2.5 whitespace-pre-line text-center text-secondary leading-relaxed text-ink-tertiary">
            {message}
          </p>
        )}
        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className={`${btnBase} border border-line bg-surface text-ink-secondary`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`${btnBase} font-medium text-ink-inverse ${danger ? 'bg-danger' : 'bg-ink-solid'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

/** 单按钮信息对话框（说明性内容，无需二选一决策） */
export function AlertDialog({
  open,
  title,
  message,
  confirmLabel = '知道了',
  onClose,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onClose: () => void
}) {
  if (!open) return null
  return (
    <Overlay onClose={onClose}>
      <div className="animate-pop-in relative w-full max-w-[312px] rounded-sheet border border-line bg-surface-raised p-6 shadow-sheet">
        <p className="text-center text-section text-ink-primary">{title}</p>
        <p className="mt-2.5 whitespace-pre-line text-center text-secondary leading-relaxed text-ink-tertiary">
          {message}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 flex h-11 w-full items-center justify-center rounded-control bg-ink-solid text-secondary font-medium text-ink-inverse transition-opacity duration-150 ease-out-quint active:opacity-70"
        >
          {confirmLabel}
        </button>
      </div>
    </Overlay>
  )
}

/** 带标题与自定义内容的表单对话框（分类/标签编辑用） */
export function FormDialog({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
}) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div
        className="animate-[pop-in_200ms_cubic-bezier(0.22,1,0.36,1)_both] absolute inset-0 bg-overlay backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="animate-sheet-up relative w-full max-w-[380px] rounded-t-sheet border border-line bg-surface-raised p-6 pb-[calc(24px+env(safe-area-inset-bottom))] shadow-sheet sm:rounded-sheet sm:pb-6">
        {/* 抓取把手：暗示这是一个可关闭的浮层 */}
        <div className="mx-auto mb-4 h-1 w-9 rounded-pill bg-line-strong" />
        <p className="mb-4 text-item text-ink-primary">{title}</p>
        {children}
      </div>
    </div>,
    document.body,
  )
}
