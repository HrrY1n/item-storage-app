/**
 * Worker 侧的硬限制（抽出独立模块以便单测）。
 *
 * ⚠️ 这些数字是 Worker 与客户端之间的约定，
 *    `src/features/sync/syncLimits.test.ts` 会交叉断言两边一致 ——
 *    任何一边改动而另一边忘记同步，测试立刻失败。
 */

/**
 * 一次 push 允许的最大变更条数。
 *
 * 推导（详见 src/features/sync/syncLimits.ts）：
 * - **bound parameters ≤ 100/query**：预加载查询参数 ≈ 3 + N ≤ 100 → N ≤ 97
 * - **Free 50 queries/invocation**：预加载(分片) + N upsert + 1 计数器推进 ≤ 50 → N ≤ 48
 *
 * 取 32 留余量（将来若新增步骤无需回头改这个数字）。
 */
export const MAX_PUSH = 32

/** 一次 pull 允许的最大条数（受 Workers 免费版 10ms CPU 约束，取保守值） */
export const MAX_PULL = 100

/**
 * 预加载查询按 id 分片的大小。
 *
 * 单条语句参数 = 实体种类数(≤3) + 本片 id 数 ≤ 3 + 90 = 93 < 100 ✅
 * 分片让「变更数超过 97」的情况也不会突破绑定参数上限。
 */
export const PRELOAD_CHUNK = 90