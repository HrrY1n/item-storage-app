import { describe, expect, it } from 'vitest'
import { collectTagKeys, readNameNormalized, resolveTagDedup } from './tagDedup'

/**
 * tag 跨设备去重（复审第 9 条）。
 *
 * 3A/3B 文档承诺"两台设备离线创建同名 tag 后服务端合并"，
 * 但第一版实现里**根本没有这段逻辑** —— 文档说支持、代码没做。
 * 这里的测试把承诺钉成可执行的规格。
 */

describe('readNameNormalized', () => {
  it('取出规范化名', () => {
    expect(readNameNormalized({ nameNormalized: 'apple' })).toBe('apple')
  })

  it('缺失或类型不对 → null', () => {
    expect(readNameNormalized({})).toBeNull()
    expect(readNameNormalized({ nameNormalized: 123 })).toBeNull()
    expect(readNameNormalized({ nameNormalized: '' })).toBeNull()
    expect(readNameNormalized(null)).toBeNull()
    expect(readNameNormalized('str')).toBeNull()
    expect(readNameNormalized([])).toBeNull()
  })
})

describe('resolveTagDedup', () => {
  const tag = (id: string, nameNormalized: string) => ({
    entityId: id,
    payload: { name: nameNormalized, nameNormalized },
  })

  it('★ 云端已有同名 tag（不同 id）→ 指示合并', () => {
    const existing = new Map([['apple', { entityId: 'tag-canonical' }]])
    const d = resolveTagDedup(tag('tag-dup', 'apple'), existing)
    expect(d).toEqual({ kind: 'merge-tag-into', duplicateId: 'tag-dup', canonicalId: 'tag-canonical' })
  })

  it('云端没有同名 → null（正常写入）', () => {
    const existing = new Map([['other', { entityId: 'tag-x' }]])
    expect(resolveTagDedup(tag('tag-new', 'apple'), existing)).toBeNull()
  })

  it('同一条记录（重命名）→ null，不是重复', () => {
    const existing = new Map([['apple', { entityId: 'tag-same' }]])
    expect(resolveTagDedup(tag('tag-same', 'apple'), existing)).toBeNull()
  })

  it('载荷缺 nameNormalized → null（无法判定，退回普通写入）', () => {
    const existing = new Map([['apple', { entityId: 'tag-canonical' }]])
    expect(resolveTagDedup({ entityId: 't1', payload: {} }, existing)).toBeNull()
  })
})

describe('collectTagKeys', () => {
  it('只收集 tag 的 nameNormalized', () => {
    const keys = collectTagKeys([
      { entity: 'item', entityId: 'i1', payload: { nameNormalized: 'nope' } },
      { entity: 'tag', entityId: 't1', payload: { nameNormalized: 'apple' } },
    ])
    expect([...keys.keys()]).toEqual(['apple'])
    expect(keys.get('apple')).toEqual({ entityId: 't1' })
  })

  it('同一 key 多次出现时保留第一条', () => {
    const keys = collectTagKeys([
      { entity: 'tag', entityId: 'first', payload: { nameNormalized: 'x' } },
      { entity: 'tag', entityId: 'second', payload: { nameNormalized: 'x' } },
    ])
    expect(keys.get('x')?.entityId).toBe('first')
  })

  it('大小写差异视为不同（规范化交给本地 tagNormalize）', () => {
    const keys = collectTagKeys([
      { entity: 'tag', entityId: 'a', payload: { nameNormalized: 'apple' } },
      { entity: 'tag', entityId: 'b', payload: { nameNormalized: 'Apple' } },
    ])
    expect(keys.size).toBe(2)
  })
})
