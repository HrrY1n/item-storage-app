/**
 * 主题偏好：纯逻辑 + 与 DOM 的边界（可独立测试）。
 *
 * 三态偏好：system / light / dark。默认 system，写入 localStorage。
 *
 * ⚠️ 一致性约束：THEME_STORAGE_KEY 与 CANVAS_COLOR 同时被 index.html 的内联启动脚本
 * 使用（那段脚本必须在 React mount 之前跑完，无法 import 本模块）。
 * 改动这里必须同步 index.html —— icons.test 之外，theme.test 会断言两者一致。
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'pil.theme'

/** 与 tailwind --color-canvas 完全一致；用于 <meta name="theme-color"> */
export const CANVAS_COLOR: Record<ResolvedTheme, string> = {
  light: '#FAFAFA',
  dark: '#0E0E10',
}

export const THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark']

/** 任意来源（localStorage / URL / 表单）→ 合法偏好；非法一律回落 system */
export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/** 偏好 + 系统当前是否深色 → 实际生效的主题 */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'light') return 'light'
  if (pref === 'dark') return 'dark'
  return systemPrefersDark ? 'dark' : 'light'
}

export function readThemePreference(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY))
  } catch {
    // 隐私模式 / 站点数据被禁用：静默回落默认值，不影响使用
    return 'system'
  }
}

export function writeThemePreference(
  pref: ThemePreference,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    /* 忽略写入失败 */
  }
}

/** 系统是否偏好深色（未实现 matchMedia 的环境视为浅色） */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 把解析后的主题写进 DOM：data-theme 驱动全部 CSS 变量，
 * 同时同步 theme-color，让 iOS / PWA 状态栏与当前主题一致。
 */
export function applyTheme(resolved: ResolvedTheme, root: Document = document): void {
  root.documentElement.dataset.theme = resolved
  const meta = root.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', CANVAS_COLOR[resolved])
}
