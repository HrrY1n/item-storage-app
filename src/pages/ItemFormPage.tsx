import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { childrenOf } from '../domain/categoryTree'
import { presetIconOfAssetId } from '../data/icons'
import type { PurchasePlatform } from '../domain/types'
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
import TagChip from '../components/TagChip'
import ConfirmDialog from '../components/Dialogs'
import { useToast } from '../components/Toast'
import IconPickerSheet from '../components/IconPickerSheet'

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <p className="text-label text-ink-tertiary">{label}</p>
        {hint && <p className="text-caption text-ink-tertiary">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** 输入控件共用的外观：白底实色 + hairline，聚焦时线变强，不做发光 */
const inputClass =
  'h-12 w-full rounded-control border border-line bg-surface px-4 text-[16px] text-ink-primary outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong'

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
      className={`flex min-h-[36px] items-center whitespace-nowrap rounded-pill px-3.5 text-secondary transition-colors duration-150 active:scale-[0.97] ${
        selected ? 'bg-ink-solid text-ink-inverse' : restClass
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
  const { toast, show } = useToast()

  const categories = useCategories()
  const tags = useTags()
  const links = useItemTagLinks()
  const assetMap = usePresetAssetMap()
  const existingItem = useItem(isEdit ? id : undefined)

  const [iconAssetId, setIconAssetId] = useState('preset-other')
  const [pickerOpen, setPickerOpen] = useState(false)
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
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [saving, setSaving] = useState(false)

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
      purchaseDate,
      purchasePriceCents: parsePriceInput(priceText),
      additionalCostCents: parsePriceInput(additionalCostText),
      purchasePlatform,
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
    purchaseDate,
    priceText,
    additionalCostText,
    purchasePlatform,
  ])

  if (loading) return null

  const roots = childrenOf(categories, null)
  const childCategories = rootId ? childrenOf(categories, rootId) : []
  const canSave = name.trim().length > 0 && categoryId !== null && !saving
  const currentIcon = presetIconOfAssetId(iconAssetId)
  // 优先用资产表解析（兼容未来的 AI / 拍照资产），缺失时回落到包内 preset 路径
  const iconUrl =
    assetMap?.get(iconAssetId) ?? currentIcon?.path ?? '/icons/items/other.svg'

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

  const handleBack = () => {
    if (dirty) setConfirmDiscard(true)
    else navigate(-1)
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const purchase = {
      purchaseDate: purchaseDate || null,
      purchasePriceCents: parsePriceInput(priceText),
      additionalCostCents: parsePriceInput(additionalCostText),
      purchasePlatform,
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
        setTimeout(() => navigate(`/items/${id}`, { replace: true }), 300)
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
        setTimeout(() => navigate(`/items/${item.id}`, { replace: true }), 300)
      }
    } catch (e) {
      show(e instanceof Error ? e.message : '保存失败')
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? '编辑物品' : '新增物品'}
        onBack={handleBack}
        right={
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={`flex h-8 items-center rounded-pill px-3.5 text-secondary transition-colors duration-200 ${
              canSave
                ? 'bg-ink-solid font-medium text-ink-inverse active:opacity-70'
                : 'bg-surface-sunken text-ink-faint'
            }`}
          >
            保存
          </button>
        }
      />

      <div className="flex flex-col gap-7 px-5 pt-5">
        {/* 图标：只展示当前选中的那一个，选择交给浮层（避免 70+ 图标撑长页面） */}
        <Field label="图标">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="group flex w-full items-center gap-4 rounded-surface border border-line bg-surface p-3.5 text-left shadow-card transition-colors duration-150 ease-out-quint active:bg-surface-sunken sm:hover:border-line-strong"
          >
            <span className="block h-[62px] w-[62px] shrink-0 overflow-hidden rounded-card border border-line-inner plate-surface">
              <img
                src={iconUrl}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-item text-ink-primary">
                {currentIcon?.label ?? '自定义图片'}
              </span>
              <span className="mt-1 block text-caption text-ink-tertiary">
                点击本行更换图标
              </span>
            </span>
            <svg
              width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="shrink-0 text-ink-faint transition-transform duration-300 ease-out-quint sm:group-hover:translate-x-0.5"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </Field>

        {/* 名称 */}
        <Field label="名称">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="比如：AirPods Pro"
            className={inputClass}
          />
        </Field>

        {/* 分类（两级 chips） */}
        <Field label="分类" hint={rootId && !categoryId && childCategories.length > 0 ? '请选择子分类' : undefined}>
          <div className="flex flex-wrap gap-2">
            {roots.map((c) => (
              <ChipButton
                key={c.id}
                label={c.name}
                selected={rootId === c.id}
                onClick={() => {
                  setRootId(c.id)
                  const children = childrenOf(categories, c.id)
                  setCategoryId(children.length > 0 ? null : c.id)
                }}
              />
            ))}
          </div>
          {childCategories.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {childCategories.map((c) => (
                <ChipButton
                  key={c.id}
                  label={c.name}
                  selected={categoryId === c.id}
                  quiet
                  onClick={() => setCategoryId(c.id)}
                />
              ))}
            </div>
          )}
        </Field>

        {/* 标签 */}
        <Field label="标签" hint={tagIds.length > 0 ? `已选 ${tagIds.length}` : '可多选'}>
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
              className="h-11 min-w-0 flex-1 rounded-control border border-line bg-surface px-4 text-body text-ink-primary outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong"
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
        </Field>

        {/* 购买信息（全部可选） */}
        <Field label="购买信息" hint="全部可选">
          {/* 不用大卡片承载：改为 hairline 分隔 + 留白分组，
              让"编辑一条档案记录"保持轻盈，而不是填写后台表单 */}
          <div className="divide-y divide-line-inner border-t border-line">
            {/* 购买日期 */}
            <div className="py-4">
              <p className="mb-2 text-label text-ink-tertiary">购买日期</p>
              <input
                type="date"
                value={purchaseDate}
                max={today}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="num h-11 w-full rounded-control border border-line bg-surface px-3 text-body text-ink-primary outline-none transition-colors focus:border-line-strong"
              />
            </div>

            {/* 购买价格 + 附加花费：并排布局，缩短表单高度（快速录入优先） */}
            <div className="grid grid-cols-2 gap-3 py-4">
              <div>
                <p className="mb-2 text-label text-ink-tertiary">购买价格</p>
                <div className="field-shell flex h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 transition-colors focus-within:border-line-strong">
                  <span className="text-body text-ink-tertiary">¥</span>
                  <input
                    value={priceText}
                    onChange={(e) => handleAmountChange(e.target.value, setPriceText)}
                    placeholder="0.00"
                    inputMode="decimal"
                    className="num min-w-0 flex-1 bg-transparent text-body text-ink-primary outline-none placeholder:text-ink-faint"
                  />
                </div>
              </div>
              <div>
                <p className="mb-2 text-label text-ink-tertiary">附加花费</p>
                <div className="field-shell flex h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 transition-colors focus-within:border-line-strong">
                  <span className="text-body text-ink-tertiary">¥</span>
                  <input
                    value={additionalCostText}
                    onChange={(e) => handleAmountChange(e.target.value, setAdditionalCostText)}
                    placeholder="0.00"
                    inputMode="decimal"
                    className="num min-w-0 flex-1 bg-transparent text-body text-ink-primary outline-none placeholder:text-ink-faint"
                  />
                </div>
                <p className="mt-1.5 text-caption text-ink-tertiary">配件 / 维修 / 升级</p>
              </div>
            </div>

            {/* 购买平台（单选，再点取消） */}
            <div className="py-4">
              <p className="mb-2 text-label text-ink-tertiary">购买平台</p>
              <div className="flex flex-wrap gap-2">
                {PURCHASE_PLATFORMS.map((p) => (
                  <ChipButton
                    key={p}
                    label={platformLabel(p)}
                    selected={purchasePlatform === p}
                    onClick={() => setPurchasePlatform(purchasePlatform === p ? null : p)}
                  />
                ))}
              </div>
            </div>

            {/* 实时预览：总投入 / 已持有天数 / 日均使用成本 */}
            {previewTotalCents !== null && (
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
            )}
          </div>
        </Field>

        {/* 备注 */}
        <Field label="备注">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="可选，比如购买渠道、使用场景……"
            rows={3}
            className="w-full resize-none rounded-control border border-line bg-surface px-4 py-3 text-body leading-relaxed text-ink-primary outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong"
          />
        </Field>
      </div>

      <IconPickerSheet
        open={pickerOpen}
        value={iconAssetId}
        onSelect={setIconAssetId}
        onClose={() => setPickerOpen(false)}
      />

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
}
