import { describe, expect, it } from 'vitest'
import { sheetDragDirection, shouldDismissSheet } from './sheetGesture'

describe('sheet drag ownership and release', () => {
  const start = { x: 100, y: 100, time: 0 }
  it('keeps taps pending and upward/horizontal gestures in native scrolling', () => {
    expect(sheetDragDirection(start, { x: 103, y: 105, time: 20 })).toBe('pending')
    expect(sheetDragDirection(start, { x: 102, y: 80, time: 20 })).toBe('scroll')
    expect(sheetDragDirection(start, { x: 125, y: 110, time: 20 })).toBe('scroll')
    expect(sheetDragDirection(start, { x: 104, y: 125, time: 20 })).toBe('drag')
  })
  it('rebounds short slow pulls and ignores tiny high-velocity noise', () => {
    expect(shouldDismissSheet(75, 700, 0.2)).toBe(false)
    expect(shouldDismissSheet(15, 700, 2)).toBe(false)
    expect(shouldDismissSheet(60, 700, -0.8)).toBe(false)
  })
  it('dismisses a deliberate pull or downward flick, adapting to shorter sheets', () => {
    expect(shouldDismissSheet(170, 700, 0)).toBe(true)
    expect(shouldDismissSheet(70, 700, 0.8)).toBe(true)
    expect(shouldDismissSheet(100, 400, 0)).toBe(true)
  })
})
