/**
 * Cloudflare Worker —— 跨设备同步 API（Phase 3B）。
 *
 * ## 第一版的信任模型（刻意简化）
 *
 * **单用户 · 单同步空间 · 一个共享随机 secret · 两台设备。**
 *
 * - `/api/sync/bootstrap` **只有 sync_auth 为空时才能成功**（防止后来者覆盖既有空间）
 * - 新设备（B）**绝不调用 bootstrap**，只用 Bearer secret 调已认证的 `/status` 校验
 * - 两台设备共享同一个 secret → **不宣称"可以单独吊销某台设备"**
 *
 * ## 两条写入级不变量（都由最终 SQL 保证，不依赖应用层判断）
 *
 * 1. **revision 分配与记录写入同事务** —— 全部 upsert 与计数器推进放进**同一个**
 *    `db.batch([...upserts, bump])`，提交顺序与 revision 可见顺序必然一致，
 *    不会出现"预留了 revision 却没写进去"的悬空区间。
 * 2. **tombstone 不可复活** —— upsert 的 `ON CONFLICT ... DO UPDATE ... WHERE`
 *    在数据库层挡住 stale 写入，不依赖 preload 是否及时。
 *
 * 详见 ./syncSql.ts 顶部的完整推导。
 * push 的编排（preload / 判定 / 重试）在 ./pushPipeline.ts，并由真实 SQLite 测试覆盖。
 *
 * ## D1 平台限制（官方文档，2026-10-06 核对）
 *
 * - bound parameters per query : **100**
 * - queries per invocation (Free) : **50**
 */

import {
  buildPullPage,
  bytesToHex,
  parseBearer,
  timingSafeEqualHex,
  type PushChange,
} from './syncLogic'
import {
  COUNT_RECORDS_SQL,
  CURRENT_REVISION_SQL,
  HAS_ANY_AUTH_SQL,
  INSERT_AUTH_SQL,
  MAX_PULL,
  MAX_PUSH,
  PULL_SQL,
  SELECT_AUTH_SQL,
} from './syncSql'
import { executePush } from './pushPipeline'

interface Env {
  /** D1 绑定名（与 wrangler.jsonc 的 d1_databases[].binding 一致） */
  SYNC_DB: D1Database
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })

const fail = (status: number, error: string): Response => json({ error }, status)

/* ---------------------------------------------------------------------- */
/* 认证                                                                    */
/* ---------------------------------------------------------------------- */

/**
 * 防在线爆破：连续失败计数（isolate 内存，尽力而为）。
 * 真正的防护是 secret 本身 256-bit 随机。
 */
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
 * - 第一版只有一个认证记录（schema 用 `CHECK(id=1)` 表达）
 * - 只存 SHA-256 哈希，D1 被完整泄漏也无法直接登录
 * - **常数时间**比较（Workers 没有 timingSafeEqual）
 */
async function authenticate(request: Request, env: Env): Promise<Response | null> {
  const token = parseBearer(request.headers.get('Authorization'))
  if (token === null) return fail(401, 'unauthorized')

  const row = await env.SYNC_DB.prepare(SELECT_AUTH_SQL)
    .bind()
    .first<{ key_id: string; secret_hash: string }>()
  if (row === null) return fail(401, 'unauthorized')

  const now = Date.now()
  if (tooManyFailures(row.key_id, now)) return fail(429, 'too-many-attempts')

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  if (!timingSafeEqualHex(bytesToHex(digest), row.secret_hash)) {
    noteFailure(row.key_id, now)
    return fail(401, 'unauthorized')
  }
  return null
}

/* ---------------------------------------------------------------------- */
/* 端点                                                                    */
/* ---------------------------------------------------------------------- */

/**
 * 创建同步空间（**仅当空间不存在时**）。只有 A 设备会调。
 *
 * 单空间不变量由 schema 的 `id INTEGER PRIMARY KEY CHECK (id = 1)` 表达，
 * 第二次 INSERT 必然违反 CHECK → 这里统一转成 409。
 */
async function handleBootstrap(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { secret?: unknown; keyId?: unknown }
  const secret = body.secret
  if (typeof secret !== 'string' || secret.length < 32) {
    return fail(400, 'weak-secret')
  }

  // 提示性检查；真正的保证是 INSERT 的 CHECK 约束
  const existing = await env.SYNC_DB.prepare(HAS_ANY_AUTH_SQL).bind().first<{ id: number }>()
  if (existing !== null) return fail(409, 'sync-space-already-exists')

  const keyId = typeof body.keyId === 'string' && body.keyId !== '' ? body.keyId : crypto.randomUUID()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))

  try {
    await env.SYNC_DB.prepare(INSERT_AUTH_SQL)
      .bind(keyId, bytesToHex(digest), new Date().toISOString())
      .run()
  } catch {
    // 并发下两个设备同时创建：一个成功、一个撞 CHECK
    return fail(409, 'sync-space-already-exists')
  }

  // ⚠️ secret 明文到此为止不再出现：库里只有哈希，响应里也不回显
  return json({ ok: true, keyId })
}

/** 连通性 + 凭据校验（**已认证**）。B 设备用它校验配对码里的 secret。 */
async function handleStatus(request: Request, env: Env): Promise<Response> {
  const authErr = await authenticate(request, env)
  if (authErr !== null) return authErr

  const [revision, count] = await Promise.all([
    env.SYNC_DB.prepare(CURRENT_REVISION_SQL).bind().first<{ revision: number }>(),
    env.SYNC_DB.prepare(COUNT_RECORDS_SQL).bind().first<{ n: number }>(),
  ])
  return json({ currentRevision: revision?.revision ?? 0, recordCount: count?.n ?? 0 })
}

async function handlePush(request: Request, env: Env): Promise<Response> {
  const authErr = await authenticate(request, env)
  if (authErr !== null) return authErr

  const body = (await request.json()) as { deviceId?: unknown; changes?: unknown }
  const deviceId = typeof body.deviceId === 'string' && body.deviceId !== '' ? body.deviceId : 'unknown'
  const changes = Array.isArray(body.changes) ? (body.changes as PushChange[]) : []
  if (changes.length > MAX_PUSH) return fail(413, 'too-many-changes')

  // 编排（preload / 判定 / 整批 + 最多一次完整重试）都在 pushPipeline，
  // 那里用真实 SQLite 做过回归测试；本文件只做 HTTP 装配。
  const outcome = await executePush(env.SYNC_DB, changes, deviceId)
  if (!outcome.ok) return fail(500, outcome.error)

  return json(outcome.result)
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

  const rows = await env.SYNC_DB.prepare(PULL_SQL)
    .bind(after, limit + 1) // 多取一条判断 hasMore
    .all<{
      revision: number
      entity: string
      entity_id: string
      payload: string
      deleted_at: string | null
      client_updated_at: string
      device_id: string
    }>()

  return json(buildPullPage(rows.results ?? [], after, limit))
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
      if (path === '/api/sync/status' && request.method === 'GET') return await handleStatus(request, env)
      if (path === '/api/sync/bootstrap' && request.method === 'POST') return await handleBootstrap(request, env)
      if (path === '/api/sync/push' && request.method === 'POST') return await handlePush(request, env)
      if (path === '/api/sync/pull' && request.method === 'GET') return await handlePull(request, env, url)
      return fail(405, 'method-not-allowed')
    } catch (err) {
      // 不把内部错误细节透给客户端（可能泄露 schema 信息）
      console.error('sync api error:', err instanceof Error ? err.message : String(err))
      return fail(500, 'internal-error')
    }
  },
}