import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIST_SESSION_STATE,
  LIST_STATE_KEY,
  parseListSessionState,
  readListSessionState,
  writeListSessionState,
} from './listSessionState'

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

describe('parseListSessionState', () => {
  it('接受完整合法状态', () => {
    const state = { status: 'wishlist', query: '耳机', categoryId: 'cat-1', sort: 'name', view: 'list', disposition: 'sold' }
    expect(parseListSessionState(state)).toEqual(state)
  })

  it('非法字段逐项回落默认值，不整包丢弃', () => {
    expect(parseListSessionState({ status: 'bogus', sort: 123, view: 'grid', disposition: 'nope', query: 42, categoryId: 7 })).toEqual({
      ...DEFAULT_LIST_SESSION_STATE,
      view: 'grid',
    })
  })

  it('view 仅接受 list，其余一律 grid', () => {
    expect(parseListSessionState({ view: 'list' }).view).toBe('list')
    expect(parseListSessionState({ view: 'table' }).view).toBe('grid')
    expect(parseListSessionState({}).view).toBe('grid')
  })

  it('损坏 JSON 由 read 捕获并回落默认值', () => {
    const storage = memoryStorage({ [LIST_STATE_KEY]: '{not json' })
    expect(readListSessionState(storage)).toEqual(DEFAULT_LIST_SESSION_STATE)
  })

  it('空串与空白 categoryId 视为 null', () => {
    expect(parseListSessionState({ categoryId: '' }).categoryId).toBeNull()
    expect(parseListSessionState({ categoryId: '   ' }).categoryId).toBeNull()
    expect(parseListSessionState({ categoryId: 'cat-1' }).categoryId).toBe('cat-1')
  })

  it('超长 query 截断到 200 字符', () => {
    expect(parseListSessionState({ query: 'a'.repeat(500) }).query).toHaveLength(200)
  })

  it('非对象输入回落默认值', () => {
    expect(parseListSessionState(null)).toEqual(DEFAULT_LIST_SESSION_STATE)
    expect(parseListSessionState('"string"')).toEqual(DEFAULT_LIST_SESSION_STATE)
    expect(parseListSessionState(42)).toEqual(DEFAULT_LIST_SESSION_STATE)
    expect(parseListSessionState(['owned'])).toEqual(DEFAULT_LIST_SESSION_STATE)
  })
})

describe('read/write', () => {
  it('写入后能原样读回', () => {
    const storage = memoryStorage()
    const state = { status: 'disposed' as const, query: 'ipad', categoryId: 'c1', sort: 'cost' as const, view: 'list' as const, disposition: 'all' as const }
    expect(writeListSessionState(state, storage)).toBe(true)
    expect(readListSessionState(storage)).toEqual(state)
  })

  it('存储为空时读回默认值', () => {
    expect(readListSessionState(memoryStorage())).toEqual(DEFAULT_LIST_SESSION_STATE)
  })

  it('存储抛异常时读取安全回落', () => {
    const throwing = { getItem: () => { throw new Error('unavailable') } }
    expect(readListSessionState(throwing)).toEqual(DEFAULT_LIST_SESSION_STATE)
  })

  it('存储抛异常时写入返回 false 且不向上抛', () => {
    const throwing = { setItem: () => { throw new Error('quota') } }
    expect(writeListSessionState(DEFAULT_LIST_SESSION_STATE, throwing)).toBe(false)
  })
})
