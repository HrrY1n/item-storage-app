import { syncRepository } from '../db/repositories/syncRepository'
import { onSyncDirty } from '../db/syncDirty'
import { SyncEngine } from '../features/sync/syncEngine'
import { fromBase64Url, toBase64Url } from './syncBytes'
import { SyncTransport, type TransportHost } from '../features/sync/syncTransport'
import { LOCAL_CHANGE_DEBOUNCE_MS } from '../features/sync/syncPolicy'
import {
  createLocalChangeDebouncer,
  realTimerHost,
} from '../features/sync/localChangeDebounce'
import type { SyncReason } from '../features/sync/syncPolicy'

/**
 * 同步的**浏览器侧唯一装配点**（与 services/pwaUpdate.ts 同一模式）。
 *
 * 平台访问全部走注入的 host —— 这样引擎的编排逻辑可以在 node 环境测，
 * 不必为此引入 jsdom。
 *
 * ⚠️ 刻意**不阻塞首屏**：启动检查排在首屏渲染之后，失败完全静默。
 * 同步是本地数据的镜像，它的可用性永远低于本地操作的可用性。
 */

let engine: SyncEngine | null = null

/** Worker 的地址。与线上部署同源，因此不需要额外配置。 */
const WORKER_BASE = typeof location === 'undefined' ? '' : location.origin

function createHost(): TransportHost {
  return {
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    now: () => Date.now(),
    async fetch(url, init) {
      // ⚠️ signal 必须透传给 fetch，否则超时完全无效
      // （这是 Phase 3B 复审发现的真实缺陷：只建了 AbortController 没接线）
      const res = await fetch(url, { ...init, signal: init.signal })
      return {
        status: res.status,
        text: () => res.text(),
      }
    },
  }
}

/**
 * 启动同步管理。只调用一次（幂等）。
 *
 * @returns 引擎实例；未启用同步时它仍然存在，但所有 run() 都会直接返回
 * （因为 syncState 里没有 enabled）。
 */
export function startSync(): SyncEngine {
  if (engine !== null) return engine
  engine = new SyncEngine(createHost(), { baseUrl: WORKER_BASE })
  attachLifecycle()
  return engine
}

/** 页面生命周期 → 统一的 requestSync(reason)，内部自带节流 */
function attachLifecycle(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return
    void requestSync('visible')
  })
  window.addEventListener('online', () => void requestSync('online'))

  // ⭐ Phase 3B.1：本地业务写入 → 聚合后自动同步一次
  //   repository 只喊一声「脏了」，聚合在这里做，
  //   保证"连续整理动作只产生一次网络请求"。
  onSyncDirty(() => localChangeDebouncer.notify())
}

/* ---------------------------------------------------------------------- */
/* 本地改动的 debounce（同步关闭 / 离线 / 未配对时零网络）                  */
/* ---------------------------------------------------------------------- */

/**
 * 本地改动 → 等 LOCAL_CHANGE_DEBOUNCE_MS → 发一次 'local-change' 同步。
 *
 * ⚠️ 只负责**聚合**；是否真的发请求由 `shouldRequestSync` 判定
 *    （未启用 / 未配 secret / 离线 一律不发），因此"同步关闭时零网络"
 *    是双重保证：既不起请求，也不弹错误。
 */
const localChangeDebouncer = createLocalChangeDebouncer({
  debounceMs: LOCAL_CHANGE_DEBOUNCE_MS,
  host: realTimerHost,
  fire: () => void requestSync('local-change'),
})

/** 仅测试用：取消待触发的 debounce（避免用例间串扰） */
export function cancelPendingLocalChangeSync(): void {
  localChangeDebouncer.cancel()
}

/** 仅测试用：是否存在待触发的本地改动同步 */
export function hasPendingLocalChangeSync(): boolean {
  return localChangeDebouncer.pending()
}

/**
 * 请求一次同步（内部决策：未启用/离线/节流中都直接跳过）。
 * 任何异常都被吞掉 —— 同步绝不影响用户使用 App。
 */
export async function requestSync(reason: SyncReason): Promise<void> {
  void (engine ?? startSync())
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false
  try {
    const e = engine ?? startSync()
    if (await e.shouldSync(reason, online)) await e.run()
  } catch {
    /* 静默：同步失败对用户不可见 */
  }
}

/** 供 React 层使用（未启动则惰性启动） */
export function getSyncEngine(): SyncEngine {
  return engine ?? startSync()
}

/* ---------------------------------------------------------------------- */
/* 配对（A/B 引导式，见 3B 计划 §0.2）                                    */
/* ---------------------------------------------------------------------- */

