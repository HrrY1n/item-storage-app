import { isPurchasePlatform, parseDateToDayNumber, parsePriceInput } from './purchase'
import type { Category, PurchasePlatform } from './types'

export type RecognitionMode = 'photo' | 'order'
export const RECOGNITION_IMAGE_BYTES = 400 * 1024
export const RECOGNITION_BODY_BYTES = 560 * 1024
export const RECOGNITION_FIELDS = ['name', 'categoryName', 'note', 'priceText', 'purchaseDate', 'purchasePlatform'] as const
export type RecognitionField = typeof RECOGNITION_FIELDS[number]
export const RECOGNITION_LABELS: Record<RecognitionField, string> = {
  name: '名称', categoryName: '分类', note: '备注', priceText: '购买价格', purchaseDate: '购买日期', purchasePlatform: '购买平台',
}
export interface RecognitionCandidate {
  name: string | null
  categoryName: string | null
  note: string | null
  priceText: string | null
  purchaseDate: string | null
  purchasePlatform: PurchasePlatform | null
  warnings: string[]
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number): string | null => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > max) throw new Error('invalid-recognition-result')
  return value.trim() || null
}

/** 模型与网络结果都经过同一校验；照片模式不接受推测的购买信息。 */
export function validateRecognitionCandidate(value: unknown, mode: RecognitionMode): RecognitionCandidate {
  if (!record(value)) throw new Error('invalid-recognition-result')
  const warnings: string[] = []
  const read = (field: RecognitionField, max: number, valid: (value: string) => boolean = () => true) => {
    try {
      const result = text(value[field], max)
      if (result !== null && !valid(result)) throw new Error('invalid-recognition-result')
      return result
    } catch {
      warnings.push(`${RECOGNITION_LABELS[field]}格式有误，已忽略，请手动填写。`)
      return null
    }
  }
  const name = read('name', 100)
  const categoryName = read('categoryName', 100)
  const note = read('note', 1000)
  const priceText = mode === 'order' ? read('priceText', 14, price => {
    const cents = parsePriceInput(price)
    return cents !== null && Number.isSafeInteger(cents)
  }) : null
  const purchaseDate = mode === 'order' ? read('purchaseDate', 10, date => parseDateToDayNumber(date) !== null) : null
  const platform = mode === 'order' ? read('purchasePlatform', 30, isPurchasePlatform) : null
  const purchasePlatform = isPurchasePlatform(platform) ? platform : null
  if (!name && !categoryName && !note && !priceText && !purchaseDate && !purchasePlatform) throw new Error('empty-recognition-result')
  if (Array.isArray(value.warnings)) {
    for (const warning of value.warnings.slice(0, 5)) {
      try { const message = text(warning, 200); if (message) warnings.push(message) } catch { /* 无效提示不影响已校验的字段。 */ }
    }
  }
  return {
    name, categoryName, note, priceText, purchaseDate, purchasePlatform,
    warnings: warnings.slice(0, 5),
  }
}

export function parseRecognitionOutput(output: unknown, mode: RecognitionMode): RecognitionCandidate {
  if (!record(output)) throw new Error('invalid-recognition-result')
  const choice = Array.isArray(output.choices) ? output.choices[0] : null
  const message = record(choice) && record(choice.message) ? choice.message : null
  const raw = typeof output.response === 'string' ? output.response : message?.content
  if (typeof raw !== 'string' || raw.length > 12000) throw new Error('invalid-recognition-result')
  const json = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, '$1')
  return validateRecognitionCandidate(JSON.parse(json), mode)
}

/** 只匹配唯一的现有名称，模型不能指定数据库 ID 或创建分类。 */
export function matchRecognitionCategory(name: string | null, categories: Category[]): Category | undefined {
  if (!name) return
  const matches = categories.filter(category => category.deletedAt === null && category.name.trim() === name.trim())
  return matches.length === 1 ? matches[0] : undefined
}

export function isRecognitionImage(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('data:image/jpeg;base64,/9j/')) return false
  const base64 = value.slice('data:image/jpeg;base64,'.length)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return base64.length >= 40 && base64.length <= Math.ceil(RECOGNITION_IMAGE_BYTES / 3) * 4
    && base64.length / 4 * 3 - padding <= RECOGNITION_IMAGE_BYTES
    && base64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64)
}
