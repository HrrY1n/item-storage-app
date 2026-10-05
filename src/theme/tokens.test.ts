import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'

/**
 * Phase 2H 新增 token 的双主题对称性。
 *
 * Hero / info 是本轮新增的语义层：任何一侧漏定义都会让组件在该主题下
 * 回落成透明/黑色 —— 这种问题截图能看出来，但测试能更早拦住。
 */
function themeBlock(theme: 'light' | 'dark'): string {
  const marker = theme === 'light' ? "[data-theme='light']" : "[data-theme='dark']"
  const start = css.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const next = css.indexOf("[data-theme='", start + marker.length)
  return css.slice(start, next === -1 ? undefined : next)
}

describe('Phase 2H token 对称性', () => {
  const tokens = [
    '--color-canvas',
    '--color-surface',
    '--color-surface-raised',
    '--color-surface-sunken',
    '--color-info',
    '--color-info-soft',
    '--color-hero',
    '--color-hero-top',
    '--color-hero-bottom',
    '--color-hero-line',
    '--hero-glow',
  ]

  it.each(['light', 'dark'] as const)('%s 主题定义了全部 Phase 2H token', (theme) => {
    const block = themeBlock(theme)
    for (const t of tokens) {
      expect(block, `${theme} 缺少 ${t}`).toContain(`${t}:`)
    }
  })

  it('.hero-surface 工具类存在且只引用 token（不出现硬编码 hex）', () => {
    const start = css.indexOf('.hero-surface {')
    expect(start).toBeGreaterThan(-1)
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule).toContain('var(--color-hero)')
    expect(rule).toContain('var(--hero-glow)')
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('浅色 canvas 明显比 surface 沉（分组层级的前提）', () => {
    const light = themeBlock('light')
    const canvas = light.match(/--color-canvas: (#[0-9a-fA-F]{6})/)![1]
    const surface = light.match(/--color-surface: (#[0-9a-fA-F]{6})/)![1]
    // canvas 至少比 surface 暗一档：G 通道差 >= 8
    const g = (hex: string) => parseInt(hex.slice(3, 5), 16)
    expect(g(surface) - g(canvas)).toBeGreaterThanOrEqual(8)
  })

  it('深色 surface 明显比 canvas 抬升（杜绝"糊成一团"）', () => {
    const dark = themeBlock('dark')
    const canvas = dark.match(/--color-canvas: (#[0-9a-fA-F]{6})/)![1]
    const surface = dark.match(/--color-surface: (#[0-9a-fA-F]{6})/)![1]
    const g = (hex: string) => parseInt(hex.slice(3, 5), 16)
    expect(g(surface) - g(canvas)).toBeGreaterThanOrEqual(8)
  })
})
