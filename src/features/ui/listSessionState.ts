import type { ItemStatus } from '../../domain/types'
import type { DispositionKind } from '../data/itemPresentation'
import type { ItemSortKey } from '../data/viewModels'

export const LIST_STATE_KEY = 'pil.listState'

/**
 * 物品列表的会话内 UI 状态：同一标签页会话中离开列表再返回时恢复。
 * 与 pil.* 其它键一样是本设备 UI 偏好——不进入 IndexedDB、ZIP 备份或云同步。
 * 用 sessionStorage 而非 localStorage：新标签页/新会话从默认值开始。
 */
export interface ListSessionState {
  status: ItemStatus
  query: string
  categoryId: string | null
  sort: ItemSortKey
  view: 'grid' | 'list'
  disposition: DispositionKind | 'all'
}

const STATUSES: readonly ItemStatus[] = ['owned', 'wishlist', 'disposed']
const SORTS: readonly ItemSortKey[] = ['recent', 'name', 'cost', 'daily']
const DISPOSITIONS: readonly (DispositionKind | 'all')[] = ['all', 'sold', 'discarded', 'other']
const MAX_QUERY_LENGTH = 200

export const DEFAULT_LIST_SESSION_STATE: ListSessionState = {
  status: 'owned',
  query: '',
  categoryId: null,
  sort: 'recent',
  view: 'grid',
  disposition: 'all',
}

/** 逐字段校验：非法/缺失字段单独回落默认值，损坏 JSON 或旧枚举都不会让页面出错。 */
export function parseListSessionState(raw: unknown): ListSessionState {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_LIST_SESSION_STATE }
  const value = raw as Record<string, unknown>
  return {
    status: STATUSES.includes(value.status as ItemStatus) ? (value.status as ItemStatus) : DEFAULT_LIST_SESSION_STATE.status,
    query: typeof value.query === 'string' ? value.query.slice(0, MAX_QUERY_LENGTH) : DEFAULT_LIST_SESSION_STATE.query,
    categoryId: typeof value.categoryId === 'string' && value.categoryId.trim() !== '' ? value.categoryId : null,
    sort: SORTS.includes(value.sort as ItemSortKey) ? (value.sort as ItemSortKey) : DEFAULT_LIST_SESSION_STATE.sort,
    view: value.view === 'list' ? 'list' : DEFAULT_LIST_SESSION_STATE.view,
    disposition: DISPOSITIONS.includes(value.disposition as DispositionKind | 'all')
      ? (value.disposition as DispositionKind | 'all')
      : DEFAULT_LIST_SESSION_STATE.disposition,
  }
}

export function readListSessionState(storage?: Pick<Storage, 'getItem'>): ListSessionState {
  try {
    return parseListSessionState(JSON.parse((storage ?? sessionStorage).getItem(LIST_STATE_KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_LIST_SESSION_STATE }
  }
}

export function writeListSessionState(state: ListSessionState, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    (storage ?? sessionStorage).setItem(LIST_STATE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}
