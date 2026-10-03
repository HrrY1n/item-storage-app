import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { itemRepository } from './itemRepository'
import { tagRepository } from './tagRepository'

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.categories.clear(),
    db.tags.clear(),
    db.itemTags.clear(),
    db.assets.clear(),
    db.appMeta.clear(),
  ])
})

const baseInput = {
  name: 'AirPods Pro 2',
  categoryId: 'c-audio',
  iconAssetId: 'preset-earbuds',
  note: '通勤降噪用',
  tagIds: [] as string[],
  purchaseDate: null as string | null,
  purchasePriceCents: null as number | null,
  purchasePlatform: null as 'jd' | 'taobao' | null,
}

describe('itemRepository', () => {
  it('create → getActive 可取回；listActive 包含新物品', async () => {
    const item = await itemRepository.create(baseInput)
    const fetched = await itemRepository.getActive(item.id)
    expect(fetched?.name).toBe('AirPods Pro 2')
    expect((await itemRepository.listActive()).map((i) => i.id)).toContain(item.id)
  })

  it('create 时写入标签关联；tagIdsOfItem 可读回', async () => {
    const tag = await tagRepository.create('Apple')
    const item = await itemRepository.create({ ...baseInput, tagIds: [tag.id] })
    expect(await tagRepository.tagIdsOfItem(item.id)).toEqual([tag.id])
  })

  it('名称为空拒绝创建', async () => {
    await expect(itemRepository.create({ ...baseInput, name: '   ' })).rejects.toThrow('名称不能为空')
  })

  it('update 修改字段并重写标签关联', async () => {
    const t1 = await tagRepository.create('Apple')
    const t2 = await tagRepository.create('白色')
    const item = await itemRepository.create({ ...baseInput, tagIds: [t1.id] })
    await itemRepository.update(item.id, {
      ...baseInput,
      name: 'AirPods Pro 2（白色）',
      tagIds: [t2.id],
    })
    const updated = await itemRepository.getActive(item.id)
    expect(updated?.name).toBe('AirPods Pro 2（白色）')
    expect(updated?.createdAt).toBe(item.createdAt)
    expect(updated && updated.updatedAt >= item.updatedAt).toBe(true)
    expect(await tagRepository.tagIdsOfItem(item.id)).toEqual([t2.id])
  })

  it('soft delete 后列表/查询不再返回，但数据仍在表中', async () => {
    const item = await itemRepository.create(baseInput)
    await itemRepository.softDelete(item.id)
    expect(await itemRepository.getActive(item.id)).toBeUndefined()
    expect((await itemRepository.listActive())).toHaveLength(0)
    const raw = await db.items.get(item.id)
    expect(raw?.deletedAt).not.toBeNull()
  })

  it('关闭并重新打开数据库后数据仍在（模拟刷新）', async () => {
    const item = await itemRepository.create(baseInput)
    await db.close()
    await db.open()
    const fetched = await itemRepository.getActive(item.id)
    expect(fetched?.name).toBe('AirPods Pro 2')
  })

  it('create 保存购买信息字段', async () => {
    const item = await itemRepository.create({
      ...baseInput,
      purchaseDate: '2026-01-01',
      purchasePriceCents: 149_900,
      purchasePlatform: 'jd',
    })
    const fetched = await itemRepository.getActive(item.id)
    expect(fetched?.purchaseDate).toBe('2026-01-01')
    expect(fetched?.purchasePriceCents).toBe(149_900)
    expect(fetched?.purchasePlatform).toBe('jd')
  })

  it('update 修改购买信息字段（含清空回 null）', async () => {
    const item = await itemRepository.create(baseInput)
    await itemRepository.update(item.id, {
      ...baseInput,
      purchaseDate: '2026-01-01',
      purchasePriceCents: 149_900,
      purchasePlatform: 'jd',
    })
    let fetched = await itemRepository.getActive(item.id)
    expect(fetched?.purchasePriceCents).toBe(149_900)

    await itemRepository.update(item.id, {
      ...baseInput,
      purchaseDate: null,
      purchasePriceCents: null,
      purchasePlatform: null,
    })
    fetched = await itemRepository.getActive(item.id)
    expect(fetched?.purchaseDate).toBeNull()
    expect(fetched?.purchasePriceCents).toBeNull()
    expect(fetched?.purchasePlatform).toBeNull()
  })
})
