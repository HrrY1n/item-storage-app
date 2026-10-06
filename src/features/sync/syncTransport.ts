import { classifyStatus, type SyncErrorKind } from './syncPolicy'
import { SYNC_PULL_PAGE_SIZE, SYNC_PUSH_BATCH_SIZE } from './syncLimits'
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

/** 服务端要求客户端把重复 tag 合并到既有 id 的指令 */
export interface TagDedupDirectiveWire {
  kind: 'merge-tag-into'
  duplicateId: string
  canonicalId: string
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
  /**
   * 服务端**实际接受**的实体 id 列表。
   *
   * ⚠️ 不能用"本批全部"来近似：服务端会忽略 tombstone 与非法实体。
   *   客户端必须只删除真正被接受的 outbox 条目，其余保留重试。
   */
  acceptedQueueIds: string[]
  /** tag 跨设备去重指令：客户端要把 duplicateId 合并到 canonicalId */
  dedupDirectives: TagDedupDirectiveWire[]
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
  /**
   * 带**取消信号**的 fetch。
   *
   * ⚠️ `signal` 必须出现在 init 里才算真的超时（Phase 3B 复审第 7 条）：
   *   此前 transport 内部创建了 AbortController 并调用 abort()，
   *   但 signal 没有传给 host.fetch —— 真实的 fetch 收不到任何取消信号，
   *   15 秒超时形同虚设（网络挂起时会一直等下去）。
   */
  fetch(
    url: string,
    init: {
      method: string
      headers: Record<string, string>
      body?: string
      signal?: AbortSignal
    },
  ): Promise<{
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
  /** 单请求超时（毫秒）。public 便于测试缩短它。 */
  readonly timeoutMs: number

  constructor(host: TransportHost, config: TransportConfig, timeoutMs = 15_000) {
    this.host = host
    this.config = config
    this.timeoutMs = timeoutMs
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
        // ★ 真正把取消信号交给底层 fetch —— 超时才生效
        signal: controller.signal,
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
   * 连通性 + **凭据校验**。
   *
   * ⚠️ 复审第 3 条后语义已变：/status 现在是**已认证**端点
   * （Worker 侧 handleStatus 会 authenticate）。
   * 客户端此前还发 `auth: false`，两边不一致 → B 设备配对必然失败。
   * B 设备正是靠它来判断"配对码里的 secret 是否有效"：
   *200 = 有效，401 = 无效。
   */
  async status(): Promise<{ ok: true; recordCount: number; currentRevision: number } | { ok: false; kind: SyncErrorKind }> {
    const res = await this.call('/api/sync/status', { method: 'GET', auth: true })
    if (res.status === 0) return { ok: false, kind: 'offline' }
    if (res.status !== 200) return { ok: false, kind: classifyStatus(res.status) }
    return {
      ok: true,
      recordCount: Number(res.data?.recordCount ?? 0),
      currentRevision: Number(res.data?.currentRevision ?? 0),
    }
  }

  /**
   * 创建同步空间（**只有 A 设备会调**）。
   *
   * 刻意不要求认证 —— 它是"尚未存在 secret"时的入口。
   * 空间已存在时 Worker 返回 409，因此 B 设备误调也不会造成破坏。
   */
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
    // queueEntryId 只是回执用的关联 id，服务端原样回传，
    // 让客户端能精确知道哪些 outbox 条目可以出队。
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
      acceptedQueueIds: Array.isArray(res.data?.acceptedIds)
        ? (res.data!.acceptedIds as string[])
        : [],
      ignored: Array.isArray(res.data?.ignored) ? (res.data!.ignored as PushResult['ignored']) : [],
      dedupDirectives: Array.isArray(res.data?.dedupDirectives)
        ? (res.data!.dedupDirectives as TagDedupDirectiveWire[])
        : [],
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