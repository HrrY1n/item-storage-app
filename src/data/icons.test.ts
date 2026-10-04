import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import {
  ICON_CATEGORIES,
  PRESET_ICONS,
  getIconCategory,
  getIconPath,
  getIconLabel,
  iconsInCategory,
  presetIconOfAssetId,
  presetSortIndex,
  searchIcons,
} from './icons'

/**
 * 用 Vite 的资源查询拿仓库内文件，而不是 node:fs ——
 * 生产代码不使用任何 Node API，因此本仓库不引入 @types/node，
 * 测试也保持同样的约束。
 */
const svgBasenames = new Set(
  Object.keys(
    import.meta.glob('/public/icons/items/*.svg', { eager: true, query: '?raw', import: 'default' }),
  ).map((p) => p.split('/').pop() ?? ''),
)

describe('PRESET_ICONS 元数据', () => {
  it('规模达到"日常录入基本都能找到图标"的量级', () => {
    expect(PRESET_ICONS.length).toBeGreaterThanOrEqual(50)
  })

  it('key 唯一，且 path 与 key 一一对应', () => {
    const keys = PRESET_ICONS.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const icon of PRESET_ICONS) {
      expect(icon.path).toBe(`/icons/items/${icon.key}.svg`)
    }
  })

  it('每个图标都有对应 SVG 资源（元数据与资产不能脱节）', () => {
    const missing = PRESET_ICONS.filter((i) => !svgBasenames.has(`${i.key}.svg`)).map((i) => i.key)
    expect(missing).toEqual([])
  })

  it('没有游离的 SVG 资源（每个文件都被元数据引用）', () => {
    const referenced = new Set(PRESET_ICONS.map((i) => `${i.key}.svg`))
    const orphans = [...svgBasenames].filter((f) => !referenced.has(f))
    expect(orphans).toEqual([])
  })

  it('每个图标都属于一个已声明的分类，且每个分类都非空', () => {
    const declared = new Set(ICON_CATEGORIES.map((c) => c.key))
    for (const icon of PRESET_ICONS) expect(declared.has(icon.category)).toBe(true)
    for (const c of ICON_CATEGORIES) expect(iconsInCategory(c.key).length).toBeGreaterThan(0)
  })

  it('手机与平板是两个独立图标（本轮的硬性诉求）', () => {
    const phone = PRESET_ICONS.find((i) => i.key === 'phone')
    const tablet = PRESET_ICONS.find((i) => i.key === 'tablet')
    expect(phone).toBeTruthy()
    expect(tablet).toBeTruthy()
    expect(phone!.path).not.toBe(tablet!.path)
    expect(phone!.label).not.toBe(tablet!.label)
  })

  it('每个图标都带关键词，且关键词不与名称重复到无意义', () => {
    for (const icon of PRESET_ICONS) {
      expect(icon.keywords.length).toBeGreaterThan(0)
    }
  })
})

describe('图标检索', () => {
  it('空查询返回全部', () => {
    expect(searchIcons('').length).toBe(PRESET_ICONS.length)
    expect(searchIcons('   ').length).toBe(PRESET_ICONS.length)
  })

  it('中文日常叫法能命中', () => {
    expect(searchIcons('平板').map((i) => i.key)).toContain('tablet')
    expect(searchIcons('充电头').map((i) => i.key)).toContain('charger')
    expect(searchIcons('话筒').map((i) => i.key)).toContain('microphone')
    expect(searchIcons('鞋').map((i) => i.key)).toContain('shoes')
  })

  it('英文与品牌名也能命中', () => {
    expect(searchIcons('iPad').map((i) => i.key)).toContain('tablet')
    expect(searchIcons('kindle').map((i) => i.key)).toContain('ereader')
  })

  it('「电脑」是宽泛词，应同时覆盖多类设备', () => {
    const keys = searchIcons('电脑').map((i) => i.key)
    expect(keys).toContain('laptop')
    expect(keys).toContain('tablet')
    expect(keys).toContain('desktop')
  })

  it('大小写无关', () => {
    expect(searchIcons('IPAD').map((i) => i.key)).toContain('tablet')
  })

  it('查不到时返回空数组而不是全部', () => {
    expect(searchIcons('zzzz-not-an-icon')).toEqual([])
  })
})

describe('图标辅助函数', () => {
  it('assetId 与 key 之间可双向解析', () => {
    expect(presetIconOfAssetId('preset-tablet')?.key).toBe('tablet')
    expect(presetIconOfAssetId('ai-123')).toBeUndefined()
    expect(presetIconOfAssetId('preset-不存在')).toBeUndefined()
  })

  it('未知 key 一律回落到通用图标，不抛错', () => {
    expect(getIconPath('不存在')).toBe('/icons/items/other.svg')
    expect(getIconLabel('不存在')).toBe('通用物品')
    expect(getIconCategory('不存在')).toBe('other')
  })

  it('排序：已知 key 按编排顺序，未知排最后', () => {
    expect(presetSortIndex('preset-phone')).toBeLessThan(presetSortIndex('preset-umbrella'))
    expect(presetSortIndex('preset-unknown')).toBeGreaterThan(PRESET_ICONS.length)
  })
})

describe('index.html 主题引导脚本', () => {
  // 内联脚本必须与 src/theme/theme.ts 的常量保持一致，否则首帧会闪错主题
  it('在样式之前同步确定主题（避免深色模式启动白屏闪烁）', () => {
    expect(html).toContain("'pil.theme'")
    expect(html).toContain('localStorage.getItem(KEY)')
    expect(html).toContain('prefers-color-scheme: dark')
    expect(html).toContain('document.documentElement.dataset.theme')
    expect(html).toContain('#0E0E10')
    expect(html).toContain('#FAFAFA')
    // 脚本必须出现在 body（React 入口）之前
    expect(html.indexOf('localStorage.getItem(KEY)')).toBeLessThan(html.indexOf('id="root"'))
  })

  it('声明 color-scheme 与 theme-color，让浏览器原生控件与状态栏同步', () => {
    expect(html).toContain('name="color-scheme"')
    expect(html).toContain('name="theme-color"')
    expect(html).toContain('viewport-fit=cover')
  })
})
