import { useEffect, useRef, useState } from 'react'
import type { Category } from '../domain/types'
import { matchRecognitionCategory, RECOGNITION_FIELDS, RECOGNITION_LABELS, validateRecognitionCandidate, type RecognitionCandidate, type RecognitionField, type RecognitionMode } from '../domain/recognition'
import { platformLabel, PURCHASE_PLATFORMS, todayString } from '../domain/purchase'
import { prepareRecognitionImage, recognizeItemImage } from '../services/recognition'
import DateField from './DateField'
import ModalSheet from './ModalSheet'

export default function AiRecognitionSheet({ open, onClose, categories, current, allowPurchaseInfo, onApply }: {
  open: boolean
  onClose: () => void
  categories: Category[]
  current: Record<RecognitionField, string>
  allowPurchaseInfo: boolean
  onApply: (values: Partial<RecognitionCandidate>) => void
}) {
  const [mode, setMode] = useState<RecognitionMode>('photo')
  const [image, setImage] = useState<string | null>(null)
  const [source, setSource] = useState<{ file: File; image: string; width: number; height: number } | null>(null)
  const [crop, setCrop] = useState({ top: 0, bottom: 100 })
  const [cropOpen, setCropOpen] = useState(false)
  const [cropped, setCropped] = useState(false)
  const [candidate, setCandidate] = useState<RecognitionCandidate | null>(null)
  const [selected, setSelected] = useState<RecognitionField[]>([])
  const [busy, setBusy] = useState<'preparing' | 'recognizing' | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const albumInput = useRef<HTMLInputElement>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const cropHeading = useRef<HTMLHeadingElement>(null)
  const errorMessage = useRef<HTMLParagraphElement>(null)
  const hasCandidate = !!candidate
  const needsCrop = !!source && source.height > source.width * 3.5 && !cropped
  const availableCategories = categories.filter(category => category.deletedAt === null
    && !categories.some(child => child.deletedAt === null && child.parentId === category.id)
    && !!matchRecognitionCategory(category.name, categories))
  const fields = RECOGNITION_FIELDS.filter(field => ['name', 'categoryName', 'note'].includes(field) || (mode === 'order' && allowPurchaseInfo))
  const inputClass = 'mt-1 min-h-11 w-full min-w-0 rounded-control border border-line-strong bg-surface-sunken px-3 text-[16px] text-ink-primary'

  const cancel = () => {
    generation.current++
    controller.current?.abort()
    setBusy(null)
  }
  useEffect(() => {
    if (!open) cancel()
    return () => { generation.current++; controller.current?.abort() }
  }, [open])
  useEffect(() => {
    if (!hasCandidate) return
    resultHeading.current?.focus({ preventScroll: true })
    resultHeading.current?.scrollIntoView({ block: 'start' })
  }, [hasCandidate])
  useEffect(() => {
    if (!cropOpen) return
    cropHeading.current?.focus({ preventScroll: true })
    cropHeading.current?.scrollIntoView({ block: 'start' })
  }, [cropOpen])
  useEffect(() => {
    if (!error) return
    errorMessage.current?.focus({ preventScroll: true })
    errorMessage.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  const chooseFile = async (file?: File, region?: typeof crop) => {
    if (!file) return
    cancel()
    const run = ++generation.current
    setImage(null); setCandidate(null); setSelected([]); setError(''); setBusy('preparing')
    if (!region) { setSource(null); setCropOpen(false); setCropped(false) }
    try {
      const prepared = await prepareRecognitionImage(file, region)
      if (run !== generation.current) return
      if (region && prepared.height > prepared.width * 3.5) throw new Error('选区仍然过长，请缩小到商品名称、实付金额和日期所在的区域。')
      setImage(prepared.image)
      if (!region) {
        setSource({ file, ...prepared })
        setCrop({ top: 0, bottom: Math.min(100, Math.max(1, Math.round(prepared.width * 2.5 / prepared.height * 100))) })
      }
      setCropped(!!region)
      setCropOpen(!region && prepared.height > prepared.width * 3.5)
    } catch (error) {
      if (run === generation.current) setError(error instanceof Error ? error.message : '无法读取图片。')
    } finally { if (run === generation.current) setBusy(null) }
  }
  const recognize = async () => {
    if (!image || busy || needsCrop || cropOpen) return
    const run = ++generation.current
    const request = new AbortController()
    controller.current = request
    setCandidate(null); setSelected([]); setError(''); setBusy('recognizing')
    try {
      const names = [...new Set(availableCategories.map(category => category.name))].slice(0, 100)
      const result = await recognizeItemImage(image, mode, names, request.signal)
      if (run !== generation.current) return
      setCandidate(result)
      setSelected(fields.filter(field => result[field] !== null && !current[field]
        && (field !== 'categoryName' || !!matchRecognitionCategory(result.categoryName, availableCategories))))
    } catch (error) {
      if (run === generation.current && !request.signal.aborted) setError(error instanceof Error ? error.message : '识别失败，可以重试。')
    } finally { if (run === generation.current) setBusy(null) }
  }
  const close = () => { cancel(); onClose() }
  const edit = (field: RecognitionField, value: string) => {
    setCandidate(previous => previous && { ...previous, [field]: value || null })
    setSelected(values => value ? [...new Set([...values, field])] : values.filter(value => value !== field))
    setError('')
  }
  const apply = () => {
    if (!candidate || !selected.length) return
    try {
      const values = validateRecognitionCandidate(Object.fromEntries(selected.map(field => [field, candidate[field]])), mode)
      if (selected.some(field => values[field] === null)
        || (selected.includes('categoryName') && !matchRecognitionCategory(values.categoryName, availableCategories))) {
        setError('请检查已勾选的内容；金额最多两位小数，分类需从现有分类中选择。')
        return
      }
      onApply(Object.fromEntries(selected.map(field => [field, values[field]])))
      close()
    } catch { setError('请先勾选有效内容，也可以关闭识别并在表单中手动填写。') }
  }

  return <ModalSheet open={open} variant="picker" size={source || busy === 'preparing' ? 'tall' : 'content'} label="AI 辅助录入" onClose={close}
    onExited={() => { setImage(null); setSource(null); setCandidate(null); setSelected([]); setError(''); setCropOpen(false); setMode('photo') }}>
    <header className="flex shrink-0 items-center justify-between px-5 py-3">
      <h2 className="text-section text-ink-primary">AI 辅助录入</h2>
      <button data-modal-autofocus type="button" onClick={close} aria-label="关闭 AI 识别" className="h-11 rounded-control px-3 text-secondary text-ink-secondary">关闭</button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4" data-ai-content>
      <p className="text-secondary leading-relaxed text-ink-tertiary">先选择图片类型，识别后核对。填入表单后仍需点击保存。</p>
      <div className="mt-4 flex gap-2" role="group" aria-label="识别模式">
        {(['photo', 'order'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={!!busy}
          onClick={() => { setMode(value); setCandidate(null); setSelected([]); setError('') }}
          className={`min-h-11 flex-1 rounded-control border px-3 text-secondary disabled:opacity-40 ${mode === value ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-ink-secondary'}`}>
          {value === 'photo' ? '物品照片' : '订单截图'}
        </button>)}
      </div>
      <p className="mt-2 text-caption leading-relaxed text-ink-tertiary">{mode === 'photo'
        ? '拍摄物品或选择实物照片，识别名称、分类和外观；不会估算购买价格和日期。'
        : '导入订单截图，提取单件商品、实付金额、完整购买日期和平台。长截图请先裁剪。'}{!allowPurchaseInfo && '心愿物品仅填入名称、分类和备注。'}</p>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" data-ai-file="camera"
        onChange={event => { if (event.target.files?.[0]) setMode('photo'); void chooseFile(event.target.files?.[0]); event.target.value = '' }} />
      <input ref={albumInput} type="file" accept="image/*" className="hidden" data-ai-file="album"
        onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = '' }} />
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={!!busy} onClick={() => cameraInput.current?.click()} className="min-h-11 flex-1 rounded-control border border-line bg-surface px-3 text-secondary text-ink-primary disabled:opacity-40">拍照</button>
        <button type="button" disabled={!!busy} onClick={() => albumInput.current?.click()} className="min-h-11 flex-1 rounded-control border border-line bg-surface px-3 text-secondary text-ink-primary disabled:opacity-40">{mode === 'photo' ? '选择物品照片' : '导入订单截图'}</button>
      </div>
      {cropOpen && source ? <section className="mt-4 rounded-card border border-line bg-surface p-3" aria-label="裁剪识别区域">
        <h3 ref={cropHeading} tabIndex={-1} className="text-item text-ink-primary outline-none">裁剪识别区域</h3>
        <p className="mt-1 text-caption leading-relaxed text-ink-tertiary">移动上下边界，保留需要识别的商品区域。裁剪在本机完成，确认前不会上传。</p>
        <div className="mt-3 flex items-center gap-5">
          <div className="relative shrink-0">
            <img src={source.image} alt="裁剪区域预览" className="max-h-40 max-w-24 object-contain" />
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-overlay" style={{ height: `${crop.top}%` }} />
            <div className="pointer-events-none absolute inset-x-0 border-2 border-accent" style={{ top: `${crop.top}%`, bottom: `${100 - crop.bottom}%` }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-overlay" style={{ height: `${100 - crop.bottom}%` }} />
          </div>
          <div className="min-w-0 flex-1">
            <label className="block text-caption text-ink-secondary">上边界 {crop.top}%
              <input aria-label="裁剪上边界" type="range" min="0" max="99" value={crop.top} disabled={!!busy} className="block h-11 w-full accent-current"
                onChange={event => setCrop(value => ({ ...value, top: Math.min(Number(event.target.value), value.bottom - 1) }))} />
            </label>
            <label className="block text-caption text-ink-secondary">下边界 {crop.bottom}%
              <input aria-label="裁剪下边界" type="range" min="1" max="100" value={crop.bottom} disabled={!!busy} className="block h-11 w-full accent-current"
                onChange={event => setCrop(value => ({ ...value, bottom: Math.max(Number(event.target.value), value.top + 1) }))} />
            </label>
          </div>
        </div>
      </section> : image && <>
        <img src={image} alt="待识别图片预览" className="mt-4 max-h-52 w-full rounded-card border border-line bg-surface object-contain" />
        <button type="button" disabled={!!busy} onClick={() => { setCropOpen(true); setCandidate(null); setSelected([]); setError('') }}
          className="mt-2 min-h-11 w-full rounded-control border border-line px-3 text-secondary text-accent disabled:opacity-40">裁剪识别区域</button>
      </>}
      {needsCrop && <p className="mt-2 text-caption leading-relaxed text-ink-tertiary">这是一张长截图，整张缩小会让文字难以辨认，请先选取局部区域。</p>}
      <p className="mt-3 text-caption leading-relaxed text-ink-tertiary">点击开始后才将当前图片与分类名称发送至 Cloudflare AI。本应用不保存原图，免费额度用尽后暂停识别。</p>
      {error && <p ref={errorMessage} tabIndex={-1} role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-secondary leading-relaxed text-danger outline-none">{error}</p>}
      {candidate && <section className="mt-5" aria-label="识别结果">
        <h3 ref={resultHeading} tabIndex={-1} className="text-item text-ink-primary outline-none">识别完成，请核对</h3>
        <p className="mt-1 text-caption leading-relaxed text-ink-tertiary">已有内容默认保留；勾选后才替换。可直接修改结果，或补充没有识别到的字段。</p>
        {candidate.warnings.length > 0 && <p className="mt-2 rounded-control bg-surface-sunken p-3 text-caption leading-relaxed text-ink-secondary">{candidate.warnings.join(' ')}</p>}
        <div className="mt-3 divide-y divide-line rounded-card border border-line bg-surface px-3">
          {fields.map(field => {
            const unmatched = field === 'categoryName' && candidate.categoryName && !matchRecognitionCategory(candidate.categoryName, availableCategories)
            return <div key={field} data-ai-field={field} className="flex items-start gap-3 py-3 text-secondary text-ink-primary">
              <label className="flex min-h-11 min-w-11 items-center justify-center" aria-label={`填入${RECOGNITION_LABELS[field]}`}>
                <input type="checkbox" checked={selected.includes(field)} disabled={!candidate[field] || !!unmatched} className="h-5 w-5 accent-current"
                  onChange={event => setSelected(values => event.target.checked ? [...values, field] : values.filter(value => value !== field))} />
              </label>
              <div className="min-w-0 flex-1">
                {field === 'purchaseDate' ? <p className="mb-1 text-caption text-ink-tertiary">购买日期{current[field] ? ' · 已有内容' : ''}</p>
                  : <label htmlFor={`ai-${field}`} className="block text-caption text-ink-tertiary">{RECOGNITION_LABELS[field]}{current[field] ? ' · 已有内容' : ''}</label>}
                {field === 'categoryName' ? <>
                  <select id={`ai-${field}`} value={unmatched ? '' : candidate.categoryName ?? ''} className={inputClass} onChange={event => edit(field, event.target.value)}>
                    <option value="">请选择分类</option>
                    {availableCategories.map(category => <option key={category.id} value={category.name}>{categories.find(parent => parent.id === category.parentId)?.name} / {category.name}</option>)}
                  </select>
                  {unmatched && <p className="mt-1 text-caption text-ink-tertiary">建议“{candidate.categoryName}”未匹配，请在上方选择现有分类。</p>}
                </> : field === 'purchasePlatform' ? <select id={`ai-${field}`} value={candidate.purchasePlatform ?? ''} className={inputClass} onChange={event => edit(field, event.target.value)}>
                  <option value="">未识别，可选择</option>
                  {PURCHASE_PLATFORMS.map(platform => <option key={platform} value={platform}>{platformLabel(platform)}</option>)}
                </select> : field === 'purchaseDate' ? <DateField label="识别购买日期" value={candidate.purchaseDate ?? ''} max={todayString()} onChange={value => edit(field, value)} />
                  : field === 'note' ? <textarea id={`ai-${field}`} value={candidate.note ?? ''} maxLength={1000} rows={2} placeholder="未识别，可补充" className={`${inputClass} py-2`} onChange={event => edit(field, event.target.value)} />
                  : <input id={`ai-${field}`} value={candidate[field] ?? ''} maxLength={field === 'name' ? 100 : 14} inputMode={field === 'priceText' ? 'decimal' : 'text'} placeholder="未识别，可补充" className={inputClass} onChange={event => edit(field, event.target.value)} />}
              </div>
            </div>
          })}
        </div>
      </section>}
    </div>
    <footer data-ai-actions className="shrink-0 border-t border-line bg-surface-raised px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
      {busy && <p role="status" className="mb-2 text-secondary text-ink-secondary">{busy === 'preparing' ? '正在准备图片…' : '正在识别，请稍候，通常需要数秒至一分钟…'}</p>}
      {!busy && <p className="mb-2 text-caption text-ink-tertiary">{candidate ? selected.length ? `已选择 ${selected.length} 项，填入后请在表单中保存。` : '请勾选或补充要填入的内容，也可关闭后手动填写。' : cropOpen ? '确认区域后，再点击开始识别。' : needsCrop ? '长截图请先裁剪商品区域。' : image ? '图片已准备好，点击开始识别。' : '请选择图片；选择后不会自动上传。'}</p>}
      <div className="flex gap-2">
        {busy === 'recognizing' ? <button type="button" onClick={cancel} className="min-h-11 w-full rounded-control border border-line bg-surface text-secondary text-ink-primary">取消识别</button>
          : cropOpen && source ? <>
            <button type="button" disabled={!!busy} onClick={() => setCropOpen(false)} className="min-h-11 rounded-control border border-line px-3 text-secondary text-ink-secondary disabled:opacity-40">取消裁剪</button>
            <button type="button" disabled={!!busy} onClick={() => void chooseFile(source.file, crop)} className="min-h-11 flex-1 rounded-control bg-ink-solid px-3 text-secondary text-ink-inverse disabled:opacity-40">使用此区域</button>
          </> : <>
            <button type="button" disabled={(!image && !needsCrop) || !!busy} onClick={() => needsCrop ? setCropOpen(true) : void recognize()}
              className={`min-h-11 flex-1 rounded-control px-3 text-secondary font-medium disabled:opacity-40 ${candidate ? 'border border-line bg-surface text-ink-primary' : 'bg-ink-solid text-ink-inverse'}`}>{needsCrop ? '裁剪图片' : candidate ? '重新识别' : '开始识别'}</button>
            {candidate && <button type="button" disabled={selected.length === 0} onClick={apply} className="min-h-11 flex-1 rounded-control bg-ink-solid px-3 text-secondary font-medium text-ink-inverse disabled:opacity-40">填入表单</button>}
          </>}
      </div>
    </footer>
  </ModalSheet>
}
