import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { itemRepository } from '../../db/repositories/itemRepository'
import { syncRepository } from '../../db/repositories/syncRepository'
import { encodeItemPayload } from '../../domain/syncPayload'
import type { BackupPayload } from '../../domain/backup'
import type { Category, Item, SyncState } from '../../domain/types'
import { restoreFromPayload } from '../../services/backupService'
import { commitJoin } from '../../services/syncService'
import { SyncEngine, type SyncEngineHost } from './syncEngine'
import type { RemoteChange } from './syncTransport'

const OLD_SECRET = 'old-secret-012345678901234567890123456789'
const NEW_SECRET = 'new-secret-012345678901234567890123456789'

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function makeCategory(id = 'c1'): Category {
  return {
    id,
    parentId: null,
    name: '分类',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

function makeItem(id: string, name: string): Item {
  return {
    id,
    name,
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

function makePayload(item: Item): BackupPayload {
  return {
    items: [item],
    categories: [makeCategory()],
    tags: [],
    itemTags: [],
    assets: [],
    appMeta: {},
  }
}

function makeRemoteChange(item: Item, revision = 1): RemoteChange {
  return {
    revision,
    entity: 'item',
    entityId: item.id,
    payload: encodeItemPayload(item, []),
    deletedAt: null,
    clientUpdatedAt: item.updatedAt,
    deviceId: 'remote-device',
  }
}

/** The network call opens the gate and then waits for release. */
function makeNetworkGate(): {
  started: Promise<void>
  open(): void
  release(): void
  wait(): Promise<void>
} {
  const started = deferred<void>()
  const released = deferred<void>()
  return {
    started: started.promise,
    open: () => started.resolve(),
    release: () => released.resolve(),
    wait: () => released.promise,
  }
}

function makeControlledHost(options: {
  pull?: { change?: RemoteChange; gate: ReturnType<typeof makeNetworkGate> }
  push?: { gate: ReturnType<typeof makeNetworkGate> }
} = {}): SyncEngineHost {
  return {
    isOnline: () => true,
    now: () => 1_000_000,
    async fetch(url) {
      if (url.includes('/api/sync/push')) {
        options.push?.gate.open()
        await options.push?.gate.wait()
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              accepted: 1,
              acceptedIds: [],
              ignored: [],
              dedupDirectives: [],
              conflicts: [],
              currentRevision: 1,
            }),
        }
      }
      if (url.includes('/api/sync/pull')) {
        options.pull?.gate.open()
        await options.pull?.gate.wait()
        const change = options.pull?.change
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              changes: change ? [change] : [],
              nextRevision: change?.revision ?? 0,
              hasMore: false,
            }),
        }
      }
      return { status: 404, text: async () => '' }
    },
  }
}

async function clearDatabase(): Promise<void> {
  await Promise.all([
    db.items.clear(),
    db.categories.clear(),
    db.tags.clear(),
    db.itemTags.clear(),
    db.assets.clear(),
    db.appMeta.clear(),
    db.syncState.clear(),
    db.syncQueue.clear(),
    db.syncConflicts.clear(),
  ])
}

async function activateOldSession(): Promise<void> {
  await syncRepository.setState({
    enabled: true,
    deviceId: 'old-device',
    secret: OLD_SECRET,
    keyId: 'old-key',
    lastPulledRevision: 0,
    lastSyncAt: null,
  })
}

beforeEach(clearDatabase)

