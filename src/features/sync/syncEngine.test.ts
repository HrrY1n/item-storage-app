import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { itemRepository } from '../../db/repositories/itemRepository'
import { categoryRepository } from '../../db/repositories/categoryRepository'
import { tagRepository } from '../../db/repositories/tagRepository'
import { syncRepository } from '../../db/repositories/syncRepository'
import { SyncEngine } from './syncEngine'
import type { SyncEngineHost } from './syncEngine'
import type { RemoteChange } from './syncTransport'
import type { SyncEntity } from '../../domain/syncPayload'
import { SYNC_PROTOCOL_VERSION } from '../../domain/syncProtocol'

/**
 * 同步引擎的端到端测试（node 环境 + fake-indexeddb）。
 *
 * 用一台**内存里的假云端**（FakeCloud）模拟 D1/Worker 的语义：
 * - 每实体只留最新一行
 * - revision 单调递增
 * - 已 tombstone 的记录拒绝复活
 * - 服务端顺序优先覆盖
 *
 * 这样可以验证"两台设备"之间的完整收敛，而不需要真实部署。
 */

const BASE = 'https://example.test'
const SECRET = 's'.repeat(40)

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

/** 内存版 D1：语义与 worker/migrations/0001_init.sql 一致 */
class FakeCloud {
  private rows = new Map<string, { revision: number; deletedAt: string | null; change: RemoteChange }>()
  private seq = 0
  /** 记录被请求过的路径，便于断言「没发多余请求」 */
  readonly calls: string[] = []
  /** 让下一次 push 失败（模拟网络/服务端故障） */
  failNextPush = false
  /** push 之前触发的钩子：用于模拟「用户在这期间又改了同一实体」 */
  onBeforePush: (() => Promise<void>) | null = null

  async push(deviceId: string, changes: Array<{ queueId?: string; entity: SyncEntity; entityId: string; payload: unknown; deletedAt: string | null; clientUpdatedAt: string; baseRevision: number; undeleteIntent?: boolean }>): Promise<{ accepted: number; acceptedQueueIds: string[]; ignored: Array<{ queueId: string; entity: SyncEntity; entityId: string; reason: string }>; currentRevision: number }> {
    if (this.failNextPush) {
      this.failNextPush = false
      throw new Error('simulated push failure')
    }
    const acceptedQueueIds: string[] = []
    const ignored: Array<{ queueId: string; entity: SyncEntity; entityId: string; reason: string }> = []
    const accepted = changes.filter((c) => {
      const key = `${c.entity}:${c.entityId}`
      const existing = this.rows.get(key)
      // ★ tombstone 规则：已删且无 undeleteIntent → 忽略（删除不被复活）
      if (existing !== undefined && existing.deletedAt !== null && c.undeleteIntent !== true) {
        ignored.push({ queueId: c.queueId ?? `${c.entity}:${c.entityId}`, entity: c.entity, entityId: c.entityId, reason: 'tombstoned' })
        return false
      }
      acceptedQueueIds.push(c.queueId ?? `${c.entity}:${c.entityId}`)
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
      return true
    }).length
    // ⭐ 请求已写进云端、响应还没回到客户端的窗口 —— 这才是真正的"飞行中"。
    // 用户在这个窗口里编辑同一实体，产生的 V2 条目必须活下来。
    if (this.onBeforePush !== null) {
      const hook = this.onBeforePush
      this.onBeforePush = null
      await hook()
    }
    return { accepted, acceptedQueueIds, ignored, currentRevision: this.seq }
  }

  pull(after: number): { changes: RemoteChange[]; nextRevision: number; hasMore: boolean } {
    const all = [...this.rows.values()]
      .filter((r) => r.revision > after)
      .sort((a, b) => a.revision - b.revision)
      .map((r) => r.change)
    return { changes: all, nextRevision: all.length === 0 ? after : all[all.length - 1]!.revision, hasMore: false }
  }

  get recordCount(): number {
    return this.rows.size
  }

