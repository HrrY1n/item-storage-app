import { useLiveQuery } from 'dexie-react-hooks'
import { itemRepository } from '../../db/repositories/itemRepository'
import { categoryRepository } from '../../db/repositories/categoryRepository'
import { tagRepository } from '../../db/repositories/tagRepository'
import { assetRepository } from '../../db/repositories/assetRepository'
import type { Asset, Category, Item, ItemTag, Tag } from '../../domain/types'

/**
 * 数据 hooks：Page → hooks → repository → Dexie。
 * useLiveQuery 在相关表变化时自动重新查询，无需手动刷新。
 */

export function useItems(): Item[] | undefined {
  return useLiveQuery(() => itemRepository.listActive(), [])
}

export function useRecentItems(n: number): Item[] | undefined {
  return useLiveQuery(() => itemRepository.recent(n), [n])
}

export function useItem(id: string | undefined): Item | undefined {
  return useLiveQuery(() => (id ? itemRepository.getActive(id) : undefined), [id])
}

export function useCategories(): Category[] | undefined {
  return useLiveQuery(() => categoryRepository.listActive(), [])
}

export function useCategory(id: string | undefined): Category | undefined {
  return useLiveQuery(() => (id ? categoryRepository.getActive(id) : undefined), [id])
}

export function useTags(): Tag[] | undefined {
  return useLiveQuery(() => tagRepository.list(), [])
}

export function useItemTagLinks(): ItemTag[] | undefined {
  return useLiveQuery(() => tagRepository.listItemTagLinks(), [])
}

export function usePresetAssets(): Asset[] | undefined {
  return useLiveQuery(() => assetRepository.listPresets(), [])
}

/** assetId → 展示 URL 的 Map（给卡片/详情解析图标用） */
export function usePresetAssetMap(): Map<string, string> | undefined {
  const assets = usePresetAssets()
  if (!assets) return undefined
  return new Map(assets.map((a) => [a.id, assetRepository.iconUrl(a)]))
}
