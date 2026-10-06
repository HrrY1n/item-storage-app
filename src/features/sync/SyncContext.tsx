import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { syncRepository } from '../../db/repositories/syncRepository'
import type { SyncConflict } from '../../domain/types'
import type { SyncReason, SyncStatusSummary } from './syncPolicy'
import { getSyncEngine } from '../../services/syncService'

/**
 * 同步的 React 层。
 *
 * 沿用 Phase 2H.1 的做法：Context + hook，**不引入状态库**。
 * 与 `PwaUpdateContext` 平行存在，两者互不干扰 ——
 * PWA 更新管"要不要 reload"，同步管"要不要推拉"，各自的节流独立。
 */

export interface SyncContextValue {
  /** 状态摘要（设置页展示用） */
  summary: SyncStatusSummary | null
  /** 立即刷新状态 */
  refresh(): Promise<void>
  /** 手动触发一次同步（忽略节流） */
  syncNow(): Promise<void>
  /** 是否已启用 */
  enabled: boolean
  /** 最近一次覆盖记录 */
  conflicts: SyncConflict[]
}

const SyncContext = createContext<SyncContextValue | null>(null)

export interface SyncProviderProps {
  children: ReactNode
}

/**
 * 引擎在 provider 内部惰性获取（services/syncService.getSyncEngine），
 * 这样 App 组件不必关心装配顺序。
 *
 * ⚠️ SSR / 测试环境下 getSyncEngine 会返回一个"永不发送请求"的引擎
 *    （因为没有 credentials），因此 summary 始终是 disabled —— 安全。
 */
export function SyncProvider({ children }: SyncProviderProps) {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false
  const [summary, setSummary] = useState<SyncStatusSummary | null>(null)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])

  const refresh = useCallback(async () => {
    const e = getSyncEngine()
    const [s, list] = await Promise.all([e.summary(online), syncRepository.listConflicts(10)])
    setSummary(s)
    setConflicts(list)
  }, [online])

  const syncNow = useCallback(async () => {
    const e = getSyncEngine()
    await e.run()
    await refresh()
  }, [refresh])

  // 引擎状态变化时刷新 UI（订阅只注册一次）
  useEffect(() => {
    void refresh()
    return getSyncEngine().subscribe(() => {
      void refresh()
    })
  }, [refresh])

  // 网络恢复时自动追赶一次（不靠定时器）
  useEffect(() => {
    const onOnline = () => {
      void refresh()
      void syncNow()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [refresh, syncNow])

  const value = useMemo<SyncContextValue>(
    () => ({
      summary,
      refresh,
      syncNow,
      enabled: summary !== null && summary.kind !== 'disabled' && summary.kind !== 'needs-setup',
      conflicts,
    }),
    [summary, refresh, syncNow, conflicts],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

/**
 * 读取同步状态。
 *
 * ⚠️ 必须在 `<SyncProvider>` 内使用。未启用同步时 summary 为 null
 * 或 kind='disabled' —— **这是"同步默认关闭、不影响既有 App"的运行时保证**。
 */
export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext)
  if (ctx === null) {
    throw new Error('useSync 必须在 <SyncProvider> 内使用')
  }
  return ctx
}

export type { SyncReason }