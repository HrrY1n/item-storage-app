import { registerSW } from 'virtual:pwa-register'
import { createUpdateManager, type PwaUpdateHost, type UpdateManager } from '../features/pwa/updateManager'
import { UPDATE_RELOAD_AT_KEY } from '../features/pwa/updatePolicy'

/**
 * PWA 更新的**浏览器侧**唯一装配点（Phase 2H.1）。
 *
 * 注册路径只有这一条：vite.config.ts 已把 `injectRegister` 设为 `null`，
 * 插件不再往 index.html 注入 `/registerSW.js`，全部由这里 `registerSW()` 完成。
 *
 * 关于 vite-plugin-pwa 1.3.0 的行为（读过 dist/client/build/register.js 后确认）：
 * - `registerType:'autoUpdate'` 模式下，`updateServiceWorker()` 内部**什么都不做**，
 *   插件也不会主动调用 `registration.update()` —— 所以必须自己主动检查。
 * - 但插件提供了 `onNeedReload`：传了它就不会自己 `window.location.reload()`，
 *   而是把这个决定权交给我们 → 这正是"编辑时不许刷新"的接入点。
 */

let manager: UpdateManager | null = null
let registration: ServiceWorkerRegistration | undefined
let swUrl: string | null = null

function createHost(): PwaUpdateHost {
  return {
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    isVisible: () =>
      typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
    now: () => Date.now(),
    reload: () => window.location.reload(),

    async updateSw() {
      if (!registration) return
      // 先用 no-store 主动探一次 sw.js，避免被浏览器对 SW 脚本的缓存上限挡住；
      // 失败不影响后续（registration.update 自身也会取一次）。
      if (swUrl) {
        try {
          await fetch(swUrl, { cache: 'no-store' })
        } catch {
          /* 离线或网络错误：静默，交给后面的 update() 兜底 */
        }
      }
      await registration.update()
    },

    readReloadAt() {
      try {
        const raw = sessionStorage.getItem(UPDATE_RELOAD_AT_KEY)
        if (raw === null) return null
        const n = Number(raw)
        return Number.isFinite(n) ? n : null
      } catch {
        return null // 隐私模式：读不到就当作"没刷新过"
      }
    },

    writeReloadAt(at: number) {
      try {
        sessionStorage.setItem(UPDATE_RELOAD_AT_KEY, String(at))
      } catch {
        /* 写不进去也不影响正确性，只是少了一层防循环保护 */
      }
    },

    setTimeout: (fn, ms) => window.setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => window.clearTimeout(id),
    wait: (ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
  }
}

/**
 * 启动 PWA 更新管理。只调用一次（幂等）。
 *
 * 刻意**不阻塞首屏**：注册走 `immediate: true`，但启动检查排在 React 挂载之后。
 */
export function startPwaUpdate(): UpdateManager {
  if (manager) return manager
  manager = createUpdateManager(createHost())

  try {
    // onNeedReload 一旦提供，插件就不会自己 reload —— 刷新时机完全由管理器决定
    registerSW({
      immediate: true,
      onRegisteredSW(url, reg) {
        swUrl = url
        registration = reg ?? undefined
        // 首屏之后再异步检查一次，不阻塞渲染
        void manager?.requestCheck('boot')
      },
      onNeedReload() {
        manager?.markUpdateAvailable()
      },
      onOfflineReady() {
        manager?.markOfflineReady()
      },
      onRegisterError() {
        // 注册失败（非 HTTPS / 不支持 SW / 浏览器禁用）：静默降级，App 照样能用
      },
    })
  } catch {
    /* 同上：任何异常都不允许影响应用 */
  }

  attachLifecycle(manager)
  return manager
}

/** 页面生命周期 → 统一的 requestCheck(reason)，内部自带节流 */
function attachLifecycle(m: UpdateManager): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  document.addEventListener('visibilitychange', () => {
    m.setVisible(document.visibilityState !== 'hidden')
  })

  // iOS 主屏 PWA 从挂起恢复 / 前进后退缓存返回时触发
  window.addEventListener('pageshow', () => {
    if (document.visibilityState === 'hidden') return
    void m.requestCheck('pageshow')
  })

  window.addEventListener('online', () => m.setOnline(true))
  window.addEventListener('offline', () => m.setOnline(false))
}

/** 供 React 层使用（未启动则惰性启动） */
export function getUpdateManager(): UpdateManager {
  return manager ?? startPwaUpdate()
}
