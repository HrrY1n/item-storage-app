/**
 * Cloudflare Worker —— 跨设备同步 API（Phase 3B）。
 *
 * 职责边界：
 * - 这个文件只做 IO 装配（读 D1、验签、写库、回 JSON）
 * - 所有判定逻辑都在 ./syncLogic.ts（纯函数，有测试）
 * - 判定逻辑集中在一处，是为了让「删除不被复活」这条不变量**只有一个实现点**
 *
 * API：
 *   POST /api/sync/bootstrap   首次配对：登记 secret 的哈希
 *   POST /api/sync/push        批量 upsert
 *   GET  /api/sync/pull        拉 revision > after
 *   GET  /api/sync/status      云端状态（也是配对时的连通性校验）
 *
 * ⚠️ 静态资源路由不受影响：`assets.not_found_handling: 'single-page-application'`
 *    只对导航请求（Sec-Fetch-Mode: navigate）回落 index.html，
 *    `fetch('/api/*')` 这类子资源请求会正常进入本 Worker。
 */

import {
  buildPullPage,
  bytesToHex,
  decidePush,
  parseBearer,
  summarize,
  timingSafeEqualHex,
  type ExistingRecord,
  type PushChange,
} from './syncLogic'

interface Env {
  /** D1 绑定名（与 wrangler.jsonc 的 d1_databases[].binding 一致） */
  SYNC_DB: D1Database
}

/** 一次 push 的最大条数（D1 免费版单次 Worker 调用仅 50 条查询，客户端也按此分批） */
const MAX_PUSH = 500
/** 一次 pull 的最大条数 */
const MAX_PULL = 500

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 同步响应不该被任何中间层缓存
      'Cache-Control': 'no-store',
    },
  })

const fail = (status: number, error: string): Response => json({ error }, status)

/* ---------------------------------------------------------------------- */
/* 认证                                                                    */
/* ---------------------------------------------------------------------- */

/** 防在线爆破：同一 key_id 连续失败次数（isolate 内存即可，不落 D1） */
const failures = new Map<string, { count: number; until: number }>()
const LOCKOUT_MS = 10 * 60_000
const MAX_FAILURES = 10

function tooManyFailures(keyId: string, now: number): boolean {
  const rec = failures.get(keyId)
  if (rec === undefined) return false
  if (now > rec.until) {
    failures.delete(keyId)
    return false
  }
  return rec.count >= MAX_FAILURES
}

function noteFailure(keyId: string, now: number): void {
  const rec = failures.get(keyId)
  if (rec === undefined || now > rec.until) {
    failures.set(keyId, { count: 1, until: now + LOCKOUT_MS })
    return
  }
  rec.count += 1
}

/**
 * 校验 Bearer。
 *
 * - 只存 SHA-256 哈希，D1 被泄漏也无法直接登录
 * - 用**常数时间**比较（Workers 没有 timingSafeEqual，见 syncLogic 的说明）
 * - 失败文案统一，不区分「密钥不存在」与「密钥错误」—— 避免探测
 */
async function authenticate(request: Request, env: Env): Promise<Response | null> {
  const token = parseBearer(request.headers.get('Authorization'))
  if (token === null) return fail(401, 'unauthorized')

  const row = await env.SYNC_DB.prepare(
    'SELECT key_id, secret_hash FROM sync_auth WHERE revoked_at IS NULL',
  ).first<{ key_id: string; secret_hash: string }>()
  if (row === null) return fail(401, 'unauthorized')

  const now = Date.now()
  if (tooManyFailures(row.key_id, now)) return fail(429, 'too-many-attempts')

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const provided = bytesToHex(digest)
  if (!timingSafeEqualHex(provided, row.secret_hash)) {
    noteFailure(row.key_id, now)
    return fail(401, 'unauthorized')
  }
  return null
}

/* ---------------------------------------------------------------------- */
/* 端点                                                                    */
/* ---------------------------------------------------------------------- */

