import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { categoryRepository } from './categoryRepository'
import { itemRepository } from './itemRepository'

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

describe('categoryRepository', () => {
  it('创建父子分类；listActive 按 sortOrder 返回', async () => {
    const root = await categoryRepository.create('数码与电子', null)
    const child = await categoryRepository.create('音频设备', root.id)
    const all = await categoryRepository.listActive()
    expect(all.find((c) => c.id === child.id)?.parentId).toBe(root.id)
  })

  it('重命名', async () => {
    const c = await categoryRepository.create('数码', null)
    await categoryRepository.rename(c.id, '数码与电子')
    expect((await categoryRepository.getActive(c.id))?.name).toBe('数码与电子')
  })

  it('移动到自己的子分类下被拒绝（循环引用保护）', async () => {
    const root = await categoryRepository.create('数码', null)
    const child = await categoryRepository.create('音频', root.id)
    await expect(categoryRepository.move(root.id, child.id)).rejects.toThrow('不能移动到自身或其子分类下')
    await expect(categoryRepository.move(root.id, root.id)).rejects.toThrow('不能移动到自身或其子分类下')
  })

  it('合法移动成功', async () => {
    const a = await categoryRepository.create('A', null)
    const b = await categoryRepository.create('B', null)
    await categoryRepository.move(b.id, a.id)
    expect((await categoryRepository.getActive(b.id))?.parentId).toBe(a.id)
  })

  it('同级排序：上移/下移交换位置', async () => {
    const c1 = await categoryRepository.create('一', null)
    const c2 = await categoryRepository.create('二', null)
    await categoryRepository.reorder(c2.id, 'up')
    const all = await categoryRepository.listActive()
    expect(all.findIndex((c) => c.id === c2.id)).toBeLessThan(all.findIndex((c) => c.id === c1.id))
  })

  it('含子分类的分类不可删除', async () => {
    const root = await categoryRepository.create('数码', null)
    await categoryRepository.create('音频', root.id)
    await expect(categoryRepository.deleteGuarded(root.id)).rejects.toThrow('该分类包含子分类')
  })

  it('含物品的分类不可删除；物品删除后可删除', async () => {
    const c = await categoryRepository.create('数码', null)
    const item = await itemRepository.create({
      name: '耳机',
      categoryId: c.id,
      iconAssetId: 'preset-earbuds',
      note: '',
      tagIds: [],
      purchaseDate: null,
      purchasePriceCents: null,
      additionalCostCents: null,
      purchasePlatform: null,
    })
    await expect(categoryRepository.deleteGuarded(c.id)).rejects.toThrow('该分类下还有 1 件物品')
    await itemRepository.softDelete(item.id)
    await categoryRepository.deleteGuarded(c.id)
    expect(await categoryRepository.getActive(c.id)).toBeUndefined()
  })

  it('空分类名称拒绝创建', async () => {
    await expect(categoryRepository.create('  ', null)).rejects.toThrow('分类名称不能为空')
  })
})
