import { describe, expect, it } from 'vitest'
import {
  RECENT_ICONS_MAX,
  parseRecentIcons,
  pushRecentIcon,
} from './recentIcons'

describe('parseRecentIcons', () => {
  it('非数组一律返回空', () => {
    expect(parseRecentIcons(null)).toEqual([])
    expect(parseRecentIcons('preset-phone')).toEqual([])
    expect(parseRecentIcons({})).toEqual([])
  })

  it('过滤非字符串与空串', () => {
    expect(parseRecentIcons(['preset-phone', 1, null, '', {}, 'preset-tablet'])).toEqual([
      'preset-phone',
      'preset-tablet',
    ])
  })

  it('去重并截断到上限', () => {
    const many = Array.from({ length: 20 }, (_, i) => `preset-${i}`)
    expect(parseRecentIcons(many).length).toBe(RECENT_ICONS_MAX)
    expect(parseRecentIcons(['a', 'a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('pushRecentIcon', () => {
  it('新项推到最前', () => {
    expect(pushRecentIcon('b', ['a'])).toEqual(['b', 'a'])
  })

  it('已存在则提前而不是重复', () => {
    expect(pushRecentIcon('b', ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('超过上限时丢弃最旧的', () => {
    const prev = Array.from({ length: RECENT_ICONS_MAX }, (_, i) => `preset-${i}`)
    const next = pushRecentIcon('preset-new', prev)
    expect(next[0]).toBe('preset-new')
    expect(next.length).toBe(RECENT_ICONS_MAX)
    expect(next).not.toContain(`preset-${RECENT_ICONS_MAX - 1}`)
  })

  it('空串不污染列表，且不修改入参（纯函数）', () => {
    const prev = ['a', 'b']
    expect(pushRecentIcon('', prev)).toEqual(['a', 'b'])
    expect(prev).toEqual(['a', 'b'])
  })
})
