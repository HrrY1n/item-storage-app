import { UPDATE_RELOAD_GUARD_MS } from './updatePolicy'
import {
  decideApply,
  guardRetryDelay,
  shouldRequestUpdateCheck,
  type UpdateCheckReason,
} from './updatePolicy'

/**
 * PWA 更新管理器（Phase 2H.1）。
 *
 * 职责：主动检查更新、跟踪 pending、控制"什么时候才允许 reload"、
 * 处理离线与节流、防止 reload 死循环。注册本身由 `startPwaUpdate()` 完成。
 *
 * 设计要点：
 * - **平台访问全部通过 host 注入**（online / visible / storage / reload / updateSw），
 *   因此这个模块能在 node 环境里用假 host 完整测试，不需要 DOM 测试库。
 * - **只有一条 reload 路径**：`host.reload()` 只被 `apply()` 调用，
 *   且调用前用 `applying` 关门，杜绝重复刷新与双重 reload listener。
 * - 更新检查失败一律静默（catch 掉），绝不阻塞应用使用，也不弹"更新失败"。
 */

export interface PwaUpdateHost {
  isOnline(): boolean
  isVisible(): boolean
  now(): number
  /** 唯一允许的刷新出口 */
  reload(): void
  /** 探测 sw.js（no-store）+ registration.update()，内部自行兜错 */
  updateSw(): Promise<void>
  /** 读取/写入"最近一次更新触发的 reload 时间"（sessionStorage） */
  readReloadAt(): number | null
  writeReloadAt(at: number): void
  /** 定时器：保护窗口结束后的重试 */
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
  /** 睡眠：手动检查后给新 SW 安装留的宽限（测试中可为空实现） */
  wait(ms: number): Promise<void>
}

export interface PwaUpdateSnapshot {
  online: boolean
  /** 已发现新版本，等待应用 */
  updatePending: boolean
  /** 刷新中（防重复 reload） */
  applying: boolean
  /** 有组件声明"此刻不能刷新" */
  blocked: boolean
  /** SW 已完成首次安装，离线可用 */
  offlineReady: boolean
  /** 正在检查中 */
  checking: boolean
  lastCheckedAt: number | null
}

export interface UpdateManager {
  getSnapshot(): PwaUpdateSnapshot
  subscribe(listener: () => void): () => void
  /** 主动检查一次；返回是否真的发起了检查 */
  requestCheck(reason: UpdateCheckReason): Promise<boolean>
  /** vite-plugin-pwa 的 onNeedReload：新 SW 已激活，可以刷新了（不立刻刷，交给策略） */
  markUpdateAvailable(): void
  markOfflineReady(): void
  /** 组件声明"此刻不能刷新"（按 key 记录，可重入） */
  setBlocked(key: string, blocked: boolean): void
  setOnline(online: boolean): void
  setVisible(visible: boolean): void
  /** 按当前策略尝试应用更新 */
  tryApply(): void
}

/** 手动检查后给新 SW 安装/激活留的宽限，避免误报"已是最新" */
const CHECK_GRACE_MS = 900

export function createUpdateManager(host: PwaUpdateHost): UpdateManager {
  const listeners = new Set<() => void>()
  const blockedKeys = new Set<string>()

  let snapshot: PwaUpdateSnapshot = {
    online: host.isOnline(),
    updatePending: false,
    applying: false,
    blocked: false,
    offlineReady: false,
    checking: false,
    lastCheckedAt: null,
  }

  let inFlight = false
  let retryTimer: number | null = null

  const emit = () => {
    for (const l of listeners) l()
  }

  const patch = (next: Partial<PwaUpdateSnapshot>) => {
    snapshot = { ...snapshot, ...next }
    emit()
  }

  const clearRetry = () => {
    if (retryTimer !== null) {
      host.clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  /** 唯一出口：判定可以做才 reload，且整段只可能执行一次（applying 关门） */
  function apply(): void {
    if (snapshot.applying) return
    const now = host.now()
    const input = {
      pending: snapshot.updatePending,
      blocked: snapshot.blocked,
      visible: host.isVisible(),
      now,
      lastAutoReloadAt: host.readReloadAt(),
    }
    const decision = decideApply(input)

    if (decision !== 'apply') {
      // 处在 reload 保护窗口内：安排一次延后重试，**而不是放弃这次更新**
      if (decision === 'defer-guard' && retryTimer === null) {
        const delay = guardRetryDelay(input)
        clearRetry()
        if (delay !== null) {
          retryTimer = host.setTimeout(() => {
            retryTimer = null
            apply()
          }, delay + 50)
        }
      }
      return
    }

    clearRetry()
    patch({ applying: true })
    host.writeReloadAt(host.now())
    host.reload()
  }

  async function requestCheck(reason: UpdateCheckReason): Promise<boolean> {
    const ok = shouldRequestUpdateCheck({
      reason,
      online: host.isOnline(),
      now: host.now(),
      lastCheckAt: snapshot.lastCheckedAt,
      inFlight,
    })
    if (!ok) return false

    inFlight = true
    patch({ checking: true })
    try {
      await host.updateSw()
      patch({ lastCheckedAt: host.now() })
      // 新 SW 的安装/激活是异步的，给一个极短宽限，让手动检查的判断更准
      await host.wait(CHECK_GRACE_MS)
    } catch {
      // 离线 / 网络错误 / 不支持 SW：静默降级，绝不影响 App 使用
    } finally {
      inFlight = false
      patch({ checking: false })
    }
    return true
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    requestCheck,

    markUpdateAvailable() {
      patch({ updatePending: true })
      apply()
    },

    markOfflineReady() {
      patch({ offlineReady: true })
    },

    setBlocked(key, blocked) {
      if (blocked) blockedKeys.add(key)
      else blockedKeys.delete(key)
      const next = blockedKeys.size > 0
      if (next !== snapshot.blocked) patch({ blocked: next })
      // 从"被阻止"恢复 = 保存成功 / 离开表单的时刻，自动补上这次更新
      if (!next && snapshot.updatePending) apply()
    },

    setOnline(online) {
      patch({ online })
      if (online && !snapshot.updatePending) void requestCheck('online')
    },

    setVisible(visible) {
      if (!visible) return
      void requestCheck('visible')
      if (snapshot.updatePending) apply()
    },

    tryApply: apply,
  }
}

export { UPDATE_RELOAD_GUARD_MS }
