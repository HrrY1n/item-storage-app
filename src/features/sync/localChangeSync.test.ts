import { beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../db/db'
import { itemRepository } from '../../db/repositories/itemRepository'
import { categoryRepository } from '../../db/repositories/categoryRepository'
import { tagRepository } from '../../db/repositories/tagRepository'
import { syncRepository } from '../../db/repositories/syncRepository'
import { markSyncDirty, onSyncDirty, resetSyncDirtyListeners } from '../../db/syncDirty'
import { createLocalChangeDebouncer, type DebounceHost } from './localChangeDebounce'
import { LOCAL_CHANGE_DEBOUNCE_MS, shouldRequestSync } from './syncPolicy'
import { SyncEngine, type SyncEngineHost } from './syncEngine'
import { exportBackup } from '../../services/backupService'
import { commitJoin, currentPairingCode, encodePairingCode, parsePairingCode } from '../../services/syncService'
import type { RemoteChange } from './syncTransport'
import type { SyncEntity } from '../../domain/syncPayload'
import { SYNC_PROTOCOL_VERSION } from '../../domain/syncProtocol'

/**
 * Phase 3B.1 —— 主力手机场景的云端同步细化。
 *
 * 覆盖点（对应需求 §11）：
 *   1. 本地改动完成后触发 debounce 同步
 *   2. 连续 5 次修改只触发一次后台同步
 *   3. 同步关闭 → 零网络
 *   4. 离线改动 → 不阻塞、不丢 outbox
 *   5. online 恢复 → pending 正常上传
 *   6. local-change 同步绝不发生在业务 Dexie transaction 内
 *   7. 恢复码刷新后仍可重建
 *   8. 恢复码不进入 ZIP 备份
 *   9. 新设备用恢复码 + cloud authoritative 能恢复数据
 */

const BASE = 'https://example.test'
const SECRET = 'r'.repeat(40)
const KEY_ID = 'key-primary-phone'

const baseInput = {
  name: '测试物品',
  categoryId: 'c1',
  iconAssetId: 'preset-other',
  note: '',
  tagIds: [] as string[],
  purchaseDate: null as string | null,
  purchasePriceCents: null as number | null,
  additionalCostCents: null as number | null,
  purchasePlatform: null as 'jd' | null,
  status: 'owned' as const,
  warrantyExpiresAt: null,
  disposedAt: null,
  disposalMethod: null,
  salePriceCents: null,
  disposalNote: null,
}

/** 内存版云端（与 syncEngine.test.ts 同一套语义） */
class FakeCloud {
  private rows = new Map<string, { revision: number; deletedAt: string | null; change: RemoteChange }>()
  private seq = 0
  readonly calls: string[] = []

  push(
    deviceId: string,
    changes: Array<{
      queueId: string
      entity: SyncEntity
      entityId: string
      payload: unknown
      deletedAt: string | null
      clientUpdatedAt: string
    }>,
  ): { accepted: number; acceptedQueueIds: string[]; currentRevision: number } {
    const acceptedQueueIds: string[] = []
    for (const c of changes) {
      const key = `${c.entity}:${c.entityId}`
      this.seq += 1
      this.rows.set(key, {
        revision: this.seq,
        deletedAt: c.deletedAt,
        change: {
          revision: this.seq,
          entity: c.entity,
          entityId: c.entityId,
          payload: c.payload,
          deletedAt: c.deletedAt,
          clientUpdatedAt: c.clientUpdatedAt,
          deviceId,
        },
      })
      acceptedQueueIds.push(c.queueId)
    }
    return { accepted: acceptedQueueIds.length, acceptedQueueIds, currentRevision: this.seq }
  }

  pull(after: number): { changes: RemoteChange[]; nextRevision: number; hasMore: boolean } {
    const all = [...this.rows.values()]
      .filter((r) => r.revision > after)
      .sort((a, b) => a.revision - b.revision)
      .map((r) => r.change)
    return {
      changes: all,
      nextRevision: all.length === 0 ? after : all[all.length - 1]!.revision,
      hasMore: false,
    }
  }

  /** 直接播种一条记录（模拟"旧手机已经同步上云的数据"） */
  seed(entity: SyncEntity, entityId: string, payload: unknown): void {
    this.seq += 1
    this.rows.set(`${entity}:${entityId}`, {
      revision: this.seq,
      deletedAt: null,
      change: {
        revision: this.seq,
        entity,
        entityId,
        payload,
        deletedAt: null,
        clientUpdatedAt: '2026-01-01T00:00:00.000Z',
        deviceId: 'dev-old-phone',
      },
    })
  }

  get recordCount(): number {
    return this.rows.size
  }
}

let cloud: FakeCloud

function makeDevice(opts: { online?: boolean } = {}): SyncEngine {
  const state = { online: opts.online ?? true, deviceId: 'dev-primary-phone', secret: SECRET }
  const host: SyncEngineHost = {
    isOnline: () => state.online,
    now: () => 1_000_000,
    async fetch(url, init) {
      if (!state.online) return { status: 0, text: async () => '' }
      cloud.calls.push(`${init.method} ${url.split('?')[0]}`)
      if (url.endsWith('/api/sync/status')) {
        return {
          status: 200,
          text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, currentRevision: 0, recordCount: cloud.recordCount }),
        }
      }
      if (url.endsWith('/api/sync/push')) {
        const body = JSON.parse(init.body ?? '{}') as {
          deviceId: string
          changes: Parameters<FakeCloud['push']>[1]
        }
        const r = cloud.push(state.deviceId, body.changes)
        return {
          status: 200,
          text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, ...r, ignored: [], dedupDirectives: [], authoritativeChanges: [], conflicts: [] }),
        }
      }
      if (url.includes('/api/sync/pull')) {
        const after = Number(new URL(url).searchParams.get('after') ?? '0')
        return { status: 200, text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, ...cloud.pull(after) }) }
      }
      return { status: 404, text: async () => '' }
    },
  }
  return new SyncEngine(host, { baseUrl: BASE })
}

