/**
 * 本地改动的 **debounce 聚合器**（Phase 3B.1）。
 *
 * ## 为什么单独抽出来
 *
 * 目标是"连续整理动作只产生一次网络请求"：
 *   新增物品 → 改标签 → 移动分类（都在 1~2 秒内完成）→ **只同步一次**
 *
 * 这件事的本质是**纯时序逻辑**，与网络、IndexedDB 都无关。
 * 若把 `setTimeout` 直接写进 syncService 里，就只能靠真实定时器去测
 * （要么 sleep 2.5 秒，要么引入 fake timers 去碰全局）——
 * 抽出来之后定时器变成注入项，测试可以用一个**手动推进的时钟**精确断言
 * 「通知 5 次、只触发 1 次」。
 */

export interface DebounceHost {
  /** 安排一次延迟回调，返回一个句柄 */
  setTimer(fn: () => void, ms: number): unknown
  /** 取消尚未触发的回调 */
  clearTimer(handle: unknown): void
}

export interface LocalChangeDebouncer {
  /** 本地又变脏了（会重置等待窗口） */
  notify(): void
  /** 取消待触发的那次 */
  cancel(): void
  /** 是否有一次同步正在等待触发 */
  pending(): boolean
}

export interface LocalChangeDebouncerOptions {
  debounceMs: number
  host: DebounceHost
  /** 窗口结束时真正要做的事（syncService 里是 requestSync('local-change')） */
  fire: () => void
}

/**
 * ⚠️ 这里**只做聚合**，不做任何网络决策。
 * "同步关闭 / 未配对 / 离线时不发请求"由 `shouldRequestSync` 负责 ——
 * 职责分开才能各自被单元测试钉死。
 */
export function createLocalChangeDebouncer(
  options: LocalChangeDebouncerOptions,
): LocalChangeDebouncer {
  let handle: unknown = null

  return {
    notify(): void {
      // ⭐ 关键：每次通知都**重置**窗口，而不是排队。
      //   连续 N 次改动因此合并成最后那一次触发。
      if (handle !== null) options.host.clearTimer(handle)
      handle = options.host.setTimer(() => {
        handle = null
        options.fire()
      }, options.debounceMs)
    },
    cancel(): void {
      if (handle !== null) {
        options.host.clearTimer(handle)
        handle = null
      }
    },
    pending(): boolean {
      return handle !== null
    },
  }
}

/** 生产环境用的真实定时器 */
export const realTimerHost: DebounceHost = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}
