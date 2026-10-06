/**
 * Cloudflare Worker —— 跨设备同步 API（Phase 3B）。
 *
 * ## 第一版的信任模型（刻意简化）
 *
 * **单用户 · 单同步空间 · 一个共享随机 secret · 两台设备。**
 *
 * 因此：
 * - `/api/sync/bootstrap` **只有 sync_auth 为空时才能成功**（防止后来者覆盖既有空间）
 * - 新设备（B）**绝不调用 bootstrap**，只用 Bearer secret 调已认证的 `/status` 校验
 * - 两台设备共享同一个 secret → **不宣称"可以单独吊销某台设备"**
 *   （per-device token 留后续 Phase）
 *
 * ## 职责边界
 *
 * - 本文件只做 IO 装配（读 D1、验签、写库、回 JSON）
 * - 所有判定逻辑都在 ./syncLogic.ts（纯函数，有测试）
 *
 * ## D1 平台限制（官方文档，2026-10-06 核对）
 *
 * - bound parameters per query : **100**
 * - queries per invocation (Free) : **50**
 * - `UPDATE ... RETURNING` 可用，但**必须用 `.run()`**；`.first()` 对写语句返回空
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
import { allocateRevisions, hasAnyAuth } from './syncSql'
import { collectTagKeys, resolveTagDedup, type TagDedupDirective } from '../src/features/sync/tagDedup'

interface Env {
  /** D1 绑定名（与 wrangler.jsonc 的 d1_databases[].binding 一致） */
  SYNC_DB: D1Database
}

// 限制数值集中在 ./limitsContract —— 那里有完整推导，
// 且被 src/features/sync/syncLimits.test.ts 交叉断言，避免两边各写一份。
import { MAX_PULL, MAX_PUSH, PRELOAD_CHUNK } from './limitsContract'
export { MAX_PULL, MAX_PUSH, PRELOAD_CHUNK }

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

/**
 * 防在线爆破：连续失败计数。
 *
 * 用 isolate 内存即可 —— 攻击者换 isolate 就能重置，这是**尽力而为**的
 * 缓解措施，不是严格的限流。真正的防护是 secret 本身 256-bit 随机。
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
 * - 第一版只有一个认证记录（schema 用 `id INTEGER PRIMARY KEY CHECK(id=1)` 表达）
 * - 只存 SHA-256 哈希，D1 被完整泄漏也无法直接登录
 * - 用**常数时间**比较（Workers 没有 timingSafeEqual，见 syncLogic 的说明）
 * - 失败文案统一，不区分「不存在」与「错误」—— 避免探测
 */