/** 手动推进的时钟，用来精确断言 debounce */
function manualClock(): { host: DebounceHost; advance(ms: number): void; timerCount(): number } {
  let next = 1
  const timers = new Map<number, { fn: () => void; at: number }>()
  let now = 0
  const host: DebounceHost = {
    setTimer(fn, ms) {
      const id = next++
      timers.set(id, { fn, at: now + ms })
      return id
    },
    clearTimer(handle) {
      timers.delete(handle as number)
    },
  }
  return {
    host,
    advance(ms) {
      now += ms
      for (const [id, t] of [...timers.entries()]) {
        if (t.at <= now) {
          timers.delete(id)
          t.fn()
        }
      }
    },
    timerCount: () => timers.size,
  }
}

beforeEach(async () => {
  resetSyncDirtyListeners()
  await Promise.all([
    db.items.clear(),
    db.categories.clear(),
    db.tags.clear(),
    db.itemTags.clear(),
    db.assets.clear(),
    db.appMeta.clear(),
    db.syncQueue.clear(),
    db.syncState.clear(),
    db.syncConflicts.clear(),
  ])
  await db.categories.add({
    id: 'c1',
    parentId: null,
    name: '分类',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  })
  cloud = new FakeCloud()
})

/* ==================================================================== *
 * 1 / 2 —— debounce 聚合
 * ==================================================================== */

