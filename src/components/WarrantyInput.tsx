import { useId } from 'react'
import { WARRANTY_MONTH_OPTIONS, warrantyDate, type WarrantySelection } from '../domain/warranty'
import DateField from './DateField'

export default function WarrantyInput({ purchaseDate, value, onChange }: {
  purchaseDate: string
  value: WarrantySelection
  onChange: (value: WarrantySelection) => void
}) {
  const monthsId = useId()
  const expiresAt = warrantyDate(purchaseDate, value)
  const chipClass = (selected: boolean) => `flex min-h-11 items-center justify-center rounded-control border px-2 text-secondary transition-colors ${selected ? 'border-accent-line bg-accent-soft font-medium text-accent' : 'border-line bg-surface-sunken text-ink-secondary'}`
  return <div data-warranty-input>
    <p className="mb-2 text-label text-ink-tertiary">保修期</p>
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="保修月数">
      {WARRANTY_MONTH_OPTIONS.map(months => <button key={months} type="button" aria-pressed={value.kind === 'months' && value.months === months}
        onClick={() => onChange({ kind: 'months', months })} className={chipClass(value.kind === 'months' && value.months === months)}>{months} 个月</button>)}
      <button type="button" aria-pressed={value.kind === 'custom'} onClick={() => { if (value.kind !== 'custom') onChange({ kind: 'custom', months: '' }) }} className={chipClass(value.kind === 'custom')}>自定义</button>
      <button type="button" aria-pressed={value.kind === 'none'} onClick={() => onChange({ kind: 'none' })} className={chipClass(value.kind === 'none')}>不适用</button>
    </div>
    {value.kind === 'custom' && <div className="mt-3 flex items-center gap-2">
      <label htmlFor={monthsId} className="shrink-0 text-caption text-ink-secondary">保修月数</label>
      <input id={monthsId} inputMode="numeric" value={value.months} placeholder="例如 18" maxLength={4}
        onChange={event => { if (/^\d*$/.test(event.target.value)) onChange({ kind: 'custom', months: event.target.value }) }}
        className="num h-11 min-w-0 flex-1 rounded-control border border-line bg-surface-sunken px-3 text-[16px] text-ink-primary" />
      <span className="text-caption text-ink-tertiary">个月</span>
    </div>}
    <div className="mb-2 mt-4 flex items-center justify-between text-caption text-ink-tertiary">
      <span>保修到期日</span><span>{value.kind === 'date' ? '手动指定日期' : value.kind === 'none' ? '不记录保修' : '按购买日期计算'}</span>
    </div>
    <DateField label="保修到期日" value={expiresAt ?? ''} min={purchaseDate || undefined}
      onChange={date => onChange(date ? { kind: 'date', date } : { kind: 'none' })} />
    <p className="mt-2 text-caption leading-relaxed text-ink-tertiary">
      {(value.kind === 'months' || value.kind === 'custom') && !purchaseDate
        ? '选择购买日期后自动计算；未填购买日期时不记录保修。'
        : value.kind === 'date' ? '保留此到期日，也可以选择月数重新计算。'
        : value.kind === 'none' ? '此物品不参与保修提醒。'
        : '按自然月计算，月末取目标月最后一天；到期前 30 天提醒。'}
    </p>
  </div>
}
