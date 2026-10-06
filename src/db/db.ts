import Dexie, { type Table } from 'dexie'
import type {
  AppMeta,
  Asset,
  Category,
  Item,
  ItemTag,
  SyncConflict,
  SyncEntity,
  SyncQueueEntry,
  SyncState,
  Tag,
} from '../domain/types'

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
 *   v4  跨设备同步（Phase 3B）：**只新增 3 张表**
 *       （syncState / syncQueue / syncConflicts）
 *       ⚠️ 前 6 张表的索引串与 v3 **逐字符完全一致**。Dexie 中索引串的任何变化都会
 *          触发受影响表的索引重建（旧库数据量大时这是实打实的代价 —— v3 的注释已经
 *          记录过同一个理由），因此同步功能一律不改既有索引。
 *       ⚠️ **不写 .upgrade() 回调**：三张新表没有旧数据，缺表时 Dexie 会创建空表；
 *          没有 upgrade 就不会触碰任何既有行，迁移零数据风险。
 */
class AppDatabase extends Dexie {
  items!: Table<Item, string>
  categories!: Table<Category, string>
  tags!: Table<Tag, string>
  itemTags!: Table<ItemTag, [string, string]>
  assets!: Table<Asset, string>
  appMeta!: Table<AppMeta, string>

  /** 同步状态单行表（key 固定为 'sync'）。含 secret 明文，**绝不进备份**。 */
  syncState!: Table<SyncState, string>
  /** outbox：待推送的实体变更。刻意不存 payload（见 types.ts 注释）。 */
  syncQueue!: Table<SyncQueueEntry, string>
  /** 「冲突事后可查」的本地记录，保留最近 50 条。 */
  syncConflicts!: Table<SyncConflict, string>

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

    this.version(4).stores({
      // ⚠️ 下面 6 行与 v3 逐字符一致 —— 改任何一个字符都会触发该表索引重建。
      items: 'id, categoryId, name, createdAt, updatedAt, deletedAt',
      categories: 'id, parentId, name, sortOrder, deletedAt',
      tags: 'id, &nameNormalized, createdAt',
      itemTags: '[itemId+tagId], itemId, tagId',
      assets: 'id, kind, createdAt',
      appMeta: 'key',

      // ↓ Phase 3B 新增。三张表都是本地状态，均不参与 ZIP 备份。
      //   复合索引 [entity+entityId] 用于「按实体去重 / 清除残留」，是回声防护的基础。
      syncState: 'key',
      syncQueue: 'id, entity, [entity+entityId], createdAt',
      syncConflicts: 'id, detectedAt',
    })
  }
}

export const db = new AppDatabase()

/** outbox 使用的实体类型（供 repository 复用，避免各处重复字面量） */
export const SYNC_ENTITIES: readonly SyncEntity[] = ['item', 'category', 'tag']
