import type { Category, Item, ItemTag, Tag } from '../../domain/types'

/**
 * 视图模型辅助：把多张表 join 成页面需要的形状。
 * 纯函数，方便测试与复用。
 */

export function categoryNameOf(categories: Category[], id: string): string {
  return categories.find((c) => c.id === id)?.name ?? '未分类'
}

export function tagNamesOf(itemId: string, links: ItemTag[], tags: Tag[]): string[] {
  const byId = new Map(tags.map((t) => [t.id, t.name]))
  return links
    .filter((l) => l.itemId === itemId)
    .map((l) => byId.get(l.tagId))
    .filter((n): n is string => typeof n === 'string')
}

/** 每个分类（含后代）下的活跃物品数量：沿物品的祖先链向上累计，O(items × 树深) */
export function computeCategoryCounts(items: Item[], categories: Category[]): Map<string, number> {
  const counts = new Map<string, number>(categories.map((c) => [c.id, 0]))
  const byId = new Map(categories.map((c) => [c.id, c]))
  for (const item of items) {
    let cursor = byId.get(item.categoryId)
    const guard = categories.length + 1
    for (let i = 0; i < guard && cursor; i++) {
      counts.set(cursor.id, (counts.get(cursor.id) ?? 0) + 1)
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
  }
  return counts
}

/** 常用标签：按关联活跃物品数排序 */
export function frequentTags(items: Item[], links: ItemTag[], tags: Tag[], n: number): Tag[] {
  const activeIds = new Set(items.map((i) => i.id))
  const counts = new Map<string, number>()
  for (const l of links) {
    if (activeIds.has(l.itemId)) counts.set(l.tagId, (counts.get(l.tagId) ?? 0) + 1)
  }
  return [...tags]
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
    .slice(0, n)
}

/** 某标签下的活跃物品 */
export function itemsWithTag(items: Item[], links: ItemTag[], tagId: string): Item[] {
  const ids = new Set(links.filter((l) => l.tagId === tagId).map((l) => l.itemId))
  return items.filter((i) => ids.has(i.id))
}
