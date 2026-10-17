import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORY_TREE } from './categories'
import { PRESET_ICONS } from './icons'

describe('默认物品分类', () => {
  it('一级保持精简，每个图标恰好有一个归属且分类封面有效', () => {
    expect(DEFAULT_CATEGORY_TREE).toHaveLength(7)
    const assigned = DEFAULT_CATEGORY_TREE.flatMap((root) =>
      root.children.length ? root.children.flatMap((child) => child.iconKeys) : [root.iconKey],
    )
    expect(assigned.slice().sort()).toEqual(PRESET_ICONS.map((icon) => icon.key).sort())
    const keys = new Set(assigned)
    for (const root of DEFAULT_CATEGORY_TREE) {
      expect(keys.has(root.iconKey)).toBe(true)
      expect(new Set(root.children.map((child) => child.name)).size).toBe(root.children.length)
      for (const child of root.children) expect(child.iconKeys.length).toBeGreaterThan(0)
    }
  })

  it('新增数码设备和生活类型都有具体二级分类', () => {
    const groups = DEFAULT_CATEGORY_TREE.flatMap((root) => root.children)
    expect(groups.find((child) => child.iconKeys.includes('djipocket'))?.name).toBe('摄影摄像')
    expect(groups.find((child) => child.iconKeys.includes('djiaction'))?.name).toBe('摄影摄像')
    expect(groups.find((child) => child.iconKeys.includes('drone'))?.name).toBe('摄影摄像')
    expect(groups.find((child) => child.iconKeys.includes('gimbal'))?.name).toBe('摄影摄像')
    expect(groups.find((child) => child.iconKeys.includes('phonecooler'))?.name).toBe('手机与平板')
    expect(groups.find((child) => child.iconKeys.includes('dockingstation'))?.name).toBe('配件与线材')
    expect(groups.find((child) => child.iconKeys.includes('tabletkeyboard'))?.name).toBe('键鼠与输入设备')
    for (const key of ['airfryer', 'cleanser', 'dumbbell', 'bed', 'puzzle']) {
      expect(groups.some((child) => child.iconKeys.includes(key)), key).toBe(true)
    }
  })
})
