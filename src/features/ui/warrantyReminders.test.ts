import { describe, expect, it } from 'vitest'
import { DISMISSED_WARRANTIES_KEY, readDismissedWarranties, writeDismissedWarranties } from './warrantyReminders'

describe('保修提醒关闭偏好', () => {
  it('以物品 ID 和到期日保存关闭结果，刷新后仍可读取', () => {
    let stored: string | null = null
    const storage = {
      getItem: (key: string) => { expect(key).toBe(DISMISSED_WARRANTIES_KEY); return stored },
      setItem: (key: string, value: string) => { expect(key).toBe(DISMISSED_WARRANTIES_KEY); stored = value },
    }
    expect(readDismissedWarranties(storage)).toEqual({})
    expect(writeDismissedWarranties({ a: '2026-11-01', b: '2026-11-02' }, storage)).toBe(true)
    expect(readDismissedWarranties(storage)).toEqual({ a: '2026-11-01', b: '2026-11-02' })
  })

  it.each(['null', '[]', '"invalid"', '{bad'] as const)('忽略无效的存储内容：%s', raw => {
    expect(readDismissedWarranties({ getItem: () => raw })).toEqual({})
  })

  it('保留合法记录，忽略空 ID、错误类型和无效日期', () => {
    const raw = JSON.stringify({ a: '2026-11-01', ' ': '2026-11-02', b: 2026, c: null, d: '2026-02-30' })
    expect(readDismissedWarranties({ getItem: () => raw })).toEqual({ a: '2026-11-01' })
  })

  it('存储不可用时安全回退，并返回保存失败供界面提示', () => {
    expect(readDismissedWarranties({ getItem: () => { throw new Error('denied') } })).toEqual({})
    expect(writeDismissedWarranties({ a: '2026-11-01' }, { setItem: () => { throw new Error('full') } })).toBe(false)
  })
})