describe('本地改动的 debounce 聚合', () => {
  it('① 一次本地改动 → 窗口结束后触发一次同步', () => {
    const clock = manualClock()
    let fired = 0
    const d = createLocalChangeDebouncer({
      debounceMs: LOCAL_CHANGE_DEBOUNCE_MS,
      host: clock.host,
      fire: () => (fired += 1),
    })

    d.notify()
    // 窗口未到 → 还没触发
    expect(fired).toBe(0)
    clock.advance(LOCAL_CHANGE_DEBOUNCE_MS)
    expect(fired).toBe(1)
    expect(d.pending()).toBe(false)
  })

  it('★② 连续 5 次修改 → 只触发一次后台同步', () => {
    const clock = manualClock()
    let fired = 0
    const d = createLocalChangeDebouncer({
      debounceMs: LOCAL_CHANGE_DEBOUNCE_MS,
      host: clock.host,
      fire: () => (fired += 1),
    })

    // 模拟一次"整理动作"：新增 → 改标签 → 改分类 → 改名称 → 再改一次
    for (let i = 0; i < 5; i += 1) {
      d.notify()
      clock.advance(400) // 每次间隔 400ms，都在 2.5s 窗口内
    }
    expect(fired).toBe(0)

    clock.advance(LOCAL_CHANGE_DEBOUNCE_MS)
    expect(fired).toBe(1)
    // 窗口里始终只有一个待触发定时器（不是排了 5 个）
    expect(clock.timerCount()).toBe(0)
  })

  it('窗口结束后再改动 → 触发第二次（不是永久只同步一次）', () => {
    const clock = manualClock()
    let fired = 0
    const d = createLocalChangeDebouncer({
      debounceMs: LOCAL_CHANGE_DEBOUNCE_MS,
      host: clock.host,
      fire: () => (fired += 1),
    })
    d.notify()
    clock.advance(LOCAL_CHANGE_DEBOUNCE_MS)
    expect(fired).toBe(1)

    d.notify()
    clock.advance(LOCAL_CHANGE_DEBOUNCE_MS)
    expect(fired).toBe(2)
  })
})

/* ==================================================================== *
 * 3 / 4 / 5 —— 什么情况下真的发请求
 * ==================================================================== */

describe('local-change 的放行条件', () => {
  const gate = (over: Partial<Parameters<typeof shouldRequestSync>[0]> = {}) =>
    shouldRequestSync({
      reason: 'local-change',
      enabled: true,
      configured: true,
      online: true,
      now: 1_000_000,
      lastAttemptAt: null,
      ...over,
    })

  it('★③ 同步关闭 → 绝不放行（零网络）', () => {
    expect(gate({ enabled: false })).toBe(false)
  })

  it('★③ 无 secret（未配对）→ 绝不放行', () => {
    expect(gate({ configured: false })).toBe(false)
  })

  it('离线 → 不放行（等 online 事件，不靠定时器）', () => {
    expect(gate({ online: false })).toBe(false)
  })

  it('已在飞行中 → 不重复发', () => {
    expect(gate({ inFlight: true })).toBe(false)
  })

  it('★⑤ local-change 不被节流挡住（否则改动会滞留在本机）', () => {
    // ⚠️ 这里正是"给 local-change 加节流"会踩的坑：
    //    上一次同步才过去 5 秒，若按节流判定这次改动会被丢弃，
    //    而 debounce 已经触发过不会再触发 → 改动卡在本机直到下次切前台。
    const base = {
      reason: 'local-change' as const,
      enabled: true,
      configured: true,
      online: true,
      now: 1_000_000,
    }
    expect(shouldRequestSync({ ...base, lastAttemptAt: 1_000_000 - 5_000 })).toBe(true)
    expect(shouldRequestSync({ ...base, lastAttemptAt: 1_000_000 - 2_000 })).toBe(true)
    expect(shouldRequestSync({ ...base, lastAttemptAt: 1_000_000 })).toBe(true)
  })

  it('限流职责在 debounce 而不在节流：visible 仍走 60s 窗口', () => {
    const base = { reason: 'visible' as const, enabled: true, configured: true, online: true, now: 1_000_000 }
    expect(shouldRequestSync({ ...base, lastAttemptAt: 1_000_000 - 5_000 })).toBe(false)
    expect(shouldRequestSync({ ...base, lastAttemptAt: 1_000_000 - 61_000 })).toBe(true)
  })

  it('★③ 端到端：同步关闭时 engine 完全不打网络', async () => {
    const engine = makeDevice()
    await syncRepository.setState({ enabled: false, secret: null, keyId: null, deviceId: null })

    if (await engine.shouldSync('local-change', true)) await engine.run()
    expect(cloud.calls).toEqual([])
  })

  it('★④ 离线改动：本地写入成功、outbox 不丢、零网络', async () => {
    const engine = makeDevice({ online: false })
    await syncRepository.setState({ enabled: true, secret: SECRET, deviceId: 'dev-primary-phone' })

    // 离线下保存：必须成功（业务写入不等网络）
    await itemRepository.create({ ...baseInput, name: '离线新增' })

    // outbox 里有条目 —— 改动没丢
    const queued = await syncRepository.listQueue()
    expect(queued.map((r) => r.entityId).length).toBeGreaterThan(0)

    // 且一个网络请求都没发
    if (await engine.shouldSync('local-change', false)) await engine.run()
    expect(cloud.calls).toEqual([])
  })

  it('★⑤ online 恢复后：pending 正常上传', async () => {
    await syncRepository.setState({ enabled: true, secret: SECRET, deviceId: 'dev-primary-phone' })

    // 先离线改动
    const offline = makeDevice({ online: false })
    await itemRepository.create({ ...baseInput, name: '离线新增' })
    expect(await offline.shouldSync('online', false)).toBe(false)

    // 恢复网络 → online 触发（忽略节流）→ 上传成功
    const online = makeDevice({ online: true })
    expect(await online.shouldSync('online', true)).toBe(true)
    const outcome = await online.run()
    expect(outcome.ok).toBe(true)
    expect(outcome.pushed).toBeGreaterThan(0)

    // outbox 已清空
    expect(await syncRepository.listQueue()).toEqual([])
  })
})

