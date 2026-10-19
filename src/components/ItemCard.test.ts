import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { makeItem } from '../test/fixtures'
import type { Item } from '../domain/types'
import ItemCard from './ItemCard'
import WarrantyStrip from './WarrantyStrip'

const TODAY = '2026-06-06'
const item = makeItem({
  name: 'iPhone 17 Pro 256G',
  purchaseDate: '2026-01-01',
  purchasePriceCents: 800_000,
  warrantyExpiresAt: '2026-12-31',
})
const strip = (overrides: Partial<Item> = {}) => renderToStaticMarkup(createElement(WarrantyStrip, { item: { ...item, ...overrides }, today: TODAY }))
const remainingFills = (html: string) => [...html.matchAll(/data-warranty-remaining=""[^>]*style="width:([\d.]+)%/g)].map(match => Number(match[1]))
const card = (overrides: Partial<Item> = {}, summary = false) => createElement(ItemCard, {
  item: { ...item, ...overrides }, to: '/items/item-1', name: item.name,
  iconUrl: '/icons/items/phone.webp', categoryName: '手机与平板', tagNames: ['常用'], today: TODAY, summary,
})
const renderCard = (overrides: Partial<Item> = {}, summary = false) => renderToStaticMarkup(createElement(MemoryRouter, null, card(overrides, summary)))

describe('dotted warranty strip', () => {
  it('keeps 12 capsule segments, visible remaining time and an accessible percentage', () => {
    const html = strip()
    expect(html.match(/data-warranty-dot=""/g)).toHaveLength(12)
    expect(html).toContain('剩余 7 个月')
    expect(html).toContain('57%')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="57"')
    expect(html).toContain('aria-valuetext="保修剩余 7 个月，剩余 57%"')
  })

  it('preserves the real fractional boundary instead of rounding to whole dots', () => {
    const fills = remainingFills(strip())
    expect(fills).toHaveLength(12)
    expect(fills.reduce((sum, value) => sum + value, 0) / 12).toBeCloseTo(57.142857, 5)
    expect(fills.filter(value => value > 0 && value < 100)).toHaveLength(1)
  })

  it('shows a full warranty when the purchase date is today', () => {
    expect(remainingFills(strip({ purchaseDate: TODAY }))).toEqual(Array(12).fill(100))
  })

  it.each([
    [TODAY, '今天到期', 'expiring'],
    ['2026-06-05', '已过保', 'expired'],
  ])('handles expiry %s without negative remaining progress', (expiry, label, state) => {
    const html = strip({ warrantyExpiresAt: expiry })
    expect(html).toContain(label)
    expect(html).toContain(`data-warranty-strip="${state}"`)
    expect(html).toContain('aria-valuenow="0"')
    expect(remainingFills(html)).toEqual(Array(12).fill(0))
  })

  it.each([null, '2026-12-31', '2027-01-01'])('does not invent a percentage for an unknown or invalid purchase date: %s', purchaseDate => {
    const html = strip({ purchaseDate })
    expect(html).toContain('剩余 7 个月')
    expect(html).not.toContain('role="progressbar"')
    expect(html).not.toContain('%')
  })

  it.each([null, 'not-a-date'])('omits an unknown expiry: %s', warrantyExpiresAt => {
    expect(strip({ warrantyExpiresAt })).toBe('')
  })
})

describe('per-card disclosure', () => {
  it('starts collapsed while keeping the dotted warranty and navigation available', () => {
    const html = renderCard()
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('href="/items/item-1"')
    expect(html.match(/data-warranty-dot=""/g)).toHaveLength(12)
    expect(html).toMatch(/<\/a><button/)
    expect(html).not.toMatch(/<a\b[^>]*>[\s\S]*?<button[\s\S]*?<\/a>/)
    const panelId = html.match(/aria-controls="([^"]+)"/)?.[1]
    expect(panelId).toBeTruthy()
    expect(html).toContain(`id="${panelId}"`)
  })

  it('gives each card its own controlled panel', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement('div', null, card(), card({ id: 'item-2' }))))
    const ids = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('keeps overview summaries compact', () => {
    const html = renderCard({}, true)
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('data-warranty-strip')
    expect(html).not.toContain('日均成本')
  })

  it('does not show a warranty strip for a wishlist or sold item', () => {
    expect(renderCard({ status: 'wishlist' })).not.toContain('data-warranty-strip')
    expect(renderCard({ status: 'disposed', disposalMethod: 'sold', disposedAt: TODAY, salePriceCents: 650_000 })).not.toContain('data-warranty-strip')
  })
})
