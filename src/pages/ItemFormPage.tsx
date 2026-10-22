import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useItemPanel } from '../components/ItemPanel'
import { childrenOf } from '../domain/categoryTree'
import { presetIconOfAssetId } from '../data/icons'
import type { ItemStatus, PurchasePlatform } from '../domain/types'
import { ITEM_STATUS_LABELS, statusOf } from '../domain/lifecycle'
import {
  PURCHASE_PLATFORMS,
  calculateDailyCostCents,
  calculateOwnershipDays,
  calculateTotalCostCents,
  centsToPriceInput,
  formatCents,
  parsePriceInput,
  platformLabel,
  todayString,
} from '../domain/purchase'
import {
  useCategories,
  useItem,
  useItemTagLinks,
  usePresetAssetMap,
  useTags,
} from '../features/data/hooks'
import { itemRepository } from '../db/repositories/itemRepository'
import { tagRepository } from '../db/repositories/tagRepository'
import PageHeader from '../components/PageHeader'
import ModalSheet from '../components/ModalSheet'
import { CategoryIconTile } from '../components/CategoryCard'
import TagChip from '../components/TagChip'
import ConfirmDialog from '../components/Dialogs'
import { useToast } from '../components/Toast'
import IconPickerSheet from '../components/IconPickerSheet'
import AiRecognitionSheet from '../components/AiRecognitionSheet'
import { matchRecognitionCategory } from '../domain/recognition'
import DateField from '../components/DateField'
import WarrantyInput from '../components/WarrantyInput'
import { DEFAULT_WARRANTY_MONTHS, validateWarranty, warrantyDate, warrantySelectionFromDates, type WarrantySelection } from '../domain/warranty'
import { useUpdateGuard } from '../features/pwa/PwaUpdateContext'

/**
 * 分组容器：与详情页 GroupCard 同一套语言（surface 卡 + label + inner cells）。
 * 编辑页 = 详情页进入编辑状态，而不是另一套后台表单。
 */
function GroupCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <p className="text-label text-ink-tertiary">{title}</p>
        {hint && <p className="text-caption text-ink-tertiary">{hint}</p>}
      </div>
      <div className="overflow-hidden rounded-surface border border-line bg-surface px-4 py-1 shadow-card">
        {children}
      </div>
    </section>
  )
}

/** Inner cell 行：同一分组内的字段行以 hairline 分隔，不再每字段一张卡 */
function FormRow({ children }: { children: ReactNode }) {
  return <div className="py-3.5 [&+&]:border-t [&+&]:border-line-inner">{children}</div>
}

/** 行内字段标签 + 说明 */
function RowLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <p className="text-label text-ink-tertiary">{label}</p>
      {hint && <p className="text-caption text-ink-tertiary">{hint}</p>}
    </div>
  )
}

/** 无边框输入：cell 自身就是容器，输入不再套第二层框（视觉减负，焦点走全局 focus-visible 环） */
const bareInputClass =
  'w-full bg-transparent text-[16px] text-ink-primary outline-none transition-colors placeholder:text-ink-faint'

/** 胶囊选择项（分类 / 平台）：选中用实心墨色；未选中按层级取「浅底」或「白底 + 描边」 */
function ChipButton({
  label,
  selected,
  onClick,
  quiet = false,
}: {
  label: string
  selected: boolean
  onClick: () => void
  quiet?: boolean
}) {
  const restClass = quiet
    ? 'border border-line-strong bg-surface text-ink-secondary'
    : 'bg-surface-sunken text-ink-secondary'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`choice-chip flex min-h-[36px] items-center whitespace-nowrap rounded-pill px-3.5 text-secondary ${
        selected ? 'bg-accent text-ink-inverse' : restClass
      }`}
    >
      {label}
    </button>
  )
}

