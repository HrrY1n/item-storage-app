/**
 * 跨设备同步的**纯逻辑**（无平台 API、无副作用，全部有测试）。
 *
 * 为什么抽出来：同步流程里真正容易出错的是"什么时候该同步"和"失败了该怎么办"，
 * 这两件事与 fetch / IndexedDB 都无关，抽成纯函数才能被单元测试钉死。
 *
 * 设计要点（见 docs/PHASE_3A_SYNC_DESIGN.md / PHASE_3B_IMPLEMENTATION_PLAN.md）：
 * - 同步是**后置动作**：任何情况下都不阻塞 App，不修改本地业务数据
 * - 离线 / 失败一律静默降级，绝不弹错误打断用户
 * - 节流只作用于"自动触发"，用户手动点击始终忽略节流
 */

/** 触发一次同步的原因 */
export type SyncReason =
  /** 应用启动 */
  | 'boot'
  /** 页面从后台恢复到前台 */
  | 'visible'
  /** 网络从离线恢复 */
  | 'online'
  /** 用户在设置里手动点击「立即同步」 */
  | 'manual'
  /**
   * 本地业务写入（新增/编辑/删除物品、标签、分类）之后。
   *
   * Phase 3B.1 新增：真实使用是"只有一台主力手机"，用户保存后不该再手动点同步。
   * 这个原因由 syncService 的 debounce 统一发出（见 LOCAL_CHANGE_DEBOUNCE_MS），
   * **绝不是** repository 每次写入都发一次 —— 那会把一次整理动作放大成 N 个请求。
   */
  | 'local-change'

/** 自动触发（前台恢复类）的最小间隔，避免每次切前台都打一次网络请求 */
export const SYNC_THROTTLE_MS = 60_000

/**
 * 本地改动后**聚合窗口**：这段时间内的连续改动合并成一次同步。
 *
 * 取 2.5s 的理由：手机上一次"整理动作"（新增物品 → 改标签 → 移动分类）
 * 通常在 1~2 秒内完成，2.5s 能可靠地把它们合成一次；又不至于让用户
 * 保存后等太久才看到"已同步"。
 */
export const LOCAL_CHANGE_DEBOUNCE_MS = 2_500

/**
 * ⚠️ local-change **刻意不参与节流**（与 boot / manual / online 同级）。
 *
 * 试过给它一个更短的节流窗口（10s），但那会制造一个真实缺陷：
 * 用户改一次 → 同步成功；**5 秒后**再改一次 → 被节流挡住 → 而 debounce
 * 已经触发过、不会再触发，于是这次改动**滞留在本机**，直到切前台 /
 * 恢复网络 / 手动点击才补上。"保存即同步"的语义就没了。
 *
 * 要补这个洞就得"被节流时重新排期"，复杂度明显上升而收益很小。
 * 因此限流职责**完全交给 debounce**：
 *   - 聚合窗口 2.5s 已经把"连续整理动作"合成一次
 *   - 引擎的 `inFlight` 保证不会并发打网络
 *   - 想发第二次请求，必须先有 2.5s 的静默 —— 单人单机的量级完全够用
 */
export const LOCAL_CHANGE_THROTTLE_MS = 0

/** 退避序列：失败后第 n 次重试的等待时间（毫秒） */
export const SYNC_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000] as const

/** 超过这个次数后停止自动重试，转为「等待用户手动重试」 */
export const SYNC_MAX_AUTO_RETRIES = SYNC_BACKOFF_MS.length

export interface SyncDecisionInput {
  reason: SyncReason
  /** 同步是否已启用（用户显式开启过） */
  enabled: boolean
  /** 是否已配好凭据（secret 存在） */
  configured: boolean
  /** 网络是否可用 */
  online: boolean
  now: number
  /** 上一次同步尝试的时间戳；null = 从未尝试过 */
  lastAttemptAt: number | null
  /** 是否已有一次同步在飞行中 */
  inFlight?: boolean
  throttleMs?: number
}

/**
 * 是否应该发起一次同步。
 *
 * - 未启用 / 未配好凭据 → 不同步。**这是"同步默认关闭不影响既有 App"的兜底**
 * - 离线 → 不同步（静默）
 * - 已在飞行中 → 不重复
 * - boot / manual / online / local-change → 忽略节流
 *   （boot 只发生一次；manual 是用户明确意图；online 是新信息；
 *    local-change 的限流由 2.5s debounce 负责，再节流会让改动滞留 ——
 *    详见 LOCAL_CHANGE_THROTTLE_MS 的注释）
 * - visible → 距上次尝试 >= SYNC_THROTTLE_MS 才同步
 */
export function shouldRequestSync(input: SyncDecisionInput): boolean {
  if (!input.enabled) return false
  if (!input.configured) return false
  if (!input.online) return false
  if (input.inFlight === true) return false
  if (input.reason === 'manual') return true
  if (input.reason === 'boot') return true
  if (input.reason === 'online') return true
  if (input.reason === 'local-change') return true
  if (input.lastAttemptAt === null) return true
  const throttle = input.throttleMs ?? SYNC_THROTTLE_MS
  return input.now - input.lastAttemptAt >= throttle
}

