import Dexie, { type Table } from 'dexie'
import { describe, expect, it } from 'vitest'
import { db } from './db'
import { statusOf, warrantyInfo } from '../domain/lifecycle'

/**
 * v2 → v3 真实迁移验证。
 *
 * 做法：用一个**只声明到 v2** 的 Dexie 实例打开同名数据库，写入一条 v2 形状的记录，
 * 关掉后用应用真正的 `db` 打开 —— 这会触发 `version(3).upgrade`。
 * 这样测的是真实迁移路径，而不是"假设迁移已经跑过"。
 */
class LegacyV2DB extends Dexie {
  items!: Table<Record<string, unknown>, string>
  categories!: Table<unknown, string>
  tags!: Table<unknown, string>
  itemTags!: Table<unknown, [string, string]>
  assets!: Table<unknown, string>
  appMeta!: Table<unknown, string>

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
    this.version(2).stores({
      items: 'id, categoryId, name, createdAt, updatedAt, deletedAt',
      categories: 'id, parentId, name, sortOrder, deletedAt',
      tags: 'id, &nameNormalized, createdAt',
      itemTags: '[itemId+tagId], itemId, tagId',
      assets: 'id, kind, createdAt',
      appMeta: 'key',
    })
  }
}

const LEGACY_ITEM = {
  id: 'legacy-1',
  name: '我的旧 iPhone',
  categoryId: 'cat-old',
  note: '迁移前写入的记录',
  iconAssetId: 'preset-phone',
  sourceType: 'preset',
  purchaseDate: '2023-05-20',
  purchasePriceCents: 599900,
  additionalCostCents: 19900,
  purchasePlatform: 'jd',
  createdAt: '2023-05-20T10:00:00.000Z',
  updatedAt: '2024-01-01T10:00:00.000Z',
  deletedAt: null,
}

describe('数据库迁移 v2 → v3', () => {
  it('旧库升级：既有物品一律变为 owned，新增字段补 null，原字段一字不改', async () => {
    // 0) 确保 app 的 db 还没被打开过，并清空同名库，
    //    这样下面写入的 v2 记录才是"磁盘上真实存在的旧数据"
    await db.close()
    await Dexie.delete('PrivateItemLibraryDB')

    // 1) 造一个"只到 v2"的旧库并写入 v2 记录
    const legacy = new LegacyV2DB()
    await legacy.open()
    await legacy.items.put({ ...LEGACY_ITEM })
    await legacy.appMeta.put({ key: 'seeded', value: '1' })
    await legacy.appMeta.put({ key: 'schemaVersion', value: '2' })
    legacy.close()

    // 2) 用应用真正的 db 打开 → 触发 version(3).upgrade
    await db.open()
    const migrated = await db.items.get('legacy-1')

    expect(migrated).toBeTruthy()
    // 生命周期：默认持有中
    expect(migrated!.status).toBe('owned')
    expect(statusOf(migrated as never)).toBe('owned')
    // 新增字段全部为 null
    expect(migrated!.warrantyExpiresAt).toBeNull()
    expect(migrated!.disposedAt).toBeNull()
    expect(migrated!.disposalMethod).toBeNull()
    expect(migrated!.salePriceCents).toBeNull()
    expect(migrated!.disposalNote).toBeNull()

    // 原有字段逐个保持不变（迁移只新增，绝不覆写）
    expect(migrated!.id).toBe('legacy-1')
    expect(migrated!.name).toBe('我的旧 iPhone')
    expect(migrated!.categoryId).toBe('cat-old')
    expect(migrated!.note).toBe('迁移前写入的记录')
    expect(migrated!.iconAssetId).toBe('preset-phone') // 图标引用不失效
    expect(migrated!.sourceType).toBe('preset')
    expect(migrated!.purchaseDate).toBe('2023-05-20')
    expect(migrated!.purchasePriceCents).toBe(599900)
    expect(migrated!.additionalCostCents).toBe(19900)
    expect(migrated!.purchasePlatform).toBe('jd')
    expect(migrated!.createdAt).toBe('2023-05-20T10:00:00.000Z')
    expect(migrated!.updatedAt).toBe('2024-01-01T10:00:00.000Z')
    expect(migrated!.deletedAt).toBeNull()

    // 迁移后立即可用：保修模块因未填写而不显示
    expect(warrantyInfo(migrated!.warrantyExpiresAt, '2026-10-05')).toBeNull()

    // 3) 不需要清库：appMeta 的 seeded 标记也保留
    expect((await db.appMeta.get('seeded'))?.value).toBe('1')
  })

  it('迁移是幂等的：重复打开不会二次改写', async () => {
    await db.items.put({
      ...LEGACY_ITEM,
      id: 'legacy-2',
      status: 'owned',
      warrantyExpiresAt: '2027-01-01',
      disposedAt: null,
      disposalMethod: null,
      salePriceCents: null,
      disposalNote: null,
    } as never)
    const before = await db.items.get('legacy-2')
    await db.open()
    await db.close()
    await db.open()
    const after = await db.items.get('legacy-2')
    expect(after).toEqual(before)
  })
})
