import Dexie, { type Table } from 'dexie'
import type { AppMeta, Asset, Category, Item, ItemTag, Tag } from '../domain/types'

/**
 * Dexie 实例与 schema。
 * ⚠️ 契约：只有 repository 可以直接 import 本文件的 db。
 *    页面 / 组件 / hooks 一律经由 src/db/repositories/* 访问数据。
 *
 * 版本史：
 *   v1  初始 6 表
 *   v2  Item 增加购买信息字段
 *       （purchaseDate / purchasePriceCents / additionalCostCents / purchasePlatform）
 *       非索引字段无需改 stores，仅需 upgrade 把旧记录的新字段补为 null
 *   v3  Item 增加生命周期与保修字段
 *       （status / warrantyExpiresAt / disposedAt / disposalMethod /
 *         salePriceCents / disposalNote）
 *       同样是「非索引字段 + upgrade 补默认值」，不重写任何既有字段、不清库
 */
class AppDatabase extends Dexie {
  items!: Table<Item, string>
  categories!: Table<Category, string>
  tags!: Table<Tag, string>
  itemTags!: Table<ItemTag, [string, string]>
  assets!: Table<Asset, string>
  appMeta!: Table<AppMeta, string>

  constructor() {
    super('PrivateItemLibraryDB')
    this.version(1).stores({
      items: 'id, categoryId, name, createdAt, updatedAt, deletedAt',
      categories: 'id, parentId, name, sortOrder, deletedAt',
      tags: 'id, &nameNormalized, createdAt',
      itemTags: '[itemId+tagId], itemId, tagId',
      assets: 'id, kind, createdAt',
      appMeta: 'key',
    })

    this.version(2)
      .stores({
        items: 'id, categoryId, name, createdAt, updatedAt, deletedAt',
        categories: 'id, parentId, name, sortOrder, deletedAt',
        tags: 'id, &nameNormalized, createdAt',
        itemTags: '[itemId+tagId], itemId, tagId',
        assets: 'id, kind, createdAt',
        appMeta: 'key',
      })
      .upgrade(async (tx) => {
        // v1 → v2：旧 Item 统一补 null，不破坏现有数据
        await tx
          .table('items')
          .toCollection()
          .modify((item: Record<string, unknown>) => {
            item.purchaseDate ??= null
            item.purchasePriceCents ??= null
            item.additionalCostCents ??= null
            item.purchasePlatform ??= null
          })
      })

    this.version(3)
      .stores({
        // 注意：索引串与 v2 完全一致 —— 生命周期字段不参与索引，
        // 避免为了加索引而触发全表重建（旧库数据量大时这是有代价的）。
        items: 'id, categoryId, name, createdAt, updatedAt, deletedAt',
        categories: 'id, parentId, name, sortOrder, deletedAt',
        tags: 'id, &nameNormalized, createdAt',
        itemTags: '[itemId+tagId], itemId, tagId',
        assets: 'id, kind, createdAt',
        appMeta: 'key',
      })
      .upgrade(async (tx) => {
        // v2 → v3：所有既有物品都已经在「持有中」，这是唯一正确的默认值。
        // 只**新增**字段，绝不触碰 id / categoryId / iconAssetId / name / note /
        // 购买信息 / createdAt / updatedAt / deletedAt。
        await tx
          .table('items')
          .toCollection()
          .modify((item: Record<string, unknown>) => {
            item.status ??= 'owned'
            item.warrantyExpiresAt ??= null
            item.disposedAt ??= null
            item.disposalMethod ??= null
            item.salePriceCents ??= null
            item.disposalNote ??= null
          })
      })
  }
}

export const db = new AppDatabase()
