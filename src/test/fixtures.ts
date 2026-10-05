import type { Item, ItemStatus } from '../domain/types'

/**
 * 测试用的完整 Item 工厂。
 *
 * 存在的理由：Item 的字段会随阶段增加（v2 购买信息、v3 生命周期与保修）。
 * 如果每个测试都手写完整字面量，每加一个字段就要改十几个文件 ——
 * 这里给出**显式默认值**，测试只写自己关心的字段，
 * 其余保持"一个普通的持有中物品"。
 */
export function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    name: '测试物品',
    categoryId: 'cat-1',
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
    ...over,
  }
}

/** 便捷构造：wishlist / disposed 物品 */
export function makeItemOfStatus(
  status: ItemStatus,
  over: Partial<Item> = {},
): Item {
  return makeItem({ status, ...over })
}
