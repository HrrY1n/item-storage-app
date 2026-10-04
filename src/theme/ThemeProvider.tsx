import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  applyTheme,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  systemPrefersDark,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from './theme'

interface ThemeContextValue {
  /** 用户选择（含 system） */
  preference: ThemePreference
  /** 实际生效的主题 */
  resolved: ResolvedTheme
  /** 系统当前是否深色（供 UI 展示"跟随系统"的实时状态） */
  systemDark: boolean
  setPreference: (pref: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 初值与 index.html 内联脚本使用完全相同的推断路径，因此首帧不会跳色
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference())
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark())
  /** 上一次已应用的主题；用来判断"是否真的换了主题"（首挂不算切换） */
  const applied = useRef<ResolvedTheme | null>(null)

  // 跟随系统：监听 prefers-color-scheme，系统日夜切换时实时生效，无需刷新
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener('change', onChange)
    setSystemDark(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(preference, systemDark)

  useEffect(() => {
    applyTheme(resolved)
    // 只有真正"换了主题"才挂过渡：首次挂载时页面本来就是空的，不需要任何动画
    if (typeof document === 'undefined') return
    if (applied.current === resolved) return
    applied.current = resolved

    const root = document.documentElement
    root.classList.add('theme-shift')
    const t = setTimeout(() => root.classList.remove('theme-shift'), 260)
    return () => clearTimeout(t)
  }, [resolved])

  const setPreference = useCallback((pref: ThemePreference) => {
    const next = parseThemePreference(pref)
    writeThemePreference(next)
    setPreferenceState(next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, systemDark, setPreference }),
    [preference, resolved, systemDark, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return ctx
}
