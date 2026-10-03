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

describe('tagRepository', () => {
  it('create 做标准化：trim + 去 # + 折叠空白', async () => {
    const tag = await tagRepository.create('  #Apple  ')
    expect(tag.name).toBe('Apple')
    expect(tag.nameNormalized).toBe('apple')
  })

  it('重复保护：Apple / apple / " Apple " 是同一个标签', async () => {
    await tagRepository.create('Apple')
    await expect(tagRepository.create('apple')).rejects.toThrow('已存在')
    await expect(tagRepository.create(' Apple ')).rejects.toThrow('已存在')
    await expect(tagRepository.create('#APPLE')).rejects.toThrow('已存在')
  })

  it('getOrCreate：已存在时返回现有标签而不报错', async () => {
    const a = await tagRepository.create('Apple')
    const b = await tagRepository.getOrCreate(' apple ')
    expect(b.id).toBe(a.id)
    expect(await tagRepository.list()).toHaveLength(1)
  })

  it('rename：重命名并更新标准化键；与其他标签冲突时拒绝', async () => {
    const a = await tagRepository.create('Apple')
    await tagRepository.create('常用')
    await tagRepository.rename(a.id, 'Apple 产品')
    expect((await tagRepository.list()).find((t) => t.id === a.id)?.name).toBe('Apple 产品')
    await expect(tagRepository.rename(a.id, ' 常用 ')).rejects.toThrow('已存在')
  })

  it('delete：删除标签并移除物品关联', async () => {
    const tag = await tagRepository.create('Apple')
    const item = await itemRepository.create({
      name: '手机',
      categoryId: 'c1',
      iconAssetId: 'preset-phone',
      note: '',
      tagIds: [tag.id],
      purchaseDate: null,
      purchasePriceCents: null,
      additionalCostCents: null,
      purchasePlatform: null,
    })
    await tagRepository.delete(tag.id)
    expect(await tagRepository.list()).toHaveLength(0)
    expect(await tagRepository.tagIdsOfItem(item.id)).toEqual([])
  })

  it('merge：关联转移到目标标签并去重，源标签删除', async () => {
    const apple = await tagRepository.create('Apple')
    const fruit = await tagRepository.create('苹果')
    const mk = (name: string, tagIds: string[]) =>
      itemRepository.create({
        name,
        categoryId: 'c1',
        iconAssetId: 'preset-other',
        note: '',
        tagIds,
        purchaseDate: null,
        purchasePriceCents: null,
        additionalCostCents: null,
        purchasePlatform: null,
      })
    const i1 = await mk('手机', [apple.id])
    const i2 = await mk('电脑', [apple.id, fruit.id]) // 两个标签都有 → 合并后应去重

    await tagRepository.merge(apple.id, fruit.id)

    expect(await tagRepository.list()).toHaveLength(1)
    expect((await tagRepository.list())[0].name).toBe('苹果')
    expect(await tagRepository.tagIdsOfItem(i1.id)).toEqual([fruit.id])
    expect(await tagRepository.tagIdsOfItem(i2.id)).toEqual([fruit.id]) // 不重复
  })
})
