import Dexie from 'dexie'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from './db'

/**
 * v3 → v4 迁移的**零数据丢失**验证（Phase 3B 步 1）。
 *
 * 这个测试要回答的是一个具体问题：老用户（已有几百件物品、且改过分类名）
 * 打开新版本 App 时，**既有的 6 张表会不会被动到一下**。
 *
 * 因此这里刻意不走「直接用 v4 的 db 写数据再断言」——那验证不了迁移。
 * 做法是：
 *   1. 用一个**独立的 Dexie 实例**按 v3 的 schema 建库，写入"用户真实数据"
 *   2. 用 db（v4）打开同一个库名 → Dexie 走真实升级路径
 *   3. 逐字段断言原 6 张表数据完全相等
 *
 * 这是 v4 唯一的安全保证：v4 **没有 .upgrade() 回调**，因此升级过程
 * 不存在任何会写既有行的代码路径。
 */

const DB_NAME = db.name

/** v3 版本的 schema —— 与 src/db/db.ts 中version(3) 逐字符一致 */
const V3_SCHEMA = {
  items: 'id, categoryId, name, createdAt, updatedAt, deletedAt',
  categories: 'id, parentId, name, sortOrder, deletedAt',
  tags: 'id, &nameNormalized, createdAt',
  itemTags: '[itemId+tagId], itemId, tagId',
  assets: 'id, kind, createdAt',
  appMeta: 'key',
} as const

interface V3Fixture {
  items: Record<string, unknown>[]
  categories: Record<string, unknown>[]
  tags: Record<string, unknown>[]
  itemTags: Record<string, unknown>[]
  assets: Record<string, unknown>[]
  appMeta: Record<string, unknown>[]
}

