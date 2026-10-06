import { syncRepository } from '../db/repositories/syncRepository'
import { SyncEngine } from '../features/sync/syncEngine'
import { fromBase64Url, toBase64Url } from './syncBytes'
import { SyncTransport, type TransportHost } from '../features/sync/syncTransport'
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
export async function createSyncSpace(): Promise<{ code: string; keyId: string; secret: string }> {
  const secret = generateSecret()
  const keyId = randomKeyId()
  const payload: PairingPayload = { v: 1, keyId, secret }
  const code = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))

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
 * 入口 B：**加入已有同步空间**。
 *
 * ⭐ B 设备**绝不调用 bootstrap** —— 那个端点是"创建空间"，B 调用它会：
 *   · 在空间已存在时收到 409（无害，但语义混乱）
 *   · 更糟：若空间为空（异常状态）就会**抢占**创建权
 * B 只做一件事：携带 secret 调**已认证的** `/status`：
 *   200 → secret 有效 → 此时才落本地凭据
 *   401 → secret 无效 → **不写入任何本地凭据**
 *
 * @param payload 配对码
 * @param cloud 云端当前记录数（用于询问用户如何处理已有数据）
 */
export async function joinSyncSpace(payload: PairingPayload): Promise<
  { ok: true; recordCount: number; currentRevision: number } | { ok: false; reason: 'rejected' | 'offline' }
> {
  const transport = new SyncTransport(createHost(), {
    baseUrl: WORKER_BASE,
    deviceId: 'join-check',
    secret: payload.secret,
  })
  // 已认证的 status：secret 错就是 401 → 'rejected'
  // B 全程不调 bootstrap，所以这里不需要再解析配对码（调用方已 parse 过）
  const status = await transport.status()
  if (!status.ok) {
    return { ok: false, reason: status.kind === 'offline' ? 'offline' : 'rejected' }
  }

  // ✅ 只有校验通过才落本地凭据并启用；401 路径上一个字节都没写
  await syncRepository.initCredentials(payload.secret, payload.keyId)
  await syncRepository.setState({ enabled: true })
  await syncRepository.enqueueAll()

  return { ok: true, recordCount: status.recordCount, currentRevision: status.currentRevision }
}

export { WORKER_BASE }