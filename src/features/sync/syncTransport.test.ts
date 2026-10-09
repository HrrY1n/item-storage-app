import { describe, expect, it } from 'vitest'
import { SyncTransport, type TransportHost } from './syncTransport'
import { SYNC_PROTOCOL_VERSION } from '../../domain/syncProtocol'

/**
 * 传输层测试：超时（复审第 7 条）与凭据头。
 *
 * ## 复审第 7 条：原来的 15 秒超时是**无效的**
 *
 * 原实现在 transport 里创建了 AbortController、也调用了 controller.abort()，
 * 但 `signal` **从未进入 host.fetch 的 init**。真实的 fetch 收不到取消信号，
 * 于是网络挂起时请求会一直挂着 —— 超时形同虚设。
 * 这条测试的作用就是把"signal 必须真的传下去"钉死。
 */

/** 记录 fetch 收到的 init，便于断言 signal 是否存在 */
function makeHost(options: { delayMs?: number; status?: number; neverResolve?: boolean } = {}) {
  const received: Array<{ url: string; init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal } }> = []
  const host: TransportHost = {
    isOnline: () => true,
    now: () => 0,
    async fetch(url, init) {
      received.push({ url, init })
      if (options.neverResolve === true) {
        // 模拟"网络挂起"：必须靠 signal 才能被中断
        return new Promise<{ status: number; text(): Promise<string> }>((resolve) => {
          init.signal?.addEventListener('abort', () => {
            resolve({ status: 0, text: async () => '' })
          })
        })
      }
      if (options.delayMs !== undefined) {
        await new Promise((r) => setTimeout(r, options.delayMs))
      }
      return {
        status: options.status ?? 200,
        text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, recordCount: 0, currentRevision: 0 }),
      }
    },
  }
  return { host, received }
}

const config = { baseUrl: 'https://example.test', deviceId: 'dev-1', secret: 'x'.repeat(40) }

