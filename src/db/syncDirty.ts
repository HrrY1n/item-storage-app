/**
 * 「本地业务数据变脏了」的极小事件总线。
 *
 * ## 为什么放在 db 层
 *
 * 触发链条是：repository（db 层）写完业务表 → 通知同步层。
 * 若让 repository 直接 `import { requestSync } from '../../services/syncService'`，
 * 就变成 **db 层反向依赖 services 层**，与项目分层约定冲突
 * （domain → db/repositories → features/services → pages）。
 *
 * 所以这里只放一个**零依赖**的信号：repository 喊一声"脏了"，
 * 由 syncService（上层）订阅并决定怎么 debounce、要不要发网络请求。
 *
 * ## 为什么不用 Dexie 的 hook / storage 事件
 *
 * - Dexie hook 在**事务内部**触发，而在事务里发起网络请求是明确禁止的
 *   （事务会因 await 非 Dexie Promise 而中断/丢失原子性）
 * - 本总线由 repository 在**事务提交之后**显式调用，时序可控且可测
 */

type DirtyListener = () => void

const listeners = new Set<DirtyListener>()

/**
 * 标记"本地有新的待同步改动"。
 *
 * ⚠️ 必须在业务 Dexie 事务**提交之后**调用 —— 事务内调用会让调用方面临
 *    "事务等待网络"的风险。所有 repository 都遵守这一点。
 *
 * 纯同步、无返回、不抛错：仓库写完顺手喊一声，绝不影响业务写入的成功与否。
 */
export function markSyncDirty(): void {
  // 复制一份再遍历：监听回调里可能会退订（防御性，成本可忽略）
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch {
      /* 监听者出错绝不能影响业务写入路径 */
    }
  }
}

/**
 * 订阅"本地变脏"事件。
 *
 * @returns 退订函数
 */
export function onSyncDirty(fn: DirtyListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 仅测试用：清空所有订阅，避免用例间互相污染 */
export function resetSyncDirtyListeners(): void {
  listeners.clear()
}