/** 一个"真实用户"的样子：多条物品、用户自建并重命名过的分类、自定义标签、软删记录 */
function makeV3Fixture(): V3Fixture {
  return {
    categories: [
      // 预设分类（未改名）
      {
        id: 'cat-digital',
        parentId: null,
        name: '数码与电子',
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
      },
      // ⭐ 用户自己新建并改过名的分类 —— 最容易被同步/迁移误伤的那类
      {
        id: 'cat-user-01',
        parentId: 'cat-digital',
        name: '我改过名的分类 · 耳机',
        sortOrder: 7,
        iconKey: 'preset-earbuds',
        createdAt: '2026-02-03T10:00:00.000Z',
        updatedAt: '2026-03-04T11:30:00.000Z',
        deletedAt: null,
      },
      // 软删的分类
      {
        id: 'cat-user-deleted',
        parentId: null,
        name: '临时分类',
        sortOrder: 99,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-20T00:00:00.000Z',
        deletedAt: '2026-02-20T00:00:00.000Z',
      },
    ],
    items: [
      {
        id: 'item-full-fields',
        name: 'AirPods Pro 2',
        categoryId: 'cat-user-01',
        note: '通勤降噪用，2026-03 换过耳塞',
        iconAssetId: 'preset-earbuds',
        sourceType: 'preset',
        status: 'owned',
        purchaseDate: '2026-01-15',
        purchasePriceCents: 149999,
        additionalCostCents: 12000,
        purchasePlatform: 'jd',
        warrantyExpiresAt: '2027-01-15',
        disposedAt: null,
        disposalMethod: null,
        salePriceCents: null,
        disposalNote: null,
        createdAt: '2026-01-15T08:00:00.000Z',
        updatedAt: '2026-03-04T11:30:00.000Z',
        deletedAt: null,
      },
      // 所有可空字段都为 null 的"裸"物品 —— 验证 null 不会被迁移改写
      {
        id: 'item-bare',
        name: '随便一个东西',
        categoryId: 'cat-digital',
        note: '',
        iconAssetId: 'preset-other',
        sourceType: 'preset',
        status: 'wishlist',
        purchaseDate: null,
        purchasePriceCents: null,
        additionalCostCents: null,
        purchasePlatform: null,
        warrantyExpiresAt: null,
        disposedAt: null,
        disposalMethod: null,
        salePriceCents: null,
        disposalNote: null,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        deletedAt: null,
      },
      // 已处置：生命周期字段全填
      {
        id: 'item-disposed',
        name: '旧手机',
        categoryId: 'cat-digital',
        note: '',
        iconAssetId: 'preset-phone',
        sourceType: 'preset',
        status: 'disposed',
        purchaseDate: '2023-05-01',
        purchasePriceCents: 399900,
        additionalCostCents: null,
        purchasePlatform: 'taobao',
        warrantyExpiresAt: null,
        disposedAt: '2026-02-01',
        disposalMethod: 'sold',
        salePriceCents: 120000,
        disposalNote: '转转二手',
        createdAt: '2023-05-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        deletedAt: null,
      },
      // 软删的物品：deletedAt 必须原样保留（同步设计要求删除不被复活）
      {
        id: 'item-soft-deleted',
        name: '卖掉的旧耳机',
        categoryId: 'cat-digital',
        note: '',
        iconAssetId: 'preset-earbuds',
        sourceType: 'preset',
        status: 'disposed',
        purchaseDate: null,
        purchasePriceCents: null,
        additionalCostCents: null,
        purchasePlatform: null,
        warrantyExpiresAt: null,
        disposedAt: null,
        disposalMethod: 'discarded',
        salePriceCents: null,
        disposalNote: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-05-05T05:05:05.000Z',
        deletedAt: '2026-05-05T05:05:05.000Z',
      },
    ],
    tags: [
      {
        id: 'tag-apple',
        name: 'Apple',
        nameNormalized: 'apple',
        createdAt: '2026-01-15T08:00:00.000Z',
        updatedAt: '2026-01-15T08:00:00.000Z',
      },
      {
        id: 'tag-commute',
        name: '通勤',
        nameNormalized: '通勤',
        createdAt: '2026-01-16T08:00:00.000Z',
        updatedAt: '2026-01-16T08:00:00.000Z',
      },
    ],
    itemTags: [
      { itemId: 'item-full-fields', tagId: 'tag-apple' },
      { itemId: 'item-full-fields', tagId: 'tag-commute' },
    ],
    assets: [
      {
        id: 'preset-earbuds',
        kind: 'preset',
        path: '/icons/items/earbuds.svg',
        blob: null,
        mime: 'image/svg+xml',
        width: 96,
        height: 96,
        styleVersion: null,
        promptVersion: null,
        sourceAssetId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    appMeta: [
      { key: 'seeded', value: '1' },
      { key: 'schemaVersion', value: '3' },
    ],
  }
}

/**
 * 用一个"只声明到 v3"的独立实例建库并写入数据。
 * 关库后Dexie 只留下磁盘上的IndexedDB 文件，v4 打开时就会走真实升级。
 */
async function seedV3Database(fixture: V3Fixture): Promise<void> {
  const legacy = new Dexie(DB_NAME)
  // 只声明 v1..v3 —— 与老用户库的实际版本完全一致
  legacy.version(1).stores(V3_SCHEMA)
  legacy.version(2).stores(V3_SCHEMA)
  legacy.version(3).stores(V3_SCHEMA)
  await legacy.open()

  // 逐表写入；此时 legacy 已是 v3
  for (const [table, rows] of Object.entries(fixture)) {
    if (rows.length > 0) {
      await (legacy as unknown as Record<string, { bulkAdd: (r: unknown[]) => Promise<unknown> }>)[
        table
      ]!.bulkAdd(rows)
    }
  }
  await legacy.close()
}

/** 逐字段深比较（顺序无关）。兼容 id / key / 复合主键三种主键形态。 */
function sortById<T extends { id?: string; key?: string; itemId?: string; tagId?: string }>(
  rows: T[],
): T[] {
  const key = (r: T) => String(r.id ?? r.key ?? `${r.itemId}#${r.tagId}`)
  return [...rows].sort((a, b) => key(a).localeCompare(key(b)))
}

describe('Dexie v3 → v4 迁移（Phase 3B）', () => {
  // fake-indexeddb 在同一个进程内共享底层存储，且一个库只能升级一次。
  // 因此这里只在 beforeAll 建一次 v3 库并完成升级，随后的断言全部是只读的 ——
  // 这也正是真实场景：老用户只会经历一次升级。
  let fixture: V3Fixture

  beforeAll(async () => {
    fixture = makeV3Fixture()
    await seedV3Database(fixture)
    // ⭐ 关键：db 声明了 v4，Dexie 会执行真实升级路径
    await db.open()
  })

  it('既有 6 张表的数据逐字段完全不变', async () => {
    expect(sortById(await db.items.toArray())).toEqual(sortById(fixture.items as never))
    expect(sortById(await db.categories.toArray())).toEqual(sortById(fixture.categories as never))
    expect(sortById(await db.tags.toArray())).toEqual(sortById(fixture.tags as never))
    expect(sortById(await db.itemTags.toArray())).toEqual(sortById(fixture.itemTags as never))
    expect(sortById(await db.assets.toArray())).toEqual(sortById(fixture.assets as never))
    expect(sortById(await db.appMeta.toArray())).toEqual(sortById(fixture.appMeta as never))
  })

  it('用户改过名的分类名不被重置为预设名', async () => {
    const renamed = await db.categories.get('cat-user-01')
    expect(renamed?.name).toBe('我改过名的分类 · 耳机')
    expect(renamed?.sortOrder).toBe(7)
    expect(renamed?.iconKey).toBe('preset-earbuds')
    expect(renamed?.updatedAt).toBe('2026-03-04T11:30:00.000Z')
  })

  it('appMeta 的 seeded / schemaVersion 不被迁移改动', async () => {
    // seeded 必须仍为 '1' —— 一旦被改，App 会重新 seed 预设分类，
    // 那就会覆盖用户自己整理过的分类名（项目既有硬不变量）
    expect(await db.appMeta.get('seeded')).toEqual({ key: 'seeded', value: '1' })
    expect(await db.appMeta.get('schemaVersion')).toEqual({ key: 'schemaVersion', value: '3' })
  })

  it('软删记录原样保留（deletedAt 不得被清空）', async () => {
    expect((await db.items.get('item-soft-deleted'))?.deletedAt).toBe('2026-05-05T05:05:05.000Z')
    expect((await db.categories.get('cat-user-deleted'))?.deletedAt).toBe('2026-02-20T00:00:00.000Z')
  })

  it('升级后版本号为 4，且 3 张新表存在且为空', async () => {
    expect(db.verno).toBe(4)
    expect(await db.syncState.count()).toBe(0)
    expect(await db.syncQueue.count()).toBe(0)
    expect(await db.syncConflicts.count()).toBe(0)
  })

  it('同步默认关闭（未启用时没有 syncState 行，不会有任何自动行为）', async () => {
    // 表是空的 → 没有 syncState 行 → 引擎读不到 enabled → 视为未启用
    expect(await db.syncState.get('sync')).toBeUndefined()
  })
})