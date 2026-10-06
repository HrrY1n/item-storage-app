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
      const res = await fetch(url, init)
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

/** 配对码的载荷结构。注意它包含明文 secret，**只在配对期间存在于内存**。 */
export interface PairingPayload {
  v: 1
  keyId: string
  secret: string
  workerBaseUrl: string
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
 * A 设备：生成配对码。
 *
 * ⚠️ 刻意**不启用同步** —— 等 B 设备接入后再启用。
 * 否则会出现"A 单边把空库推上去覆盖 B 的老数据"。
 */
export async function createPairingCode(): Promise<{ code: string; keyId: string; secret: string }> {
  const secret = generateSecret()
  const keyId = randomKeyId()
  const payload: PairingPayload = { v: 1, keyId, secret, workerBaseUrl: WORKER_BASE }
  const code = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  // 先落凭据（不含 enabled），用户复制配对码到另一台设备
  await syncRepository.initCredentials(secret, keyId)
  return { code, keyId, secret }
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
    return {
      v: 1,
      keyId: parsed.keyId,
      secret: parsed.secret,
      workerBaseUrl: typeof parsed.workerBaseUrl === 'string' ? parsed.workerBaseUrl : WORKER_BASE,
    }
  } catch {
    return null
  }
}

/** 在 Worker 上登记 secret 的哈希（B 设备与 A 设备都需要登记一次） */
export async function registerSecret(secret: string, keyId: string, baseUrl = WORKER_BASE): Promise<boolean> {
  const host = createHost()
  const transport = new SyncTransport(host, { baseUrl, deviceId: 'bootstrap', secret })
  const result = await transport.bootstrap(secret, keyId)
  return result.ok
}

export { WORKER_BASE }