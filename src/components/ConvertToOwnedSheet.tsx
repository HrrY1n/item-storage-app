import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Item, PurchasePlatform } from '../domain/types'
import { PURCHASE_PLATFORMS, parsePriceInput, platformLabel, todayString } from '../domain/purchase'

export interface PurchaseInput {
  purchaseDate: string
  purchasePriceCents: number | null
  additionalCostCents: number | null
  purchasePlatform: PurchasePlatform | null
  warrantyExpiresAt: string | null
}

/**
 * 心愿 → 持有。
 *
 * 之所以单独做一个面板而不是让用户去编辑页：心愿物品本来就没有购买信息，
 * 「买到了」是一个**明确的事件**，应该在详情页就地完成。
 */
export default function ConvertToOwnedSheet({
  open,
  item,
  onSubmit,
  onClose,
}: {
  open: boolean
  item: Item
  onSubmit: (input: PurchaseInput) => void | Promise<void>
  onClose: () => void
}) {
  const [purchaseDate, setPurchaseDate] = useState(todayString())
  const [priceText, setPriceText] = useState('')
  const [extraText, setExtraText] = useState('')
  const [platform, setPlatform] = useState<PurchasePlatform | null>(null)
  const [warranty, setWarranty] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setPurchaseDate(todayString())
    setPriceText('')
    setExtraText('')
    setPlatform(null)
    setWarranty('')
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

  const amount = (raw: string, set: (v: string) => void) => {
    if (raw === '' || /^\d*(\.\d{0,2})?$/.test(raw)) set(raw)
  }

  const handleSubmit = async () => {
    if (warranty !== '' && warranty < purchaseDate) {
      setError('保修到期日不能早于购买日期')
      return
    }
    setBusy(true)
    try {
      await onSubmit({
        purchaseDate,
        purchasePriceCents: parsePriceInput(priceText),
        additionalCostCents: parsePriceInput(extraText),
        purchasePlatform: platform,
        warrantyExpiresAt: warranty === '' ? null : warranty,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
      setBusy(false)
    }
  }

  const fieldShell =
    'field-shell flex h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 transition-colors focus-within:border-line-strong'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="animate-[pop-in_200ms_cubic-bezier(0.22,1,0.36,1)_both] absolute inset-0 bg-overlay backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="animate-sheet-up relative w-full max-w-[420px] rounded-t-sheet border border-line bg-surface-raised p-5 pb-[calc(24px+env(safe-area-inset-bottom))] shadow-sheet sm:animate-pop-in sm:rounded-sheet sm:pb-5">
        <div className="mx-auto mb-4 h-1 w-9 rounded-pill bg-line-strong sm:hidden" />

        <h2 className="text-section text-ink-primary">转为持有</h2>
        <p className="mt-1 truncate text-caption text-ink-tertiary">{item.name}</p>

        <div className="mt-5">
          <p className="mb-2 text-label text-ink-tertiary">购买日期</p>
          <input
            type="date"
            value={purchaseDate}
            max={todayString()}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className="num h-11 w-full rounded-control border border-line bg-surface px-3 text-body text-ink-primary outline-none transition-colors focus:border-line-strong"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <p className="mb-2 text-label text-ink-tertiary">购买价格</p>
            <div className={fieldShell}>
              <span className="text-body text-ink-tertiary">¥</span>
              <input
                value={priceText}
                onChange={(e) => amount(e.target.value, setPriceText)}
                placeholder="0.00"
                inputMode="decimal"
                className="num min-w-0 flex-1 bg-transparent text-body text-ink-primary outline-none placeholder:text-ink-faint"
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-label text-ink-tertiary">附加花费</p>
            <div className={fieldShell}>
              <span className="text-body text-ink-tertiary">¥</span>
              <input
                value={extraText}
                onChange={(e) => amount(e.target.value, setExtraText)}
                placeholder="0.00"
                inputMode="decimal"
                className="num min-w-0 flex-1 bg-transparent text-body text-ink-primary outline-none placeholder:text-ink-faint"
              />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-label text-ink-tertiary">购买平台</p>
          <div className="flex flex-wrap gap-1.5">
            {PURCHASE_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(platform === p ? null : p)}
                aria-pressed={platform === p}
                className={`flex h-8 items-center whitespace-nowrap rounded-pill px-3 text-caption transition-colors duration-150 ${
                  platform === p
                    ? 'bg-accent font-medium text-ink-inverse'
                    : 'bg-surface-sunken text-ink-secondary'
                }`}
              >
                {platformLabel(p)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-label text-ink-tertiary">保修到期日</p>
          <input
            type="date"
            value={warranty}
            min={purchaseDate || undefined}
            onChange={(e) => setWarranty(e.target.value)}
            className="num h-11 w-full rounded-control border border-line bg-surface px-3 text-body text-ink-primary outline-none transition-colors focus:border-line-strong"
          />
        </div>

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
            {busy ? '处理中…' : '确认购入'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
