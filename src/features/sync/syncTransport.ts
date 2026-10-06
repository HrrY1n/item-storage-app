import {
  classifyStatus,
  type SyncErrorKind,
  SYNC_PULL_PAGE_SIZE,
  SYNC_PUSH_BATCH_SIZE,
} from './syncPolicy'
import type { SyncEntity } from '../../domain/syncPayload'

/**
 * 与 Worker 通信的**薄传输层**。
 *
 * 刻意做成"平台访问全部走host"（与 Phase 2H.1 的 updateManager 同一模式），
 * 这样同步循环的编排逻辑可以在 node 环境里测，不必为此引入 DOM 环境。
 *
 * 失败一律**分类**后返回，不抛异常 —— 同步失败绝不能打断用户的本地操作。
 */

/** 服务端会返回的形态（这里只声明用到的字段） */
export interface RemoteChange {
  revision: number
  entity: string
  entityId: string
  payload: unknown
  deletedAt: string | null
  clientUpdatedAt: string
  deviceId: string
}

export interface PushConflict {
  entity: string
  entityId: string
  loserUpdatedAt: string | null
  winnerDeviceId: string | null
  winnerUpdatedAt: string | null
  loserSummary: string | null
  winnerSummary: string | null
  detectedAt: string
}

export interface PushResult {
  ok: true
  accepted: number
  ignored: Array<{ entity: string; entityId: string; reason: string }>
  conflicts: PushConflict[]
  currentRevision: number
}

export interface PullResult {
  ok: true
  changes: RemoteChange[]
  nextRevision: number
  hasMore: boolean
}

export type SyncFailure = { ok: false; kind: SyncErrorKind; status?: number }
export type PushOutcome = PushResult | SyncFailure
export type PullOutcome = PullResult | SyncFailure

export interface TransportHost {
  isOnline(): boolean
  /** 带超时的 fetch */
  fetch(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number
    text(): Promise<string>
  }>
  now(): number
}

export interface TransportConfig {
  baseUrl: string
  deviceId: string
  secret: string
}

export class SyncTransport {
  private readonly host: TransportHost
  private readonly config: TransportConfig
  /** 单请求超时（毫秒） */
  private readonly timeoutMs = 15_000

  constructor(host: TransportHost, config: TransportConfig) {
    this.host = host
    this.config = config
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.secret}`,
      'Content-Type': 'application/json',
    }
  }

  /** 把一次 HTTP 调用包成"永不抛异常"的结果 */
  private async call(
    path: string,
    init: { method: string; body?: unknown; auth: boolean },
  ): Promise<{ status: number; data: Record<string, unknown> | null }> {
    if (!this.host.isOnline()) return { status: 0, data: null }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.host.fetch(`${this.config.baseUrl}${path}`, {
        method: init.method,
        headers: init.auth ? this.headers() : {},
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      })
      const text = await res.text()
      let data: Record<string, unknown> | null = null
      try {
        data = text === '' ? null : (JSON.parse(text) as Record<string, unknown>)
      } catch {
        data = null
      }
      return { status: res.status, data }
    } catch {
      // 超时 / 网络不可达 / 被中断 —— 一律归为 offline，静默处理
      return { status: 0, data: null }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 连通性 + 凭据校验（也是配对流程的第一步）。
   * 刻意**不要求认证** —— 配对时就是要用它验证 secret 是否有效。
   */
  async status(): Promise<{ ok: true; recordCount: number; currentRevision: number } | { ok: false; kind: SyncErrorKind }> {
    const res = await this.call('/api/sync/status', { method: 'GET', auth: false })
    if (res.status === 0) return { ok: false, kind: 'offline' }
    if (res.status !== 200) return { ok: false, kind: classifyStatus(res.status) }
    return {
      ok: true,
      recordCount: Number(res.data?.recordCount ?? 0),
      currentRevision: Number(res.data?.currentRevision ?? 0),
    }
  }

  /** 登记 secret 的哈希（首次配对时由 A 设备调用） */
  async bootstrap(secret: string, keyId: string): Promise<{ ok: boolean; kind?: SyncErrorKind; keyId?: string }> {
    const res = await this.call('/api/sync/bootstrap', {
      method: 'POST',
      body: { secret, keyId },
      auth: false,
    })
    if (res.status === 0) return { ok: false, kind: 'offline' }
    if (res.status !== 200) return { ok: false, kind: classifyStatus(res.status) }
    return { ok: true, keyId: typeof res.data?.keyId === 'string' ? res.data.keyId : keyId }
  }

  /** 推送一批变更。调用方负责按 SYNC_PUSH_BATCH_SIZE 分批。 */
  async push(
    changes: Array<{
      entity: SyncEntity
      entityId: string
      payload: unknown
      deletedAt: string | null
      clientUpdatedAt: string
      baseRevision: number
    }>,
  ): Promise<PushOutcome> {
    const res = await this.call('/api/sync/push', {
      method: 'POST',
      body: { deviceId: this.config.deviceId, changes },
      auth: true,
    })
    if (res.status === 0) return { ok: false, kind: 'offline' }
    if (res.status !== 200) return { ok: false, kind: classifyStatus(res.status), status: res.status }

    return {
      ok: true,
      accepted: Number(res.data?.accepted ?? 0),
      ignored: Array.isArray(res.data?.ignored) ? (res.data!.ignored as PushResult['ignored']) : [],
      conflicts: Array.isArray(res.data?.conflicts) ? (res.data!.conflicts as PushConflict[]) : [],
      currentRevision: Number(res.data?.currentRevision ?? 0),
    }
  }

  /** 拉取 revision > after 的变更 */
  async pull(after: number): Promise<PullOutcome> {
    const res = await this.call(`/api/sync/pull?after=${after}&limit=${SYNC_PULL_PAGE_SIZE}`, {
      method: 'GET',
      auth: true,
    })
    if (res.status === 0) return { ok: false, kind: 'offline' }
    if (res.status !== 200) return { ok: false, kind: classifyStatus(res.status), status: res.status }

    const changes = Array.isArray(res.data?.changes) ? (res.data!.changes as RemoteChange[]) : []
    return {
      ok: true,
      changes,
      nextRevision: Number(res.data?.nextRevision ?? after),
      hasMore: res.data?.hasMore === true,
    }
  }
}

export { SYNC_PUSH_BATCH_SIZE, SYNC_PULL_PAGE_SIZE }