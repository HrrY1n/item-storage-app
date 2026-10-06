import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { categoryRepository } from './categoryRepository'
import { itemRepository } from './itemRepository'
import { tagRepository } from './tagRepository'
import { syncRepository } from './syncRepository'

/**
 * Phase 3B 步 4 的核心保证：**业务写入与 outbox 入队原子发生**。
 *
 * 为什么这值得单独写测试：一旦有人日后把这些写入点"简化"成裸的
 * `db.items.update(...)`，同步不会立刻报错，只是**静默地**从此漏掉变更 ——
 * 用户看到的现象是"这台设备怎么老是不更新"，极难排查。
 * 所以这里把"改完之后 outbox 一定有对应条目"钉死。
 *
 * 同时验证反向保证：业务写入失败时，outbox 也**不应该**被写入。
 */

const baseInput = {
  name: '测试物品',
  categoryId: 'c1',
  iconAssetId: 'preset-other',
  note: '',
  tagIds: [] as string[],
  purchaseDate: null as string | null,
  purchasePriceCents: null as number | null,
  additionalCostCents: null as number | null,
  purchasePlatform: null as 'jd' | 'taobao' | null,
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
})

async function queueIds(): Promise<string[]> {
  const list = await syncRepository.listQueue()
  return list.map((r) => `${r.entity}:${r.entityId}`).sort()
}

describe('itemRepository → outbox', () => {
  it('create 后有对应 outbox 条目', async () => {
    const item = await itemRepository.create(baseInput)
    expect(await queueIds()).toEqual([`item:${item.id}`])
  })

  it('update 后 outbox 仍只有一条（幂等）', async () => {
    const item = await itemRepository.create(baseInput)
    await itemRepository.update(item.id, { ...baseInput, name: '改名了' })
    await itemRepository.update(item.id, { ...baseInput, name: '又改了' })
    expect(await queueIds()).toEqual([`item:${item.id}`])
  })

  it('softDelete 后 outbox 仍只有一条，且 deletedAt 已写入', async () => {
    const item = await itemRepository.create(baseInput)
    await itemRepository.softDelete(item.id)
    expect(await queueIds()).toEqual([`item:${item.id}`])
    expect((await db.items.get(item.id))?.deletedAt).toBeTruthy()
  })

  it('restoreToOwned（心愿→持有 / 恢复持有）也入队 —— 这是最容易漏的写入点', async () => {
    const item = await itemRepository.create({ ...baseInput, status: 'wishlist' })
    await itemRepository.convertToOwned(item.id, {
      purchaseDate: '2026-01-01',
      purchasePriceCents: null,
      additionalCostCents: null,
      purchasePlatform: null,
      warrantyExpiresAt: null,
    })
    expect(await queueIds()).toEqual([`item:${item.id}`])

    await itemRepository.softDelete(item.id)
    await db.items.update(item.id, { deletedAt: null })
    // restoreToOwned 需要 active 记录
    await syncRepository.clearQueue()
    await itemRepository.restoreToOwned(item.id)
    expect(await queueIds()).toEqual([`item:${item.id}`])
  })

  it('业务写入失败时，outbox 不会被写入（原子性）', async () => {
    // 名称为空 → create 抛错
    await expect(itemRepository.create({ ...baseInput, name: '   ' })).rejects.toThrow()
    expect(await syncRepository.pendingCount()).toBe(0)
  })

  it('update 一个不存在的物品失败时，outbox 不被污染', async () => {
    await expect(itemRepository.update('nonexistent', baseInput)).rejects.toThrow()
    expect(await syncRepository.pendingCount()).toBe(0)
  })

  it('带标签创建时，item 入队且关联正确写入', async () => {
    const tag = await tagRepository.create('通勤')
    const item = await itemRepository.create({ ...baseInput, tagIds: [tag.id] })
    expect(await queueIds()).toContain(`item:${item.id}`)
    expect(await itemRepository.tagIdsOf(item.id)).toEqual([tag.id])
  })
})

