/**
 * Worker 侧的硬限制（抽出独立模块以便单测）。
 *
 * ⚠️ 这些数字**必须**与 worker/index.ts 保持一致 ——
 *    syncLimits.test.ts 会交叉断言本模块与 worker/index.ts 导出的常量相等，
 *    任何一边改动而另一边忘记同步，测试立刻失败。
 */

/**
 * 一次 push 允许的最大变更条数。
 *
 * 推导（详见 src/features/sync/syncLimits.ts）：
 * - bound parameters ≤ 100/query：预加载查询参数 ≈ 3 + N ≤ 100 → N ≤ 97
 * - Free 50 queries/invocation：1 预加载 + N upsert + 1 revision 分配 ≤ 50 → N ≤ 48
 * 取 32 留余量。
 */
export const MAX_PUSH = 32

/** 一次 pull 允许的最大条数 */
export const MAX_PULL = 100

/**
 * 预加载查询按 id 分片的大小。
 *
 * 单条语句参数 = 实体种类数(≤3) + 本片 id 数 ≤ 3 + 90 = 93 < 100 ✅
 * 分片让「变更数超过 97」的情况也不会突破绑定参数上限。
 */
export const PRELOAD_CHUNK = 90