async function authenticate(request: Request, env: Env): Promise<Response | null> {
  const token = parseBearer(request.headers.get('Authorization'))
  if (token === null) return fail(401, 'unauthorized')

  const row = await env.SYNC_DB.prepare(
    'SELECT key_id, secret_hash FROM sync_auth WHERE id = 1',
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

/**
 * 创建同步空间（A 设备，**仅当空间不存在时**）。
 *
 * 单用户第一版：整个数据库只有一个同步空间，由 `sync_auth` 的
 * `id INTEGER PRIMARY KEY CHECK(id = 1)` 在**schema 层**表达这个不变量 ——
 * 不是靠代码约定。第二次调用必然撞 CHECK 约束 → 409。
 *
 * B 设备**绝不该调用这里**，它只用已认证的 /status 校验 secret。
 */
async function handleBootstrap(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { secret?: unknown; keyId?: unknown }
  const secret = body.secret
  if (typeof secret !== 'string' || secret.length < 32) {
    return fail(400, 'weak-secret')
  }

  // 先查是否已有空间。这是**提示性**检查；真正的保证是 INSERT 的 CHECK 约束。
  if (await hasAnyAuth(env.SYNC_DB)) {
    return fail(409, 'sync-space-already-exists')
  }

  const keyId = typeof body.keyId === 'string' && body.keyId !== '' ? body.keyId : crypto.randomUUID()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  const hash = bytesToHex(digest)
  const now = new Date().toISOString()

  try {
    // id 固定为 1：第二次插入会撞 CHECK(id=1) 而失败 —— schema 层的单空间保证
    await env.SYNC_DB.prepare(
      'INSERT INTO sync_auth (id, key_id, secret_hash, created_at) VALUES (1, ?1, ?2, ?3)',
    )
      .bind(keyId, hash, now)
      .run()
  } catch {
    // 并发下两个设备同时创建：一个成功、一个撞约束失败
    return fail(409, 'sync-space-already-exists')
  }

  // ⚠️ secret 明文到此为止不再出现：库里只有哈希，响应里也不回显
  return json({ ok: true, keyId })
}

/**
 * 连通性 + 凭据校验。**已认证**。
 *
 * 用途：B 设备用它验证自己拿到的配对码里的 secret 是否有效
 * （200 = 有效，401 = 无效）。A 设备也用它确认服务可达。
 */
async function handleStatus(request: Request, env: Env): Promise<Response> {
  const authErr = await authenticate(request, env)
  if (authErr !== null) return authErr

  const [revision, count] = await Promise.all([
    currentRevision(env),
    env.SYNC_DB.prepare('SELECT COUNT(*) AS n FROM sync_records').first<{ n: number }>(),
  ])
  return json({ currentRevision: revision, recordCount: count?.n ?? 0 })
}

async function handlePush(request: Request, env: Env): Promise<Response> {
  const authErr = await authenticate(request, env)
  if (authErr !== null) return authErr

  const body = (await request.json()) as { deviceId?: unknown; changes?: unknown }
  const deviceId = typeof body.deviceId === 'string' && body.deviceId !== '' ? body.deviceId : 'unknown'
  const changes = Array.isArray(body.changes) ? (body.changes as PushChange[]) : []
  if (changes.length > MAX_PUSH) return fail(413, 'too-many-changes')

  // 预加载本批涉及的现有记录。
  // ⚠️ 必须按 id 分片：单条 IN 查询的绑定参数上限是 100，超了 D1 会在运行时拒绝。
  const { records: existingMap, tagKeys } = await preloadExisting(env, changes)

  // 先做一遍判定（只判不写），确定本批真正需要预留多少 revision。
  // 这样 revision 区间不会因为被忽略的条目而浪费。
  const decisions = changes.map((change) => {
    const existing = existingMap.get(`${change.entity}:${change.entityId}`) ?? null
    // revisionFrom 此刻还是占位值：判定不依赖具体值，只看existing 与 baseRevision
    return { change, existing, decision: decidePush({ change, existing, revisionFrom: 1 }) }
  })
  const writable = decisions.filter(
    ({ decision }) => decision.kind !== 'ignore-tombstone' && decision.kind !== 'ignore-invalid',
  )

  // ⭐ 原子分配 revision：UPDATE ... RETURNING，单条语句完成自增 + 取回。
  //   旧实现是 UPDATE 之后再 SELECT，两步之间可能被另一个并发 push 插入，
  //   导致两个请求拿到重叠的 revision。
  const revisionFrom = await allocateRevisions(env.SYNC_DB, writable.length)

  const ignored: Array<{ entity: string; entityId: string; reason: string }> = []
  /** 服务端真正接受的实体 id —— 客户端据此精确出队 */
  const acceptedIds: string[] = []
  const conflicts: Array<Record<string, unknown>> = []
  const statements: D1PreparedStatement[] = []
  let offset = 0

  /** tag 跨设备去重指令（复审第 9 条：文档承诺了，代码必须真实现） */
  const dedupDirectives: TagDedupDirective[] = []

  for (const { change, existing, decision } of decisions) {
    if (decision.kind === 'ignore-tombstone' || decision.kind === 'ignore-invalid') {
      ignored.push({
        entity: String(change.entity),
        entityId: String(change.entityId),
        reason: decision.ignoreReason ?? 'ignored',
      })
      continue
    }

    // tag 同名归一：云端已有同名 tag 时不写入重复记录，
    // 而是让客户端把自己的那份合并到既有 id 上。
    const dedup = change.entity === 'tag' ? resolveTagDedup(change, tagKeys) : null
    if (dedup !== null) {
      dedupDirectives.push(dedup)
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

    acceptedIds.push(change.entityId)

    if (decision.recordConflict && existing !== null) {
      // 回报冲突供客户端「事后可查」。刻意只给摘要，不给全量 payload。
      //
      // ⚠️ 字段方向：本请求的设备是**胜方**（覆盖方），existing 是**败方**（被覆盖方）。
      conflicts.push({
        entity: change.entity,
        entityId: change.entityId,
        // 败方是谁：服务端原有的那条记录
        loserUpdatedAt: existing.clientUpdatedAt,
        loserDeviceId: existing.deviceId,
        // 胜方是谁：**当前请求的设备**（不是 existing.deviceId）
        winnerUpdatedAt: change.clientUpdatedAt,
        winnerDeviceId: deviceId,
        loserSummary: summarize(existing.payload),
        winnerSummary: summarize(change.payload),
        detectedAt: new Date().toISOString(),
      })
    }
    offset += 1
  }

  // ⚠️ 批处理：所有 upsert 一次提交。D1 免费版单次调用仅 50 条查询，
  //    MAX_PUSH=32 加上预加载与 revision 分配仍远低于上限。
  if (statements.length > 0) {
    await env.SYNC_DB.batch(statements)
  }

  return json({
    accepted: offset,
    acceptedIds,
    ignored,
    dedupDirectives,
    conflicts,
    currentRevision: revisionFrom + Math.max(0, offset - 1),
  })
}

/**
 * 预加载现有记录，**按 id 分片**以避开绑定参数上限。
 *
 * 单条查询的参数数 ≈ 实体种类数(≤3) + 本片 id 数，必须 ≤ 100。
 */
async function preloadExisting(
  env: Env,
  changes: PushChange[],
): Promise<{ records: Map<string, ExistingRecord>; tagKeys: Map<string, { entityId: string }> }> {
  const tagKeys = await preloadTagKeys(env, changes)
  const out = new Map<string, ExistingRecord>()
  const ids = [...new Set(changes.map((c) => c.entityId))]
  const entities = [...new Set(changes.map((c) => c.entity))]

  for (let i = 0; i < ids.length; i += PRELOAD_CHUNK) {
    const idSlice = ids.slice(i, i + PRELOAD_CHUNK)
    // 参数数 = entity种类 + id个数 ≤ 3 + 90 = 93 < 100 ✅
    const rows = await env.SYNC_DB.prepare(
      `SELECT entity, entity_id, revision, deleted_at, client_updated_at, device_id, payload
       FROM sync_records
       WHERE entity IN (${entities.map(() => '?').join(',')})
         AND entity_id IN (${idSlice.map(() => '?').join(',')})`,
    )
      .bind(...entities, ...idSlice)
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
      out.set(`${r.entity}:${r.entity_id}`, {
        revision: r.revision,
        deletedAt: r.deleted_at,
        clientUpdatedAt: r.client_updated_at,
        deviceId: r.device_id,
        payload: r.payload,
      })
    }
  }
  return { records: out, tagKeys }
}

/**
 * 预加载本批 tag 的 nameNormalized → entityId 映射，用于跨设备去重。
 *
 * ⚠️ nameNormalized 存放在 JSON payload 里，SQLite 无法直接用索引查找，
 *    因此这里把本批涉及的 nameNormalized 全量取回后在内存里比对。
 *    代价是扫描 `entity='tag'` 全表 —— tags 的规模远小于 items（个人使用下
 *    通常几十条），这点扫描可以接受；给 json_extract 加索引并不划算。
 */
async function preloadTagKeys(
  env: Env,
  changes: PushChange[],
): Promise<Map<string, { entityId: string }>> {
  const wanted = collectTagKeys(changes)
  const out = new Map<string, { entityId: string }>()
  if (wanted.size === 0) return out

  const rows = await env.SYNC_DB.prepare(
    `SELECT entity_id, payload FROM sync_records WHERE entity = 'tag' AND deleted_at IS NULL`,
  )
    .bind()
    .all<{ entity_id: string; payload: string }>()

  for (const r of rows.results ?? []) {
    let parsed: unknown
    try {
      parsed = JSON.parse(r.payload) as unknown
    } catch {
      continue
    }
    const key = readKeyOf(parsed)
    if (key !== null && wanted.has(key)) {
      // 同一nameNormalized 若云端已有多条，保留先出现的那条为胜出者
      if (!out.has(key)) out.set(key, { entityId: r.entity_id })
    }
  }
  return out
}

function readKeyOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const v = (payload as Record<string, unknown>).nameNormalized
  return typeof v === 'string' && v !== '' ? v : null
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

/* ---------------------------------------------------------------------- */
/* 入口                */
/* ---------------------------------------------------------------------- */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // 非 /api/* 一律 404 —— 静态资源由 assets 路由处理，不会到这里
    if (!path.startsWith('/api/')) return new Response('Not Found', { status: 404 })

    try {
      if (path === '/api/sync/status' && request.method === 'GET') {
        return await handleStatus(request, env)
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