/** 同步失败的分类。决定 UI 展示与重试策略。 */
export type SyncErrorKind =
  /** 网络不可达 / 请求超时 —— 静默，等 online 事件 */
  | 'offline'
  /** 401：secret 无效或被吊销 —— **需要用户重新配对**，重试无意义 */
  | 'unauthorized'
  /** 429：请求过于频繁 —— 退避后重试 */
  | 'rate-limited'
  /** 5xx：Cloudflare / D1 侧故障 —— 退避后重试 */
  | 'server'
  /** 其他错误（含解析失败） —— 退避后重试 */
  | 'unknown'

/** 把 HTTP 状态码归类。纯函数，便于针对每类写测试。 */
export function classifyStatus(status: number): SyncErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server'
  return 'unknown'
}

/**
 * 某次失败是否值得自动重试。
 *
 * `unauthorized` 不重试 —— secret 不对，重试一百次也是 401，
 * 只会白耗额度并让用户以为 App 出问题。应当安静地等用户重新配对。
 */
export function shouldAutoRetry(kind: SyncErrorKind, attempt: number): boolean {
  if (kind === 'unauthorized') return false
  if (kind === 'offline') return false // 等 online 事件，不靠定时器
  return attempt < SYNC_MAX_AUTO_RETRIES
}

/**
 * 第 `attempt` 次失败后，等待多久再重试（毫秒）；null = 不再自动重试。
 *
 * attempt 从 1 开始计（即刚失败第一次时传 1）。
 */
export function backoffDelay(attempt: number): number | null {
  if (attempt < 1) return null
  if (attempt > SYNC_MAX_AUTO_RETRIES) return null
  return SYNC_BACKOFF_MS[attempt - 1] ?? null
}

/**
 * 把一批待推变更切成若干批，每批不超过 `batchSize`。
 *
 * 为什么必须分批（不是性能优化，是**硬约束**）：
 * D1 免费版**单次 Worker 调用只有 50 条查询**，且**单条查询最多 100 个绑定参数**
 * （Worker 预加载已有记录的 `IN (...)` 查询参数量 ≈ 3 + N）。
 * 两条约束把单批上限压到 48 / 97 —— 取更保守的 **32**。
 * 完整推导见 ./syncLimits.ts
 */
export function chunk<T>(items: readonly T[], batchSize: number): T[][] {
  const size = Math.max(1, Math.floor(batchSize))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

// 批大小与页大小的常量已移到 ./syncLimits —— 那里记录了
// D1 官方限制（bound params ≤ 100 / Free 50 queries per invocation）
// 以及 32 这个数字的完整推导，避免两处各写一份导致不一致。
export { SYNC_PULL_PAGE_SIZE, SYNC_PUSH_BATCH_SIZE, D1_MAX_BOUND_PARAMS_PER_QUERY } from './syncLimits'

/**
 * 同步状态的一行摘要，供设置页展示。
 * 刻意保持极简 —— 3B 不做同步历史页 / 控制台。
 */
export type SyncStatusSummary =
  | { kind: 'disabled' }
  | { kind: 'needs-setup' }
  | { kind: 'offline'; pendingCount: number }
  | { kind: 'pending'; pendingCount: number }
  | { kind: 'syncing'; pendingCount: number }
  | { kind: 'synced'; lastSyncAt: string | null }
  | { kind: 'error'; message: string; pendingCount: number }

export interface SyncStatusInput {
  enabled: boolean
  configured: boolean
  online: boolean
  pendingCount: number
  syncing: boolean
  lastSyncAt: string | null
  lastError: string | null
}

/**
 * 由原始状态派生一行展示文案。
 *
 * 优先级里有一点刻意的取舍：**「待同步 N 项」比「离线」更值得让用户看到**，
 * 因为离线是可预期的临时状态，而"有 N 项没同步上去"才是需要用户留意的。
 * 因此离线且有积压时展示 offline + pendingCount 两个信息。
 */
export function summarizeSync(input: SyncStatusInput): SyncStatusSummary {
  if (!input.enabled) return { kind: 'disabled' }
  if (!input.configured) return { kind: 'needs-setup' }
  if (!input.online) {
    return input.pendingCount > 0
      ? { kind: 'offline', pendingCount: input.pendingCount }
      : { kind: 'offline', pendingCount: 0 }
  }
  if (input.lastError !== null) {
    return { kind: 'error', message: input.lastError, pendingCount: input.pendingCount }
  }
  if (input.pendingCount > 0) return { kind: 'pending', pendingCount: input.pendingCount }
  return { kind: 'synced', lastSyncAt: input.lastSyncAt }
}

/** 把时间戳格式化成"刚刚 / N 分钟前 / N 小时前 / 日期"，供设置页展示 */
export function formatRelativeTime(iso: string | null, now: number): string {
  if (iso === null) return '从未'
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return '从未'
  const diff = now - then
  if (diff < 0) return '刚刚'
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const d = new Date(then)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 把状态摘要翻成设置页那一行文案 */
export function syncSummaryToMessage(s: SyncStatusSummary, now: number): string {
  switch (s.kind) {
    case 'disabled':
      return '未启用'
    case 'needs-setup':
      return '尚未完成配对'
    case 'synced':
      return `已同步 · ${formatRelativeTime(s.lastSyncAt, now)}`
    case 'pending':
      return `${s.pendingCount} 项待同步`
    case 'syncing':
      return '正在同步…'
    case 'offline':
      return s.pendingCount > 0 ? `离线 · ${s.pendingCount} 项待同步` : '离线 · 联网后会自动同步'
    case 'error':
      return `同步失败（${s.message}）· ${s.pendingCount} 项待同步`
  }
}