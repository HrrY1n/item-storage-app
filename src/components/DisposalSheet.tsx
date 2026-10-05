import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { DISPOSAL_METHOD_LABELS, validateDisposal } from '../domain/lifecycle'
import type { DisposalMethod, Item } from '../domain/types'
import { parsePriceInput, todayString } from '../domain/purchase'
import { useUpdateGuard } from '../features/pwa/PwaUpdateContext'

export interface DisposalResult {
  disposedAt: string
  disposalMethod: DisposalMethod
  salePriceCents: number | null
  disposalNote: string | null
}

const METHODS: DisposalMethod[] = ['sold', 'discarded', 'other']

/**
 * 处置物品面板。
 *
 * 只有三种方式，不多不少：出售 / 丢弃 / 其他。
 * - 出售 → 额外出现「出售金额」，用整数分存储，允许 0；留空则不计算净成本
 * - 丢弃 / 其他 → **强制清空**出售金额（不给出错的入口）
 * - 其他 → 允许填写处置备注（赠送朋友 / 损坏报废 / 回收…）
 * 处置日期默认今天，且不允许早于购买日期。
 */
export default function DisposalSheet({
  open,
  item,
  onSubmit,
  onClose,
}: {
  open: boolean
  item: Item
  onSubmit: (result: DisposalResult) => void | Promise<void>
  onClose: () => void
}) {
  const [method, setMethod] = useState<DisposalMethod>('sold')
  const [disposedAt, setDisposedAt] = useState(todayString())
  const [saleText, setSaleText] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 面板打开期间（用户可能已输入出售金额）不允许自动刷新
  useUpdateGuard(open, 'disposal-sheet')

  useEffect(() => {
    if (!open) return
    setMethod('sold')
    setDisposedAt(todayString())
    setSaleText('')
    setNote('')
    setError(null)
    setBusy(false)
  }, [open, item.id])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleAmount = (raw: string) => {
    if (raw === '' || /^\d*(\.\d{0,2})?$/.test(raw)) setSaleText(raw)
  }

  const handleSubmit = async () => {
    const salePriceCents = method === 'sold' ? parsePriceInput(saleText) : null
    const check = validateDisposal({
      disposedAt,
      purchaseDate: item.purchaseDate,
      disposalMethod: method,
      salePriceCents,
    })
    if (!check.ok) {
      setError(check.error ?? '输入有误')
      return
    }
    setBusy(true)
    try {
      await onSubmit({
        disposedAt,
        disposalMethod: method,
        salePriceCents,
        disposalNote: note.trim() === '' ? null : note.trim(),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="animate-[pop-in_200ms_cubic-bezier(0.22,1,0.36,1)_both] absolute inset-0 bg-overlay backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="animate-sheet-up relative w-full max-w-[420px] rounded-t-sheet border border-line bg-surface-raised p-5 pb-[calc(24px+env(safe-area-inset-bottom))] shadow-sheet sm:animate-pop-in sm:rounded-sheet sm:pb-5">
        <div className="mx-auto mb-4 h-1 w-9 rounded-pill bg-line-strong sm:hidden" />

        <h2 className="text-section text-ink-primary">处置物品</h2>
        <p className="mt-1 truncate text-caption text-ink-tertiary">{item.name}</p>

        <div className="mt-5">
          <p className="mb-2 text-label text-ink-tertiary">处置方式</p>
          <div className="flex gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                aria-pressed={method === m}
                className={`flex h-10 flex-1 items-center justify-center rounded-control text-secondary transition-colors duration-150 ${
                  method === m
                    ? 'bg-accent font-medium text-ink-inverse'
                    : 'border border-line bg-surface text-ink-secondary'
                }`}
              >
                {DISPOSAL_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-label text-ink-tertiary">处置日期</p>
          <input
            type="date"
            value={disposedAt}
            max={todayString()}
            onChange={(e) => setDisposedAt(e.target.value)}
            className="num h-11 w-full rounded-control border border-line bg-surface px-3 text-body text-ink-primary outline-none transition-colors focus:border-line-strong"
          />
        </div>

        {method === 'sold' && (
          <div className="mt-4">
            <p className="mb-2 text-label text-ink-tertiary">出售金额</p>
            <div className="field-shell flex h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 transition-colors focus-within:border-line-strong">
              <span className="text-body text-ink-tertiary">¥</span>
              <input
                value={saleText}
                onChange={(e) => handleAmount(e.target.value)}
                placeholder="0.00（留空则不计算净成本）"
                inputMode="decimal"
                className="num min-w-0 flex-1 bg-transparent text-body text-ink-primary outline-none placeholder:text-ink-faint"
              />
            </div>
            <p className="mt-1.5 text-caption text-ink-tertiary">
              允许 0。填了之后「实际持有成本 = 总投入 − 出售金额」，卖得比买得多会显示为负数。
            </p>
          </div>
        )}

        {method === 'other' && (
          <div className="mt-4">
            <p className="mb-2 text-label text-ink-tertiary">处置备注</p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：赠送给朋友 / 损坏报废 / 回收"
              className="h-11 w-full rounded-control border border-line bg-surface px-3 text-body text-ink-primary outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong"
            />
          </div>
        )}

        {error && <p className="mt-3 text-caption text-danger">{error}</p>}

        <div className="mt-6 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 flex-1 items-center justify-center rounded-control border border-line bg-surface text-secondary text-ink-secondary transition-opacity active:opacity-70"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy}
            className="flex h-11 flex-1 items-center justify-center rounded-control bg-ink-solid text-secondary font-medium text-ink-inverse transition-opacity active:opacity-70 disabled:opacity-40"
          >
            {busy ? '处理中…' : '确认处置'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
