import { describe, expect, it } from 'vitest'
import {
  buildItemTagRows,
  decodeCategoryPayload,
  decodeItemPayload,
  decodeTagIds,
  decodeTagPayload,
  encodeAssetMetaPayload,
  encodeCategoryPayload,
  encodeItemPayload,
  encodeTagPayload,
} from './syncPayload'
import { makeItem } from '../test/fixtures'

/**
 * 同步载荷编解码测试（纯函数）。
 *
 * 重点验证三件事：
 * 1. 往返一致（encode → decode 得到等价实体）
 * 2. 脏数据不会导致崩溃（同步来的 JSON 不可信）
 * 3. 前向兼容：未知字段被忽略，缺失可选字段不炸
 */

describe('Item 载荷', () => {
  it('往返一致', () => {
    const item = makeItem({
      name: 'AirPods Pro 2',
      note: '通勤降噪用',
      categoryId: 'cat-01',
      iconAssetId: 'preset-earbuds',
      status: 'owned',
      purchaseDate: '2026-01-15',
      purchasePriceCents: 149999,
      additionalCostCents: 12000,
      purchasePlatform: 'jd',
      warrantyExpiresAt: '2027-01-15',
    })
    const back = decodeItemPayload(item.id, encodeItemPayload(item, ['tag-a', 'tag-b']))
    expect(back).toEqual(item)
  })

  it('保留内聚的 tagIds', () => {
    const payload = encodeItemPayload(makeItem(), ['t1', 't2'])
    expect(payload.tagIds).toEqual(['t1', 't2'])
    expect(decodeTagIds(payload)).toEqual(['t1', 't2'])
  })

  it('tagIds 复制而非引用（避免后续被意外改写）', () => {
    const ids = ['t1']
    const payload = encodeItemPayload(makeItem(), ids)
    ids.push('t2')
    expect(payload.tagIds).toEqual(['t1'])
  })

  it('已处置物品的处置字段完整往返', () => {
    const item = makeItem({
      status: 'disposed',
      disposedAt: '2026-02-01',
      disposalMethod: 'sold',
      salePriceCents: 120000,
      disposalNote: '转转二手',
    })
    const back = decodeItemPayload(item.id, encodeItemPayload(item, []))
    expect(back?.status).toBe('disposed')
    expect(back?.disposalMethod).toBe('sold')
    expect(back?.salePriceCents).toBe(120000)
    expect(back?.disposalNote).toBe('转转二手')
  })

  it('decode 后 deletedAt 恒为 null（软删标记由外层记录单独传递）', () => {
    const back = decodeItemPayload('i1', encodeItemPayload(makeItem(), []))
    expect(back?.deletedAt).toBeNull()
  })
})

describe('脏数据容错（同步来的 JSON 不可信）', () => {
  it('名称缺失或为空 → 返回 null（静默丢弃，不抛）', () => {
    expect(decodeItemPayload('i1', {})).toBeNull()
    expect(decodeItemPayload('i1', { name: '' })).toBeNull()
    expect(decodeItemPayload('i1', { name: 123 })).toBeNull()
  })

  it('非对象输入安全返回 null', () => {
    expect(decodeItemPayload('i1', null)).toBeNull()
    expect(decodeItemPayload('i1', 'nope')).toBeNull()
    expect(decodeItemPayload('i1', 42)).toBeNull()
    expect(decodeItemPayload('i1', [])).toBeNull()
  })

  it('缺失的可空字段补 null，非法的数字被丢弃', () => {
    const back = decodeItemPayload('i1', {
      name: 'X',
      purchasePriceCents: '不是数字',
      salePriceCents: Number.NaN,
    })
    expect(back?.purchasePriceCents).toBeNull()
    expect(back?.salePriceCents).toBeNull()
  })

  it('缺失的非空字段用安全默认值', () => {
    const back = decodeItemPayload('i1', { name: 'X' })
    expect(back?.status).toBe('owned')
    expect(back?.iconAssetId).toBe('preset-other')
    expect(back?.note).toBe('')
    expect(back?.categoryId).toBe('')
  })

  it('未知字段被忽略（前向兼容：老App 拉到新字段不崩）', () => {
    const back = decodeItemPayload('i1', {
      name: 'X',
      someFutureField: 'whatever',
      nested: { a: 1 },
    })
    expect(back?.name).toBe('X')
    expect(back).not.toHaveProperty('someFutureField')
  })
})

