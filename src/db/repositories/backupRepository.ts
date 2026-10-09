import { db } from '../db'
import type { Asset, Category, Item, ItemTag, Tag } from '../../domain/types'
import type { BackupPayload } from '../../domain/backup'
import { MIGRATABLE_APP_META_KEYS } from '../../domain/backup'
import { disableInTransaction } from './syncRepository'

/**
 * 备份相关的数据库读写（repositories 是唯一可直接 import db 的一层）。
 */

export interface Snapshot {
  items: Item[]
  categories: Category[]
  tags: Tag[]
  itemTags: ItemTag[]
  assets: Asset[]
  appMeta: Record<string, string>
}

/** 读取当前数据库全量快照（含软删除记录，保证备份可完整还原） */
export async function readSnapshot(): Promise<Snapshot> {
  const [items, categories, tags, itemTags, assets, metaRows] = await Promise.all([
    db.items.toArray(),
    db.categories.toArray(),
    db.tags.toArray(),
    db.itemTags.toArray(),
    db.assets.toArray(),
    db.appMeta.toArray(),
  ])

  const appMeta: Record<string, string> = {}
  for (const row of metaRows) {
    if (MIGRATABLE_APP_META_KEYS.includes(row.key as (typeof MIGRATABLE_APP_META_KEYS)[number])) {
      appMeta[row.key] = row.value
    }
  }

  return { items, categories, tags, itemTags, assets, appMeta }
}

async function replaceAllWithBackupInTransaction(payload: BackupPayload): Promise<void> {
  await Promise.all([
    db.items.clear(),
    db.categories.clear(),
    db.tags.clear(),
    db.itemTags.clear(),
    db.assets.clear(),
    db.appMeta.clear(),
  ])

  await Promise.all([
    db.items.bulkAdd(payload.items),
    db.categories.bulkAdd(payload.categories),
    db.tags.bulkAdd(payload.tags),
    db.itemTags.bulkAdd(payload.itemTags),
    db.assets.bulkAdd(payload.assets),
  ])

  const metaRows = Object.entries(payload.appMeta).map(([key, value]) => ({ key, value }))
  if (metaRows.length > 0) await db.appMeta.bulkAdd(metaRows)
}

/**
 * Replace Restore：在**单个事务**内完整替换全部数据。
 *
 * 事务保证原子性：中途任何异常都会整体回滚，不会出现"清空一半"的半成品状态。
 * 调用方必须已完成全部校验并取得用户确认。
 */
export async function replaceAllWithBackup(payload: BackupPayload): Promise<void> {
  await db.transaction(
    'rw',
    [db.items, db.categories, db.tags, db.itemTags, db.assets, db.appMeta],
    () => replaceAllWithBackupInTransaction(payload),
  )
}

/** Replace Restore + 使旧同步会话失效，必须是同一个本地事务。 */
export async function replaceAllWithBackupAndDisableSync(payload: BackupPayload): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.items,
      db.categories,
      db.tags,
      db.itemTags,
      db.assets,
      db.appMeta,
      db.syncQueue,
      db.syncState,
    ],
    async () => {
      await replaceAllWithBackupInTransaction(payload)
      await db.syncQueue.clear()
      await disableInTransaction(db.syncState)
    },
  )
}
