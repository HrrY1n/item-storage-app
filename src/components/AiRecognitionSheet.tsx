import { useEffect, useRef, useState } from 'react'
import type { Category } from '../domain/types'
import { matchRecognitionCategory, RECOGNITION_FIELDS, type RecognitionCandidate, type RecognitionField, type RecognitionMode } from '../domain/recognition'
import { platformLabel } from '../domain/purchase'
import { prepareRecognitionImage, recognizeItemImage } from '../services/recognition'
import ModalSheet from './ModalSheet'

export const RECOGNITION_LABELS: Record<RecognitionField, string> = {
  name: '名称', categoryName: '分类', note: '备注', priceText: '购买价格', purchaseDate: '购买日期', purchasePlatform: '购买平台',
}

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
  const [candidate, setCandidate] = useState<RecognitionCandidate | null>(null)
  const [selected, setSelected] = useState<RecognitionField[]>([])
  const [busy, setBusy] = useState<'preparing' | 'recognizing' | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const albumInput = useRef<HTMLInputElement>(null)

  const cancel = () => {
    generation.current++
    controller.current?.abort()
    setBusy(null)
  }
  useEffect(() => {
    if (!open) cancel()
    return () => { generation.current++; controller.current?.abort() }
  }, [open])

  const chooseFile = async (file?: File) => {
    if (!file) return
    cancel()
    const run = ++generation.current
    setCandidate(null); setError(''); setBusy('preparing')
    try {
      const prepared = await prepareRecognitionImage(file)
      if (run === generation.current) setImage(prepared)
    } catch (error) {
      if (run === generation.current) setError(error instanceof Error ? error.message : '无法读取图片。')
    } finally { if (run === generation.current) setBusy(null) }
  }
  const recognize = async () => {
    if (!image || busy) return
    const run = ++generation.current
    const request = new AbortController()
    controller.current = request
    setCandidate(null); setError(''); setBusy('recognizing')
    try {
      const names = [...new Set(categories.filter(category => category.deletedAt === null
        && !categories.some(child => child.deletedAt === null && child.parentId === category.id)).map(category => category.name))].slice(0, 100)
      const result = await recognizeItemImage(image, mode, names, request.signal)
      if (run !== generation.current) return
      setCandidate(result)
      setSelected(RECOGNITION_FIELDS.filter(field => result[field] !== null && !current[field]
        && (allowPurchaseInfo || ['name', 'categoryName', 'note'].includes(field))
        && (field !== 'categoryName' || !!matchRecognitionCategory(result.categoryName, categories))))
    } catch (error) {
      if (run === generation.current && !request.signal.aborted) setError(error instanceof Error ? error.message : '识别失败，可以重试。')
    } finally { if (run === generation.current) setBusy(null) }
  }
  const close = () => { cancel(); onClose() }

  return <ModalSheet open={open} variant="picker" size={image ? 'tall' : 'content'} label="AI 辅助录入" onClose={close}
    onExited={() => { setImage(null); setCandidate(null); setError('') }}>
    <header className="flex shrink-0 items-center justify-between px-5 py-3">
      <h2 className="text-section text-ink-primary">AI 辅助录入</h2>
      <button data-modal-autofocus type="button" onClick={close} aria-label="关闭 AI 识别" className="h-11 rounded-control px-3 text-secondary text-ink-secondary">关闭</button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
      <p className="text-secondary leading-relaxed text-ink-tertiary">识别后先核对，再填入表单。只有点击保存才会保存物品。</p>
      <div className="mt-4 flex gap-2" role="group" aria-label="识别模式">
        {(['photo', 'order'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={!!busy}
          onClick={() => { setMode(value); setCandidate(null); setError('') }}
          className={`min-h-11 flex-1 rounded-control border px-3 text-secondary ${mode === value ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-ink-secondary'}`}>
          {value === 'photo' ? '物品照片' : '订单截图'}
        </button>)}
      </div>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" data-ai-file="camera"
        onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = '' }} />
      <input ref={albumInput} type="file" accept="image/*" className="hidden" data-ai-file="album"
        onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = '' }} />
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={!!busy} onClick={() => cameraInput.current?.click()} className="min-h-11 flex-1 rounded-control border border-line bg-surface px-3 text-secondary text-ink-primary disabled:opacity-40">拍照</button>
        <button type="button" disabled={!!busy} onClick={() => albumInput.current?.click()} className="min-h-11 flex-1 rounded-control border border-line bg-surface px-3 text-secondary text-ink-primary disabled:opacity-40">选择图片</button>
      </div>
      {image && <img src={image} alt="待识别图片预览" className="mt-4 max-h-52 w-full rounded-card border border-line bg-surface object-contain" />}
      <p className="mt-3 text-caption leading-relaxed text-ink-tertiary">开始后，将当前图片和可用分类名称发送至 Cloudflare AI。本应用不保存原图。免费额度用尽后暂停识别。</p>
      {mode === 'photo' && <p className="mt-2 text-caption text-ink-tertiary">物品照片只辅助识别外观信息，购买价格和日期仍由你填写。</p>}
      {busy && <p role="status" className="mt-4 text-secondary text-ink-secondary">{busy === 'preparing' ? '正在准备图片…' : '正在识别，请稍候…'}</p>}
      {error && <p role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-secondary leading-relaxed text-danger">{error}</p>}
      {busy === 'recognizing'
        ? <button type="button" onClick={cancel} className="mt-4 min-h-11 w-full rounded-control border border-line bg-surface text-secondary text-ink-primary">取消识别</button>
        : <button type="button" disabled={!image || !!busy} onClick={() => void recognize()} className="mt-4 min-h-11 w-full rounded-control bg-ink-solid px-3 text-secondary font-medium text-ink-inverse disabled:opacity-40">{candidate ? '重新识别' : '开始识别'}</button>}
      {candidate && <section className="mt-5" aria-label="识别结果">
        <h3 className="text-item text-ink-primary">选择要填入的内容</h3>
        <p className="mt-1 text-caption text-ink-tertiary">已有内容默认保留；勾选对应字段会替换该字段。</p>
        <div className="mt-3 divide-y divide-line rounded-card border border-line bg-surface px-3">
          {RECOGNITION_FIELDS.filter(field => candidate[field] !== null && (allowPurchaseInfo || ['name', 'categoryName', 'note'].includes(field))).map(field => {
            const unmatched = field === 'categoryName' && !matchRecognitionCategory(candidate.categoryName, categories)
            return <label key={field} className="flex min-h-14 items-start gap-3 py-3 text-secondary text-ink-primary">
              <input type="checkbox" checked={selected.includes(field)} disabled={unmatched} className="mt-1 h-4 w-4 accent-current"
                onChange={event => setSelected(values => event.target.checked ? [...values, field] : values.filter(value => value !== field))} />
              <span className="min-w-0 flex-1"><span className="block text-caption text-ink-tertiary">{RECOGNITION_LABELS[field]}{current[field] ? ' · 已有内容' : ''}</span>
                <span className="mt-1 block whitespace-pre-wrap break-words">{field === 'purchasePlatform' ? platformLabel(candidate.purchasePlatform) : candidate[field]}</span>
                {unmatched && <span className="mt-1 block text-caption text-ink-tertiary">未匹配到唯一分类，请回到表单选择。</span>}
              </span>
            </label>
          })}
        </div>
        {candidate.warnings.map((warning, index) => <p key={index} className="mt-2 text-caption leading-relaxed text-ink-tertiary">{warning}</p>)}
        <button type="button" disabled={selected.length === 0} onClick={() => {
          const values: Partial<RecognitionCandidate> = {}
          for (const field of selected) Object.assign(values, { [field]: candidate[field] })
          onApply(values); close()
        }} className="mt-4 min-h-11 w-full rounded-control bg-ink-solid px-3 text-secondary font-medium text-ink-inverse disabled:opacity-40">填入表单</button>
      </section>}
    </div>
  </ModalSheet>
}
