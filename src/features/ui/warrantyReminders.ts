import { parseDateToDayNumber } from '../../domain/purchase'

export const DISMISSED_WARRANTIES_KEY = 'pil.dismissedWarranties'

/** 本设备 UI 偏好：以物品 ID 和到期日记住关闭结果，不进入业务数据、备份或同步。 */
export function readDismissedWarranties(storage?: Pick<Storage, 'getItem'>): Record<string, string> {
  try {
    const raw: unknown = JSON.parse((storage ?? localStorage).getItem(DISMISSED_WARRANTIES_KEY) ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter(([id, date]) =>
      id.trim() !== '' && typeof date === 'string' && parseDateToDayNumber(date) !== null,
    ))
  } catch {
    return {}
  }
}

export function writeDismissedWarranties(dismissed: Record<string, string>, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    (storage ?? localStorage).setItem(DISMISSED_WARRANTIES_KEY, JSON.stringify(dismissed))
    return true
  } catch {
    return false
  }
}
