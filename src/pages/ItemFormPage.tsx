import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { childrenOf } from '../domain/categoryTree'
import { presetSortIndex } from '../data/icons'
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
        <p className="text-secondary font-medium text-ink-secondary">{label}</p>
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
  }, [isEdit, existingItem, categories, links])

  const loading = !categories || !tags || !links || !presetAssets || (isEdit && !initialized.current)

  const initialSnapshot = useRef<string>('')
  useEffect(() => {
    if (loading) return
    if (!initialSnapshot.current) {
      initialSnapshot.current = JSON.stringify({
        name: name.trim(),
        iconAssetId,
        categoryId,
        tagIds: [...tagIds].sort(),
        note: note.trim(),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const dirty = useMemo(() => {
    if (!initialSnapshot.current) return false
    return (
      JSON.stringify({
        name: name.trim(),
        iconAssetId,
        categoryId,
        tagIds: [...tagIds].sort(),
        note: note.trim(),
      }) !== initialSnapshot.current
    )
  }, [name, iconAssetId, categoryId, tagIds, note])

  if (loading) return null

  const roots = childrenOf(categories, null)
  const childCategories = rootId ? childrenOf(categories, rootId) : []
  const canSave = name.trim().length > 0 && categoryId !== null && !saving

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
    try {
      if (isEdit && id) {
        await itemRepository.update(id, { name, categoryId: categoryId!, iconAssetId, note, tagIds })
        show('已保存')
        setTimeout(() => navigate(`/items/${id}`, { replace: true }), 300)
      } else {
        const item = await itemRepository.create({
          name,
          categoryId: categoryId!,
          iconAssetId,
          note,
          tagIds,
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
                : 'bg-neutral-100 text-neutral-300'
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
                  className={`aspect-square overflow-hidden rounded-2xl border-2 transition-transform duration-100 ease-out-quint active:scale-[0.94] ${
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
            className="h-12 w-full rounded-2xl border border-black/[0.05] bg-white px-4 text-[16px] text-ink-primary shadow-card outline-none transition-colors placeholder:text-neutral-300 focus:border-neutral-300"
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
                        : 'border border-neutral-200 bg-white text-ink-secondary'
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
              className="h-11 min-w-0 flex-1 rounded-2xl border border-black/[0.05] bg-white px-4 text-body text-ink-primary shadow-card outline-none transition-colors placeholder:text-neutral-300 focus:border-neutral-300"
            />
            <button
              type="button"
              onClick={() => void handleAddTag()}
              disabled={!newTagName.trim()}
              className={`h-11 shrink-0 rounded-2xl px-4 text-secondary transition-colors ${
                newTagName.trim()
                  ? 'bg-neutral-900 font-medium text-white active:opacity-70'
                  : 'bg-neutral-100 text-neutral-300'
              }`}
            >
              添加
            </button>
          </div>
        </Field>

        {/* 备注 */}
        <Field label="备注">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="可选，比如购买渠道、使用场景……"
            rows={3}
            className="w-full resize-none rounded-2xl border border-black/[0.05] bg-white px-4 py-3 text-body text-ink-primary shadow-card outline-none transition-colors placeholder:text-neutral-300 focus:border-neutral-300"
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