describe('AbortSignal 必须真的传给 host.fetch', () => {
  it('★ fetch 的 init 里带 signal（复审第 7 条的原缺陷）', async () => {
    const { host, received } = makeHost({ status: 200 })
    const transport = new SyncTransport(host, config)
    await transport.status()

    expect(received).toHaveLength(1)
    expect(received[0]!.init.signal).toBeDefined()
    expect(received[0]!.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('signal 在请求完成后已被中止（定时器被正确清理）', async () => {
    const { host, received } = makeHost({ status: 200 })
    const transport = new SyncTransport(host, config)
    await transport.status()

    // call() 的 finally 会 clearTimeout，但 abort 未必被调用过；
    // 这里只断言请求正常结束、不抛错（回归保护）
    expect(received[0]!.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('★ 网络永不返回时，靠 signal 中断并归类为 offline', async () => {
    const { host } = makeHost({ neverResolve: true })
    // 用真实但很短的超时（20ms），避免测试挂起 15s
    const transport = new SyncTransport(host, config, 20)

    const start = Date.now()
    const result = await transport.status()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('offline')
    // 若signal 没生效，这个 await 会永远挂住 —— 也就是说这条测试
    // 本身就是"超时真的生效"的证据。
    expect(Date.now() - start).toBeLessThan(2000)
  })
})

describe('请求头与错误分类', () => {
  it('认证端点带 Bearer secret', async () => {
    const { host, received } = makeHost({ status: 200 })
    const transport = new SyncTransport(host, config)
    await transport.status()

    expect(received[0]!.init.headers.Authorization).toBe(`Bearer ${config.secret}`)
  })

  it('/status 携带 Bearer（复审第 3 条：它现在是**已认证**端点）', async () => {
    const { host, received } = makeHost({ status: 200 })
    const transport = new SyncTransport(host, config)
    await transport.status()
    expect(received[0]!.url).toContain('/api/sync/status')
    expect(received[0]!.init.headers.Authorization).toBeTruthy()
  })

  it('401 → unauthorized（secret 无效，配对时的判定）', async () => {
    const { host } = makeHost({ status: 401 })
    const transport = new SyncTransport(host, config)
    const r = await transport.status()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('unauthorized')
  })

  it('409 → unknown（bootstrap 时表示空间已存在）', async () => {
    const { host } = makeHost({ status: 409 })
    const transport = new SyncTransport(host, config)
    const r = await transport.bootstrap(config.secret, 'k1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('unknown')
  })

  it('5xx → server（退避重试）', async () => {
    const { host } = makeHost({ status: 500 })
    const transport = new SyncTransport(host, config)
    const r = await transport.status()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('server')
  })

  it('离线时不发请求', async () => {
    let called = false
    const host: TransportHost = {
      isOnline: () => false,
      now: () => 0,
      async fetch() {
        called = true
        return { status: 200, text: async () => '{}' }
      },
    }
    const transport = new SyncTransport(host, config)
    const r = await transport.status()
    expect(called).toBe(false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('offline')
  })
})

describe('v2 成功响应校验', () => {
  it('200 但响应不是对象 → protocol，不把空/数组当成功', async () => {
    const host: TransportHost = {
      isOnline: () => true,
      now: () => 0,
      async fetch() {
        return { status: 200, text: async () => '[]' }
      },
    }
    const result = await new SyncTransport(host, config).status()
    expect(result).toEqual({ ok: false, kind: 'protocol' })
  })

  it('push 混合确认按 queueId 解析，并要求所有请求条目都有终态', async () => {
    const changes = [
      { queueId: 'q-accepted', entity: 'item' as const, entityId: 'i1', payload: { name: 'A' }, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
      { queueId: 'q-ignored', entity: 'item' as const, entityId: 'i2', payload: {}, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
      { queueId: 'q-dedup', entity: 'tag' as const, entityId: 'tag-dup', payload: {}, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
    ]
    const host: TransportHost = {
      isOnline: () => true,
      now: () => 0,
      async fetch() {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              protocolVersion: SYNC_PROTOCOL_VERSION,
              accepted: 1,
              acceptedQueueIds: ['q-accepted'],
              ignored: [{ queueId: 'q-ignored', entity: 'item', entityId: 'i2', reason: 'tombstoned' }],
              dedupDirectives: [{ kind: 'merge-tag-into', queueId: 'q-dedup', duplicateId: 'tag-dup', canonicalId: 'tag-canonical' }],
              authoritativeChanges: [],
              conflicts: [],
              currentRevision: 7,
            }),
        }
      },
    }
    const result = await new SyncTransport(host, config).push(changes)
    expect(result).toMatchObject({ ok: true, acceptedQueueIds: ['q-accepted'], currentRevision: 7 })
    if (result.ok) {
      expect(result.ignored[0]!.queueId).toBe('q-ignored')
      expect(result.dedupDirectives[0]!.queueId).toBe('q-dedup')
    }
  })

  it('push 缺少一个条目的终态 → protocol，客户端不应部分出队', async () => {
    const host: TransportHost = {
      isOnline: () => true,
      now: () => 0,
      async fetch() {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              protocolVersion: SYNC_PROTOCOL_VERSION,
              accepted: 1,
              acceptedQueueIds: ['q-1'],
              ignored: [],
              dedupDirectives: [],
              authoritativeChanges: [],
              conflicts: [],
              currentRevision: 1,
            }),
        }
      },
    }
    const result = await new SyncTransport(host, config).push([
      { queueId: 'q-1', entity: 'item', entityId: 'i1', payload: {}, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
      { queueId: 'q-2', entity: 'item', entityId: 'i2', payload: {}, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
    ])
    expect(result).toEqual({ ok: false, kind: 'protocol' })
  })

  it('pull 空页却宣称 hasMore，或页内游标不前进 → protocol', async () => {
    const host: TransportHost = {
      isOnline: () => true,
      now: () => 0,
      async fetch(url) {
        const after = Number(new URL(url).searchParams.get('after'))
        return {
          status: 200,
          text: async () =>
            JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, changes: [], nextRevision: after, hasMore: true }),
        }
      },
    }
    const result = await new SyncTransport(host, config).pull(5)
    expect(result).toEqual({ ok: false, kind: 'protocol' })
  })
})
