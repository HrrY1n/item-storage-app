import { beforeEach, describe, expect, it, vi } from 'vitest'
import css from '../index.css?raw'
import {
  CANVAS_COLOR,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  applyTheme,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  systemPrefersDark,
  writeThemePreference,
} from './theme'

describe('parseThemePreference', () => {
  it('只接受三个合法值', () => {
    expect(parseThemePreference('system')).toBe('system')
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('dark')).toBe('dark')
  })

  it('非法 / 缺失 / 类型错误一律回落 system', () => {
    for (const bad of [null, undefined, '', 'Dark', 'auto', 0, 1, {}, [], 'light ']) {
      expect(parseThemePreference(bad)).toBe('system')
    }
  })
})

describe('resolveTheme', () => {
  it('显式选择优先于系统', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('system 跟随系统实时值', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('三种偏好 × 两种系统状态都有确定结果', () => {
    for (const pref of THEME_PREFERENCES) {
      for (const dark of [true, false]) {
        expect(['light', 'dark']).toContain(resolveTheme(pref, dark))
      }
    }
  })
})

describe('偏好读写', () => {
  it('从 storage 读回写入的值', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    writeThemePreference('dark', storage)
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(readThemePreference(storage)).toBe('dark')
  })

  it('未写入过 → system', () => {
    expect(readThemePreference({ getItem: () => null })).toBe('system')
  })

  it('storage 抛异常（隐私模式）时静默降级，不抛出', () => {
    const boom = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(() => readThemePreference(boom)).not.toThrow()
    expect(readThemePreference(boom)).toBe('system')
    expect(() => writeThemePreference('dark', boom)).not.toThrow()
  })

  it('storage 中存了脏值 → 回落 system', () => {
    expect(readThemePreference({ getItem: () => 'neon' })).toBe('system')
  })
})

describe('applyTheme', () => {
  function fakeDoc() {
    const attributes: Record<string, string> = {}
    return {
      documentElement: { dataset: {} as Record<string, string> },
      querySelector: () => ({
        setAttribute: (k: string, v: string) => {
          attributes[k] = v
        },
      }),
      attributes,
    }
  }

  it('写入 data-theme 并同步 theme-color', () => {
    const doc = fakeDoc()
    applyTheme('dark', doc as unknown as Document)
    expect(doc.documentElement.dataset.theme).toBe('dark')
    expect(doc.attributes.content).toBe(CANVAS_COLOR.dark)

    applyTheme('light', doc as unknown as Document)
    expect(doc.documentElement.dataset.theme).toBe('light')
    expect(doc.attributes.content).toBe(CANVAS_COLOR.light)
  })

  it('缺少 theme-color meta 时不抛错', () => {
    const doc = {
      documentElement: { dataset: {} as Record<string, string> },
      querySelector: () => null,
    }
    expect(() => applyTheme('dark', doc as unknown as Document)).not.toThrow()
  })
})

describe('systemPrefersDark', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('读取 prefers-color-scheme', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q === '(prefers-color-scheme: dark)' }),
    })
    expect(systemPrefersDark()).toBe(true)
  })

  it('环境不支持 matchMedia 时视为浅色，不抛错', () => {
    vi.stubGlobal('window', {})
    expect(systemPrefersDark()).toBe(false)
  })
})

describe('主题 token 的两套定义保持对称', () => {
  function tokenNames(marker: string): string[] {
    const start = css.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const open = css.indexOf('{', start)
    const end = css.indexOf('\n}', open)
    const block = css.slice(open + 1, end)
    return [...block.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort()
  }

  it('深色主题必须定义与浅色完全相同的变量集合', () => {
    // 少一个变量，深色下就会静默回落到浅色值 —— 这是最容易漏、也最难发现的主题 bug
    const light = tokenNames(':root,')
    const dark = tokenNames("[data-theme='dark']")
    expect(dark).toEqual(light)
  })

  it('两套主题的值确实不同（不是把浅色复制一遍）', () => {
    const lightStart = css.indexOf(':root,')
    const darkStart = css.indexOf("[data-theme='dark']")
    expect(css.slice(lightStart, darkStart)).not.toBe(css.slice(darkStart, darkStart + 600))
    expect(lightStart).toBeLessThan(darkStart)
  })

  it('CSS 里的 canvas 与 theme.ts 的 CANVAS_COLOR 一致', () => {
    expect(css.toLowerCase()).toContain(CANVAS_COLOR.light.toLowerCase())
    expect(css.toLowerCase()).toContain(CANVAS_COLOR.dark.toLowerCase())
  })
})

describe('主题切换的动效契约', () => {
  it('卡片/表面的过渡类存在，且被 prefers-reduced-motion 门控', () => {
    expect(css).toContain('html.theme-shift main')
    expect(css).toContain('html.theme-shift .plate-surface')

    // 这条规则必须位于 prefers-reduced-motion: no-preference 块内，
    // 且块内不能再出现 reduce 门控 —— 即"允许动效时才有过渡"
    const idx = css.indexOf('html.theme-shift main')
    const gateOpen = css.lastIndexOf('@media (prefers-reduced-motion: no-preference)', idx)
    const blockEnd = css.indexOf('\n}', idx)
    expect(gateOpen).toBeGreaterThan(-1)
    expect(gateOpen).toBeLessThan(idx)
    expect(blockEnd).toBeGreaterThan(idx)
    expect(css.slice(gateOpen, blockEnd)).not.toContain('prefers-reduced-motion: reduce')
  })

  it('入场动画保持短促（fade-rise ≤ 360ms），避免"到处在飞"', () => {
    const m = /animation: fade-rise (\d+)ms/.exec(css)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeLessThanOrEqual(360)
  })

  it('prefers-reduced-motion 会一次性压制所有动画与过渡', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important[\s\S]*transition-duration: 0\.01ms !important/,
    )
  })
})
