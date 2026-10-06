/**
 * 同步的平台限制常量 —— **这些数字来自 Cloudflare 官方文档，不是估计值**。
 *
 * 核对时间：2026-10-06，来源：
 * - https://developers.cloudflare.com/d1/platform/limits/
 *
 * 官方原文对应数值：
 * - Maximum bound parameters per query : **100**
 * - Queries per Worker invocation     : **50**（Free）/ 1000（Paid）
 * - Maximum bindings per Workers script: 约 5000
 */

/**
 * 一次 push 的最大变更条数。
 *
 * ## 为什么是 32（第一版刻意保守，不追吞吐量）
 *
 * handlePush 每批会产生这些 D1 操作：
 * 1. 预加载已存在记录的查询（见下方参数预算）
 * 2. N 条 upsert，每条 7 个绑定参数
 * 3. 一次 revision 分配（UPDATE ... RETURNING，单条语句）
 *
 * 两条硬约束各自给出的上限：
 *
 * **① 绑定参数 ≤ 100/query**
 * 预加载查询是 `WHERE entity IN (?,...) AND entity_id IN (?,...)`。
 * 变更里不同的 entity 最多 3 种（item/category/tag），不同 entity_id 最多 N 个，
 * 因此参数总数 ≈ 3 + N。约束：3 + N ≤ 100 → **N ≤ 97**。
 * （单条 upsert 另用 7 个参数，但那是独立语句，不受这条限制。）
 *
 * **② 查询数 ≤ 50/invocation（Free）**
 * 1（预加载）+ N（upsert）+ 1（revision 分配）≤ 50 → **N ≤ 48**。
 *
 * 两者取小 → 48。但**第一版取 32**：留出余量应对将来 handlePush 里
 * 新增一两步（如 tag 去重预查），避免那时又要回来改这个数字。
 * 单用户场景下一天也就几百条变更，32 条一批完全不构成瓶颈。
 */
export const SYNC_PUSH_BATCH_SIZE = 32

/**
 * 一次 pull 的最大条数。
 *
 * pull 只有 1 条查询，`WHERE revision > ? ORDER BY revision LIMIT ?`。
 * 受 50 queries/invocation 约束极宽松，但被**单次返回行数**约束：
 * 500 行 × 每行一个 JSON 载荷在 Workers 免费版 10ms CPU 下偏重，
 * 取 100 作为保守值。
 */
export const SYNC_PULL_PAGE_SIZE = 100

/**
 * 预加载查询的参数预算校验用。
 *
 * 之所以要有这个常量而不是只靠注释：D1 会在**运行时**拒绝超过 100 个
 * 绑定参数的查询，那种错误出现在用户同步时才暴露，很难定位。
 * 我们在本地先拦住。
 */
export const D1_MAX_BOUND_PARAMS_PER_QUERY = 100