/* ==================================================================== *
 * 6 —— 绝不在业务 Dexie transaction 内触发同步
 * ==================================================================== */

describe('local-change 与业务事务的时序', () => {
  it('★⑥ markSyncDirty 只在业务事务**提交后**被调用', async () => {
    let txDuringNotify: unknown = 'not-called'
    const off = onSyncDirty(() => {
      txDuringNotify = Dexie.currentTransaction
    })

    await itemRepository.create({ ...baseInput, name: '时序检查' })
    off()

    // ⭐ 关键断言：事件触发时不存在任何活动事务 ——
    //   若在事务内触发并 await 了网络，Dexie 事务会被中断、原子性丢失。
    expect(txDuringNotify).toBeNull()
  })

  it('★⑥ 分类 / 标签写入同样在事务外通知', async () => {
    const seen: unknown[] = []
    const off = onSyncDirty(() => seen.push(Dexie.currentTransaction))

    await categoryRepository.create('新分类', null)
    off()

    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((tx) => tx === null)).toBe(true)
  })

  it('标签物理删除也会进入自动同步 debounce', async () => {
    const tag = await tagRepository.create('待删除')
    const clock = manualClock()
    let fired = 0
    const debouncer = createLocalChangeDebouncer({
      debounceMs: LOCAL_CHANGE_DEBOUNCE_MS,
      host: clock.host,
      fire: () => (fired += 1),
    })
    const off = onSyncDirty(() => debouncer.notify())

    await tagRepository.delete(tag.id)
    clock.advance(LOCAL_CHANGE_DEBOUNCE_MS)
    off()

    expect(fired).toBe(1)
    expect((await syncRepository.listQueue()).find((entry) => entry.entityId === tag.id)?.op).toBe('delete')
  })

  it('★⑥ 同步监听抛错也不会影响业务写入', async () => {
    const off = onSyncDirty(() => {
      throw new Error('listener blew up')
    })
    await expect(itemRepository.create({ ...baseInput, name: '监听炸了也要写进去' })).resolves.toBeTruthy()
    off()
  })

  it('repository 写入确实会通知到同步层', async () => {
    let count = 0
    const off = onSyncDirty(() => (count += 1))
    await itemRepository.create({ ...baseInput, name: '通知检查' })
    off()
    expect(count).toBe(1)
  })

  it('markSyncDirty 本身没有订阅者时也不报错', () => {
    expect(() => markSyncDirty()).not.toThrow()
  })
})

