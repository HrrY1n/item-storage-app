import { describe, expect, it } from 'vitest'
import type { Category } from './types'
import { categoryPath, childrenOf, collectSubtreeIds, hasCategoryCycle, wouldCreateCycle } from './categoryTree'

function cat(id: string, parentId: string | null, sortOrder = 1): Category {
  return {
    id,
    parentId,
    name: `分类${id}`,
    sortOrder,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  }
}

// 树：A ── B ── C；A ── D；E（独立根）
const tree = [cat('A', null), cat('B', 'A'), cat('C', 'B'), cat('D', 'A'), cat('E', null)]

describe('childrenOf', () => {
  it('返回直接子分类并按 sortOrder 排序', () => {
    const mixed = [cat('B2', 'A', 2), cat('A', null), cat('B1', 'A', 1)]
    const children = childrenOf(mixed, 'A')
    expect(children.map((c) => c.id)).toEqual(['B1', 'B2'])
  })

  it('parentId 为 null 时返回根分类', () => {
    expect(childrenOf(tree, null).map((c) => c.id)).toEqual(['A', 'E'])
  })
})

describe('wouldCreateCycle', () => {
  it('自己成为自己的父分类 → 成环', () => {
    expect(wouldCreateCycle(tree, 'A', 'A')).toBe(true)
  })

  it('移动到自己的后代节点下 → 成环', () => {
    expect(wouldCreateCycle(tree, 'A', 'B')).toBe(true)
    expect(wouldCreateCycle(tree, 'A', 'C')).toBe(true)
    expect(wouldCreateCycle(tree, 'B', 'C')).toBe(true)
  })

  it('合法移动不成环', () => {
    expect(wouldCreateCycle(tree, 'C', 'D')).toBe(false)
    expect(wouldCreateCycle(tree, 'B', 'E')).toBe(false)
    expect(wouldCreateCycle(tree, 'D', null)).toBe(false)
  })

  it('父链中存在脏数据时也不会死循环', () => {
    const dirty = [cat('X', 'Y'), cat('Y', 'X')]
    expect(wouldCreateCycle(dirty, 'X', 'Y')).toBe(true)
    expect(wouldCreateCycle(dirty, 'Z', 'Y')).toBe(false)
  })
})

describe('collectSubtreeIds', () => {
  it('包含自身与全部后代', () => {
    expect([...collectSubtreeIds(tree, 'A')].sort()).toEqual(['A', 'B', 'C', 'D'])
    expect([...collectSubtreeIds(tree, 'B')]).toEqual(['B', 'C'])
    expect([...collectSubtreeIds(tree, 'E')]).toEqual(['E'])
  })
})

describe('hasCategoryCycle', () => {
  it('报告历史分类环，但不修改分类', () => {
    const dirty = [cat('A', 'B'), cat('B', 'A')]
    expect(hasCategoryCycle(dirty)).toBe(true)
    expect(dirty.map((c) => c.parentId)).toEqual(['B', 'A'])
  })

  it('忽略缺失父分类，不把跨页合法暂态误判为环', () => {
    expect(hasCategoryCycle([cat('child', 'parent-not-yet-arrived')])).toBe(false)
  })
})

describe('categoryPath', () => {
  it('拼接完整路径', () => {
    expect(categoryPath(tree, 'C')).toBe('分类A / 分类B / 分类C')
    expect(categoryPath(tree, 'A')).toBe('分类A')
  })
})
