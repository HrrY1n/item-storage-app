import { describe, expect, it } from 'vitest'
import {
  backoffDelay,
  chunk,
  classifyStatus,
  shouldAutoRetry,
  shouldRequestSync,
  summarizeSync,
  SYNC_MAX_AUTO_RETRIES,
  SYNC_THROTTLE_MS,
} from './syncPolicy'

/**
 * 同步决策的纯逻辑测试。
 * 对应 3B 计划 §8.1「纯函数必须有测试」。
 */

const base = {
  enabled: true,
  configured: true,
  online: true,
  lastAttemptAt: null as number | null,
  // now 只在 visible（节流）分支参与计算，给个固定值即可
  now: 1_000_000,
}

describe('shouldRequestSync', () => {
  it('同步未启用时一律不同步（保证默认关闭不影响既有 App）', () => {
    expect(
      shouldRequestSync({ ...base, enabled: false, reason: 'boot' }),
    ).toBe(false)
    expect(
      shouldRequestSync({ ...base, enabled: false, reason: 'manual' }),
    ).toBe(false)
  })

  it('未配好凭据时不同步', () => {
    expect(shouldRequestSync({ ...base, configured: false, reason: 'boot' })).toBe(false)
  })

  it('离线时不同步', () => {
    expect(shouldRequestSync({ ...base, online: false, reason: 'boot' })).toBe(false)
    expect(shouldRequestSync({ ...base, online: false, reason: 'manual' })).toBe(false)
  })

  it('已有同步在飞时不重复发起', () => {
    expect(shouldRequestSync({ ...base, reason: 'boot', inFlight: true })).toBe(false)
  })

  it('启动、手动、联网恢复都忽略节流', () => {
    const recently = Date.now()
    for (const reason of ['boot', 'manual', 'online'] as const) {
      expect(shouldRequestSync({ ...base, reason, lastAttemptAt: recently })).toBe(true)
    }
  })

  it('前台恢复：距上次尝试不足节流窗口则不同步', () => {
    const now = 1_000_000
    expect(
      shouldRequestSync({
        ...base,
        reason: 'visible',
        now,
        lastAttemptAt: now - SYNC_THROTTLE_MS + 1,
      }),
    ).toBe(false)
  })

  it('前台恢复：超过节流窗口则同步', () => {
    const now = 1_000_000
    expect(
      shouldRequestSync({
        ...base,
        reason: 'visible',
        now,
        lastAttemptAt: now - SYNC_THROTTLE_MS,
      }),
    ).toBe(true)
  })

  it('前台恢复：从未尝试过则同步', () => {
    expect(shouldRequestSync({ ...base, reason: 'visible', lastAttemptAt: null })).toBe(true)
  })
})

describe('classifyStatus', () => {
  it('401 是未授权（需要重新配对，重试无意义）', () => {
    expect(classifyStatus(401)).toBe('unauthorized')
  })

  it('429 是限流', () => {
    expect(classifyStatus(429)).toBe('rate-limited')
  })

  it('5xx 是服务端故障', () => {
    expect(classifyStatus(500)).toBe('server')
    expect(classifyStatus(503)).toBe('server')
  })

  it('其他状态码归为 unknown', () => {
    expect(classifyStatus(400)).toBe('unknown')
    expect(classifyStatus(404)).toBe('unknown')
  })
})

describe('shouldAutoRetry', () => {
  it('未授权不重试（再试一百次也是 401，只白耗额度）', () => {
    expect(shouldAutoRetry('unauthorized', 1)).toBe(false)
  })

  it('离线不靠定时器重试，等 online 事件', () => {
    expect(shouldAutoRetry('offline', 1)).toBe(false)
  })

  it('服务端故障在重试上限内才重试', () => {
    expect(shouldAutoRetry('server', 1)).toBe(true)
    expect(shouldAutoRetry('server', SYNC_MAX_AUTO_RETRIES)).toBe(false)
  })
})

describe('backoffDelay', () => {
  it('随尝试次数递增', () => {
    const d1 = backoffDelay(1) ?? 0
    const d2 = backoffDelay(2) ?? 0
    const d3 = backoffDelay(3) ?? 0
    expect(d1).toBeLessThan(d2)
    expect(d2).toBeLessThan(d3)
  })

  it('超出上限返回 null（转为等用户手动重试）', () => {
    expect(backoffDelay(SYNC_MAX_AUTO_RETRIES + 1)).toBeNull()
  })

  it('非法输入返回 null', () => {
    expect(backoffDelay(0)).toBeNull()
    expect(backoffDelay(-1)).toBeNull()
  })
})

describe('chunk', () => {
  it('按批大小切分', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('空数组返回空', () => {
    expect(chunk([], 10)).toEqual([])
  })

  it('批大小非法时按 1 处理，不会死循环', () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]])
  })

  it('恰好整除时不产生空的尾批', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })
})

describe('summarizeSync', () => {
  const base2 = {
    enabled: true,
    configured: true,
    online: true,
    pendingCount: 0,
    syncing: false,
    lastSyncAt: null as string | null,
    lastError: null as string | null,
  }

  it('未启用 → disabled', () => {
    expect(summarizeSync({ ...base2, enabled: false })).toEqual({ kind: 'disabled' })
  })

  it('已启用但没配好凭据 → needs-setup', () => {
    expect(summarizeSync({ ...base2, configured: false })).toEqual({ kind: 'needs-setup' })
  })

  it('离线且有积压 → offline 且带pendingCount', () => {
    expect(summarizeSync({ ...base2, online: false, pendingCount: 3 })).toEqual({
      kind: 'offline',
      pendingCount: 3,
    })
  })

  it('有失败记录 → error 并带消息', () => {
    expect(summarizeSync({ ...base2, lastError: '同步失败', pendingCount: 2 })).toEqual({
      kind: 'error',
      message: '同步失败',
      pendingCount: 2,
    })
  })

  it('干净且在线 → synced', () => {
    expect(summarizeSync({ ...base2, lastSyncAt: '2026-10-06T00:00:00.000Z' })).toEqual({
      kind: 'synced',
      lastSyncAt: '2026-10-06T00:00:00.000Z',
    })
  })

  it('有积压且在线 → pending', () => {
    expect(summarizeSync({ ...base2, pendingCount: 5 })).toEqual({
      kind: 'pending',
      pendingCount: 5,
    })
  })
})