/* ==================================================================== *
 * 7 —— 恢复码刷新后仍可重建
 * ==================================================================== */

describe('恢复码（recovery code）', () => {
  it('★⑦ 从本地凭据重建，反复调用结果一致', async () => {
    await syncRepository.setState({ enabled: true, secret: SECRET, keyId: KEY_ID, deviceId: 'dev' })

    const first = await currentPairingCode()
    expect(first).not.toBeNull()
    // 模拟"刷新页面 / PWA 重启"：再取一次，必须还是同一个
    const second = await currentPairingCode()
    expect(second).toBe(first)
  })

  it('★⑦ 重建出来的码能解回同一个 secret + keyId（协议格式不变）', async () => {
    await syncRepository.setState({ enabled: true, secret: SECRET, keyId: KEY_ID, deviceId: 'dev' })
    const code = await currentPairingCode()
    expect(code).not.toBeNull()

    const parsed = parsePairingCode(code!)
    expect(parsed).toEqual({ v: 1, keyId: KEY_ID, secret: SECRET })
  })

  it('本机还没创建同步空间 → 返回 null（不凭空造码）', async () => {
    expect(await currentPairingCode()).toBeNull()
  })

  it('encodePairingCode 是纯函数（同输入同输出）', () => {
    expect(encodePairingCode(SECRET, KEY_ID)).toBe(encodePairingCode(SECRET, KEY_ID))
  })

  it('★⑧ 恢复码（含明文 secret）绝不进入 ZIP 备份', async () => {
    await syncRepository.setState({ enabled: true, secret: SECRET, keyId: KEY_ID, deviceId: 'dev' })
    const code = (await currentPairingCode())!

    const result = await exportBackup()
    const text = await result.blob.text()

    // 恢复码本体、secret 明文、乃至同步表键名都不该出现
    expect(text).not.toContain(code)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('syncState')
  })
})

/* ==================================================================== *
 * 9 —— 新设备用恢复码 + 云端为准恢复
 * ==================================================================== */

describe('换机恢复（新设备 + 云端为准）', () => {
  it('★⑨ 恢复码解析出的凭据 + commitJoin(cloud) 能把云端数据拉回本机', async () => {
    // 旧手机已经同步上云的数据
    cloud.seed('item', 'item-from-old-phone', {
      v: 1,
      name: '旧手机上的物品',
      categoryId: 'c1',
      iconAssetId: 'preset-other',
      note: '',
      tagIds: [],
      status: 'owned',
      purchaseDate: null,
      purchasePriceCents: null,
      additionalCostCents: null,
      purchasePlatform: null,
      warrantyExpiresAt: null,
      disposedAt: null,
      disposalMethod: null,
      salePriceCents: null,
      disposalNote: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    // 新手机上有一些"本地垃圾数据"（换机后不该留下）
    await itemRepository.create({ ...baseInput, name: '新手机上的临时数据' })
    expect(await db.items.count()).toBe(1)

    // 用户输入恢复码 → 解析 → 以云端为准加入
    const recoveryCode = encodePairingCode(SECRET, KEY_ID)
    const payload = parsePairingCode(recoveryCode)
    expect(payload).not.toBeNull()
    await commitJoin(payload!, 'cloud')

    // 加入后：本地业务数据已被清空、游标归零、凭据已就绪
    expect(await db.items.count()).toBe(0)
    const state = await syncRepository.getState()
    expect(state?.enabled).toBe(true)
    expect(state?.lastPulledRevision).toBe(0)

    // 同步一次 → 云端数据回到本机
    const engine = makeDevice()
    const outcome = await engine.run()
    expect(outcome.ok).toBe(true)
    expect(outcome.pulled).toBeGreaterThan(0)

    const restored = await db.items.get('item-from-old-phone')
    expect(restored?.name).toBe('旧手机上的物品')
    // 新手机上的临时数据没有残留
    expect((await db.items.toArray()).map((i) => i.name)).toEqual(['旧手机上的物品'])
  })
})
