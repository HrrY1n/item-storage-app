import { ulid } from 'ulid'
import { db } from '../db'
import { markSyncDirty } from '../syncDirty'
import type { Tag } from '../../domain/types'
import { normalizeTagName } from '../../domain/tagNormalize'
import { syncRepository } from './syncRepository'

/**
 * Tag repository —— 标签 CRUD + 合并。
 * nameNormalized 有唯一索引：重复创建会在数据库层直接失败，
 * 这里先做显式检查以返回更友好的中文错误。
 */

export const tagRepository = {
  async list(): Promise<Tag[]> {
    const all = await db.tags.toArray()
    return all.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  },

  async getByNormalized(key: string): Promise<Tag | undefined> {
    return db.tags.where('nameNormalized').equals(key).first()
  },

  /** @throws 重名（大小写/空白/# 差异视为同一个标签） */
  async create(rawName: string): Promise<Tag> {
    const normalized = normalizeTagName(rawName)
    if (!normalized) throw new Error('标签名不能为空')
    const existing = await this.getByNormalized(normalized.key)
    if (existing) throw new Error(`标签 #${existing.name} 已存在`)
    const now = new Date().toISOString()
    const tag: Tag = {
      id: ulid(),
      name: normalized.display,
      nameNormalized: normalized.key,
      createdAt: now,
      updatedAt: now,
    }
    // Phase 3B：标签创建与 outbox 入队同事务
    await db.transaction('rw', [db.tags, db.syncQueue], async (tx) => {
      await db.tags.add(tag)
      await syncRepository.enqueueWithTx('tag', tag.id, tx)
    })
    markSyncDirty()
    return tag
  },

  /** 已存在则直接返回现有标签（供物品表单快速创建使用） */
  async getOrCreate(rawName: string): Promise<Tag> {
    const normalized = normalizeTagName(rawName)
    if (!normalized) throw new Error('标签名不能为空')
    const existing = await this.getByNormalized(normalized.key)
    if (existing) return existing
    return this.create(rawName)
  },

  async rename(id: string, rawName: string): Promise<void> {
    const normalized = normalizeTagName(rawName)
    if (!normalized) throw new Error('标签名不能为空')
    const conflict = await this.getByNormalized(normalized.key)
    if (conflict && conflict.id !== id) {
      throw new Error(`标签 #${conflict.name} 已存在，可考虑使用「合并」`)
    }
    await db.transaction('rw', [db.tags, db.syncQueue], async (tx) => {
      await db.tags.update(id, {
        name: normalized.display,
        nameNormalized: normalized.key,
        updatedAt: new Date().toISOString(),
      })
      await syncRepository.enqueueWithTx('tag', id, tx)
    })
    markSyncDirty()
  },

  /**
   * 删除标签并移除全部物品关联。
   *
   * Phase 3B：标签消失会**改变物品的 tagIds**，所以受影响物品必须重新入队，
   * 否则另一台设备上的物品还挂着这个已删标签。
   */
  async delete(id: string): Promise<void> {
    const affected = (await db.itemTags.where('tagId').equals(id).toArray()).map((l) => l.itemId)
    const now = new Date().toISOString()
    await db.transaction('rw', [db.tags, db.itemTags, db.syncQueue], async (tx) => {
      await db.tags.delete(id)
      await db.itemTags.where('tagId').equals(id).delete()
      // ⭐ tag 是**物理删除**：业务表里读不到了，必须把「删除事实」留在 outbox，
      //否则另一台设备会永远保留这个已删标签。
      await syncRepository.enqueueDeleteWithTx('tag', id, tx, now, now)
      for (const itemId of affected) {
        await syncRepository.enqueueWithTx('item', itemId, tx)
      }
    })
    markSyncDirty()
  },

  /** 合并：把 source 的全部物品关联转移给 target，然后删除 source */
  async merge(sourceId: string, targetId: string): Promise<void> {
    if (sourceId === targetId) throw new Error('不能合并到自身')
    const links = await db.itemTags.where('tagId').equals(sourceId).toArray()
    const affected = links.map((l) => l.itemId)
    const now = new Date().toISOString()
    await db.transaction('rw', [db.tags, db.itemTags, db.syncQueue], async (tx) => {
      const [source, target] = await Promise.all([db.tags.get(sourceId), db.tags.get(targetId)])
      if (!source || !target) throw new Error('标签不存在')
      for (const link of links) {
        const exists = await db.itemTags.get([link.itemId, targetId])
        if (exists) {
          await db.itemTags.delete([link.itemId, sourceId])
        } else {
          await db.itemTags.put({ itemId: link.itemId, tagId: targetId })
        }
      }
      await db.tags.delete(sourceId)
      await db.itemTags.where('tagId').equals(sourceId).delete()
      // ⭐ source tag 也是物理删除 → 登记删除事件，让另一台设备跟着消失
      await syncRepository.enqueueDeleteWithTx('tag', sourceId, tx, now, now)
      // 被合并进来的物品，其 tagIds 变了 → 必须重新入队
      for (const itemId of affected) {
        await syncRepository.enqueueWithTx('item', itemId, tx)
      }
      // target 标签本身没变字段，但它是被引用的那一端，刷新一次以确保上云
      await syncRepository.enqueueWithTx('tag', targetId, tx)
    })
    markSyncDirty()
  },

  async listItemTagLinks(): Promise<{ itemId: string; tagId: string }[]> {
    return db.itemTags.toArray()
  },

  async countItems(tagId: string): Promise<number> {
    return db.itemTags.where('tagId').equals(tagId).count()
  },

  /** 某物品的标签 id 列表 */
  async tagIdsOfItem(itemId: string): Promise<string[]> {
    const links = await db.itemTags.where('itemId').equals(itemId).toArray()
    return links.map((l) => l.tagId)
  },
}
