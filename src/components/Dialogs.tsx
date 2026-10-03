import type { ReactNode } from 'react'

interface Props {
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

/** 简洁确认对话框（放弃修改 / 删除确认等） */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-10">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative w-full max-w-[300px] rounded-2xl bg-white p-5 shadow-xl">
        <p className="text-center text-item text-ink-primary">{title}</p>
        {message && (
          <p className="mt-2 text-center text-caption leading-relaxed text-ink-tertiary">{message}</p>
        )}
        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-11 flex-1 items-center justify-center rounded-xl bg-neutral-100 text-secondary text-ink-secondary transition-transform duration-100 active:scale-[0.97]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex h-11 flex-1 items-center justify-center rounded-xl text-secondary font-medium text-white transition-transform duration-100 active:scale-[0.97] ${
              danger ? 'bg-[#DC2626]' : 'bg-neutral-900'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-40 flex items-center justify-center px-10">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[300px] rounded-2xl bg-white p-5 shadow-xl">
        <p className="text-center text-item text-ink-primary">{title}</p>
        <p className="mt-2 whitespace-pre-line text-center text-caption leading-relaxed text-ink-tertiary">
          {message}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-neutral-900 text-secondary font-medium text-white transition-transform duration-100 active:scale-[0.97]"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
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
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[360px] rounded-t-3xl bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl sm:pb-5">
        <p className="mb-4 text-center text-item text-ink-primary">{title}</p>
        {children}
      </div>
    </div>
  )
}