/**
 * 配对码的载荷结构。注意它包含明文 secret，**只在配对期间存在于内存**。
 *
 * ⚠️ 刻意**不含 workerBaseUrl**（Phase 3B 复审第 11 条）：
 *   同步 API 与 App 同源，因此永远用 `location.origin`。
 *   若让配对码携带地址，一个恶意/篡改过的配对码就能把 secret
 *   引导到第三方 origin 上 —— 那等于把凭据主动送出去。
 *   同源也意味着省掉了"配对码在不同环境（局域网预览 / 线上）间不通用"的麻烦。
 */
export interface PairingPayload {
  v: 1
  keyId: string
  secret: string
}

/** 生成 256-bit 随机 secret（base64url，无 padding） */
function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return toBase64Url(bytes)
}

function randomKeyId(): string {
  return crypto.randomUUID()
}

/**
 * 入口 A：**创建新的同步空间**。
 *
 * 流程（Phase 3B 复审第 4 条修正后的简化版）：
 *   1. 生成 secret + keyId，向 Worker登记（唯一会调 bootstrap 的地方）
 *   2. 本机**立即启用**同步并把全部本地数据入队推送
 *   3. 配对码**持久化展示**，用户随时可复制
 *
 * ## 为什么不再"等 B 接入后自动启用"
 *
 * 旧设计让 A 停在"等 B 接入"状态，靠"收到首次成功 pull"来触发启用。
 * 复核后认为这有两个问题：
 *   ① **没有触发机制** —— 谁来决定"A 收到了 B 的数据"？这需要一个额外的
 *      状态标记与检查点，实际上就是第 4 条批评的"看似有实则无"。
 *   ② A 本来就是数据的来源方，它的云端数据由自己建立，不存在"推空库覆盖
 *      B 的老数据"这种风险 —— 那个风险是**B 单边加入**时的方向问题。
 * 因此改为：A 立即启用（自己的数据就是权威），B 加入时才会遇到
 * "云端已有数据"的抉择，由 B 侧显式询问用户。
 */
/** 把 (secret, keyId) 编码成配对码字符串（纯函数，刷新后可重复调用） */
export function encodePairingCode(secret: string, keyId: string): string {
  const payload: PairingPayload = { v: 1, keyId, secret }
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
}

/**
 * 入口 A：**创建新的同步空间**。
 *
 * 这是**唯一**会调用 bootstrap 的地方 —— 空间已存在时服务端必然返回 409。
 * "显示/复制配对码"请用 `currentPairingCode()`，它不碰网络。
 *
 * 流程：
 *   1. 生成 secret + keyId，向 Worker 登记
 *   2. 本机**立即启用**同步并把全部本地数据入队推送
 *   3. 返回配对码（之后随时可用 currentPairingCode() 重新取到）
 *
 * ## 为什么不再"等 B 接入后自动启用"
 *
 * 旧设计让 A 停在"等 B 接入"状态，靠"收到首次成功 pull"来触发启用。
 * 复核后认为这有两个问题：
 *   ① **没有触发机制** —— 谁来判断"A 收到了 B 的数据"？需要额外状态标记与检查点。
 *   ② A 本来就是数据的来源方，它的云端数据由自己建立，
 *      不存在"推空库覆盖 B 的老数据"这种风险 —— 那风险在**B 单边加入**的方向。
 * 因此改为：A 立即启用（自己的数据就是权威），B 加入时才需要显式抉择。
 */
export async function createSyncSpace(): Promise<{ code: string; keyId: string; secret: string }> {
  const secret = generateSecret()
  const keyId = randomKeyId()
  const code = encodePairingCode(secret, keyId)

  // 先向 Worker 登记哈希。失败就不要把配对码给出去（否则对方拿到的是一个
  // 服务端并不认识的 secret，表现为"配对码无效"，很难排查）。
  const transport = new SyncTransport(createHost(), {
    baseUrl: WORKER_BASE,
    deviceId: 'bootstrap',
    secret,
  })
  const registered = await transport.bootstrap(secret, keyId)
  if (!registered.ok) throw new Error('无法创建同步空间')

  // 登记成功后才落本地凭据并启用
  await syncRepository.initCredentials(secret, registered.keyId ?? keyId)
  await syncRepository.setState({ enabled: true })
  await syncRepository.enqueueAll()

  return { code, keyId: registered.keyId ?? keyId, secret }
}

/** 解析配对码；格式不对返回 null */
export function parsePairingCode(code: string): PairingPayload | null {
  try {
    const bytes = fromBase64Url(code)
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PairingPayload>
    if (
      parsed.v !== 1 ||
      typeof parsed.secret !== 'string' ||
      parsed.secret.length < 32 ||
      typeof parsed.keyId !== 'string'
    ) {
      return null
    }
    // ⚠️ 即使旧版配对码里带了 workerBaseUrl 也**不采纳** ——
    // 目标 origin 永远是当前页面自己的 origin。
    return { v: 1, keyId: parsed.keyId, secret: parsed.secret }
  } catch {
    return null
  }
}