describe('F01 持久化同步会话代次', () => {
  it('延迟 pull 在恢复后返回时不能覆盖恢复数据或推进新状态', async () => {
    const oldItem = makeItem('restored-item', 'remote-old')
    await db.items.add(makeItem(oldItem.id, 'before-restore'))
    await activateOldSession()
    const beforeEpoch = (await syncRepository.getState())!.sessionEpoch

    const gate = makeNetworkGate()
    const engine = new SyncEngine(
      makeControlledHost({ pull: { change: makeRemoteChange(oldItem), gate } }),
      { baseUrl: 'https://example.test' },
    )
    const running = engine.run()
    await gate.started

    await restoreFromPayload(makePayload(makeItem(oldItem.id, 'restored-new')))
    gate.release()
    await running

    expect((await db.items.get(oldItem.id))?.name).toBe('restored-new')
    const state = await syncRepository.getState()
    expect(state?.enabled).toBe(false)
    expect(state?.lastPulledRevision).toBe(0)
    expect(state?.sessionEpoch).toBeGreaterThan(beforeEpoch)
  })

  it('延迟 pull 在重新配对后返回时不能写入新会话或推进新游标', async () => {
    const oldItem = makeItem('join-item', 'remote-old')
    await db.items.add(makeItem(oldItem.id, 'before-join'))
    await activateOldSession()

    const gate = makeNetworkGate()
    const engine = new SyncEngine(
      makeControlledHost({ pull: { change: makeRemoteChange(oldItem), gate } }),
      { baseUrl: 'https://example.test' },
    )
    const running = engine.run()
    await gate.started

    await commitJoin({ v: 1, secret: NEW_SECRET, keyId: 'new-key' }, 'cloud')
    gate.release()
    await running

    expect(await db.items.get(oldItem.id)).toBeUndefined()
    const state = await syncRepository.getState()
    expect(state?.secret).toBe(NEW_SECRET)
    expect(state?.lastPulledRevision).toBe(0)
  })

  it('延迟 push 在恢复并重新配对后返回时不能清除新 outbox 或写新状态', async () => {
    await db.items.add(makeItem('old-item', 'old-session'))
    await activateOldSession()
    await syncRepository.enqueue('item', 'old-item')

    const gate = makeNetworkGate()
    const engine = new SyncEngine(
      makeControlledHost({ push: { gate } }),
      { baseUrl: 'https://example.test' },
    )
    const running = engine.run()
    await gate.started

    await restoreFromPayload(makePayload(makeItem('new-item', 'restored-data')))
    await commitJoin({ v: 1, secret: NEW_SECRET, keyId: 'new-key' }, 'local')

    gate.release()
    await running

    expect((await db.items.get('new-item'))?.name).toBe('restored-data')
    const queueIds = (await syncRepository.listQueue()).map((entry) => entry.entityId)
    expect(queueIds).toContain('new-item')
    expect(queueIds).not.toContain('old-item')
    expect((await syncRepository.getState())?.lastSyncAt).toBeNull()
  })

  it('两个共享 IndexedDB 的引擎在会话失效后都不能写入旧响应', async () => {
    const oldItem = makeItem('multi-engine-item', 'remote-old')
    await db.items.add(makeItem(oldItem.id, 'before-restore'))
    await activateOldSession()

    const gateA = makeNetworkGate()
    const gateB = makeNetworkGate()
    const engineA = new SyncEngine(
      makeControlledHost({ pull: { change: makeRemoteChange(oldItem), gate: gateA } }),
      { baseUrl: 'https://example.test' },
    )
    const engineB = new SyncEngine(
      makeControlledHost({ pull: { change: makeRemoteChange(oldItem), gate: gateB } }),
      { baseUrl: 'https://example.test' },
    )
    const runningA = engineA.run()
    const runningB = engineB.run()
    await Promise.all([gateA.started, gateB.started])

    await restoreFromPayload(makePayload(makeItem(oldItem.id, 'restored-new')))
    gateA.release()
    gateB.release()
    await Promise.all([runningA, runningB])

    expect((await db.items.get(oldItem.id))?.name).toBe('restored-new')
    expect((await syncRepository.getState())?.lastPulledRevision).toBe(0)
  })

  it('网络 pull 挂起时普通本地保存仍立即完成', async () => {
    await activateOldSession()
    const gate = makeNetworkGate()
    const engine = new SyncEngine(
      makeControlledHost({ pull: { gate } }),
      { baseUrl: 'https://example.test' },
    )
    const running = engine.run()
    await gate.started

    const item = await itemRepository.create({
      ...makeItem('local-save', 'local-save'),
      tagIds: [],
    })
    expect(item.name).toBe('local-save')
    expect(await syncRepository.pendingCount()).toBe(1)

    gate.release()
    await running
  })

  it('恢复事务中途失败时业务表、outbox 和旧同步状态一起保留', async () => {
    const oldItem = makeItem('atomic-item', 'old-data')
    await db.items.add(oldItem)
    await activateOldSession()
    await syncRepository.enqueue('item', oldItem.id)
    const before = await syncRepository.getState()

    const fail = () => {
      throw new Error('injected sync-state write failure')
    }
    db.syncState.hook('creating', fail)
    db.syncState.hook('updating', fail)
    try {
      await expect(
        restoreFromPayload(makePayload(makeItem('atomic-item', 'new-data'))),
      ).rejects.toThrow('injected sync-state write failure')
    } finally {
      db.syncState.hook('creating').unsubscribe(fail)
      db.syncState.hook('updating').unsubscribe(fail)
    }

    expect((await db.items.get(oldItem.id))?.name).toBe('old-data')
    expect((await syncRepository.listQueue()).map((entry) => entry.entityId)).toEqual([oldItem.id])
    expect(await syncRepository.getState()).toEqual(before)
  })

  it('旧版缺少 sessionEpoch 时按 0 读取，并在关闭/重配对时单调递增', async () => {
    const legacy = {
      key: 'sync',
      deviceId: 'legacy-device',
      enabled: true,
      keyId: 'legacy-key',
      secret: OLD_SECRET,
      lastPulledRevision: 7,
      lastSyncAt: null,
      lastError: null,
      pendingCount: 0,
    }
    await db.syncState.put(legacy as unknown as SyncState)

    expect((await syncRepository.getState())?.sessionEpoch).toBe(0)
    await syncRepository.disable()
    const afterDisable = await syncRepository.getState()
    expect(afterDisable?.sessionEpoch).toBeGreaterThan(0)

    await syncRepository.disable()
    const afterSecondDisable = await syncRepository.getState()
    expect(afterSecondDisable?.sessionEpoch).toBeGreaterThan(afterDisable!.sessionEpoch)

    await commitJoin({ v: 1, secret: NEW_SECRET, keyId: 'new-key' }, 'local')
    const afterJoin = await syncRepository.getState()
    expect(afterJoin?.sessionEpoch).toBeGreaterThan(afterSecondDisable!.sessionEpoch)
  })

  it('保留已有 V1/V2 飞行中编辑保护的测试入口', async () => {
    const item = await itemRepository.create({
      ...makeItem('v1-v2', 'V1'),
      tagIds: [],
    })
    const first = (await syncRepository.listQueue())[0]
    expect(first?.entityId).toBe(item.id)
    await itemRepository.update(item.id, { ...makeItem(item.id, 'V2'), tagIds: [] })
    const queue = await syncRepository.listQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0]?.id).not.toBe(first?.id)
    expect((await db.items.get(item.id))?.name).toBe('V2')
  })
})
