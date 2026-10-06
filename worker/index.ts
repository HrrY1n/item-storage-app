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
 * 1. **revision 分配与记录写入同事务** —— 批内第一条 UPDATE 推进计数器，
 *    后续 upsert 在 SQL 内部读计数器取 revision。提交顺序与 revision 可见顺序
 *    必然一致，不会出现"预留了 revision 却没写进去"的悬空区间。
 * 2. **tombstone 不可复活** —— upsert 的 `ON CONFLICT ... DO UPDATE ... WHERE`
 *    在数据库层挡住 stale 写入，不依赖 preload 是否及时。
 *
 * 详见 ./syncSql.ts 顶部的完整推导。
 *
 * ## D1 平台限制（官方文档，2026-10-06 核对）
 *
 * - bound parameters per query : **100**
 * - queries per invocation (Free) : **50**
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
import {
  BUMP_REVISION_SQL,
  COUNT_RECORDS_SQL,
  CURRENT_REVISION_SQL,
  HAS_ANY_AUTH_SQL,
  INSERT_AUTH_SQL,
  MAX_PULL,
  MAX_PUSH,
  PRELOAD_CHUNK,
  PULL_SQL,
  PULL_TAG_KEYS_SQL,
  SELECT_AUTH_SQL,
  UPSERT_SQL,
  preloadSql,
  readNameNormalizedOf,
} from './syncSql'
import { collectTagKeys, resolveTagDedup, type TagDedupDirective } from '../src/features/sync/tagDedup'

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

  // 预加载只用于**生成冲突报告**（谁被覆盖了）与 tag 去重判断。
  // ⚠️ 它**不再承担** tombstone 保护职责 —— 那已下沉到 UPSERT_SQL 的 WHERE 子句，
  //    由真正执行写入的 SQL 原子保证。
  const { records: existingMap, tagKeys } = await preloadExisting(env, changes)

  const decisions = changes.map((change) => {
    const existing = existingMap.get(`${change.entity}:${change.entityId}`) ?? null
    return { change, existing, decision: decidePush({ change, existing, revisionFrom: 1 }) }
  })

  const ignored: Array<{ entity: string; entityId: string; reason: string }> = []
  const acceptedIds: string[] = []
  const conflicts: Array<Record<string, unknown>> = []
  const dedupDirectives: TagDedupDirective[] = []
  /** 本批要写库的 upsert（offset 即批内序号，revision 因此连续） */
  const upserts: D1PreparedStatement[] = []
  /**
   * 与 `upserts` **逐项对应**的元信息。
   * ⚠️ 不能用 `decisions[i]` 反查：被 ignore / 去重的条目不会产生 upsert，
   *   两个数组会错位，进而在逐条重试时把错误的实体当成冲突项。
   */
  const upsertMeta: Array<{
    entity: string
    entityId: string
    nameNormalized: string | null
  }> = []

  for (const { change, existing, decision } of decisions) {
    if (decision.kind === 'ignore-tombstone' || decision.kind === 'ignore-invalid') {
      ignored.push({
        entity: String(change.entity),
        entityId: String(change.entityId),
        reason: decision.ignoreReason ?? 'ignored',
      })
      continue
    }

    // tag 同名归一：云端已有同名 tag 时不写重复记录，改由客户端合并
    const dedup = change.entity === 'tag' ? resolveTagDedup(change, tagKeys) : null
    if (dedup !== null) {
      dedupDirectives.push(dedup)
      continue
    }

    // tombstone 二次判定：应用层给出准确的 ignored 回报；
    // 即便这里漏判，UPSERT_SQL 的 WHERE 也会在数据库层挡住。
    if (existing !== null && existing.deletedAt !== null && change.undeleteIntent !== true) {
      ignored.push({ entity: change.entity, entityId: change.entityId, reason: 'tombstoned' })
      continue
    }

    upsertMeta.push({
      entity: change.entity,
      entityId: change.entityId,
      nameNormalized: readNormalizedOf(change.payload),
    })
    upserts.push(
      env.SYNC_DB.prepare(UPSERT_SQL).bind(
        change.entity,
        change.entityId,
        JSON.stringify(change.payload ?? {}),
        change.deletedAt ?? null,
        change.clientUpdatedAt,
        deviceId,
        change.undeleteIntent === true ? 1 : 0,
        upserts.length,
      ),
    )
    acceptedIds.push(change.entityId)

    if (decision.recordConflict && existing !== null) {
      // 本请求的设备是**胜方**（覆盖方），existing 是**败方**（被覆盖的那条）。
      conflicts.push({
        entity: change.entity,
        entityId: change.entityId,
        loserUpdatedAt: existing.clientUpdatedAt,
        loserDeviceId: existing.deviceId,
        winnerUpdatedAt: change.clientUpdatedAt,
        winnerDeviceId: deviceId,
        loserSummary: summarize(existing.payload),
        winnerSummary: summarize(change.payload),
        detectedAt: new Date().toISOString(),
      })
    }
  }

  let currentRevision = 0
  if (upserts.length > 0) {
    // ⚠️ 顺序很重要：先 upsert、**最后**才推进计数器。
    //   这样每条 upsert 读到的都是"上一批已提交的最大 revision"，
    //   公式 (rev) + 1 + offset 才能得到连续的 revision 区间。
    let results: D1Result[]
    try {
      results = await env.SYNC_DB.batch([
        ...upserts,
        env.SYNC_DB.prepare(BUMP_REVISION_SQL).bind(upserts.length),
      ])
    } catch {
      // ⭐ 批次里可能混着**tag 唯一索引冲突**（两台设备真正同时建了同名 tag）。
      //   整批回滚后逐条重试：能写的先写，冲突的那条转成合并指令。
      //   这样"并发同名 tag"退化为一次正常合并，而不是整个 push 失败。
      const retry = await pushIndividually(
        env,
        upserts.map((statement, i) => ({ statement, ...upsertMeta[i]! })),
        dedupDirectives,
        tagKeys,
      )
      if (!retry.ok) return fail(500, 'push-failed')
      results = []
    }
    const last = results[results.length - 1]?.meta?.last_row_id
    currentRevision = typeof last === 'number' ? last : 0
  }
  if (currentRevision === 0) {
    // 仅用于响应提示，回读一次不影响正确性
    const row = await env.SYNC_DB.prepare(CURRENT_REVISION_SQL).bind().first<{ revision: number }>()
    currentRevision = row?.revision ?? 0
  }

  return json({
    accepted: acceptedIds.length,
    acceptedIds,
    ignored,
    dedupDirectives,
    conflicts,
    currentRevision,
  })
}