  /** 某设备当前的记录（用于断言收敛） */
  get changeOf(): (key: string) => RemoteChange | undefined {
    return (key: string) => this.rows.get(key)?.change
  }

  /** 直接读某条记录的 payload 字段（避免泛型断言噪音） */
  payloadOf(key: string): unknown {
    return this.rows.get(key)?.change.payload
  }
}

let cloud: FakeCloud
let deviceSeq = 0

/** 造一台"设备"：独立的引擎 + 可控网络 */
function makeDevice(opts: { online?: boolean } = {}): { engine: SyncEngine; host: SyncEngineHost } {
  const state = {
    online: opts.online ?? true,
    deviceId: `dev-${++deviceSeq}`,
    secret: SECRET,
  }
  const host: SyncEngineHost = {
    isOnline: () => state.online,
    now: () => 1_000_000,
    async fetch(url, init) {
      if (!state.online) return { status: 0, text: async () => '' }
      cloud.calls.push(`${init.method} ${url.split('?')[0]}`)

      // 模拟 Worker 的四个端点
      if (url.endsWith('/api/sync/status')) {
        return { status: 200, text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, currentRevision: 0, recordCount: cloud.recordCount }) }
      }
      if (url.endsWith('/api/sync/push')) {
        const body = JSON.parse(init.body ?? '{}') as {
          deviceId: string
          changes: Parameters<FakeCloud['push']>[1]
        }
        const r = await cloud.push(state.deviceId, body.changes)
        return {
          status: 200,
          text: async () =>
            // acceptedQueueIds 与 dedupDirectives 必须回传：客户端靠它们精确出队 / 去重
            JSON.stringify({
              protocolVersion: SYNC_PROTOCOL_VERSION,
              ...r,
              dedupDirectives: [],
              authoritativeChanges: [],
              conflicts: [],
            }),
        }
      }
      if (url.includes('/api/sync/pull')) {
        const after = Number(new URL(url).searchParams.get('after') ?? '0')
        const r = cloud.pull(after)
        return { status: 200, text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, ...r }) }
      }
      return { status: 404, text: async () => '' }
    },
  }
  const engine = new SyncEngine(host, { baseUrl: BASE })
  return { engine, host }
}

/** 把一台设备"配对好"（启用同步） */
async function pairDevice(deviceId: string): Promise<void> {
  await syncRepository.setState({ enabled: true, secret: SECRET, deviceId })
}

/** 清库并重置假云端 + 设备序号 */
beforeEach(async () => {
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
  deviceSeq = 0
})

/* ---------------------------------------------------------------------- */

describe('未启用同步时', () => {
  it('run() 直接空转，不发任何请求', async () => {
    const { engine } = makeDevice()
    const r = await engine.run()
    expect(r.ok).toBe(false)
    expect(cloud.calls).toEqual([])
  })

  it('本地改动照常累积到 outbox（关掉同步不丢数据）', async () => {
    await itemRepository.create(baseInput)
    expect(await syncRepository.pendingCount()).toBe(1)
  })

  it('shouldSync 返回 false', async () => {
    const { engine } = makeDevice()
    expect(await engine.shouldSync('manual', true)).toBe(false)
  })
})

describe('离线时', () => {
  it('run() 不发请求也不丢 outbox', async () => {
    const { engine } = makeDevice({ online: false })
    await pairDevice('dev-x')
    await itemRepository.create(baseInput)

    await engine.run()

    expect(cloud.calls).toEqual([])
    expect(await syncRepository.pendingCount()).toBe(1)
  })
})

