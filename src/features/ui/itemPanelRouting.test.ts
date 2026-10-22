import { describe, expect, it } from 'vitest'
import type { Location } from 'react-router'
import { itemPanelBackground } from './itemPanelRouting'

const source: Location = { pathname: '/items', search: '?status=owned', hash: '', key: 'source', state: { view: 'grid' } }
const route = (pathname: string, state: unknown = null): Location => ({ pathname, search: '', hash: '', key: 'detail', state })

describe('item panel history state', () => {
  it('preserves the exact source location for detail and edit navigation', () => {
    expect(itemPanelBackground(route('/items/item-1', { itemBackground: source }))).toBe(source)
    expect(itemPanelBackground(route('/items/item-1/edit', { itemBackground: source }))).toBe(source)
  })

  it('leaves direct links, new-item and unrelated routes as normal pages', () => {
    expect(itemPanelBackground(route('/items/item-1'))).toBeUndefined()
    expect(itemPanelBackground(route('/items/item-1/edit'))).toBeUndefined()
    expect(itemPanelBackground(route('/items/new', { itemBackground: source }))).toBeUndefined()
    expect(itemPanelBackground(route('/settings', { itemBackground: source }))).toBeUndefined()
  })

  it.each([null, 'bad', {}, { pathname: '/items' }, { ...source, pathname: '//example.test' },
    { ...source, pathname: '/items/item-2' }, { ...source, pathname: '/items/item-2/edit' },
    { ...source, pathname: 'items' }, { ...source, key: 3 }])('rejects incomplete or nested backgrounds: %j', background => {
    expect(itemPanelBackground(route('/items/item-1', { itemBackground: background }))).toBeUndefined()
  })
})
