import { useState } from 'react'
import type { Tag } from '../types'
import { useItemTagLinks, useItems, useTags } from '../features/data/hooks'
import { tagRepository } from '../db/repositories/tagRepository'
import PageHeader from '../components/PageHeader'
import ConfirmDialog, { FormDialog } from '../components/Dialogs'
import { useToast } from '../components/Toast'

export default function TagManagePage() {
  const tags = useTags()
  const links = useItemTagLinks()
  const items = useItems()
  const { toast, show } = useToast()

  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<Tag | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [merging, setMerging] = useState<Tag | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Tag | null>(null)
  const [busy, setBusy] = useState(false)

  if (!tags || !links || !items) return null

  const activeItemIds = new Set(items.map((i) => i.id))
  const countOf = (tagId: string) =>
    links.filter((l) => l.tagId === tagId && activeItemIds.has(l.itemId)).length

  const run = async (fn: () => Promise<unknown>, okMessage: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      show(okMessage)
    } catch (e) {
      show(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = () => {
    const raw = newName.trim()
    if (!raw) return
    void run(async () => {
      await tagRepository.create(raw)
      setNewName('')
    }, '已新增标签')
  }

  const handleRename = () => {
    if (!renaming || !renameValue.trim()) return
    const target = renaming
    void run(async () => {
      await tagRepository.rename(target.id, renameValue)
      setRenaming(null)
    }, '已重命名')
  }

  const handleMerge = () => {
    if (!merging || !mergeTargetId) return
    const source = merging
    void run(async () => {
      await tagRepository.merge(source.id, mergeTargetId)
      setMerging(null)
      setMergeTargetId(null)
    }, `已合并到目标标签`)
  }

  const handleDelete = () => {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    void run(() => tagRepository.delete(target.id), `已删除 #${target.name}`)
  }

  return (
    <div>
      <PageHeader title="标签管理" />
      <div className="px-5 pt-4">
        {/* 新增 */}
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCreate()
              }
            }}
            placeholder="新增标签，如：冬季"
            className="h-12 min-w-0 flex-1 rounded-control border border-line bg-surface px-4 text-[16px] text-ink-primary shadow-card outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newName.trim() || busy}
            className={`h-12 shrink-0 rounded-control px-4 text-secondary transition-colors ${
              newName.trim() && !busy
                ? 'bg-ink-solid font-medium text-ink-inverse active:opacity-70'
                : 'bg-surface-sunken text-ink-faint'
            }`}
          >
            添加
          </button>
        </div>
        <p className="mt-2 px-1 text-caption text-ink-tertiary">
          同名标签自动去重（忽略大小写、空白与 # 前缀）
        </p>

        {/* 标签列表 */}
        {tags.length === 0 ? (
          <p className="mt-8 text-center text-secondary text-ink-tertiary">还没有标签</p>
        ) : (
          <div className="divide-y divide-line-inner overflow-hidden rounded-surface border border-line bg-surface shadow-card">
            {tags.map((tag) => (
              <div key={tag.id} className="flex min-h-[52px] items-center gap-2 px-4">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink-primary">#{tag.name}</span>
                </span>
                <span className="shrink-0 text-caption text-ink-tertiary">{countOf(tag.id)} 件</span>
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(tag)
                    setRenameValue(tag.name)
                  }}
                  className="flex min-h-[36px] items-center px-2 text-secondary text-ink-tertiary transition-opacity active:opacity-50"
                >
                  重命名
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMerging(tag)
                    setMergeTargetId(null)
                  }}
                  className="flex min-h-[36px] items-center px-2 text-secondary text-ink-tertiary transition-opacity active:opacity-50"
                >
                  合并
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(tag)}
                  className="flex min-h-[36px] items-center px-2 text-secondary text-danger transition-opacity active:opacity-50"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 重命名 */}
      <FormDialog open={renaming !== null} title={`重命名 #${renaming?.name}`} onClose={() => setRenaming(null)}>
        <input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          autoFocus
          placeholder="新名称"
          className="h-12 w-full rounded-control border border-line bg-surface px-4 text-[16px] text-ink-primary outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong"
        />
        <button
          type="button"
          onClick={handleRename}
          disabled={!renameValue.trim() || busy}
          className={`mt-4 flex h-12 w-full items-center justify-center rounded-control text-secondary font-medium transition-colors ${
            renameValue.trim() && !busy ? 'bg-ink-solid text-ink-inverse active:opacity-70' : 'bg-surface-sunken text-ink-faint'
          }`}
        >
          保存
        </button>
      </FormDialog>

      {/* 合并 */}
      <FormDialog open={merging !== null} title={`把 #${merging?.name} 合并到…`} onClose={() => setMerging(null)}>
        <div className="max-h-[240px] overflow-y-auto rounded-control border border-line">
          {tags
            .filter((t) => t.id !== merging?.id)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setMergeTargetId(t.id)}
                className={`flex min-h-[44px] w-full items-center px-4 text-left text-body transition-colors ${
                  mergeTargetId === t.id ? 'bg-ink-solid text-ink-inverse' : 'text-ink-primary active:bg-surface-sunken'
                }`}
              >
                #{t.name}
                <span className={`ml-2 text-caption ${mergeTargetId === t.id ? 'text-ink-inverse/70' : 'text-ink-tertiary'}`}>
                  {countOf(t.id)} 件
                </span>
              </button>
            ))}
        </div>
        <button
          type="button"
          onClick={handleMerge}
          disabled={!mergeTargetId || busy}
          className={`mt-4 flex h-12 w-full items-center justify-center rounded-control text-secondary font-medium transition-colors ${
            mergeTargetId && !busy ? 'bg-ink-solid text-ink-inverse active:opacity-70' : 'bg-surface-sunken text-ink-faint'
          }`}
        >
          合并（源标签将被删除）
        </button>
      </FormDialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleting !== null}
        title={`删除标签 #${deleting?.name}？`}
        message={`将同时从 ${deleting ? countOf(deleting.id) : 0} 件物品上移除该标签。`}
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
      {toast}
    </div>
  )
}
