import { describe, expect, it } from 'vitest'
import { normalizeTagName, sameTagName } from './tagNormalize'

describe('normalizeTagName', () => {
  it('trim 首尾空白', () => {
    expect(normalizeTagName('  Apple  ')?.display).toBe('Apple')
  })

  it('去除开头 # 前缀', () => {
    expect(normalizeTagName('#Apple')?.display).toBe('Apple')
    expect(normalizeTagName('## 冬季')?.display).toBe('冬季')
  })

  it('折叠内部连续空白', () => {
    expect(normalizeTagName('移动  电源')?.display).toBe('移动 电源')
  })

  it('保留原始大小写作为显示名，小写折叠作为比较键', () => {
    const n = normalizeTagName('Apple')
    expect(n?.display).toBe('Apple')
    expect(n?.key).toBe('apple')
  })

  it('空白或纯 # 输入非法', () => {
    expect(normalizeTagName('')).toBeNull()
    expect(normalizeTagName('   ')).toBeNull()
    expect(normalizeTagName('#')).toBeNull()
    expect(normalizeTagName('##  ')).toBeNull()
  })
})

describe('sameTagName', () => {
  it('Apple / apple / " Apple " / #APPLE 视为同一个标签', () => {
    expect(sameTagName('Apple', 'apple')).toBe(true)
    expect(sameTagName(' Apple ', '#APPLE')).toBe(true)
  })

  it('不同名称不相等', () => {
    expect(sameTagName('Apple', 'Apples')).toBe(false)
  })
})