describe('A→B 单向推送', () => {
  it('A 新建物品后同步，B 拉取能看到（同一套 Dexie 模拟两台设备）', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-a')

    const item = await itemRepository.create({ ...baseInput, name: 'A 创建的物品' })
    const r = await engine.run()
    expect(r.ok).toBe(true)
    expect(r.pushed).toBeGreaterThan(0)
    expect(cloud.changeOf(`item:${item.id}`)?.payload).toMatchObject({ name: 'A 创建的物品' })
    // outbox 已清空
    expect(await syncRepository.pendingCount()).toBe(0)
  })

  it('分类与标签也一起同步', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-a')

    const cat = await categoryRepository.create('同步分类', null)
    const tag = await tagRepository.create('同步标签')
    await engine.run()

    expect(cloud.changeOf(`category:${cat.id}`)?.payload).toMatchObject({ name: '同步分类' })
    expect(cloud.changeOf(`tag:${tag.id}`)?.payload).toMatchObject({ name: '同步标签' })
  })

  it('标签关联内聚进 item 载荷（itemTags 表本身不上云）', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-a')

    const tag = await tagRepository.create('通勤')
    const item = await itemRepository.create({ ...baseInput, tagIds: [tag.id] })
    await engine.run()

    const payload = cloud.changeOf(`item:${item.id}`)?.payload as { tagIds: string[] }
    expect(payload.tagIds).toEqual([tag.id])
    // 云端只有 item 与 tag 两条记录（种子分类是直接 add 的，未经 repository，故不入 outbox）
    expect(cloud.recordCount).toBe(2)
  })

  it('软删的 deletedAt 一并上云（删除必须可靠传播）', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-a')

    const item = await itemRepository.create(baseInput)
    await itemRepository.softDelete(item.id)
    await engine.run()

    expect(cloud.changeOf(`item:${item.id}`)?.deletedAt).toBeTruthy()
  })
})

describe('apply 远端变更', () => {
  it('远端新增的物品出现在本地', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-b')

    // 先让云端有一台"A 设备"写入的数据
    cloud.push('dev-a', [
      {
        entity: 'item',
        entityId: 'from-a',
        payload: {
          name: '来自 A 的物品',
          categoryId: 'c1',
          note: '推送过来的',
          iconAssetId: 'preset-other',
          sourceType: 'preset',
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
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-02T00:00:00.000Z',
        },
        deletedAt: null,
        clientUpdatedAt: '2026-02-02T00:00:00.000Z',
        baseRevision: 0,
      },
    ])

    await engine.run()

    const item = await db.items.get('from-a')
    expect(item?.name).toBe('来自 A 的物品')
    expect(item?.note).toBe('推送过来的')
  })

  it('远端 tagIds 会重建本地关联', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-b')

    await db.tags.add({
      id: 't-remote',
      name: '远端标签',
      nameNormalized: '远端标签',
      createdAt: 't',
      updatedAt: 't',
    })
    cloud.push('dev-a', [
      {
        entity: 'item',
        entityId: 'item-with-tag',
        payload: {
          name: '带标签的物品',
          categoryId: 'c1',
          note: '',
          iconAssetId: 'preset-other',
          sourceType: 'preset',
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
          createdAt: 't',
          updatedAt: 't',
          tagIds: ['t-remote'],
        },
        deletedAt: null,
        clientUpdatedAt: 't',
        baseRevision: 0,
      },
    ])

    await engine.run()

    expect(await itemRepository.tagIdsOf('item-with-tag')).toEqual(['t-remote'])
  })

  it('远端删除的物品在本地也标记为已删（不物理删除）', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-b')

    // 本地先有这个物品
    const item = await itemRepository.create(baseInput)
    await syncRepository.clearQueue()

    // 云端把它删了
    cloud.push('dev-a', [
      {
        entity: 'item',
        entityId: item.id,
        payload: {},
        deletedAt: '2026-03-01T00:00:00.000Z',
        clientUpdatedAt: '2026-03-01T00:00:00.000Z',
        baseRevision: 0,
      },
    ])

    await engine.run()

    const local = await db.items.get(item.id)
    expect(local).toBeDefined() // 数据仍在
    expect(local?.deletedAt).toBe('2026-03-01T00:00:00.000Z') // 但被标记删除
  })

  it('★ 纯删除（payload 为空）也必须传播 —— 删除独立于 payload', async () => {
    // 回归测试：曾出现"解不出 payload 就 return"的实现，
    // 导致远端只发来一条删除标记时被整条跳过 → 本机物品永远留着，
    // "删除不被复活"这条不变量就出现了漏洞。
    const { engine } = makeDevice()
    await pairDevice('dev-b')

    const item = await itemRepository.create(baseInput)
    await syncRepository.clearQueue()

    cloud.push('dev-a', [
      {
        entity: 'item',
        entityId: item.id,
        payload: {}, // ← payload 为空，只有删除标记
        deletedAt: '2026-03-01T00:00:00.000Z',
        clientUpdatedAt: '2026-03-01T00:00:00.000Z',
        baseRevision: 0,
      },
    ])

    await engine.run()

    expect((await db.items.get(item.id))?.deletedAt).toBe('2026-03-01T00:00:00.000Z')
  })

  it('远端已删而本地完全没有该记录 → 不凭空造出僵尸数据', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-b')

    cloud.push('dev-a', [
      {
        entity: 'item',
        entityId: 'never-existed',
        payload: { name: '幽灵', categoryId: 'c1', iconAssetId: 'preset-other', createdAt: 't', updatedAt: 't' },
        deletedAt: '2026-03-01T00:00:00.000Z',
        clientUpdatedAt: 't',
        baseRevision: 0,
      },
    ])

    await engine.run()

    expect(await db.items.get('never-existed')).toBeUndefined()
  })

  it('分类的纯删除同样传播', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-b')

    const cat = await categoryRepository.create('将被删的分类', null)
    await syncRepository.clearQueue()
    cloud.push('dev-a', [
      {
        entity: 'category',
        entityId: cat.id,
        payload: {},
        deletedAt: '2026-03-01T00:00:00.000Z',
        clientUpdatedAt: 't',
        baseRevision: 0,
      },
    ])

    await engine.run()

    expect((await db.categories.get(cat.id))?.deletedAt).toBe('2026-03-01T00:00:00.000Z')
  })

  it('脏载荷被静默丢弃，不让整批失败', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-b')

    cloud.push('dev-a', [
      { entity: 'item', entityId: 'bad-1', payload: { name: '' }, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
      { entity: 'item', entityId: 'not-json', payload: { name: '' }, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
      {
        entity: 'item',
        entityId: 'good',
        payload: { name: '好的', categoryId: 'c1', iconAssetId: 'preset-other', createdAt: 't', updatedAt: 't' },
        deletedAt: null,
        clientUpdatedAt: 't',
        baseRevision: 0,
      },
    ])

    const r = await engine.run()

    expect(r.ok).toBe(true)
    expect(await db.items.get('bad-1')).toBeUndefined()
    expect(await db.items.get('good')).toBeDefined()
  })
})

