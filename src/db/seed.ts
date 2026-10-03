import { ulid } from 'ulid'
import { db } from './db'
import type { Asset, Category, IconKey } from '../domain/types'
import { CURRENT_SCHEMA_VERSION } from '../domain/types'
import { PRESET_ICONS } from '../data/icons'

/**
 * 首次启动 seed：只在真正空的数据库里写入一次默认分类与预置图标资产。
 * 用 appMeta.seeded 标记防重复；整个操作在单个事务内完成。
 */

const DEFAULT_TREE: { name: string; iconKey: IconKey; children?: string[] }[] = [
  { name: '数码与电子', iconKey: 'laptop', children: ['电脑设备', '手机与平板', '音频设备', '存储设备', '配件与线材'] },
  { name: '学习与办公', iconKey: 'book', children: ['书籍', '笔记本与纸品', '文具', '文件资料'] },
  { name: '衣物与穿搭', iconKey: 'tshirt', children: ['上衣', '裤装', '外套', '鞋履', '包袋', '配饰'] },
  { name: '生活用品', iconKey: 'bottle' },
  { name: '收藏与纪念', iconKey: 'backpack' },
  { name: '其他', iconKey: 'other' },
]

function buildDefaultCategories(now: string): Category[] {
  const list: Category[] = []
  DEFAULT_TREE.forEach((root, i) => {
    const rootId = ulid()
    list.push({
      id: rootId,
      parentId: null,
      name: root.name,
      sortOrder: i + 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      iconKey: root.iconKey,
    })
    root.children?.forEach((childName, j) => {
      list.push({
        id: ulid(),
        parentId: rootId,
        name: childName,
        sortOrder: j + 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
    })
  })
  return list
}

/** 预置图标资产：id 稳定（preset-<key>），便于 Item.iconAssetId 引用与测试 */
export function buildPresetAssets(now: string): Asset[] {
  return PRESET_ICONS.map((icon) => ({
    id: `preset-${icon.key}`,
    kind: 'preset' as const,
    path: icon.path,
    blob: null,
    mime: 'image/svg+xml',
    width: 96,
    height: 96,
    styleVersion: null,
    promptVersion: null,
    sourceAssetId: null,
    createdAt: now,
  }))
}

export async function seedIfEmpty(): Promise<void> {
  const seeded = await db.appMeta.get('seeded')
  if (seeded?.value === '1') return

  await db.transaction('rw', [db.categories, db.assets, db.appMeta], async () => {
    if ((await db.categories.count()) > 0) {
      await db.appMeta.put({ key: 'seeded', value: '1' })
      return
    }
    const now = new Date().toISOString()
    await db.categories.bulkAdd(buildDefaultCategories(now))
    await db.assets.bulkPut(buildPresetAssets(now))
    await db.appMeta.bulkPut([
      { key: 'seeded', value: '1' },
      { key: 'schemaVersion', value: String(CURRENT_SCHEMA_VERSION) },
    ])
  })
}

/**
 * 已存在数据库的 schemaVersion 升级（v1 → v2）。
 * Item 字段补齐由 Dexie version(2).upgrade 完成，这里只同步 appMeta 标记。
 */
export async function upgradeSchemaVersionMeta(): Promise<void> {
  const current = await db.appMeta.get('schemaVersion')
  const target = String(CURRENT_SCHEMA_VERSION)
  if (!current || current.value !== target) {
    await db.appMeta.put({ key: 'schemaVersion', value: target })
  }
}