/** 从载荷里取 nameNormalized（非 tag 或载荷异常时返回 null） */
function readNormalizedOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const v = (payload as Record<string, unknown>).nameNormalized
  return typeof v === 'string' && v !== '' ? v : null
}

/**
 * 整批失败后的逐条重试。
 *
 * 唯一预期的失败原因是 **tag 规范化名的部分唯一索引冲突** ——
 * 两台设备真正同时创建了同名 tag。这属于正常业务情形，不是错误：
 * 把冲突的那条转成 `merge-tag-into` 指令交给客户端合并即可。
 *
 * 逐条执行时 revision 公式仍然是 (rev) + 1 + 0，天然连续。
 */
async function pushIndividually(
  env: Env,
  rows: Array<{
    statement: D1PreparedStatement
    entity: string
    entityId: string
    nameNormalized: string | null
  }>,
  dedupDirectives: TagDedupDirective[],
  tagKeys: Map<string, { entityId: string }>,
): Promise<{ ok: true } | { ok: false }> {
  for (const row of rows) {
    try {
      await row.statement.run()
    } catch {
      // 写不进去 —— 大概率是 tag 唯一索引冲突（两台设备真正同时建了同名 tag）。
      // 失败会连带把本批的 revision 推进也回滚掉，因此这里必须
      // **逐条同时推进计数器**，否则 revision 与写入又脱钩了。
      if (row.entity === 'tag' && row.nameNormalized !== null) {
        await env.SYNC_DB.prepare(BUMP_REVISION_SQL).bind(1).run()
        const canonical = tagKeys.get(row.nameNormalized)
        if (canonical !== undefined && canonical.entityId !== row.entityId) {
          dedupDirectives.push({
            kind: 'merge-tag-into',
            duplicateId: row.entityId,
            canonicalId: canonical.entityId,
          })
        }
      } else {
        // 非 tag 的失败是真问题（如约束冲突）→ 整批放弃并报错
        return { ok: false }
      }
    }
  }
  return { ok: true }
}

/** 预加载现有记录（按 id 分片）+ tag nameNormalized 映射 */
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
    // 参数数 = 实体种类(≤3) + 本片 id 数 ≤ 93 < 100 ✅
    const rows = await env.SYNC_DB.prepare(preloadSql(entities.length, idSlice.length))
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
 * 预加载 tag 的 nameNormalized → entityId。
 *
 * ⚠️ nameNormalized 在 JSON 里无法建索引，因此扫描 `entity='tag'` 后在内存比对。
 *   tags 规模远小于 items（个人使用下通常几十条），可接受。
 *
 * ⚠️ **并发局限**（Phase 3B 最终审查第 6 条）：这是"预加载 + 判断"模式，
 *   两台设备**真正同时**创建同名 tag 时可能都先看到"不存在"。
 *   第一版接受这个局限：不去宣称"彻底解决"，改由客户端兜底 ——
 *   apply 时若撞上Dexie 的 &nameNormalized 唯一索引，该条被安全忽略，
 *   整批同步不会失败。
 */
async function preloadTagKeys(
  env: Env,
  changes: PushChange[],
): Promise<Map<string, { entityId: string }>> {
  const wanted = collectTagKeys(changes)
  const out = new Map<string, { entityId: string }>()
  if (wanted.size === 0) return out

  const rows = await env.SYNC_DB.prepare(PULL_TAG_KEYS_SQL).bind().all<{
    entity_id: string
    payload: string
  }>()
  for (const r of rows.results ?? []) {
    const key = readNameNormalizedOf(r.payload)
    if (key !== null && wanted.has(key) && !out.has(key)) {
      out.set(key, { entityId: r.entity_id })
    }
  }
  return out
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