describe('F03 分类冲突收敛', () => {
  it('服务端拒绝成环移动后，客户端精确出队并应用权威分类快照', async () => {
    const a = await categoryRepository.create('A', null)
    const b = await categoryRepository.create('B', null)
    await syncRepository.clearQueue()
    await categoryRepository.move(a.id, b.id)
    await syncRepository.setState({ enabled: true, deviceId: 'dev-category', secret: SECRET, keyId: 'key-category', lastPulledRevision: 0 })

    const host: SyncEngineHost = {
      isOnline: () => true,
      now: () => 1_000_000,
      async fetch(url, init) {
        if (url.includes('/api/sync/push')) {
          const body = JSON.parse(init.body ?? '{}') as { changes: Array<{ queueId: string }> }
          const queueId = body.changes[0]!.queueId
          return {
            status: 200,
            text: async () =>
              JSON.stringify({
                protocolVersion: SYNC_PROTOCOL_VERSION,
                accepted: 0,
                acceptedQueueIds: [],
                ignored: [{ queueId, entity: 'category', entityId: a.id, reason: 'category-cycle' }],
                dedupDirectives: [],
                authoritativeChanges: [{
                  revision: 1,
                  entity: 'category',
                  entityId: a.id,
                  payload: { ...a, parentId: null },
                  deletedAt: null,
                  clientUpdatedAt: a.updatedAt,
                  deviceId: 'remote-device',
                }],
                conflicts: [],
                currentRevision: 1,
              }),
          }
        }
        const after = Number(new URL(url).searchParams.get('after') ?? '0')
        return {
          status: 200,
          text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, changes: [], nextRevision: after, hasMore: false }),
        }
      },
    }

    const result = await new SyncEngine(host, { baseUrl: BASE }).run()
    expect(result).toMatchObject({ ok: true, pushed: 0, conflicts: 1 })
    expect(await syncRepository.pendingCount()).toBe(0)
    expect((await db.categories.get(a.id))?.parentId).toBeNull()
    expect((await syncRepository.listConflicts(1))[0]?.reason).toBe('category-cycle')
    expect((await db.categories.get(b.id))?.name).toBe('B')
  })

  it('同批次新分类形成环时，权威 tombstone 能解除本地环并清空两个队列', async () => {
    const a = await categoryRepository.create('A', null)
    const b = await categoryRepository.create('B', null)
    await syncRepository.clearQueue()
    await db.categories.update(a.id, { parentId: b.id })
    await db.categories.update(b.id, { parentId: a.id })
    await syncRepository.enqueue('category', a.id)
    await syncRepository.enqueue('category', b.id)
    await syncRepository.setState({ enabled: true, deviceId: 'dev-category', secret: SECRET, keyId: 'key-category', lastPulledRevision: 0 })

    const host: SyncEngineHost = {
      isOnline: () => true,
      now: () => 1_000_000,
      async fetch(url, init) {
        if (url.includes('/api/sync/push')) {
          const body = JSON.parse(init.body ?? '{}') as {
            changes: Array<{ queueId: string; entityId: string; payload: unknown; clientUpdatedAt: string }>
          }
          return {
            status: 200,
            text: async () => JSON.stringify({
              protocolVersion: SYNC_PROTOCOL_VERSION,
              accepted: 0,
              acceptedQueueIds: [],
              ignored: body.changes.map((change) => ({ queueId: change.queueId, entity: 'category', entityId: change.entityId, reason: 'category-cycle' })),
              dedupDirectives: [],
              authoritativeChanges: body.changes.map((change) => ({
                revision: 0,
                entity: 'category',
                entityId: change.entityId,
                payload: change.payload,
                deletedAt: '2026-03-01T00:00:00.000Z',
                clientUpdatedAt: change.clientUpdatedAt,
                deviceId: 'server',
              })),
              conflicts: [],
              currentRevision: 0,
            }),
          }
        }
        const after = Number(new URL(url).searchParams.get('after') ?? '0')
        return {
          status: 200,
          text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, changes: [], nextRevision: after, hasMore: false }),
        }
      },
    }

    const result = await new SyncEngine(host, { baseUrl: BASE }).run()
    expect(result).toMatchObject({ ok: true, conflicts: 2 })
    expect(await syncRepository.pendingCount()).toBe(0)
    expect((await db.categories.get(a.id))?.deletedAt).toBe('2026-03-01T00:00:00.000Z')
    expect((await db.categories.get(b.id))?.deletedAt).toBe('2026-03-01T00:00:00.000Z')
  })
})