describe('categoryRepository → outbox', () => {
  it('create 入队', async () => {
    const c = await categoryRepository.create('新分类', null)
    expect(await queueIds()).toContain(`category:${c.id}`)
  })

  it('rename 入队', async () => {
    await syncRepository.clearQueue()
    await categoryRepository.rename('c1', '改过的名字')
    expect(await queueIds()).toEqual(['category:c1'])
  })

  it('move 入队', async () => {
    const child = await categoryRepository.create('子分类', null)
    await syncRepository.clearQueue()
    await categoryRepository.move(child.id, 'c1')
    expect(await queueIds()).toEqual([`category:${child.id}`])
  })

  it('reorder 入队**两条**（交换影响两个分类，少一条云端顺序就不一致）', async () => {
    const a = await categoryRepository.create('A', null)
    const b = await categoryRepository.create('B', null)
    await syncRepository.clearQueue()
    await categoryRepository.reorder(a.id, 'down')
    expect(await queueIds()).toContain(`category:${a.id}`)
    expect(await queueIds()).toContain(`category:${b.id}`)
  })

  it('deleteGuarded 入队', async () => {
    const c = await categoryRepository.create('要删的', null)
    await syncRepository.clearQueue()
    await categoryRepository.deleteGuarded(c.id)
    expect(await queueIds()).toEqual([`category:${c.id}`])
  })

  it('删除保护拒绝时，outbox 不被写入', async () => {
    const c = await categoryRepository.create('有物品的', null)
    const item = await itemRepository.create({ ...baseInput, categoryId: c.id })
    await syncRepository.clearQueue()
    await expect(categoryRepository.deleteGuarded(c.id)).rejects.toThrow()
    expect(await syncRepository.pendingCount()).toBe(0)
    expect(item.id).toBeTruthy()
  })
})

describe('tagRepository → outbox', () => {
  it('create 入队', async () => {
    const t = await tagRepository.create('通勤')
    expect(await queueIds()).toContain(`tag:${t.id}`)
  })

  it('rename 入队', async () => {
    const t = await tagRepository.create('通勤')
    await syncRepository.clearQueue()
    await tagRepository.rename(t.id, '上下班')
    expect(await queueIds()).toEqual([`tag:${t.id}`])
  })

  it('delete 会让**受影响物品**重新入队（否则另一台还挂着旧标签）', async () => {
    const t = await tagRepository.create('待删')
    const item = await itemRepository.create({ ...baseInput, tagIds: [t.id] })
    await syncRepository.clearQueue()

    await tagRepository.delete(t.id)

    // 关键是 item 那一条
    expect(await queueIds()).toContain(`item:${item.id}`)
  })

  it('delete 移除全部关联', async () => {
    const t = await tagRepository.create('待删')
    const item = await itemRepository.create({ ...baseInput, tagIds: [t.id] })
    await tagRepository.delete(t.id)
    expect(await itemRepository.tagIdsOf(item.id)).toEqual([])
  })

  it('merge 会让**被合并的物品**重新入队', async () => {
    const source = await tagRepository.create('旧标签')
    const target = await tagRepository.create('新标签')
    const item = await itemRepository.create({ ...baseInput, tagIds: [source.id] })
    await syncRepository.clearQueue()

    await tagRepository.merge(source.id, target.id)

    const ids = await queueIds()
    expect(ids).toContain(`item:${item.id}`) // ← 关键：物品的 tagIds 变了
    expect(ids).toContain(`tag:${target.id}`)
    expect(ids).not.toContain(`tag:${source.id}`)
  })

  it('merge 后关联转移到目标标签', async () => {
    const source = await tagRepository.create('旧标签')
    const target = await tagRepository.create('新标签')
    const item = await itemRepository.create({ ...baseInput, tagIds: [source.id] })

    await tagRepository.merge(source.id, target.id)

    expect(await itemRepository.tagIdsOf(item.id)).toEqual([target.id])
    expect(await tagRepository.getByNormalized('旧标签')).toBeUndefined()
  })

  it('merge 到自身被拒绝，outbox 不被写入', async () => {
    const t = await tagRepository.create('同标签')
    await syncRepository.clearQueue()
    await expect(tagRepository.merge(t.id, t.id)).rejects.toThrow()
    expect(await syncRepository.pendingCount()).toBe(0)
  })

  it('重名创建被拒绝，outbox 不被写入', async () => {
    await tagRepository.create('Apple')
    await syncRepository.clearQueue()
    await expect(tagRepository.create('apple')).rejects.toThrow()
    expect(await syncRepository.pendingCount()).toBe(0)
  })
})

describe('同步开关与 outbox 的关系', () => {
  it('同步未启用时 outbox 照常累积（关掉同步不丢待推数据）', async () => {
    await itemRepository.create(baseInput)
    await categoryRepository.create('某分类', null)
    expect(await syncRepository.pendingCount()).toBeGreaterThan(0)
    expect(await syncRepository.isActive()).toBe(false)
  })

  it('enqueueAll 能把散落的变化一次收齐（首次启用 / 恢复备份后）', async () => {
    await itemRepository.create(baseInput)
    await tagRepository.create('X')
    await syncRepository.enqueueAll()
    const ids = await queueIds()
    expect(ids).toHaveLength(3) // 1 item + 1 category(种子) + 1 tag
  })
})