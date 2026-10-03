import type { Category } from './types'

/**
 * 分类树不变量（domain 纯函数，全部有测试）。
 * 只处理「未删除」的分类 —— 调用方负责先过滤 deletedAt。
 */

/** 按 sortOrder 返回某节点的直接子分类 */
export function childrenOf(categories: Category[], parentId: string | null): Category[] {
  return categories
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

/**
 * 判断把 categoryId 移动到 newParentId 之下是否会形成循环。
 * 沿 newParentId 的祖先链向上走，若遇到 categoryId 自身则成环。
 * 覆盖两种违规：成为自己的父节点；移动到自己的后代节点下。
 */
export function wouldCreateCycle(
  categories: Category[],
  categoryId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false
  if (newParentId === categoryId) return true
  const byId = new Map(categories.map((c) => [c.id, c]))
  let cursor: string | null = newParentId
  const guard = categories.length + 1
  for (let i = 0; i < guard && cursor !== null; i++) {
    if (cursor === categoryId) return true
    cursor = byId.get(cursor)?.parentId ?? null
  }
  return false
}

/** 收集某分类及其全部后代（含自身）的 id 集合 */
export function collectSubtreeIds(categories: Category[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const c of categories) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id)
        changed = true
      }
    }
  }
  return ids
}

/** 分类的完整路径名，如「数码与电子 / 音频设备」 */
export function categoryPath(categories: Category[], categoryId: string): string {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const names: string[] = []
  let cursor = byId.get(categoryId)
  const guard = categories.length + 1
  for (let i = 0; i < guard && cursor; i++) {
    names.unshift(cursor.name)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return names.join(' / ')
}
