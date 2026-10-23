import { isOwned } from '../../domain/lifecycle'
import type { Item } from '../../domain/types'

export const OVERVIEW_ITEMS_KEY = 'pil.overviewItems'
export const OVERVIEW_ITEMS_MAX = 2

/** null 表示自动选择；这是本设备 UI 偏好，不进入备份或同步。 */
export function parseOverviewItemIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const ids = [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.trim() !== ''))].slice(0, OVERVIEW_ITEMS_MAX)
  return ids.length > 0 ? ids : null
}

export function readOverviewItemIds(storage?: Pick<Storage, 'getItem'>): string[] | null {
  try {
    return parseOverviewItemIds(JSON.parse((storage ?? localStorage).getItem(OVERVIEW_ITEMS_KEY) ?? 'null'))
  } catch {
    return null
  }
}

export function writeOverviewItemIds(ids: readonly string[] | null, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    (storage ?? localStorage).setItem(OVERVIEW_ITEMS_KEY, JSON.stringify(parseOverviewItemIds(ids)))
    return true
  } catch {
    return false
  }
}

/** items 沿用 repository 的最近添加顺序；已失效的选择全部忽略。 */
export function overviewDisplayItems(items: readonly Item[], ids: readonly string[] | null): Item[] {
  const owned = items.filter(item => item.deletedAt === null && isOwned(item))
  const selected = (parseOverviewItemIds(ids) ?? []).flatMap(id => {
    const item = owned.find(item => item.id === id)
    return item ? [item] : []
  })
  return selected.length > 0 ? selected : owned.slice(0, OVERVIEW_ITEMS_MAX)
}