/** 新增（/items/new）与编辑（/items/:id/edit）共用的物品表单 */
export default function ItemFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const location = useLocation()
  const { toast, show } = useToast()

  const categories = useCategories()
  const tags = useTags()
  const links = useItemTagLinks()
  const assetMap = usePresetAssetMap()
  const existingItem = useItem(isEdit ? id : undefined)

  const [iconAssetId, setIconAssetId] = useState('preset-other')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [recognitionOpen, setRecognitionOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [name, setName] = useState('')
  const [rootId, setRootId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [newTagName, setNewTagName] = useState('')
  // 购买信息（全部可选）
  const [purchaseDate, setPurchaseDate] = useState('')
  const [priceText, setPriceText] = useState('')
  const [additionalCostText, setAdditionalCostText] = useState('')
  const [purchasePlatform, setPurchasePlatform] = useState<PurchasePlatform | null>(null)
  const [status, setStatus] = useState<ItemStatus>('owned')
  const [warranty, setWarranty] = useState<WarrantySelection>({ kind: 'months', months: DEFAULT_WARRANTY_MONTHS })
  const [warrantyExpanded, setWarrantyExpanded] = useState(false)
  const warrantyPanelId = useId()
  const warrantyExpiresAt = warrantyDate(purchaseDate, warranty)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [saving, setSaving] = useState(false)

  /**
   * 编辑态不允许自动刷新到新版本：用户正在输入，reload 会丢掉未保存内容。
   * 发现新版本时改为"新版本已就绪"，保存/离开后自动应用。
   */
  useUpdateGuard(true, 'item-form')

  // 编辑模式：数据就绪后初始化一次表单
  const initialized = useRef(false)
  useEffect(() => {
    if (!isEdit || initialized.current || !existingItem || !categories || !links) return
    initialized.current = true
    setName(existingItem.name)
    setIconAssetId(existingItem.iconAssetId)
    setCategoryId(existingItem.categoryId)
    const cat = categories.find((c) => c.id === existingItem.categoryId)
    setRootId(cat ? (cat.parentId ?? cat.id) : null)
    setNote(existingItem.note)
    setTagIds(links.filter((l) => l.itemId === existingItem.id).map((l) => l.tagId))
    setPurchaseDate(existingItem.purchaseDate ?? '')
    setPriceText(
      existingItem.purchasePriceCents !== null ? centsToPriceInput(existingItem.purchasePriceCents) : '',
    )
    setAdditionalCostText(
      existingItem.additionalCostCents !== null
        ? centsToPriceInput(existingItem.additionalCostCents)
        : '',
    )
    setPurchasePlatform(existingItem.purchasePlatform)
    setStatus(statusOf(existingItem))
    setWarranty(warrantySelectionFromDates(existingItem.purchaseDate, existingItem.warrantyExpiresAt))
    setWarrantyExpanded(existingItem.warrantyExpiresAt !== null)
  }, [isEdit, existingItem, categories, links])

  const loading = !categories || !tags || !links || !assetMap || (isEdit && !initialized.current)

  /** dirty 判定用的表单快照：任何参与保存的字段都必须在此 */
  const formSnapshot = () =>
    JSON.stringify({
      name: name.trim(),
      iconAssetId,
      categoryId,
      tagIds: [...tagIds].sort(),
      note: note.trim(),
      status,
      purchaseDate,
      purchasePriceCents: parsePriceInput(priceText),
      additionalCostCents: parsePriceInput(additionalCostText),
      purchasePlatform,
      warrantyExpiresAt,
      warranty,
    })

  const initialSnapshot = useRef<string>('')
  useEffect(() => {
    if (loading) return
    if (!initialSnapshot.current) initialSnapshot.current = formSnapshot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const dirty = useMemo(() => {
    if (!initialSnapshot.current) return false
    return formSnapshot() !== initialSnapshot.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    name,
    iconAssetId,
    categoryId,
    tagIds,
    note,
    status,
    purchaseDate,
    priceText,
    additionalCostText,
    purchasePlatform,
    warrantyExpiresAt,
    warranty,
  ])

  const handleBack = () => {
    if (dirty) setConfirmDiscard(true)
    else navigate(-1)
  }
  useItemPanel(handleBack, !loading)

  if (loading) {
    const pending = <div><PageHeader title={isEdit ? '编辑物品' : '新增物品'} onBack={() => navigate(-1)} />
      <p className="px-5 py-10 text-secondary text-ink-tertiary" role="status">正在载入表单…</p></div>
    return pending
  }

  const roots = childrenOf(categories, null)
  const childCategories = rootId ? childrenOf(categories, rootId) : []
  const canSave = name.trim().length > 0 && categoryId !== null && !saving
  const currentIcon = presetIconOfAssetId(iconAssetId)
  // 优先用资产表解析（兼容未来的 AI / 拍照资产），缺失时回落到包内 preset 路径
  const iconUrl =
    assetMap?.get(iconAssetId) ?? currentIcon?.path ?? '/icons/items/other.webp'

  // 实时预览：总投入只要填了价格或附加花费任一即可显示
  // 日均使用成本额外需要购买日期（缺日期时只显示总投入，不显示日均）
  const previewTotalCents = calculateTotalCostCents(
    parsePriceInput(priceText),
    parsePriceInput(additionalCostText),
  )
  const previewDailyCents = calculateDailyCostCents(previewTotalCents, purchaseDate || null)
  const previewDays = purchaseDate ? calculateOwnershipDays(purchaseDate) : null
  const today = todayString()

  /** 金额输入只接受「整数 / 最多两位小数」（禁止负数），输入过程不产生非法中间态 */
  const handleAmountChange = (raw: string, set: (v: string) => void) => {
    if (raw === '' || /^\d*(\.\d{0,2})?$/.test(raw)) set(raw)
  }

  const toggleTag = (tid: string) => {
    setTagIds((prev) => (prev.includes(tid) ? prev.filter((t) => t !== tid) : [...prev, tid]))
  }

  const handleAddTag = async () => {
    const raw = newTagName.trim()
    if (!raw) return
    try {
      const tag = await tagRepository.getOrCreate(raw)
      setTagIds((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]))
      setNewTagName('')
    } catch (e) {
      show(e instanceof Error ? e.message : '标签创建失败')
    }
  }

  const handleSave = async () => {
    if (!canSave) return
    const error = status === 'wishlist' ? null : validateWarranty(purchaseDate, warranty)
    if (error) { show(error); return }
    setSaving(true)
    // 心愿物品不携带购买/保修信息（可以之后再转为持有时补齐）
    const isWish = status === 'wishlist'
    const purchase = {
      status,
      purchaseDate: isWish ? null : purchaseDate || null,
      purchasePriceCents: isWish ? null : parsePriceInput(priceText),
      additionalCostCents: isWish ? null : parsePriceInput(additionalCostText),
      purchasePlatform: isWish ? null : purchasePlatform,
      warrantyExpiresAt: isWish ? null : warrantyExpiresAt || null,
      disposedAt: existingItem?.disposedAt ?? null,
      disposalMethod: existingItem?.disposalMethod ?? null,
      salePriceCents: existingItem?.salePriceCents ?? null,
      disposalNote: existingItem?.disposalNote ?? null,
    }
    try {
      if (isEdit && id) {
        await itemRepository.update(id, {
          name,
          categoryId: categoryId!,
          iconAssetId,
          note,
          tagIds,
          ...purchase,
        })
        show('已保存')
        setTimeout(() => navigate(`/items/${id}`, { replace: true, state: location.state }), 300)
      } else {
        const item = await itemRepository.create({
          name,
          categoryId: categoryId!,
          iconAssetId,
          note,
          tagIds,
          ...purchase,
        })
        show('已添加')
        setTimeout(() => navigate(`/items/${item.id}`, { replace: true, state: location.state }), 300)
      }
    } catch (e) {
      show(e instanceof Error ? e.message : '保存失败')
      setSaving(false)
    }
  }

  const content = (
    <div>
      <PageHeader
        title={isEdit ? '编辑物品' : '新增物品'}
        onBack={handleBack}
        backLabel="取消"
        right={
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={`chrome flex h-11 min-w-16 items-center justify-center rounded-pill border border-line px-4 text-secondary transition-colors duration-200 ${
              canSave
                ? 'font-medium text-accent active:opacity-70'
                : 'text-ink-faint'
            }`}
          >
            保存
          </button>
        }
      />

      <div className="flex flex-col gap-4 px-4 pt-8 sm:px-7">
        <section className="form-identity">
          <button type="button" onClick={() => setPickerOpen(true)} className="form-cover" aria-label="更换物品图标">
            <img src={iconUrl} alt="" className="h-full w-full object-contain" draggable={false} />
            <span className="sr-only">{currentIcon?.label ?? '自定义图片'}，点击本行更换图标</span>
            <span className="form-cover-edit" aria-hidden>✎</span>
          </button>
          <p className="text-caption text-white/60">物品名称</p>
          <input value={name} onChange={event => setName(event.target.value)} aria-label="物品名称"
            placeholder="比如：AirPods Pro" className="form-name mt-2 w-full min-w-0 bg-transparent text-[26px] font-semibold leading-tight" />
        </section>
        <button type="button" onClick={() => setRecognitionOpen(true)} data-ai-entry
          className="flex min-h-12 items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left text-ink-primary">
          <span className="flex items-center gap-2"><span className="text-accent" aria-hidden>✦</span><span className="text-item">AI 辅助录入</span></span>
          <span className="text-caption text-ink-tertiary">照片或订单截图 ›</span>
        </button>
        <div className={`grid gap-3 ${status === 'wishlist' ? '' : 'grid-cols-2'}`}>
          <button type="button" aria-label="选择分类" onClick={() => setCategoryOpen(true)} className="form-field-button">
            <span className="text-caption text-ink-tertiary">分类 <span aria-hidden className="float-right">›</span></span>
            <span className="mt-2 block truncate text-item text-ink-primary">{categories.find(category => category.id === categoryId)?.name ?? (rootId ? '请选择子分类' : '请选择')}</span>
          </button>
          {status !== 'wishlist' && <button type="button" aria-label="选择购买来源" onClick={() => setSourceOpen(true)} className="form-field-button">
            <span className="text-caption text-ink-tertiary">购买来源 <span aria-hidden className="float-right">›</span></span>
            <span className="mt-2 block truncate text-item text-ink-primary">{purchasePlatform ? platformLabel(purchasePlatform) : '请选择'}</span>
          </button>}
        </div>
        {/* ---------- 基本信息 ---------- */}
        <GroupCard title="基本信息">
          {/* 生命周期：只在新增时选。之后的状态变更走详情页的「转为持有 / 处置 / 恢复为持有」，
              避免两处入口互相覆盖。 */}
          {!isEdit && (
            <FormRow>
              <RowLabel label="状态" />
              <div className="flex gap-2">
                {(['owned', 'wishlist'] as ItemStatus[]).map((s) => (
                  <ChipButton
                    key={s}
                    label={ITEM_STATUS_LABELS[s]}
                    selected={status === s}
                    onClick={() => setStatus(s)}
                  />
                ))}
              </div>
              <p className="mt-2 text-caption text-ink-tertiary">
                {status === 'wishlist'
                  ? '心愿物品可以完全没有购买信息，购入后再转为持有并补齐。'
                  : '持有中的物品会参与总投入、日均成本与保修提醒。'}
              </p>
            </FormRow>
          )}

          <FormRow>
            <RowLabel label="标签" hint={tagIds.length > 0 ? `已选 ${tagIds.length}` : '可多选'} />
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  name={tag.name}
                  selected={tagIds.includes(tag.id)}
                  onClick={() => toggleTag(tag.id)}
                />
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleAddTag()
                  }
                }}
                placeholder="新建标签，如：白色"
                className={`${bareInputClass} h-11 min-w-0 flex-1 rounded-control bg-surface-sunken px-4 text-body`}
              />
              <button
                type="button"
                onClick={() => void handleAddTag()}
                disabled={!newTagName.trim()}
                className={`h-11 shrink-0 rounded-control px-4 text-secondary transition-colors ${
                  newTagName.trim()
                    ? 'bg-ink-solid font-medium text-ink-inverse active:opacity-70'
                    : 'bg-surface-sunken text-ink-faint'
                }`}
              >
                添加
              </button>
            </div>
          </FormRow>
        </GroupCard>

        {/* ---------- 购买信息（心愿物品不需要） ---------- */}
        {status === 'wishlist' ? (
          <GroupCard title="购买信息">
            <FormRow>
              <p className="text-body text-ink-tertiary">
                心愿物品不需要购买信息。购入之后，在详情页点「转为持有」再补齐价格、日期与保修。
              </p>
            </FormRow>
          </GroupCard>
        ) : (
          <GroupCard title="购买信息" hint="全部可选">
            <FormRow>
              <RowLabel label="购买日期" />
              <DateField label="购买日期" value={purchaseDate} max={today} onChange={setPurchaseDate} />
            </FormRow>

            <FormRow>
            <button type="button" aria-expanded={warrantyExpanded} aria-controls={warrantyPanelId}
                data-warranty-toggle onClick={event => {
                  if (warrantyExpanded) event.currentTarget.focus({ preventScroll: true })
                  setWarrantyExpanded(value => !value)
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-control text-left text-ink-primary">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-info-soft text-info" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></svg>
                </span>
                <span className="min-w-0 flex-1"><span className="block text-body">保修信息</span><span className="mt-0.5 block truncate text-caption text-ink-tertiary">
                  {warrantyExpiresAt ? `到期日 ${warrantyExpiresAt}` : warranty.kind === 'none' ? '不记录保修' : '选择购买日期后计算到期日'}
                </span></span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"
                  className={`shrink-0 text-ink-tertiary transition-transform duration-200 ${warrantyExpanded ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
              </button>
              <div id={warrantyPanelId} className="warranty-disclosure" data-open={warrantyExpanded} aria-hidden={!warrantyExpanded} inert={!warrantyExpanded}>
                <div className="min-h-0 overflow-hidden"><div className="pt-4">
                  <WarrantyInput purchaseDate={purchaseDate} value={warranty} onChange={setWarranty} />
                </div></div>
              </div>
            </FormRow>

            {/* 购买价格 + 附加花费：并排布局，缩短表单高度（快速录入优先） */}
            <FormRow>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <RowLabel label="购买价格" />
                  <div className="flex h-11 items-center gap-2 rounded-control bg-surface-sunken px-3 transition-colors">
                    <span className="text-body text-ink-tertiary">¥</span>
                    <input
                      value={priceText}
                      onChange={(e) => handleAmountChange(e.target.value, setPriceText)}
                      placeholder="0.00"
                      inputMode="decimal"
                      className={`num min-w-0 flex-1 ${bareInputClass}`}
                    />
                  </div>
                </div>
                <div>
                  <RowLabel label="附加花费" />
                  <div className="flex h-11 items-center gap-2 rounded-control bg-surface-sunken px-3 transition-colors">
                    <span className="text-body text-ink-tertiary">¥</span>
                    <input
                      value={additionalCostText}
                      onChange={(e) => handleAmountChange(e.target.value, setAdditionalCostText)}
                      placeholder="0.00"
                      inputMode="decimal"
                      className={`num min-w-0 flex-1 ${bareInputClass}`}
                    />
                  </div>
                  <p className="mt-1.5 text-caption text-ink-tertiary">配件 / 维修 / 升级</p>
                </div>
              </div>
            </FormRow>

            {/* 实时预览：总投入 / 已持有天数 / 日均使用成本 */}
            {previewTotalCents !== null && (
              <FormRow>
                <div className="overflow-hidden rounded-control border border-money-line bg-money-soft">
                  <div className="flex items-baseline justify-between px-3.5 py-3">
                    <p className="text-label text-ink-tertiary">总投入</p>
                    <p className="num text-item text-ink-primary">
                      {formatCents(previewTotalCents)}
                    </p>
                  </div>
                  {previewDailyCents !== null && previewDays !== null && (
                    <div className="border-t border-money-line px-3.5 py-3">
                      <div className="flex items-baseline justify-between">
                        <p className="text-label text-money-deep">日均使用成本</p>
                        <p className="flex items-baseline gap-1">
                          <span className="num text-metric text-ink-primary">
                            {formatCents(previewDailyCents)}
                          </span>
                          <span className="text-caption text-ink-secondary">/ 天</span>
                        </p>
                      </div>
                      <p className="num mt-1.5 text-caption text-ink-tertiary">
                        已持有 {previewDays} 天
                      </p>
                    </div>
                  )}
                </div>
              </FormRow>
            )}
          </GroupCard>
        )}

        {/* ---------- 备注 ---------- */}
        <GroupCard title="备注">
          <FormRow>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="可选，比如购买渠道、使用场景……"
              rows={3}
              className={`${bareInputClass} resize-none leading-relaxed`}
            />
          </FormRow>
        </GroupCard>

        {/* ---------- 底部动作区：主操作拇指可达，取消是次操作；危险操作不进表单 ---------- */}
        <div className="animate-fade-rise flex flex-col gap-2.5 pb-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={`flex h-12 items-center justify-center gap-2 rounded-control text-body font-medium transition-all duration-150 ${
              canSave
                ? 'bg-accent text-ink-inverse shadow-card active:scale-[0.98] active:opacity-80'
                : 'bg-surface-sunken text-ink-faint'
            }`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="m8.5 12.5 2.5 2.5 4.5-5" />
            </svg>
            {isEdit ? '保存更改' : '添加物品'}
          </button>
          <button
            type="button"
            onClick={handleBack}
            className="flex h-12 items-center justify-center rounded-control border border-line bg-surface text-body text-ink-secondary transition-colors active:bg-surface-sunken"
          >
            {isEdit ? '取消编辑' : '取消'}
          </button>
        </div>
      </div>

      <IconPickerSheet
        open={pickerOpen}
        value={iconAssetId}
        onSelect={setIconAssetId}
        onClose={() => setPickerOpen(false)}
      />

      <ModalSheet open={categoryOpen} onClose={() => setCategoryOpen(false)} label="分类" variant="picker">
        <header className="flex min-h-14 items-center justify-between border-b border-line px-4">
          <h2 tabIndex={-1} data-modal-autofocus className="text-section text-ink-primary outline-none">分类</h2>
          <button type="button" onClick={() => setCategoryOpen(false)} className="min-h-11 rounded-pill px-4 text-secondary text-accent">完成</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-3 gap-2">
            {roots.map(category => <button key={category.id} type="button" aria-pressed={rootId === category.id} className={`choice-chip flex min-h-20 flex-col items-center justify-center gap-2 rounded-control border p-2 text-caption ${rootId === category.id ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-ink-secondary'}`}
              onClick={() => { setRootId(category.id); setCategoryId(childrenOf(categories, category.id).length > 0 ? null : category.id) }}>
              <CategoryIconTile category={category} size={28} />{category.name}
            </button>)}
          </div>
          {childCategories.length > 0 && <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="子分类">
            {childCategories.map(category => <ChipButton key={category.id} label={category.name} selected={categoryId === category.id} quiet onClick={() => setCategoryId(category.id)} />)}
          </div>}
          {rootId && !categoryId && childCategories.length > 0 && <p className="mt-3 text-caption text-ink-tertiary">请选择子分类</p>}
        </div>
      </ModalSheet>

      <ModalSheet open={sourceOpen} onClose={() => setSourceOpen(false)} label="购买来源" variant="picker" size="compact">
        <header className="flex min-h-14 items-center justify-between border-b border-line px-4">
          <h2 tabIndex={-1} data-modal-autofocus className="text-section text-ink-primary outline-none">购买来源</h2>
          <button type="button" onClick={() => setSourceOpen(false)} className="min-h-11 rounded-pill px-4 text-secondary text-accent">完成</button>
        </header>
        <div className="min-h-0 overflow-y-auto p-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-3 gap-2">
            {([null, ...PURCHASE_PLATFORMS] as const).map(platform => <button key={platform ?? 'none'} type="button" aria-pressed={purchasePlatform === platform}
              onClick={() => setPurchasePlatform(platform)} className={`choice-chip min-h-16 rounded-control border p-2 text-caption ${purchasePlatform === platform ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-ink-secondary'}`}>{platform ? platformLabel(platform) : '未填写'}</button>)}
          </div>
        </div>
      </ModalSheet>

      <AiRecognitionSheet open={recognitionOpen} onClose={() => setRecognitionOpen(false)} categories={categories} allowPurchaseInfo={status !== 'wishlist'}
        current={{ name, categoryName: categories.find(category => category.id === categoryId)?.name ?? '', note, priceText, purchaseDate, purchasePlatform: purchasePlatform ?? '' }}
        onApply={values => {
          if (values.name != null) setName(values.name)
          if (values.note != null) setNote(values.note)
          const category = matchRecognitionCategory(values.categoryName ?? null, categories)
          if (category) { setCategoryId(category.id); setRootId(category.parentId ?? category.id) }
          if (status !== 'wishlist') {
            if (values.priceText != null) setPriceText(values.priceText)
            if (values.purchaseDate != null) setPurchaseDate(values.purchaseDate)
            if (values.purchasePlatform != null) setPurchasePlatform(values.purchasePlatform)
          }
        }} />

      <ConfirmDialog
        open={confirmDiscard}
        title="放弃此次修改？"
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        danger
        onConfirm={() => {
          setConfirmDiscard(false)
          navigate(-1)
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
      {toast}
    </div>
  )
  return content
}
