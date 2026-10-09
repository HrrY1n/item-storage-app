import { describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from '../../services/syncBytes'
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

  it('426 是协议不兼容', () => {
    expect(classifyStatus(426)).toBe('protocol')
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

  it('协议错误不自动重试，避免反复发送不兼容请求', () => {
    expect(shouldAutoRetry('protocol', 1)).toBe(false)
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
/* ==================================================================== *
 * base64url 双向编解码（syncBytes）
 *
 * ⚠️ 这里曾有一个**让B 设备完全无法加入**的真实 bug：
 *   `fromBase64Url` 先把 `-_` 换成 `+/`，却仍用 URL-safe 字母表 indexOf，
 *   再加上第三字节掩码写成 `& 0x0f` 而非 `& 0x03` —— 双重错误叠加成乱码，
 *   `JSON.parse` 必然失败。
 *   为什么第一版没发现：当时只测了 encode（对照标准 base64 一致），
 *   **decode 从未被独立测过**，而"encode 正确"并不能推出"decode 正确"。
 * ==================================================================== */
describe('base64url 编解码（配对码的成败取决于此）', () => {
  it('★ 往返一致：ASCII 载荷', () => {
    const json = JSON.stringify({ v: 1, keyId: 'key-1', secret: 's'.repeat(40) })
    const code = toBase64Url(new TextEncoder().encode(json))
    expect(new TextDecoder().decode(fromBase64Url(code))).toBe(json)
  })

  it('encode 结果与标准 base64url 一致（无 padding）', () => {
    // 对照真值用**平台标准** `btoa()`（Web 标准 API，DOM lib 里有声明）。
    // ⚠️ 刻意不用 Node 的 `Buffer`：本项目是浏览器目标（lib = ES2022 + DOM），
    //    而 `@types/node` **不在** package-lock 里 —— CI 的 `npm ci` 不会装它，
    //    于是 `Buffer` 在那边是未定义的名字，构建直接 TS2580 失败。
    //    （本地若曾残留 node_modules/@types/node 会误判为通过，务必用 npm ci 验证。）
    const bytes = new TextEncoder().encode('hello world!')
    const expected = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(toBase64Url(bytes)).toBe(expected)
  })

  it('★ 逐长度 0..64 往返（含 1/2 字节边界）', () => {
    for (let n = 0; n <= 64; n += 1) {
      const bytes = new Uint8Array(n)
      for (let i = 0; i < n; i += 1) bytes[i] = (i * 31 + n * 7) % 256
      const back = fromBase64Url(toBase64Url(bytes))
      expect(Array.from(back), `长度 ${n} 往返不一致`).toEqual(Array.from(bytes))
    }
  })

  it('URL-safe 字符集：只含 A-Za-z0-9_-，无 + / =', () => {
    const code = toBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, keyId: 'k', secret: 'x'.repeat(32) })))
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('能正确解出含 + / 的标准 base64（URL-safe 变体）', () => {
    // 选一些会产生 +/ 的字节
    const bytes = new Uint8Array([0xfb, 0xff, 0xbe, 0x00, 0x3e, 0x3f])
    const code = toBase64Url(bytes)
    expect(Array.from(fromBase64Url(code))).toEqual(Array.from(bytes))
  })

  it('非法字符安全停止，不抛异常', () => {
    expect(() => fromBase64Url('!!!!')).not.toThrow()
    expect(fromBase64Url('!!!!').length).toBe(0)
  })

  it('空串往返', () => {
    expect(toBase64Url(new Uint8Array([]))).toBe('')
    expect(fromBase64Url('').length).toBe(0)
  })
})
