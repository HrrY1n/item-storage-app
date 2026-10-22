import { describe, expect, it } from 'vitest'
import { tabMotionDirection } from './navigationMotion'

describe('tab motion intent', () => {
  it('follows the tab order in either direction', () => {
    expect(tabMotionDirection('/', '/items')).toBe('forward')
    expect(tabMotionDirection('/search', '/items')).toBe('back')
  })
  it('leaves identical routes and non-tab task flows to their own presentation', () => {
    expect(tabMotionDirection('/items', '/items')).toBe('none')
    expect(tabMotionDirection('/items', '/items/abc')).toBe('none')
    expect(tabMotionDirection('/items/abc/edit', '/items')).toBe('none')
  })
})
