import Dexie, { type Table } from 'dexie'
import type { AppMeta, Asset, Category, Item, ItemTag, Tag } from '../domain/types'

/**
 * Dexie 实例与 schema（v1）。
 * ⚠️ 契约：只有 repository 可以直接 import 本文件的 db。
 *    页面 / 组件 / hooks 一律经由 src/db/repositories/* 访问数据。
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
  }
}

export const db = new AppDatabase()
