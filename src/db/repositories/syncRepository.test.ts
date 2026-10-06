import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { SYNC_CONFLICT_LIMIT, syncRepository } from './syncRepository'

/**
 * syncRepository 的集成测试（fake-indexeddb）。
 *
 * 重点验证：
 * - outbox 的幂等入队（同一实体只留 1 条）
 * - 回声防护（clearEntity）
 * - 「同步默认关闭」的判断依据（getState 为 null）
 * - 冲突记录的 50 条生命周期上限
 */

beforeEach(async () => {
  await Promise.all([
    db.syncState.clear(),
    db.syncQueue.clear(),
    db.syncConflicts.clear(),
  ])
})

describe('syncState', () => {
  it('从未启用过时getState 返回 null（=同步关闭的判断依据）', async () => {
    expect(await syncRepository.getState()).toBeNull()
  })

  it('未配好凭据时 isActive 为假', async () => {
    expect(await syncRepository.isActive()).toBe(false)
    await syncRepository.setState({ enabled: true, secret: null })
    expect(await syncRepository.isActive()).toBe(false)
  })

  it('已启用且有 secret 时 isActive 为真', async () => {
    await syncRepository.setState({ enabled: true, secret: 's3cret' })
    expect(await syncRepository.isActive()).toBe(true)
  })

  it('setState 只改指定字段，其余保留', async () => {
    await syncRepository.setState({ enabled: true, secret: 's3cret', keyId: 'k1' })
    const s = await syncRepository.setState({ lastSyncAt: '2026-10-06T00:00:00.000Z' })
    expect(s.enabled).toBe(true)
    expect(s.secret).toBe('s3cret')
    expect(s.keyId).toBe('k1')
    expect(s.lastSyncAt).toBe('2026-10-06T00:00:00.000Z')
  })

  it('initCredentials 生成 deviceId 并写入凭据，但不擅自启用', async () => {
    const s = await syncRepository.initCredentials('topsecret', 'key-1')
    expect(s.deviceId).toBeTruthy()
    expect(s.secret).toBe('topsecret')
    expect(s.keyId).toBe('key-1')
    expect(s.enabled).toBe(false) // 由调用方决定（配对 A 端要等对方确认）
  })

  it('markSynced 只推进游标，不会把游标推回去', async () => {
    await syncRepository.setState({ enabled: true, secret: 's' })
    await syncRepository.markSynced(10)
    await syncRepository.markSynced(25)
    expect((await syncRepository.getState())?.lastPulledRevision).toBe(25)
    // 较旧的 revision 不应覆盖较新的
    await syncRepository.markSynced(5)
    expect((await syncRepository.getState())?.lastPulledRevision).toBe(25)
  })

  it('markSynced 清除上次错误', async () => {
    await syncRepository.setState({ enabled: true, secret: 's' })
    await syncRepository.markError('炸了')
    await syncRepository.markSynced(1)
    expect((await syncRepository.getState())?.lastError).toBeNull()
  })

  it('disable 清凭据与游标，但保留 outbox（关掉同步不该丢用户数据）', async () => {
    await syncRepository.setState({ enabled: true, secret: 's', keyId: 'k', lastPulledRevision: 9 })
    await syncRepository.enqueue('item', 'i1')

    await syncRepository.disable()

    const s = await syncRepository.getState()
    expect(s?.enabled).toBe(false)
    expect(s?.secret).toBeNull()
    expect(s?.keyId).toBeNull()
    expect(s?.lastPulledRevision).toBe(0)
    // 待推条目仍在 —— 用户数据一条都没丢
    expect(await syncRepository.pendingCount()).toBe(1)
  })
})

