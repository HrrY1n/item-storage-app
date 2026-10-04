/**
 * 「最近使用的图标」本地偏好。
 *
 * 刻意不放 IndexedDB / 不进备份：它是纯 UI 偏好，跨设备迁移没有意义，
 * 与 SearchPage 的最近搜索保持同样的处理方式（localStorage + 静默降级）。
 *
 * pushRecentIcon 是纯函数（便于测试），IO 只在 load / persist 两个边界上。
 */

export const RECENT_ICONS_KEY = 'pil.recentIcons'
export const RECENT_ICONS_MAX = 8

/** 任意来源 → 合法 assetId 列表：只保留字符串、去重、截断到上限 */
export function parseRecentIcons(raw: unknown, max = RECENT_ICONS_MAX): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string' || v === '') continue
    if (out.includes(v)) continue
    out.push(v)
    if (out.length >= max) break
  }
  return out
}

/** 把刚选中的图标推到最前（已存在则提前），并截断 */
export function pushRecentIcon(
  assetId: string,
  prev: readonly string[],
  max = RECENT_ICONS_MAX,
): string[] {
  if (!assetId) return [...prev].slice(0, max)
  return [assetId, ...prev.filter((id) => id !== assetId)].slice(0, max)
}

export function loadRecentIcons(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_ICONS_KEY)
    return raw ? parseRecentIcons(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function persistRecentIcons(list: readonly string[]): void {
  try {
    localStorage.setItem(RECENT_ICONS_KEY, JSON.stringify(list))
  } catch {
    /* 忽略隐私模式等写入失败 */
  }
}