describe('tagIds 解码', () => {
  it('去重（itemTags 是复合主键，重复会被 Dexie 拒绝）', () => {
    expect(decodeTagIds({ tagIds: ['a', 'b', 'a'] })).toEqual(['a', 'b'])
  })

  it('过滤非字符串与空串', () => {
    expect(decodeTagIds({ tagIds: ['a', 123, '', null, 'b'] })).toEqual(['a', 'b'])
  })

  it('非数组或缺失 → 空数组', () => {
    expect(decodeTagIds({})).toEqual([])
    expect(decodeTagIds({ tagIds: 'a,b' })).toEqual([])
  })

  it('buildItemTagRows 产出复合主键行并去重', () => {
    expect(buildItemTagRows('i1', ['t1', 't1', 't2'])).toEqual([
      { itemId: 'i1', tagId: 't1' },
      { itemId: 'i1', tagId: 't2' },
    ])
  })
})

describe('Category 载荷', () => {
  const category = {
    id: 'c1',
    parentId: 'c0',
    name: '我改过名的分类',
    sortOrder: 7,
    createdAt: '2026-02-03T10:00:00.000Z',
    updatedAt: '2026-03-04T11:30:00.000Z',
    deletedAt: null,
    iconKey: 'preset-earbuds',
  }

  it('往返一致（含 iconKey）', () => {
    expect(decodeCategoryPayload('c1', encodeCategoryPayload(category))).toEqual(category)
  })

  it('没有 iconKey 时不写入该字段', () => {
    const { iconKey: _drop, ...withoutIcon } = category
    const payload = encodeCategoryPayload(withoutIcon)
    expect(payload).not.toHaveProperty('iconKey')
    expect(decodeCategoryPayload('c1', payload)).toEqual(withoutIcon)
  })

  it('空名称 → null', () => {
    expect(decodeCategoryPayload('c1', { name: '' })).toBeNull()
  })

  it('root 分类 parentId 为 null', () => {
    const root = { ...category, id: 'c-root', parentId: null }
    expect(decodeCategoryPayload('c-root', encodeCategoryPayload(root))?.parentId).toBeNull()
  })
})

describe('Tag 载荷', () => {
  const tag = {
    id: 't1',
    name: 'Apple',
    nameNormalized: 'apple',
    createdAt: '2026-01-15T08:00:00.000Z',
    updatedAt: '2026-01-15T08:00:00.000Z',
  }

  it('往返一致', () => {
    expect(decodeTagPayload('t1', encodeTagPayload(tag))).toEqual(tag)
  })

  it('nameNormalized 缺失时兜底，保证唯一索引有值', () => {
    const back = decodeTagPayload('t1', { name: '通勤' })
    expect(back?.nameNormalized).toBe('通勤')
  })

  it('空名称 → null', () => {
    expect(decodeTagPayload('t1', { nameNormalized: 'x' })).toBeNull()
  })
})

describe('资产元数据', () => {
  it('只带 hasBlob，不含二进制内容', () => {
    const payload = encodeAssetMetaPayload({
      id: 'a1',
      kind: 'from_photo',
      path: null,
      blob: new Blob(['x']),
      mime: 'image/png',
      width: 100,
      height: 100,
      styleVersion: null,
      promptVersion: null,
      sourceAssetId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(payload.hasBlob).toBe(true)
    expect('blob' in payload).toBe(false)
  })

  it('preset 资产 hasBlob 为 false', () => {
    const payload = encodeAssetMetaPayload({
      id: 'preset-other',
      kind: 'preset',
      path: '/icons/items/other.svg',
      blob: null,
      mime: 'image/svg+xml',
      width: 96,
      height: 96,
      styleVersion: null,
      promptVersion: null,
      sourceAssetId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(payload.hasBlob).toBe(false)
  })
})