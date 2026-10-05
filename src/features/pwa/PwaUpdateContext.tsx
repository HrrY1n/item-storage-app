import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { getUpdateManager } from '../../services/pwaUpdate'
import type { PwaUpdateSnapshot } from './updateManager'

export type ManualCheckResult =
  /** 已经是最新版本 */
  | 'up-to-date'
  /** 发现新版本，正在更新 */
  | 'updating'
  /** 发现新版本，但当前正在编辑 → 推迟到操作完成后 */
  | 'pending-blocked'
  /** 离线：不报错，联网后会自动检查 */
  | 'offline'

interface PwaUpdateContextValue {
  snapshot: PwaUpdateSnapshot
  /** 手动检查（忽略节流） */
  checkForUpdate: () => Promise<ManualCheckResult>
  /** 组件注册"此刻不能刷新" */
  setBlocked: (key: string, blocked: boolean) => void
}

const PwaUpdateContext = createContext<PwaUpdateContextValue | null>(null)

export function PwaUpdateProvider({ children }: { children: ReactNode }) {
  const manager = getUpdateManager()
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => manager.subscribe(cb), [manager]),
    () => manager.getSnapshot(),
  )

  const checkForUpdate = useCallback(async (): Promise<ManualCheckResult> => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
    await manager.requestCheck('manual')
    const s = manager.getSnapshot()
    if (s.updatePending) return s.blocked ? 'pending-blocked' : 'updating'
    return 'up-to-date'
  }, [manager])

  const setBlocked = useCallback(
    (key: string, blocked: boolean) => manager.setBlocked(key, blocked),
    [manager],
  )

  const value = useMemo(
    () => ({ snapshot, checkForUpdate, setBlocked }),
    [snapshot, checkForUpdate, setBlocked],
  )

  return <PwaUpdateContext.Provider value={value}>{children}</PwaUpdateContext.Provider>
}

export function usePwaUpdate(): PwaUpdateContextValue {
  const ctx = useContext(PwaUpdateContext)
  if (ctx === null) {
    throw new Error('usePwaUpdate 必须在 PwaUpdateProvider 内使用')
  }
  return ctx
}

/**
 * 声明"当前不允许自动刷新到新版本"。
 *
 * 为什么不用路由判断 dirty：路由只能表达"在编辑页"，表达不了
 * 「处置浮层正打开且用户已输入金额」。让组件自己注册是最贴近事实的做法。
 *
 * 保守策略：进入编辑页就视为不安全（哪怕还没改动）。
 * 优先保证输入不丢失，而不是追求极端的自动化。
 */
export function useUpdateGuard(active: boolean, key: string): void {
  const { setBlocked } = usePwaUpdate()
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    setBlocked(key, active)
    return () => setBlocked(key, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, setBlocked])
}
