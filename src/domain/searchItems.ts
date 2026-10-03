import type { Category, Item, ItemTag, Tag } from './types'
import { categoryPath } from './categoryTree'

/**
 * 搜索打分与排序（domain 纯函数，全部有测试）。
 * 优先级（与 PRD 一致）：
 *   名称完全匹配(100) > 名称前缀(80) > 名称包含(60) > 标签(40) > 分类(30) > 备注(10)
 * 同分时按创建时间新→旧。
 */

export interface SearchHit {
  item: Item
  score: number
  /** 命中来源说明，用于结果行展示 */
  matchedVia: string
}

export function searchItems(
  query: string,
  items: Item[],
  categories: Category[],
  tags: Tag[],
  itemTags: ItemTag[],
): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const tagById = new Map(tags.map((t) => [t.id, t]))
  const tagsByItem = new Map<string, Tag[]>()
  for (const it of itemTags) {
    const tag = tagById.get(it.tagId)
    if (!tag) continue
    const list = tagsByItem.get(it.itemId) ?? []
    list.push(tag)
    tagsByItem.set(it.itemId, list)
  }

  const hits: SearchHit[] = []

  for (const item of items) {
    if (item.deletedAt) continue
    const name = item.name.toLowerCase()
    let score = 0
    let matchedVia = ''

    if (name === q) {
      score = 100
      matchedVia = '名称匹配'
    } else if (name.startsWith(q)) {
      score = 80
      matchedVia = '名称匹配'
    } else if (name.includes(q)) {
      score = 60
      matchedVia = '名称匹配'
    }

    if (!score) {
      const hitTag = (tagsByItem.get(item.id) ?? []).find((t) =>
        t.name.toLowerCase().includes(q),
      )
      if (hitTag) {
        score = 40
        matchedVia = `标签 #${hitTag.name}`
      }
    }

    if (!score) {
      const path = categoryPath(categories, item.categoryId)
      if (path.toLowerCase().includes(q)) {
        score = 30
        matchedVia = `分类 ${path}`
      }
    }

    if (!score && item.note.toLowerCase().includes(q)) {
      score = 10
      matchedVia = '备注'
    }

    if (score > 0) hits.push({ item, score, matchedVia })
  }

  return hits.sort((a, b) => b.score - a.score || b.item.createdAt.localeCompare(a.item.createdAt))
}