describe('协议失败的本地保护', () => {
  it('非法 dedup 回执不会改动标签或清除 outbox', async () => {
    const duplicate = await tagRepository.create('待合并标签')
    await syncRepository.setState({ enabled: true, deviceId: 'dev-dedup', secret: SECRET, keyId: 'key-dedup', lastPulledRevision: 0 })
    const queue = await syncRepository.listQueue()
    const tagQueue = queue.find((entry) => entry.entity === 'tag' && entry.entityId === duplicate.id)
    expect(tagQueue).toBeDefined()
    if (!tagQueue) return

    const host: SyncEngineHost = {
      isOnline: () => true,
      now: () => 1_000_000,
      async fetch(url) {
        if (url.includes('/api/sync/push')) {
          return {
            status: 200,
            text: async () => JSON.stringify({
              protocolVersion: SYNC_PROTOCOL_VERSION,
              accepted: 0,
              acceptedQueueIds: [],
              ignored: [],
              dedupDirectives: [{ kind: 'merge-tag-into', queueId: tagQueue.id, duplicateId: 'wrong-tag', canonicalId: 'canonical-tag' }],
              authoritativeChanges: [],
              conflicts: [],
              currentRevision: 0,
            }),
          }
        }
        const after = Number(new URL(url).searchParams.get('after') ?? '0')
        return {
          status: 200,
          text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, changes: [], nextRevision: after, hasMore: false }),
        }
      },
    }

    const result = await new SyncEngine(host, { baseUrl: BASE }).run()
    expect(result).toMatchObject({ ok: false, errorKind: 'protocol' })
    expect(await db.tags.get(duplicate.id)).toEqual(duplicate)
    expect((await syncRepository.listQueue()).map((entry) => entry.id)).toContain(tagQueue.id)
  })
})

