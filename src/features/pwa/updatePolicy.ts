/**
 * PWA 更新决策的**纯逻辑**（无平台 API、无副作用，全部有测试）。
 *
 * 为什么抽出来：更新流程里真正容易出错的是"什么时候该检查"和"什么时候能刷新"，
 * 这两件事与浏览器 API 无关，抽成纯函数才能被单元测试钉死。
 *
 * 背景（vite-plugin-pwa 1.3.0 实测）：
 * `registerType: 'autoUpdate'` 只负责"浏览器发现新 SW 以后如何安装接管"，
 * `updateServiceWorker()` 在 autoUpdate 模式下**什么都不做**，插件也从不主动调用
 * `registration.update()`。iOS 主屏 PWA 恢复的是一个挂起的旧页面，
 * 于是就停在旧版本 —— 这正是本阶段要补的"客户端主动检查"。
 */

/** 触发更新检查的原因 */
export type UpdateCheckReason =
  /** 应用启动（首次检查，始终允许） */
  | 'boot'
  /** 页面从后台恢复到前台 */
  | 'visible'
  /** pageshow（iOS 恢复 / 前进后退缓存返回） */
  | 'pageshow'
  /** 网络从离线恢复 */
  | 'online'
  /** 用户在设置里手动点击 */
  | 'manual'

/** 前台恢复类检查的最小间隔：避免每次切前台都打一次网络请求 */
export const UPDATE_CHECK_THROTTLE_MS = 60_000

/**
 * 自动 reload 保护窗口：刚因更新刷新过，短时间内不再自动刷新。
 * 注意这是**延迟**而非丢弃 —— 窗口过后仍然会应用，不会把真实的新版本永久锁死。
 */
export const UPDATE_RELOAD_GUARD_MS = 15_000

/** sessionStorage 键：最近一次由更新触发的 reload 时间戳 */
export const UPDATE_RELOAD_AT_KEY = 'pil.pwa.update-reload-at'

export interface CheckDecisionInput {
  reason: UpdateCheckReason
  online: boolean
  now: number
  /** 上一次检查的时间戳；null = 从未检查过 */
  lastCheckAt: number | null
  /** 是否已有检查在飞行中（避免并发重复请求） */
  inFlight?: boolean
  throttleMs?: number
}

/**
 * 是否应该发起一次 `registration.update()`。
 *
 * - 离线 → 一律不检查（静默，不打扰用户）
 * - 已有检查在飞 → 不重复
 * - boot / manual / online → 忽略节流（启动只发生一次；手动是用户意图；联网恢复是新信息）
 * - visible / pageshow → 距离上次检查 >= 节流窗口才检查
 */
export function shouldRequestUpdateCheck(input: CheckDecisionInput): boolean {
  if (!input.online) return false
  if (input.inFlight === true) return false
  if (input.reason === 'manual' || input.reason === 'online' || input.reason === 'boot') return true
  if (input.lastCheckAt === null) return true
  const throttle = input.throttleMs ?? UPDATE_CHECK_THROTTLE_MS
  return input.now - input.lastCheckAt >= throttle
}

export type ApplyDecision =
  /** 没有待应用的更新 */
  | 'idle'
  /** 可以刷新到新版本 */
  | 'apply'
  /** 正在编辑 / 有未保存输入 → 绝不刷新 */
  | 'defer-blocked'
  /** 页面不可见（后台）→ 回到前台再刷 */
  | 'defer-hidden'
  /** 刚刷新过，处在保护窗口内 → 稍后重试 */
  | 'defer-guard'

export interface ApplyDecisionInput {
  /** 是否已发现并 pending 一个新版本 */
  pending: boolean
  /** 是否有组件声明"此刻不能刷新" */
  blocked: boolean
  visible: boolean
  now: number
  /** 最近一次自动 reload 的时间戳；null = 没有 */
  lastAutoReloadAt: number | null
  guardMs?: number
}

/**
 * 判定此刻能否刷新到新版本。
 *
 * 优先级：blocked > hidden > guard > apply。
 * **数据不丢失永远优先于"尽快更新"** —— 只要 blocked，就绝不允许 reload。
 */
export function decideApply(input: ApplyDecisionInput): ApplyDecision {
  if (!input.pending) return 'idle'
  if (input.blocked) return 'defer-blocked'
  if (!input.visible) return 'defer-hidden'
  const guard = input.guardMs ?? UPDATE_RELOAD_GUARD_MS
  if (input.lastAutoReloadAt !== null && input.now - input.lastAutoReloadAt < guard) {
    return 'defer-guard'
  }
  return 'apply'
}

/** 处在保护窗口时，还差多少毫秒可以重试（用于安排一次重试定时器） */
export function guardRetryDelay(input: ApplyDecisionInput): number | null {
  if (input.lastAutoReloadAt === null) return null
  const guard = input.guardMs ?? UPDATE_RELOAD_GUARD_MS
  const elapsed = input.now - input.lastAutoReloadAt
  if (elapsed >= guard) return null
  return guard - elapsed
}
