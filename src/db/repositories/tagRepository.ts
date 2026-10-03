import { ulid } from 'ulid'
import { db } from '../db'
import type { Tag } from '../../domain/types'
import { normalizeTagName } from '../../domain/tagNormalize'

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
    await db.tags.add(tag)
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
    await db.tags.update(id, {
      name: normalized.display,
      nameNormalized: normalized.key,
      updatedAt: new Date().toISOString(),
    })
  },

  /** 删除标签并移除全部物品关联 */
  async delete(id: string): Promise<void> {
    await db.transaction('rw', [db.tags, db.itemTags], async () => {
      await db.tags.delete(id)
      await db.itemTags.where('tagId').equals(id).delete()
    })
  },

  /** 合并：把 source 的全部物品关联转移给 target，然后删除 source */
  async merge(sourceId: string, targetId: string): Promise<void> {
    if (sourceId === targetId) throw new Error('不能合并到自身')
    await db.transaction('rw', [db.tags, db.itemTags], async () => {
      const [source, target] = await Promise.all([db.tags.get(sourceId), db.tags.get(targetId)])
      if (!source || !target) throw new Error('标签不存在')
      const links = await db.itemTags.where('tagId').equals(sourceId).toArray()
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
    })
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