describe('回声防护（最重要的一条）', () => {
  it('apply 远端变更后，该实体不再留在 outbox 里（否则会被推回去形成回环）', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-b')

    // 本地有一个待推条目
    await syncRepository.enqueue('item', 'echo-test')
    expect(await syncRepository.pendingCount()).toBe(1)

    cloud.push('dev-a', [
      {
        entity: 'item',
        entityId: 'echo-test',
        payload: { name: '远端版本', categoryId: 'c1', iconAssetId: 'preset-other', createdAt: 't', updatedAt: 't' },
        deletedAt: null,
        clientUpdatedAt: 't',
        baseRevision: 0,
      },
    ])

    await engine.run()

    // 关键断言：这个实体已从 outbox 消失
    const left = await syncRepository.listQueue()
    expect(left.find((r) => r.entityId === 'echo-test')).toBeUndefined()
  })

  it('apply 后游标推进到最大 revision（不会重复拉取）', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-b')
    cloud.push('dev-a', [
      { entity: 'item', entityId: 'x1', payload: { name: 'A', categoryId: 'c1', iconAssetId: 'preset-other', createdAt: 't', updatedAt: 't' }, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
      { entity: 'item', entityId: 'x2', payload: { name: 'B', categoryId: 'c1', iconAssetId: 'preset-other', createdAt: 't', updatedAt: 't' }, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
    ])
    await engine.run()

    const afterFirst = (await syncRepository.getState())?.lastPulledRevision ?? 0
    expect(afterFirst).toBe(2)

    // 第二次同步不应再拉同样的数据
    const pulledSecond = await engine.run()
    expect(pulledSecond.pulled).toBe(0)
    expect((await syncRepository.getState())?.lastPulledRevision).toBe(2)
  })
})

