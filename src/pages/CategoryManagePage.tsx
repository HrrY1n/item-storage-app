import { useState } from 'react'
import type { Category } from '../types'
import { childrenOf, collectSubtreeIds } from '../domain/categoryTree'
import { useCategories, useItems } from '../features/data/hooks'
import { computeCategoryCounts } from '../features/data/viewModels'
import { categoryRepository } from '../db/repositories/categoryRepository'
import PageHeader from '../components/PageHeader'
import ConfirmDialog, { FormDialog } from '../components/Dialogs'
import { useToast } from '../components/Toast'

interface FlatNode {
  category: Category
  depth: number
}

function flattenTree(categories: Category[], parentId: string | null = null, depth = 0): FlatNode[] {
  const out: FlatNode[] = []
  for (const c of childrenOf(categories, parentId)) {
    out.push({ category: c, depth })
    out.push(...flattenTree(categories, c.id, depth + 1))
  }
  return out
}

interface EditorState {
  mode: 'create' | 'edit'
  category?: Category
  name: string
  parentId: string | null
}

export default function CategoryManagePage() {
  const categories = useCategories()
  const items = useItems()
  const { toast, show } = useToast()

  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleting, setDeleting] = useState<Category | null>(null)
  const [saving, setSaving] = useState(false)

  if (!categories || !items) return null

  const counts = computeCategoryCounts(items, categories)

  /** 编辑时可选父分类：排除自身与全部后代 */
  const parentOptions = (excludeId?: string): FlatNode[] => {
    const flat = flattenTree(categories)
    if (!excludeId) return flat
    const subtree = collectSubtreeIds(categories, excludeId)
    return flat.filter((n) => !subtree.has(n.category.id))
  }

  const handleSaveEditor = async () => {
    if (!editor || !editor.name.trim() || saving) return
    setSaving(true)
    try {
      if (editor.mode === 'create') {
        await categoryRepository.create(editor.name, editor.parentId)
        show('已新增分类')
      } else if (editor.category) {
        const c = editor.category
        if (editor.name.trim() !== c.name) await categoryRepository.rename(c.id, editor.name)
        if (editor.parentId !== c.parentId) await categoryRepository.move(c.id, editor.parentId)
        show('已保存')
      }
      setEditor(null)
    } catch (e) {
      show(e instanceof Error ? e.message : '操作失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    try {
      await categoryRepository.deleteGuarded(target.id)
      show(`已删除「${target.name}」`)
    } catch (e) {
      show(e instanceof Error ? e.message : '删除失败')
    }
  }

  const handleReorder = async (id: string, direction: 'up' | 'down') => {
    try {
      await categoryRepository.reorder(id, direction)
    } catch (e) {
      show(e instanceof Error ? e.message : '排序失败')
    }
  }

  const renderNode = ({ category: c, depth }: FlatNode, siblings: FlatNode[], index: number) => (
    <div key={c.id} className="flex min-h-[60px] items-center gap-2 px-3" style={{ paddingLeft: 10 + depth * 22 }}>
      {/* 排序：每个方向 ≥28px 高，保证可点按 */}
      <div className="flex w-7 flex-col items-center">
        <button
          type="button"
          aria-label="上移"
          disabled={index === 0}
          onClick={() => void handleReorder(c.id, 'up')}
          className={`flex h-7 w-7 items-center justify-center transition-colors ${
            index === 0 ? 'text-neutral-200' : 'text-ink-tertiary active:text-ink-primary'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 15 6-6 6 6" /></svg>
        </button>
        <button
          type="button"
          aria-label="下移"
          disabled={index === siblings.length - 1}
          onClick={() => void handleReorder(c.id, 'down')}
          className={`flex h-7 w-7 items-center justify-center transition-colors ${
            index === siblings.length - 1 ? 'text-neutral-200' : 'text-ink-tertiary active:text-ink-primary'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      {/* 名称与数量 */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-body text-ink-primary">{c.name}</p>
      </div>
      <span className="shrink-0 text-caption text-ink-tertiary">{counts.get(c.id) ?? 0} 件</span>
      {/* 操作 */}
      <button
        type="button"
        onClick={() => setEditor({ mode: 'edit', category: c, name: c.name, parentId: c.parentId })}
        className="flex min-h-[36px] items-center px-2 text-secondary text-ink-tertiary transition-opacity active:opacity-50"
      >
        编辑
      </button>
      <button
        type="button"
        onClick={() => setDeleting(c)}
        className="flex min-h-[36px] items-center px-2 text-secondary text-[#DC2626]/80 transition-opacity active:opacity-50"
      >
        删除
      </button>
    </div>
  )

  const renderTree = (parentId: string | null, depth: number) => {
    const siblings = childrenOf(categories, parentId).map((category) => ({ category, depth }))
    return siblings.map((node, i) => (
      <div key={node.category.id}>
        {renderNode(node, siblings, i)}
        {renderTree(node.category.id, depth + 1)}
      </div>
    ))
  }

  return (
    <div>
      <PageHeader title="分类管理" />
      <div className="px-5 pt-4">
        <p className="text-caption leading-relaxed text-ink-tertiary">
          含子分类或物品的分类不可删除；移动时不能选择自身或其子分类作为父级。
        </p>

        <div className="divide-y divide-line-inner overflow-hidden rounded-[20px] border border-line bg-white shadow-card">
          {renderTree(null, 0)}
        </div>

        <button
          type="button"
          onClick={() => setEditor({ mode: 'create', name: '', parentId: null })}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-neutral-300 text-secondary text-ink-tertiary transition-colors active:bg-neutral-50"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          新增分类
        </button>
      </div>

      {/* 新增 / 编辑对话框 */}
      <FormDialog
        open={editor !== null}
        title={editor?.mode === 'create' ? '新增分类' : '编辑分类'}
        onClose={() => setEditor(null)}
      >
        {editor && (
          <div>
            <input
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              placeholder="分类名称"
              autoFocus
              className="h-12 w-full rounded-xl border border-line bg-white px-4 text-[16px] text-ink-primary outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong"
            />
            <p className="mb-2 mt-4 px-1 text-caption text-ink-tertiary">父分类</p>
            <div className="max-h-[220px] overflow-y-auto rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setEditor({ ...editor, parentId: null })}
                className={`flex min-h-[44px] w-full items-center px-4 text-left text-body transition-colors ${
                  editor.parentId === null ? 'bg-neutral-900 text-white' : 'text-ink-primary active:bg-neutral-50'
                }`}
              >
                作为一级分类
              </button>
              {parentOptions(editor.mode === 'edit' ? editor.category?.id : undefined).map((n) => (
                <button
                  key={n.category.id}
                  type="button"
                  onClick={() => setEditor({ ...editor, parentId: n.category.id })}
                  className={`flex min-h-[44px] w-full items-center px-4 text-left text-body transition-colors ${
                    editor.parentId === n.category.id ? 'bg-neutral-900 text-white' : 'text-ink-primary active:bg-neutral-50'
                  }`}
                  style={{ paddingLeft: 16 + n.depth * 18 }}
                >
                  {n.category.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void handleSaveEditor()}
              disabled={!editor.name.trim() || saving}
              className={`mt-4 flex h-12 w-full items-center justify-center rounded-2xl text-secondary font-medium transition-colors ${
                editor.name.trim() && !saving
                  ? 'bg-neutral-900 text-white active:opacity-70'
                  : 'bg-neutral-100 text-ink-faint'
              }`}
            >
              保存
            </button>
          </div>
        )}
      </FormDialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleting !== null}
        title={`删除分类「${deleting?.name}」？`}
        message="仅当分类不含子分类和物品时可删除。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />
      {toast}
    </div>
  )
}
