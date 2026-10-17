import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import artworkJson from '../../assets/item-icons/prompts.json?raw'
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
const webpBasenames = new Set(
  Object.keys(
    import.meta.glob('/public/icons/items/*.webp', { eager: true, query: '?url', import: 'default' }),
  ).map((p) => p.split('/').pop() ?? ''),
)

describe('PRESET_ICONS 元数据', () => {
  it('图标库包含 217 个独立物品', () => {
    expect(PRESET_ICONS.length).toBe(217)
  })

  it('key 唯一，且 path 与 key 一一对应', () => {
    const keys = PRESET_ICONS.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const icon of PRESET_ICONS) {
      expect(icon.path).toBe(`/icons/items/${icon.key}.webp`)
    }
  })

  it('每个图标都有对应 WebP 资源（元数据与资产不能脱节）', () => {
    const missing = PRESET_ICONS.filter((i) => !webpBasenames.has(`${i.key}.webp`)).map((i) => i.key)
    expect(missing).toEqual([])
  })

  it('没有游离的 WebP 资源（每个文件都被元数据引用）', () => {
    const referenced = new Set(PRESET_ICONS.map((i) => `${i.key}.webp`))
    const orphans = [...webpBasenames].filter((f) => !referenced.has(f))
    expect(orphans).toEqual([])
  })

  it('生成记录与注册表逐项对应，新增图标保留来源及输出信息', () => {
    const artwork = JSON.parse(artworkJson) as { icons: {
      key: string; label: string; category: string; prompt: string; sourceImage: string
      generationBatch?: string; output?: string; outputSize?: number[]
      sourceSha256?: string; outputSha256?: string
    }[] }
    expect(artwork.icons.map(({ key, label, category }) => ({ key, label, category }))).toEqual(
      PRESET_ICONS.map(({ key, label, category }) => ({ key, label, category })),
    )
    const added = artwork.icons.filter((i) => i.generationBatch === 'icon-library-v2')
    expect(added).toHaveLength(63)
    for (const icon of added) {
      expect(icon.prompt.length).toBeGreaterThan(100)
      expect(icon.sourceImage).toMatch(/^exec-.*\.png$/)
      expect(icon.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(icon.outputSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(icon.output).toBe(`/icons/items/${icon.key}.webp`)
      expect(icon.outputSize).toEqual([768, 768])
    }
  })

  it('每个图标都属于一个已声明的分类，且每个分类都非空', () => {
    const declared = new Set(ICON_CATEGORIES.map((c) => c.key))
    for (const icon of PRESET_ICONS) expect(declared.has(icon.category)).toBe(true)
    for (const c of ICON_CATEGORIES) expect(iconsInCategory(c.key).length).toBeGreaterThan(0)
  })

  it('九大分类全部有图标，且没有空分类', () => {
    expect(ICON_CATEGORIES.map(({ key, label }) => [key, label])).toEqual([
      ['digital', '数码'], ['office', '办公'], ['apparel', '服饰'],
      ['life', '生活'], ['care', '护理'], ['kitchen', '厨房'],
      ['home', '家居'], ['hobby', '兴趣'], ['other', '其他'],
    ])
    for (const c of ICON_CATEGORIES) {
      expect(iconsInCategory(c.key).length).toBeGreaterThan(0)
    }
    expect(ICON_CATEGORIES.reduce((sum, c) => sum + iconsInCategory(c.key).length, 0)).toBe(PRESET_ICONS.length)
  })

  it('Phase 2G 新增分类可用：护理 / 厨房', () => {
    expect(iconsInCategory('care').map((i) => i.key)).toContain('electrictoothbrush')
    expect(iconsInCategory('kitchen').map((i) => i.key)).toContain('airfryer')
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

  it('「平板 / iPad / 平板电脑」三种叫法都稳定命中 tablet', () => {
    for (const q of ['平板', 'iPad', 'ipad', '平板电脑', 'Tablet', 'iPad mini']) {
      expect(searchIcons(q).map((i) => i.key), `查询「${q}」`).toContain('tablet')
    }
    // 反例：「平板壳」指的是保护壳，不应该把 tablet 也塞进来
    expect(searchIcons('平板壳').map((i) => i.key)).toEqual(['tabletcase'])
  })

  it('新增图标按日常叫法可搜', () => {
    expect(searchIcons('吹风机').map((i) => i.key)).toContain('hairdryer')
    expect(searchIcons('电动牙刷').map((i) => i.key)).toContain('electrictoothbrush')
    expect(searchIcons('空气炸锅').map((i) => i.key)).toContain('airfryer')
    expect(searchIcons('哑铃').map((i) => i.key)).toContain('dumbbell')
    expect(searchIcons('帐篷').map((i) => i.key)).toContain('tent')
    expect(searchIcons('螺丝刀').map((i) => i.key)).toContain('screwdriver')
  })

  it('磁吸平板键盘有独立图标，常见叫法都能优先找到', () => {
    const keyboard = presetIconOfAssetId('preset-tabletkeyboard')
    expect(keyboard?.label).toBe('平板磁吸键盘')
    expect(keyboard?.category).toBe('digital')
    expect(keyboard?.path).not.toBe(getIconPath('keyboard'))
    expect(keyboard?.path).not.toBe(getIconPath('tabletcase'))
    for (const query of ['磁吸键盘', '平板键盘', '平板电脑键盘', '妙控键盘', 'iPad 键盘', 'Magic Keyboard', 'Tablet Keyboard', 'Keyboard Folio']) {
      expect(searchIcons(query)[0]?.key, query).toBe('tabletkeyboard')
    }
    expect(searchIcons('键盘')[0]?.key).toBe('keyboard')
  })

  it('USB 集线器、HDMI 转接器和读卡器统一为一个拓展坞', () => {
    expect(presetIconOfAssetId('preset-dockingstation')?.label).toBe('拓展坞')
    for (const key of ['usbhub', 'hdmiadapter', 'cfreader']) {
      expect(presetIconOfAssetId(`preset-${key}`)).toBeUndefined()
    }
    for (const query of ['拓展坞', '扩展坞', 'USB 集线器', 'HDMI 转接器', 'HDMI', '读卡器', 'Docking Station', 'USB-C Hub']) {
      expect(searchIcons(query)[0]?.key, query).toBe('dockingstation')
    }
    for (const key of ['usb', 'dock']) {
      expect(presetIconOfAssetId(`preset-${key}`)).toBeDefined()
    }
  })

  it('Pocket 云台相机与 Action 运动相机可分别检索，大疆可找到相关设备', () => {
    for (const [key, queries] of [
      ['djipocket', ['Pocket', 'DJI Pocket', 'Osmo Pocket', '大疆Pocket', '云台相机', '口袋相机']],
      ['djiaction', ['Action', 'DJI Action', 'Osmo Action', '大疆Action', '运动相机', '运动摄像机']],
    ] as const) {
      expect(presetIconOfAssetId(`preset-${key}`)?.category).toBe('digital')
      for (const query of queries) expect(searchIcons(query)[0]?.key, query).toBe(key)
    }
    expect(searchIcons('大疆').map((i) => i.key)).toEqual(['djipocket', 'djiaction', 'microphone'])
    expect(searchIcons('DJI').map((i) => i.key)).toEqual(['djipocket', 'djiaction', 'microphone'])
    expect(getIconPath('djipocket')).not.toBe(getIconPath('djiaction'))
    expect(searchIcons('相机')[0]?.key).toBe('camera')
  })

  it('DJI Mic Mini 和领夹/无线麦别名复用稳定的麦克风图标', () => {
    expect(presetIconOfAssetId('preset-microphone')?.path).toBe('/icons/items/microphone.webp')
    for (const query of ['DJI Mic Mini', 'Mic Mini', '大疆 Mic Mini', '领夹麦', '无线麦克风', '话筒']) {
      expect(searchIcons(query)[0]?.key, query).toBe('microphone')
    }
  })

  it('无人机、稳定器和磁吸手机散热器可分别搜索并选择', () => {
    const added = [
      ['drone', '无人机', ['无人机', '航拍机', '四旋翼', 'Drone', 'UAV']],
      ['gimbal', '手持稳定器', ['手持稳定器', '相机稳定器', '三轴云台', 'Gimbal', 'Stabilizer']],
      ['phonecooler', '手机散热器', ['手机散热器', '手机散热背夹', '散热背夹', '磁吸散热器', 'RGB散热器', 'Magnetic Phone Cooler']],
    ] as const
    const paths = []
    for (const [key, label, queries] of added) {
      const preset = presetIconOfAssetId(`preset-${key}`)
      expect(preset?.label).toBe(label)
      expect(preset?.category).toBe('digital')
      paths.push(preset?.path)
      for (const query of queries) expect(searchIcons(query)[0]?.key, query).toBe(key)
    }
    expect(new Set(paths).size).toBe(3)
    expect(paths).not.toContain(getIconPath('djipocket'))
    expect(paths).not.toContain(getIconPath('phone'))
  })

  it('六种不记录的数码附件不再出现在图标库或搜索中', () => {
    for (const [key, label] of [
      ['screenprotector', '屏幕保护膜'], ['battery', '充电电池'], ['hdddock', '硬盘盒'],
      ['cableorganizer', '理线器'], ['powerstrip', '插线板'], ['wristrest', '键盘腕托'],
    ]) {
      expect(presetIconOfAssetId(`preset-${key}`), label).toBeUndefined()
      expect(searchIcons(label), label).toEqual([])
    }
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

  it('按名称精确、前缀、包含、别名精确、宽泛关键词排序', () => {
    expect(searchIcons('笔记本').map((i) => i.key).slice(0, 2)).toEqual(['notebook', 'laptop'])
    expect(searchIcons('手表').map((i) => i.key).slice(0, 2)).toEqual(['watch', 'smartwatch'])
    const headphones = searchIcons('耳机').map((i) => i.key)
    expect(headphones[0]).toBe('earbudcase')
    expect(headphones.indexOf('earbuds')).toBeGreaterThan(0)
    const computers = searchIcons('电脑').map((i) => i.key)
    expect(computers.indexOf('desktop')).toBeGreaterThan(computers.indexOf('laptop'))
    expect(searchIcons('pad')[0].key).toBe('tablet')
  })

  it('常见简称、英文及品牌名优先返回相关设备', () => {
    expect(searchIcons('Mic Mini')[0].key).toBe('microphone')
    expect(searchIcons('iPad')[0].key).toBe('tablet')
    expect(searchIcons('laptop')[0].key).toBe('laptop')
    expect(searchIcons('  IPAD  ')).toEqual(searchIcons('ipad'))
  })

  it('新增独立物品的名称优先于旧图标的宽泛别名', () => {
    expect(searchIcons('卷尺')[0].key).toBe('tapemeasure')
    expect(searchIcons('置物架')[0].key).toBe('shelf')
    expect(searchIcons('DDR5')[0].key).toBe('ram')
    expect(searchIcons('NVIDIA')[0].key).toBe('graphicscard')
    expect(searchIcons('Facial Cleanser')[0].key).toBe('cleanser')
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
    expect(getIconPath('不存在')).toBe('/icons/items/other.webp')
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
    expect(html).toContain('#101013')
    expect(html).toContain('#F2F2F4')
    // 脚本必须出现在 body（React 入口）之前
    expect(html.indexOf('localStorage.getItem(KEY)')).toBeLessThan(html.indexOf('id="root"'))
  })

  it('声明 color-scheme 与 theme-color，让浏览器原生控件与状态栏同步', () => {
    expect(html).toContain('name="color-scheme"')
    expect(html).toContain('name="theme-color"')
    expect(html).toContain('viewport-fit=cover')
  })
})