describe('⭐ tag 删除跨设备同步（复审第 5 条）', () => {
  it('A 建 tag → B 拉到 → A 删 tag → B 再拉到 → tag 消失', async () => {
    // B 设备（拉取方）
    const { engine: engineB } = makeDevice()
    await pairDevice('dev-b')

    // 云端先有A 创建的 tag
    cloud.push('dev-a', [
      {
        entity: 'tag',
        entityId: 'tag-from-a',
        payload: { name: '通勤', nameNormalized: '通勤', createdAt: 't', updatedAt: 't' },
        deletedAt: null,
        clientUpdatedAt: 't',
        baseRevision: 0,
      },
    ])
    await engineB.run()
    expect(await db.tags.get('tag-from-a')).toBeDefined()

    // A 设备删除该 tag（物理删除 → 留下 delete 条目）
    // ⚠️ 同一个 Dexie 里该 tag 已被上一轮 pull 写入，直接 add 会撞主键
    const { engine: engineA } = makeDevice()
    await pairDevice('dev-a')
    await db.tags.put({
      id: 'tag-from-a',
      name: '通勤',
      nameNormalized: '通勤',
      createdAt: 't',
      updatedAt: 't',
    })
    await syncRepository.clearQueue()
    await tagRepository.delete('tag-from-a')

    // A 把删除推上云
    await engineA.run()
    const onCloud = cloud.changeOf('tag:tag-from-a')
    expect(onCloud?.deletedAt).toBeTruthy()

    // B 再拉 → tag 消失
    await syncRepository.setState({ lastPulledRevision: 0 })
    await engineB.run()
    expect(await db.tags.get('tag-from-a')).toBeUndefined()
  })

  it('★ B 的旧副本不得复活已删除的 tag', async () => {
    const { engine: engineB } = makeDevice()
    await pairDevice('dev-b')

    // 云端：该 tag 已被 A 删除
    cloud.push('dev-a', [
      {
        entity: 'tag',
        entityId: 'doomed-tag',
        payload: {},
        deletedAt: '2026-03-01T00:00:00.000Z',
        clientUpdatedAt: '2026-03-01T00:00:00.000Z',
        baseRevision: 0,
      },
    ])

    // B 本地还留着旧副本
    await db.tags.add({
      id: 'doomed-tag',
      name: '已删',
      nameNormalized: '已删',
      createdAt: 't',
      updatedAt: 't',
    })

    await engineB.run()
    expect(await db.tags.get('doomed-tag')).toBeUndefined()
  })

  it('删除 tag 会连带清掉引用它的关联', async () => {
    const { engine: engineB } = makeDevice()
    await pairDevice('dev-b')

    await db.itemTags.clear()
    await db.tags.put({
      id: 'tag-x',
      name: 'X',
      nameNormalized: 'x',
      createdAt: 't',
      updatedAt: 't',
    })
    const item = await itemRepository.create({ ...baseInput, tagIds: ['tag-x'] })
    expect(await itemRepository.tagIdsOf(item.id)).toEqual(['tag-x'])

    // 先把本机状态正常推上云（清空 outbox、推进游标），
    // 这样后面 pull 回来的就只有"云端删除 tag"这一件事，不会混进旧载荷。
    const first = await engineB.run()
    expect(first.ok).toBe(true)
    expect(await syncRepository.pendingCount()).toBe(0)

    cloud.push('dev-a', [
      {
        entity: 'tag',
        entityId: 'tag-x',
        payload: {},
        deletedAt: '2026-03-01T00:00:00.000Z',
        clientUpdatedAt: 't',
        baseRevision: 0,
      },
    ])
    await engineB.run()

    // tag 消失，且引用它的关联也被清掉
    expect(await db.tags.get('tag-x')).toBeUndefined()
    expect(await itemRepository.tagIdsOf(item.id)).toEqual([])
  })

  it('merge 的 source tag 在另一台设备消失', async () => {
    const { engine: engineB } = makeDevice()
    await pairDevice('dev-b')

    // 云端：source 与 target 两个 tag
    cloud.push('dev-a', [
      { entity: 'tag', entityId: 'src', payload: { name: '旧', nameNormalized: '旧', createdAt: 't', updatedAt: 't' }, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
      { entity: 'tag', entityId: 'dst', payload: { name: '新', nameNormalized: '新', createdAt: 't', updatedAt: 't' }, deletedAt: null, clientUpdatedAt: 't', baseRevision: 0 },
    ])
    await engineB.run()
    expect(await db.tags.get('src')).toBeDefined()

    // A 执行 merge → source 留删除条目
    const { engine: engineA } = makeDevice()
    await pairDevice('dev-a')
    await db.tags.put({ id: 'src', name: '旧', nameNormalized: '旧', createdAt: 't', updatedAt: 't' })
    await db.tags.put({ id: 'dst', name: '新', nameNormalized: '新', createdAt: 't', updatedAt: 't' })
    await syncRepository.clearQueue()
    await tagRepository.merge('src', 'dst')
    await engineA.run()

    await syncRepository.setState({ lastPulledRevision: 0 })
    await engineB.run()
    expect(await db.tags.get('src')).toBeUndefined()
    expect(await db.tags.get('dst')).toBeDefined()
  })
})

describe('⭐ push 失败 / 竞态时绝不动本地数据（复审第 6 条 · Local-first 硬不变量）', () => {
  it('★ push 失败时停止 pull，本地修改不被远端旧值覆盖、outbox 原样保留', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-a')

    // 本地有待推改动 V1
    const item = await itemRepository.create({ ...baseInput, name: '我的本地修改' })
    expect(await syncRepository.pendingCount()).toBe(1)

    // 云端存在同名记录，但内容是**旧值**
    cloud.push('dev-b', [
      {
        entity: 'item',
        entityId: item.id,
        payload: { name: '云端旧值', categoryId: 'c1', iconAssetId: 'preset-other', createdAt: 't', updatedAt: 't' },
        deletedAt: null,
        clientUpdatedAt: 't',
        baseRevision: 0,
      },
    ])

    // 让 push 失败
    cloud.failNextPush = true
    const r = await engine.run()

    expect(r.ok).toBe(false)
    // 本地修改**完好无损**
    expect((await db.items.get(item.id))?.name).toBe('我的本地修改')
    // outbox **未被清空**
    expect(await syncRepository.pendingCount()).toBe(1)
    // 游标未推进（本轮根本没pull）
    expect((await syncRepository.getState())?.lastPulledRevision).toBe(0)
  })

  it('★ 同步期间用户再次编辑同一实体 → 新 outbox 必须保留（V1/V2 race）', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-a')

    const item = await itemRepository.create({ ...baseInput, name: 'V1' })
    const v1Entry = (await syncRepository.listQueue()).find((r) => r.entityId === item.id)
    expect(v1Entry).toBeDefined()

    // 在 push 飞行途中，用户又改了同一实体（V2）→ outbox 里产生**新条目**
    cloud.onBeforePush = async () => {
      await itemRepository.update(item.id, { ...baseInput, name: 'V2' })
      const after = await db.items.get(item.id)
      console.log('[钩子] 更新后本地 name =', after?.name, '| outbox =', (await syncRepository.listQueue()).map(r => r.id.slice(-6)).join(','))
    }

    await engine.run()

    // ⭐ 关键断言：V1 出队了，但 V2 的条目**必须还在** outbox 里等下一轮。
    //   若被清掉，V2 就永远不会同步上去 —— 这正是复审第 6 条要防的。
    const still = await syncRepository.listQueue()
    expect(still).toHaveLength(1)
    expect(still[0].entityId).toBe(item.id)
    // 新条目的 id 与 V1 不同（说明确实是新条目，不是旧的残留）
    expect(still[0].id).not.toBe(v1Entry?.id)

    // 下一轮：V2 成功同步
    const second = await engine.run()
    expect(second.ok).toBe(true)
    expect(await syncRepository.pendingCount()).toBe(0)
    // 云端最终应是 V2（第二轮才推上去的）
    const final = cloud.payloadOf(`item:${item.id}`) as { name?: string } | undefined
    expect(final?.name).toBe('V2')
  })

  it('push 失败后下一轮成功：outbox 全部清空且数据最终一致', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-a')

    await itemRepository.create({ ...baseInput, name: '先失败再成功' })
    cloud.failNextPush = true
    const first = await engine.run()
    expect(first.ok).toBe(false)
    expect(await syncRepository.pendingCount()).toBe(1)

    const second = await engine.run()
    expect(second.ok).toBe(true)
    expect(await syncRepository.pendingCount()).toBe(0)
  })
})

describe('状态摘要', () => {
  it('未启用 → disabled', async () => {
    const { engine } = makeDevice()
    expect((await engine.summary(true)).kind).toBe('disabled')
  })

  it('离线且有积压 → offline 并带条数', async () => {
    const { engine } = makeDevice({ online: false })
    await pairDevice('dev-x')
    await itemRepository.create(baseInput)
    const s = await engine.summary(false)
    expect(s.kind).toBe('offline')
    if (s.kind === 'offline') expect(s.pendingCount).toBeGreaterThan(0)
  })

  it('同步成功后 → synced 且带时间', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-a')
    await engine.run()
    const s = await engine.summary(true)
    expect(s.kind).toBe('synced')
  })

  it('statusMessage 返回可读中文', async () => {
    const { engine } = makeDevice()
    await pairDevice('dev-a')
    await engine.run()
    expect(await engine.statusMessage(true)).toContain('已同步')
  })
})
