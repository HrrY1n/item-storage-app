import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { childrenOf } from '../domain/categoryTree'
import { presetSortIndex } from '../data/icons'
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
  usePresetAssets,
  useTags,
} from '../features/data/hooks'
import { itemRepository } from '../db/repositories/itemRepository'
import { tagRepository } from '../db/repositories/tagRepository'
import PageHeader from '../components/PageHeader'
import TagChip from '../components/TagChip'
import ConfirmDialog from '../components/Dialogs'
import { useToast } from '../components/Toast'

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

/** 新增（/items/new）与编辑（/items/:id/edit）共用的物品表单 */
export default function ItemFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { toast, show } = useToast()

  const categories = useCategories()
  const tags = useTags()
  const links = useItemTagLinks()
  const presetAssets = usePresetAssets()
  const existingItem = useItem(isEdit ? id : undefined)

  const [iconAssetId, setIconAssetId] = useState('preset-other')
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

  const loading = !categories || !tags || !links || !presetAssets || (isEdit && !initialized.current)

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
            className={`flex h-8 items-center rounded-full px-3.5 text-secondary transition-colors duration-200 ${
              canSave
                ? 'bg-neutral-900 font-medium text-white active:opacity-70'
                : 'bg-neutral-100 text-ink-faint'
            }`}
          >
            保存
          </button>
        }
      />

      <div className="flex flex-col gap-7 px-5 pt-5">
        {/* 图标 */}
        <Field label="图标" hint="点击选择">
          <div className="grid grid-cols-4 gap-2.5">
            {[...presetAssets]
              .sort((a, b) => presetSortIndex(a.id) - presetSortIndex(b.id))
              .map((asset) => {
              const selected = iconAssetId === asset.id
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setIconAssetId(asset.id)}
                  aria-pressed={selected}
                  className={`relative aspect-square overflow-hidden rounded-card border-2 transition-[border-color,transform] duration-200 ease-out-quint active:scale-[0.96] ${
                    selected ? 'border-neutral-900' : 'border-transparent'
                  }`}
                >
                  <img src={asset.path ?? '/icons/items/other.svg'} alt="" className="h-full w-full object-cover" draggable={false} />
                </button>
              )
            })}
          </div>
        </Field>

        {/* 名称 */}
        <Field label="名称">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="比如：AirPods Pro"
            className="h-12 w-full rounded-control border border-line bg-white px-4 text-[16px] text-ink-primary shadow-card outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong"
          />
        </Field>

        {/* 分类（两级 chips） */}
        <Field label="分类" hint={rootId && !categoryId && childCategories.length > 0 ? '请选择子分类' : undefined}>
          <div className="flex flex-wrap gap-2">
            {roots.map((c) => {
              const selected = rootId === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setRootId(c.id)
                    const children = childrenOf(categories, c.id)
                    setCategoryId(children.length > 0 ? null : c.id)
                  }}
                  className={`flex min-h-[36px] items-center rounded-full px-3.5 text-secondary transition-colors duration-150 active:scale-[0.97] ${
                    selected ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-ink-secondary'
                  }`}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
          {childCategories.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {childCategories.map((c) => {
                const selected = categoryId === c.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryId(c.id)}
                    className={`flex min-h-[36px] items-center rounded-full px-3.5 text-secondary transition-colors duration-150 active:scale-[0.97] ${
                      selected
                        ? 'bg-neutral-900 text-white'
                        : 'border border-line-strong bg-white text-ink-secondary'
                    }`}
                  >
                    {c.name}
                  </button>
                )
              })}
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
              className="h-11 min-w-0 flex-1 rounded-control border border-line bg-white px-4 text-body text-ink-primary shadow-card outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong"
            />
            <button
              type="button"
              onClick={() => void handleAddTag()}
              disabled={!newTagName.trim()}
              className={`h-11 shrink-0 rounded-control px-4 text-secondary transition-colors ${
                newTagName.trim()
                  ? 'bg-neutral-900 font-medium text-white active:opacity-70'
                  : 'bg-neutral-100 text-ink-faint'
              }`}
            >
              添加
            </button>
          </div>
        </Field>

        {/* 购买信息（全部可选） */}
        <Field label="购买信息" hint="全部可选">
          <div className="flex flex-col gap-4 rounded-surface border border-line bg-white p-4 shadow-card">
            {/* 购买日期 */}
            <div>
              <p className="mb-2 text-label text-ink-tertiary">购买日期</p>
              <input
                type="date"
                value={purchaseDate}
                max={today}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="num h-11 w-full rounded-control border border-line bg-white px-3 text-body text-ink-primary outline-none transition-colors focus:border-line-strong"
              />
            </div>

            {/* 购买价格 + 附加花费：并排布局，缩短表单高度（快速录入优先） */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-2 text-label text-ink-tertiary">购买价格</p>
                <div className="flex h-11 items-center gap-2 rounded-control border border-line bg-white px-3 transition-colors focus-within:border-line-strong">
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
                <div className="flex h-11 items-center gap-2 rounded-control border border-line bg-white px-3 transition-colors focus-within:border-line-strong">
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
            <div>
              <p className="mb-2 text-label text-ink-tertiary">购买平台</p>
              <div className="flex flex-wrap gap-2">
                {PURCHASE_PLATFORMS.map((p) => {
                  const selected = purchasePlatform === p
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPurchasePlatform(selected ? null : p)}
                      aria-pressed={selected}
                      className={`flex min-h-[36px] items-center rounded-full px-3.5 text-secondary transition-colors duration-150 active:scale-[0.97] ${
                        selected
                          ? 'bg-neutral-900 text-white'
                          : 'bg-neutral-100 text-ink-secondary'
                      }`}
                    >
                      {platformLabel(p)}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 实时预览：总投入 / 已持有天数 / 日均使用成本 */}
            {previewTotalCents !== null && (
              <div className="overflow-hidden rounded-control border border-accent-line bg-accent-soft">
                <div className="flex items-baseline justify-between px-3.5 py-3">
                  <p className="text-label text-ink-tertiary">总投入</p>
                  <p className="num text-item text-ink-primary">
                    {formatCents(previewTotalCents)}
                  </p>
                </div>
                {previewDailyCents !== null && previewDays !== null && (
                  <div className="border-t border-accent-line px-3.5 py-3">
                    <div className="flex items-baseline justify-between">
                      <p className="text-label text-accent-deep">日均使用成本</p>
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
            className="w-full resize-none rounded-control border border-line bg-white px-4 py-3 text-body leading-relaxed text-ink-primary shadow-card outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong"
          />
        </Field>

        <p className="pb-2 text-center text-caption text-ink-tertiary">
          图标为占位素材，后续将统一替换为 AI 生成图标包
        </p>
      </div>

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
