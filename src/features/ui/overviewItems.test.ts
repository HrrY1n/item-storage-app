import { describe, expect, it } from 'vitest'
import { makeItem } from '../../test/fixtures'
import { OVERVIEW_ITEMS_KEY, overviewDisplayItems, parseOverviewItemIds, readOverviewItemIds, writeOverviewItemIds } from './overviewItems'

const items = ['newest', 'middle', 'oldest'].map(id => makeItem({ id }))
const ids = (selected: ReturnType<typeof overviewDisplayItems>) => selected.map(item => item.id)

describe('overview display selection', () => {
  it('defaults to the two latest owned items', () => {
    expect(ids(overviewDisplayItems(items, null))).toEqual(['newest', 'middle'])
  })

  it('preserves selection order and caps at two distinct items', () => {
    expect(ids(overviewDisplayItems(items, ['oldest', 'newest', 'middle']))).toEqual(['oldest', 'newest'])
    expect(ids(overviewDisplayItems(items, ['oldest', 'oldest', 'middle']))).toEqual(['oldest', 'middle'])
  })

  it('one selected item stays alone without an automatic second item', () => {
    expect(ids(overviewDisplayItems(items, ['oldest']))).toEqual(['oldest'])
  })

  it('ignores deleted, wishlist and disposed items in both modes', () => {
    const unavailable = [
      makeItem({ id: 'deleted', deletedAt: '2026-10-23T00:00:00.000Z' }),
      makeItem({ id: 'wishlist', status: 'wishlist' }),
      makeItem({ id: 'disposed', status: 'disposed' }),
    ]
    expect(ids(overviewDisplayItems([...unavailable, ...items], null))).toEqual(['newest', 'middle'])
    expect(ids(overviewDisplayItems([...unavailable, ...items], ['disposed', 'oldest']))).toEqual(['oldest'])
  })

  it('keeps remaining valid selections and falls back only when none remain', () => {
    expect(ids(overviewDisplayItems(items, ['missing', 'oldest']))).toEqual(['oldest'])
    expect(ids(overviewDisplayItems(items, ['missing']))).toEqual(['newest', 'middle'])
    expect(overviewDisplayItems([], ['missing'])).toEqual([])
  })

  it('uses current item content and does not mutate items or preferences', () => {
    const selected = Object.freeze(['oldest'])
    const updated = items.map(item => item.id === 'oldest' ? { ...item, iconAssetId: 'preset-phone' } : item)
    expect(overviewDisplayItems(updated, selected)[0].iconAssetId).toBe('preset-phone')
    expect(selected).toEqual(['oldest'])
    expect(items.map(item => item.id)).toEqual(['newest', 'middle', 'oldest'])
  })
})

describe('overview preference storage', () => {
  it.each([null, {}, 'oldest', [], [1, null, ' ', '']])('treats invalid or empty preferences as automatic: %j', raw => {
    expect(parseOverviewItemIds(raw)).toBeNull()
  })

  it('filters invalid IDs, deduplicates and enforces the two-item storage limit', () => {
    expect(parseOverviewItemIds([null, '', 'a', 'a', 'b', 'c'])).toEqual(['a', 'b'])
  })

  it('loads and saves the local preference and the automatic reset', () => {
    let stored: string | null = null
    const storage = {
      getItem: (key: string) => { expect(key).toBe(OVERVIEW_ITEMS_KEY); return stored },
      setItem: (key: string, value: string) => { expect(key).toBe(OVERVIEW_ITEMS_KEY); stored = value },
    }
    expect(readOverviewItemIds(storage)).toBeNull()
    expect(writeOverviewItemIds(['oldest', 'middle'], storage)).toBe(true)
    expect(readOverviewItemIds(storage)).toEqual(['oldest', 'middle'])
    expect(writeOverviewItemIds(null, storage)).toBe(true)
    expect(readOverviewItemIds(storage)).toBeNull()
  })

  it('falls back safely for malformed JSON or denied storage, and reports write failure', () => {
    expect(readOverviewItemIds({ getItem: () => '{bad' })).toBeNull()
    expect(readOverviewItemIds({ getItem: () => { throw new Error('denied') } })).toBeNull()
    expect(writeOverviewItemIds(['oldest'], { setItem: () => { throw new Error('full') } })).toBe(false)
  })
})
