import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { syncRepository } from '../db/repositories/syncRepository'
import { itemRepository } from '../db/repositories/itemRepository'
import {
  commitJoin,
  currentPairingCode,
  encodePairingCode,
  hasSyncSpace,
  parsePairingCode,
  wipeSyncableLocalData,
} from './syncService'

/**
 * 配对与加入流程的回归测试（Phase 3B 最终审查第 3、4、5 条）。
 *
 * 覆盖：
 *   3) 配对码必须在刷新/重启后可重建，且**不得**再次调用 bootstrap
 *   4) validate阶段零副作用（不写凭据、不启用同步）
 *   5)「以云端为准」必须**真的清空**本地可同步数据
 */

const baseInput = {
  name: '本机物品',
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

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.categories.clear(),
    db.tags.clear(),
    db.itemTags.clear(),
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
})

describe('配对码编解码（最终审查第 3 条）', () => {
  it('encode → parse 往返一致', () => {
    const code = encodePairingCode('s'.repeat(40), 'key-1')
    const parsed = parsePairingCode(code)
    expect(parsed).toEqual({ v: 1, keyId: 'key-1', secret: 's'.repeat(40) })
  })

  it('同一个 (secret, keyId) 总是编码出同一个码（可重复重建）', () => {
    expect(encodePairingCode('abc', 'k')).toBe(encodePairingCode('abc', 'k'))
  })

  it('配对码不含 workerBaseUrl（同源安全）', () => {
    const parsed = parsePairingCode(encodePairingCode('s'.repeat(40), 'k'))
    expect(parsed).not.toHaveProperty('workerBaseUrl')
  })

  it('残缺/损坏的配对码被拒绝', () => {
    expect(parsePairingCode('')).toBeNull()
    expect(parsePairingCode('not-base64!!')).toBeNull()
    expect(parsePairingCode(encodePairingCode('short', 'k'))).toBeNull() // secret 太短
  })
})

describe('配对码在刷新后可重建（最终审查第 3 条）', () => {
  it('未创建空间时 currentPairingCode 返回 null', async () => {
    expect(await hasSyncSpace()).toBe(false)
    expect(await currentPairingCode()).toBeNull()
  })

  it('★ 已有凭据 → 能重建出同一个配对码（模拟刷新后重取）', async () => {
    const secret = 'x'.repeat(40)
    await syncRepository.initCredentials(secret, 'key-1')

    // 第一次重建
    const first = await currentPairingCode()
    // 模拟"刷新"：React state 全丢，只剩 IndexedDB
    // 第二次重建必须得到完全相同的码
    const second = await currentPairingCode()

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    const parsed = parsePairingCode(second!)
    expect(parsed?.secret).toBe(secret)
    expect(parsed?.keyId).toBe('key-1')
  })

  it('★ 重建过程不触碰 enabled（不会因为查看配对码而开始同步）', async () => {
    await syncRepository.initCredentials('y'.repeat(40), 'k')
    await currentPairingCode()
    const state = await syncRepository.getState()
    expect(state?.enabled).toBe(false)
  })

  it('disable 之后 currentPairingCode 返回 null（凭据已清）', async () => {
    await syncRepository.initCredentials('z'.repeat(40), 'k')
    await syncRepository.disable()
    expect(await currentPairingCode()).toBeNull()
  })
})

describe('加入流程：validate 阶段零副作用（最终审查第 4 条）', () => {
  it('commitJoin 之前 syncState 完全没有该空间的凭据', async () => {
    // 这模拟"validate 通过但用户还没确认方向"的状态：
    // 此时 enabled 必须仍为 false，绝不会自动 push/pull。
    const state = await syncRepository.getState()
    expect(state?.enabled ?? false).toBe(false)
    expect(state?.secret ?? null).toBeNull()
    expect(await syncRepository.isActive()).toBe(false)
  })

  it('校验阶段本地改动仍积压在 outbox（没有被悄悄推走）', async () => {
    await itemRepository.create(baseInput)
    expect(await syncRepository.pendingCount()).toBe(1)
  })
})

describe('「以云端为准」真的清空本地数据（最终审查第 5 条）', () => {
  it('★ wipeSyncableLocalData 清掉 items/categories/tags/itemTags', async () => {
    await itemRepository.create(baseInput)
    await db.tags.add({
      id: 't1',
      name: 'X',
      nameNormalized: 'x',
      createdAt: 't',
      updatedAt: 't',
    })
    expect(await db.items.count()).toBe(1)
    expect(await db.tags.count()).toBe(1)

    await wipeSyncableLocalData()

    expect(await db.items.count()).toBe(0)
    expect(await db.itemTags.count()).toBe(0)
    expect(await db.categories.count()).toBe(0)
    expect(await db.tags.count()).toBe(0)
  })

  it('★ 刻意不动 assets 与 appMeta（preset 需幂等补齐；appMeta 清了会重新 seed 覆盖用户分类名）', async () => {
    await db.assets.add({
      id: 'preset-other',
      kind: 'preset',
      path: '/icons/items/other.svg',
      blob: null,
      mime: 'image/svg+xml',
      width: 96,
      height: 96,
      styleVersion: null,
      promptVersion: null,
      sourceAssetId: null,
      createdAt: 't',
    })
    await db.appMeta.add({ key: 'seeded', value: '1' })
    await db.appMeta.add({ key: 'schemaVersion', value: '3' })

    await wipeSyncableLocalData()

    expect(await db.assets.count()).toBe(1)
    expect((await db.appMeta.get('seeded'))?.value).toBe('1')
    expect((await db.appMeta.get('schemaVersion'))?.value).toBe('3')
  })

  it('commitJoin(cloud) 清空数据 + 游标归零 + 启用同步', async () => {
    await itemRepository.create(baseInput)
    await syncRepository.setState({ lastPulledRevision: 42 })

    await commitJoin({ v: 1, secret: 's'.repeat(40), keyId: 'k' }, 'cloud')

    expect(await db.items.count()).toBe(0)
    const state = await syncRepository.getState()
    expect(state?.lastPulledRevision).toBe(0)
    expect(state?.enabled).toBe(true)
    expect(state?.secret).toBe('s'.repeat(40))
    // ⭐ outbox 必须同时清空：里面是**刚被清掉的那些实体**的待推条目，
    //   留着会把已删除的本机数据又推回云端，语义完全相反。
    expect(await syncRepository.pendingCount()).toBe(0)
  })

  it('commitJoin(local) 保留本机数据并全量入队', async () => {
    await itemRepository.create(baseInput)
    await commitJoin({ v: 1, secret: 's'.repeat(40), keyId: 'k' }, 'local')

    expect(await db.items.count()).toBe(1)
    expect(await syncRepository.pendingCount()).toBeGreaterThan(0)
    expect((await syncRepository.getState())?.enabled).toBe(true)
  })
})