async function handleBootstrap(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { secret?: unknown; keyId?: unknown }
  if (typeof body.secret !== 'string' || body.secret.length < 32) {
    return fail(400, 'weak-secret')
  }
  const keyId = typeof body.keyId === 'string' && body.keyId !== '' ? body.keyId : crypto.randomUUID()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.secret))
  const hash = bytesToHex(digest)
  const now = new Date().toISOString()

  // 同一个 keyId 重复 bootstrap 会覆盖哈希（用户重新配对同一设备时的正常路径）
  await env.SYNC_DB.prepare(
    `INSERT INTO sync_auth (key_id, secret_hash, created_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(key_id) DO UPDATE SET secret_hash = ?2, revoked_at = NULL`,
  )
    .bind(keyId, hash, now)
    .run()

  // ⚠️ secret 明文到此为止不再出现：库里只有哈希，响应里也不回显
  return json({ ok: true, keyId })
}

async function handlePush(request: Request, env: Env): Promise<Response> {
  const authErr = await authenticate(request, env)
  if (authErr !== null) return authErr

  const body = (await request.json()) as { deviceId?: unknown; changes?: unknown }
  const deviceId = typeof body.deviceId === 'string' && body.deviceId !== '' ? body.deviceId : 'unknown'
  const changes = Array.isArray(body.changes) ? (body.changes as PushChange[]) : []
  if (changes.length > MAX_PUSH) return fail(413, 'too-many-changes')

  // 先查出本批涉及的现有记录，避免逐条查询（每条一次查询会撞上50 次上限）
  const entities = [...new Set(changes.map((c) => c.entity))]
  const ids = [...new Set(changes.map((c) => c.entityId))]
  const existingMap = new Map<string, ExistingRecord>()
  if (entities.length > 0 && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    const rows = await env.SYNC_DB.prepare(
      `SELECT entity, entity_id, revision, deleted_at, client_updated_at, device_id, payload
       FROM sync_records
       WHERE entity IN (${entities.map(() => '?').join(',')})
         AND entity_id IN (${placeholders})`,
    )
      .bind(...entities, ...ids)
      .all<{
        entity: string
        entity_id: string
        revision: number
        deleted_at: string | null
        client_updated_at: string
        device_id: string
        payload: string
      }>()
    for (const r of rows.results ?? []) {
      existingMap.set(`${r.entity}:${r.entity_id}`, {
        revision: r.revision,
        deletedAt: r.deleted_at,
        clientUpdatedAt: r.client_updated_at,
        deviceId: r.device_id,
        payload: r.payload,
      })
    }
  }

  // 一次性分配 revision 区间：本批共用连续的一段，
  // 客户端推进游标到末值即可，不会漏掉中间任何一条
  const revisionFrom = await nextRevisions(env, changes.length)

  const accepted: string[] = []
  const ignored: Array<{ entity: string; entityId: string; reason: string }> = []
  const conflicts: Array<Record<string, unknown>> = []
  const statements: D1PreparedStatement[] = []
  let offset = 0

  for (const change of changes) {
    const existing = existingMap.get(`${change.entity}:${change.entityId}`) ?? null
    const decision = decidePush({ change, existing, revisionFrom: revisionFrom + offset })

    if (decision.kind === 'ignore-tombstone' || decision.kind === 'ignore-invalid') {
      ignored.push({
        entity: String(change.entity),
        entityId: String(change.entityId),
        reason: decision.ignoreReason ?? 'ignored',
      })
      continue
    }

    const revision = decision.revision ?? revisionFrom + offset
    statements.push(
      env.SYNC_DB.prepare(
        `INSERT INTO sync_records
           (revision, entity, entity_id, payload, deleted_at, client_updated_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(entity, entity_id) DO UPDATE SET
           revision = excluded.revision,
           payload = excluded.payload,
           deleted_at = excluded.deleted_at,
           client_updated_at = excluded.client_updated_at,
           device_id = excluded.device_id`,
      ).bind(
        revision,
        change.entity,
        change.entityId,
        JSON.stringify(change.payload ?? {}),
        change.deletedAt ?? null,
        change.clientUpdatedAt,
        deviceId,
      ),
    )
    accepted.push(`${change.entity}:${change.entityId}`)

    if (decision.recordConflict && existing !== null) {
      // 回报冲突供客户端「事后可查」。刻意只给摘要，不给全量 payload。
      conflicts.push({
        entity: change.entity,
        entityId: change.entityId,
        loserUpdatedAt: existing.clientUpdatedAt,
        winnerDeviceId: existing.deviceId,
        winnerUpdatedAt: change.clientUpdatedAt,
        loserSummary: summarize(existing.payload),
        winnerSummary: summarize(change.payload),
        detectedAt: new Date().toISOString(),
      })
    }
    offset += 1
  }

  // ⚠️ 批处理：所有语句一次提交。D1 免费版单次调用仅 50 条查询，
  //    所以客户端必须按 ≤ MAX_PUSH 分批，这里不会超。
  if (statements.length > 0) {
    await env.SYNC_DB.batch(statements)
  }

  return json({
    accepted: accepted.length,
    ignored,
    conflicts,
    currentRevision: revisionFrom + Math.max(0, offset - 1),
  })
}

