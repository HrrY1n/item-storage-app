import { describe, expect, it } from 'vitest'
import type { Category, Item, ItemTag, Tag } from './types'
import { searchItems } from './searchItems'

const categories: Category[] = [
  { id: 'c-root', parentId: null, name: '数码与电子', sortOrder: 1, createdAt: '', updatedAt: '', deletedAt: null },
  { id: 'c-audio', parentId: 'c-root', name: '音频设备', sortOrder: 1, createdAt: '', updatedAt: '', deletedAt: null },
]
const tags: Tag[] = [
  { id: 't-apple', name: 'Apple', nameNormalized: 'apple', createdAt: '', updatedAt: '' },
]
const itemTags: ItemTag[] = [{ itemId: 'i-tag', tagId: 't-apple' }]

function item(id: string, name: string, note = ''): Item {
  return {
    id,
    name,
    categoryId: 'c-audio',
    note,
    iconAssetId: 'preset-other',
    sourceType: 'preset',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  }
}

const items = [
  item('i-exact', 'apple'),
  item('i-prefix', 'Apple Watch'),
  item('i-contains', '我的apple备用机'),
  item('i-tag', '手机'),
  item('i-cat', '耳机'),
  item('i-note', '键盘', '配 apple 设备使用'),
  item('i-none', '无关物品'),
]

describe('searchItems 排序优先级', () => {
  it('名称完全匹配 > 前缀 > 包含 > 标签 > 分类 > 备注', () => {
    // 分类匹配用「音频」命中；标签用「apple」命中
    const hits = searchItems('apple', items, categories, tags, itemTags)
    const order = hits.map((h) => h.item.id)
    expect(order).toEqual(['i-exact', 'i-prefix', 'i-contains', 'i-tag', 'i-note'])
    // i-cat 不命中 apple，i-none 不命中
    expect(order).not.toContain('i-cat')
    expect(order).not.toContain('i-none')
  })

  it('按分类名命中', () => {
    const hits = searchItems('音频', items, categories, tags, itemTags)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.matchedVia.startsWith('分类'))).toBe(true)
  })

  it('按备注命中', () => {
    const hits = searchItems('备用机', items, categories, tags, itemTags)
    expect(hits.map((h) => h.item.id)).toEqual(['i-contains'])
  })

  it('空查询返回空', () => {
    expect(searchItems('  ', items, categories, tags, itemTags)).toEqual([])
  })

  it('已删除物品不参与搜索', () => {
    const deleted = { ...item('i-del', 'apple 删除项'), deletedAt: '2026-01-02T00:00:00Z' }
    const hits = searchItems('删除项', [...items, deleted], categories, tags, itemTags)
    expect(hits).toEqual([])
  })
})