describe('outbox', () => {
  it('入队后可读出', async () => {
    await syncRepository.enqueue('item', 'i1')
    const list = await syncRepository.listQueue()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ entity: 'item', entityId: 'i1' })
  })

  it('同一实体重复入队只留一条（幂等）', async () => {
    await syncRepository.enqueue('item', 'i1')
    await syncRepository.enqueue('item', 'i1')
    await syncRepository.enqueue('item', 'i1')
    expect(await syncRepository.pendingCount()).toBe(1)
  })

  it('不同实体的条目互不干扰', async () => {
    await syncRepository.enqueue('item', 'i1')
    await syncRepository.enqueue('category', 'c1')
    await syncRepository.enqueue('tag', 't1')
    expect(await syncRepository.pendingCount()).toBe(3)
  })

  it('不同实体类型用同一 id 不冲突', async () => {
    await syncRepository.enqueue('item', 'same-id')
    await syncRepository.enqueue('category', 'same-id')
    expect(await syncRepository.pendingCount()).toBe(2)
  })

  it('listQueue 按入队时间从旧到新（变更按时间序上云）', async () => {
    await syncRepository.enqueue('item', 'first')
    await new Promise((r) => setTimeout(r, 5))
    await syncRepository.enqueue('item', 'second')
    const list = await syncRepository.listQueue()
    expect(list.map((r) => r.entityId)).toEqual(['first', 'second'])
  })

  it('dequeue 按 id 删除已推送条目', async () => {
    await syncRepository.enqueue('item', 'i1')
    await syncRepository.enqueue('item', 'i2')
    const [first] = await syncRepository.listQueue()
    await syncRepository.dequeue([first.id])
    const left = await syncRepository.listQueue()
    expect(left).toHaveLength(1)
    expect(left[0].entityId).toBe('i2')
  })

  it('dequeue 传空数组是安全的空操作', async () => {
    await syncRepository.enqueue('item', 'i1')
    await syncRepository.dequeue([])
    expect(await syncRepository.pendingCount()).toBe(1)
  })

  it('clearEntity 清除指定实体条目（回声防护）', async () => {
    await syncRepository.enqueue('item', 'i1')
    await syncRepository.enqueue('item', 'i2')
    await syncRepository.enqueue('tag', 't1')

    await syncRepository.clearEntity('item', 'i1')

    const left = await syncRepository.listQueue()
    expect(left.map((r) => `${r.entity}:${r.entityId}`)).toEqual(['item:i2', 'tag:t1'])
  })

  it('clearEntity 清空后可以重新入队（pull 之后仍能再次推送）', async () => {
    await syncRepository.enqueue('item', 'i1')
    await syncRepository.clearEntity('item', 'i1')
    expect(await syncRepository.pendingCount()).toBe(0)
    await syncRepository.enqueue('item', 'i1')
    expect(await syncRepository.pendingCount()).toBe(1)
  })

  it('clearQueue 清空全部', async () => {
    await syncRepository.enqueue('item', 'i1')
    await syncRepository.enqueue('tag', 't1')
    await syncRepository.clearQueue()
    expect(await syncRepository.pendingCount()).toBe(0)
  })

  it('enqueueAll 把全部业务实体入队', async () => {
    await db.items.add({
      id: 'i1',
      name: 'A',
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
    })
    await db.categories.add({
      id: 'c1',
      parentId: null,
      name: '分类',
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    })
    await db.tags.add({
      id: 't1',
      name: 'X',
      nameNormalized: 'x',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const n = await syncRepository.enqueueAll()
    expect(n).toBe(3)
    expect(await syncRepository.pendingCount()).toBe(3)
  })

  it('enqueueAll 会先清空旧条目，不重复累积', async () => {
    await syncRepository.enqueue('item', 'stale')
    await syncRepository.enqueueAll()
    const list = await syncRepository.listQueue()
    expect(list.map((r) => r.entityId)).not.toContain('stale')
  })
})

describe('冲突记录（生命周期上限 50 条）', () => {
  const base = {
    entity: 'item' as const,
    entityId: 'i1',
    loserUpdatedAt: '2026-01-01T00:00:00.000Z',
    winnerDeviceId: 'dev-b',
    winnerUpdatedAt: '2026-01-02T00:00:00.000Z',
    loserSummary: '旧名称',
    winnerSummary: '新名称',
  }

  it('记录后可读出', async () => {
    await syncRepository.recordConflict({ ...base, detectedAt: '2026-10-06T00:00:00.000Z' })
    expect(await syncRepository.conflictCount()).toBe(1)
    const list = await syncRepository.listConflicts()
    expect(list[0]).toMatchObject({ entityId: 'i1', loserSummary: '旧名称' })
  })

  it('超出 50 条时裁掉最旧的', async () => {
    for (let i = 0; i < SYNC_CONFLICT_LIMIT + 10; i += 1) {
      await syncRepository.recordConflict({
        ...base,
        entityId: `i${i}`,
        detectedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      })
    }
    expect(await syncRepository.conflictCount()).toBe(SYNC_CONFLICT_LIMIT)
    const list = await syncRepository.listConflicts(SYNC_CONFLICT_LIMIT)
    // 最新的那条必须在
    expect(list[0].entityId).toBe(`i${SYNC_CONFLICT_LIMIT + 9}`)
    // 最旧的那条必须已被裁掉
    expect(list.map((r) => r.entityId)).not.toContain('i0')
  })

  it('恰好 50 条不裁剪', async () => {
    for (let i = 0; i < SYNC_CONFLICT_LIMIT; i += 1) {
      await syncRepository.recordConflict({
        ...base,
        entityId: `i${i}`,
        detectedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      })
    }
    expect(await syncRepository.conflictCount()).toBe(SYNC_CONFLICT_LIMIT)
  })

  it('listConflicts 新的在前', async () => {
    await syncRepository.recordConflict({ ...base, detectedAt: '2026-10-05T00:00:00.000Z' })
    await syncRepository.recordConflict({ ...base, detectedAt: '2026-10-06T00:00:00.000Z' })
    const list = await syncRepository.listConflicts()
    expect(list[0].detectedAt).toBe('2026-10-06T00:00:00.000Z')
  })

  it('可单条删除与全部清空', async () => {
    await syncRepository.recordConflict({ ...base, detectedAt: '2026-10-05T00:00:00.000Z' })
    await syncRepository.recordConflict({
      ...base,
      entityId: 'i2',
      detectedAt: '2026-10-06T00:00:00.000Z',
    })
    const [newest] = await syncRepository.listConflicts()
    expect(newest.entityId).toBe('i2')
    await syncRepository.deleteConflict(newest.id)
    expect(await syncRepository.conflictCount()).toBe(1)
    await syncRepository.clearConflicts()
    expect(await syncRepository.conflictCount()).toBe(0)
  })
})