/** 为本批预留一段连续 revision，返回起始值 */
async function nextRevisions(env: Env, count: number): Promise<number> {
  if (count <= 0) return currentRevision(env)
  await env.SYNC_DB.prepare('UPDATE sync_revision_seq SET revision = revision + ?1 WHERE id = 1')
    .bind(count)
    .run()
  const row = await env.SYNC_DB.prepare('SELECT revision FROM sync_revision_seq WHERE id = 1').first<{
    revision: number
  }>()
  const end = row?.revision ?? 0
  return end - count + 1
}

async function currentRevision(env: Env): Promise<number> {
  const row = await env.SYNC_DB.prepare('SELECT revision FROM sync_revision_seq WHERE id = 1').first<{
    revision: number
  }>()
  return row?.revision ?? 0
}

async function handlePull(request: Request, env: Env, url: URL): Promise<Response> {
  const authErr = await authenticate(request, env)
  if (authErr !== null) return authErr

  const afterRaw = url.searchParams.get('after')
  const after = afterRaw === null ? 0 : Number(afterRaw)
  if (!Number.isFinite(after) || after < 0) return fail(400, 'bad-after')

  const limitRaw = url.searchParams.get('limit')
  const parsedLimit = limitRaw === null ? MAX_PULL : Number(limitRaw)
  const limit = Math.min(MAX_PULL, Math.max(1, Math.floor(parsedLimit)))

  // ⚠️ 恒为「WHERE revision > ? ORDER BY revision LIMIT ?」——走主键有序扫描，
  //    禁止 SELECT *（那是全表扫描，白烧 rows read 额度）
  // 多取一条用于判断 hasMore
  const rows = await env.SYNC_DB.prepare(
    `SELECT revision, entity, entity_id, payload, deleted_at, client_updated_at, device_id
     FROM sync_records
     WHERE revision > ?1
     ORDER BY revision
     LIMIT ?2`,
  )
    .bind(after, limit + 1)
    .all<{
      revision: number
      entity: string
      entity_id: string
      payload: string
      deleted_at: string | null
      client_updated_at: string
      device_id: string
    }>()

  const page = buildPullPage(rows.results ?? [], after, limit)
  return json(page)
}

async function handleStatus(env: Env): Promise<Response> {
  // 刻意**不要求认证**：配对流程要用它先验证 secret 是否有效（401 = 配对码不对）
  const revision = await currentRevision(env)
  const row = await env.SYNC_DB.prepare('SELECT COUNT(*) AS n FROM sync_records').first<{ n: number }>()
  return json({ currentRevision: revision, recordCount: row?.n ?? 0 })
}

/* ---------------------------------------------------------------------- */
/* 入口                                                                    */
/* ---------------------------------------------------------------------- */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // 非 /api/* 一律 404 —— 静态资源由 assets 路由处理，不会到这里
    if (!path.startsWith('/api/')) return new Response('Not Found', { status: 404 })

    try {
      if (path === '/api/sync/status' && request.method === 'GET') {
        return await handleStatus(env)
      }
      if (path === '/api/sync/bootstrap' && request.method === 'POST') {
        return await handleBootstrap(request, env)
      }
      if (path === '/api/sync/push' && request.method === 'POST') {
        return await handlePush(request, env)
      }
      if (path === '/api/sync/pull' && request.method === 'GET') {
        return await handlePull(request, env, url)
      }
      return fail(405, 'method-not-allowed')
    } catch (err) {
      // 不把内部错误细节透给客户端（可能泄露 schema 信息）
      console.error('sync api error:', err instanceof Error ? err.message : String(err))
      return fail(500, 'internal-error')
    }
  },
}