import { describe, expect, it } from 'vitest'
import { chunk } from './syncPolicy'
import {
  D1_MAX_BOUND_PARAMS_PER_QUERY,
  SYNC_PULL_PAGE_SIZE,
  SYNC_PUSH_BATCH_SIZE,
} from './syncLimits'
import { MAX_PUSH as WORKER_MAX_PUSH, MAX_PULL as WORKER_MAX_PULL } from '../../../worker/limitsContract'

/**
 * 平台限制的边界测试（Phase 3B 复审第 1 条）。
 *
 * 背景：原实现把批大小设成 500，但 D1 官方限制是
 * **bound parameters per query = 100**（不是 500）。
 * 而 Worker 预加载已有记录用的���
 * `WHERE entity IN (...) AND entity_id IN (...)`
 * 其参数数 ≈ 实体种类(≤3) + 实体id 数 —— 500 条变更直接超出限制，
 * D1 会在**运行时**拒绝，用户体验是"同步莫名失败"。
 *
 * 这些测试的作用：把"为什么是 32"钉死，日后任何人想调大批量时
 * 会先撞到测试而不是撞到线上故障。
 */

/** 复刻 Worker 预加载查询的参数计算方式（index.ts 的 preloadExisting） */
function preloadParamCount(entityCount: number, idCount: number): number {
  return entityCount + idCount
}

describe('批大小与 D1 限制（官方：bound params ≤ 100 / Free 50 queries per invocation）', () => {
  it('批大小 ≤ Worker 允许的上限（两个常量必须一致）', () => {
    expect(SYNC_PUSH_BATCH_SIZE).toBeLessThanOrEqual(WORKER_MAX_PUSH)
  })

  it('★ 预加载查询的绑定参数不超过官方上限 —— 这是原实现的真实 bug', () => {
    const entities = 3 // item / category / tag
    const params = preloadParamCount(entities, SYNC_PUSH_BATCH_SIZE)
    expect(params).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS_PER_QUERY)
  })

  it('原实现的 500 条会突破限制（锁住这次修复的必要性）', () => {
    // 若有人把批大小改回 500，这条测试会失败并说明原因
    expect(preloadParamCount(3, 500)).toBeGreaterThan(D1_MAX_BOUND_PARAMS_PER_QUERY)
  })

  it('批大小也满足 Free 的 50 queries/invocation', () => {
    // 1（预加载，可能是分片的）+ N（upsert）+ 1（revision 分配）
    const queries = 1 + SYNC_PUSH_BATCH_SIZE + 1
    expect(queries).toBeLessThanOrEqual(50)
  })

  it('客户端批大小不超过 Worker 上限（避免 413）', () => {
    const batches = chunk([...Array(200).keys()], SYNC_PUSH_BATCH_SIZE)
    for (const b of batches) {
      expect(b.length).toBeLessThanOrEqual(WORKER_MAX_PUSH)
    }
  })

  it('pull 页大小也在Worker 上限之内', () => {
    expect(SYNC_PULL_PAGE_SIZE).toBeLessThanOrEqual(WORKER_MAX_PULL)
  })
})

describe('自动分批', () => {
  it('恰好整除不产生空批', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('有余数时最后一批是余数条数', () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])
  })

  it('200 条按 32 分批 → 7 批，且每批都不超限', () => {
    const batches = chunk([...Array(200).keys()], SYNC_PUSH_BATCH_SIZE)
    expect(batches).toHaveLength(7)
    expect(batches.every((b) => b.length <= SYNC_PUSH_BATCH_SIZE)).toBe(true)
  })

  it('非法的批大小不会死循环', () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]])
    expect(chunk([1, 2], -1)).toEqual([[1], [2]])
  })

  it('1000 条也正确分批（bootstrap 大数据量场景）', () => {
    const batches = chunk([...Array(1000).keys()], SYNC_PUSH_BATCH_SIZE)
    expect(batches).toHaveLength(Math.ceil(1000 / SYNC_PUSH_BATCH_SIZE))
    expect(batches.flat()).toHaveLength(1000)
  })
})