/**
 * 从**本地已有凭据**重建配对码 —— 不发任何网络请求。
 *
 * Phase 3B 最终审查第 3 条：配对码此前只存在 React useState 里，
 * 刷新/重启后就丢了，而"生成配对码"按钮又会去调 bootstrap（必然 409）。
 * 现在 secret 与 keyId 本来就持久在 syncState，因此直接重新编码即可。
 *
 * @returns 配对码字符串；本机尚未创建同步空间时返回 null
 */
export async function currentPairingCode(): Promise<string | null> {
  const state = await syncRepository.getState()
  if (state === null || state.secret === null || state.keyId === null) return null
  return encodePairingCode(state.secret, state.keyId)
}

/** 本机是否已经创建过同步空间（有凭据） */
export async function hasSyncSpace(): Promise<boolean> {
  const state = await syncRepository.getState()
  return state !== null && state.secret !== null && state.keyId !== null
}

/**
 * 入口 B 步骤 1：**只校验配对码**，绝不修改任何本地状态。
 *
 * Phase 3B 最终审查第 4 条：旧实现在校验通过后立刻
 * `initCredentials` + `enabled=true` + `enqueueAll` ——
 * 但那时用户**还没决定数据方向**。此刻若触发同步，
 * 就可能把本地数据推上去、或拉到云端数据，污染用户尚未确认的状态。
 *
 * ⭐ B 设备**绝不调用 bootstrap** —— 那是"创建空间"入口，
 *   B 调用会语义混乱（空间已存在 → 409；空间为空 → 抢占创建权）。
 *
 * @returns 成功时带上云端记录数，供 UI 询问用户数据方向
 */
export async function validateJoinPairingCode(payload: PairingPayload): Promise<
  { ok: true; recordCount: number } | { ok: false; reason: 'rejected' | 'offline' }
> {
  const transport = new SyncTransport(createHost(), {
    baseUrl: WORKER_BASE,
    deviceId: 'join-check',
    secret: payload.secret,
  })
  // 已认证的 status：secret 错就是 401 → 'rejected'
  const status = await transport.status()
  if (!status.ok) {
    return { ok: false, reason: status.kind === 'offline' ? 'offline' : 'rejected' }
  }
  // ⚠️ 此刻**不写任何本地状态**：enabled 仍是 false，绝不会自动 push/pull。
  return { ok: true, recordCount: status.recordCount }
}

/**
 * 入口 B 步骤 2：**用户确认数据方向之后**才落凭据并启用。
 *
 * @param payload 已通过 validateJoinPairingCode 的配对码
 * @param direction 数据方向
 *   - `'cloud'`：以云端为准 → **显式清空本地业务数据**，再从 revision=0 完整拉取
 *   - `'local'`：以本机为准 → 本地全量入队并推送（服务端按 revision 逐条覆盖，
 *     云端独有的记录不会被删除 —— 第一版不提供真正的 server-side replace）
 */
export async function commitJoin(
  payload: PairingPayload,
  direction: 'cloud' | 'local',
): Promise<void> {
  if (direction === 'cloud') {
    // 清空**需要同步的**本地业务数据（assets / appMeta / 同步表保持不动）：
    // 否则云端不存在的数据会留在本机，"以云端为准"名不副实。
    await wipeSyncableLocalData()
    // ⚠️ outbox 也必须清：里面是**已被清掉的那些实体**的待推条目。
    //   若留着，启用后会把刚被删掉的本地数据又推回云端 —— 语义完全相反。
    await syncRepository.clearQueue()
    // 游标归零 → 下一轮从 revision=0 完整拉取云端全量
    await syncRepository.setState({ lastPulledRevision: 0 })
  }

  await syncRepository.initCredentials(payload.secret, payload.keyId)
  await syncRepository.setState({ enabled: true })
  if (direction === 'local') {
    await syncRepository.enqueueAll()
  }
}

/**
 * 清空需要同步的本地业务数据（items / categories / tags / itemTags）。
 *
 * ⚠️ 刻意**不动** assets 与 appMeta：
 *   - assets：preset 资产由 syncPresetAssets 幂等补齐，用户的照片/AI 图标不该被清
 *   - appMeta：本地状态（seeded / schemaVersion），清掉会导致 App 重新 seed
 *     并覆盖用户整理过的分类名 —— 项目既有硬不变量。
 */
export async function wipeSyncableLocalData(): Promise<void> {
  const { db } = await import('../db/db')
  await db.transaction('rw', [db.items, db.itemTags, db.categories, db.tags], async () => {
    await db.items.clear()
    await db.itemTags.clear()
    await db.categories.clear()
    await db.tags.clear()
  })
}

export { WORKER_BASE }