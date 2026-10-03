import type { IconKey } from '../types'

/**
 * 预置占位图标注册表（Icon Asset Library 的 Prototype 形态）。
 *
 * 未来替换为正式 AI 图标包时，只需替换 public/icons/items/ 下的资源
 * 与本注册表的元数据，组件代码不变。
 */
export interface PresetIcon {
  key: IconKey
  label: string
  path: string
}

export const PRESET_ICONS: PresetIcon[] = [
  { key: 'laptop', label: '笔记本电脑', path: '/icons/items/laptop.svg' },
  { key: 'phone', label: '手机 / 平板', path: '/icons/items/phone.svg' },
  { key: 'earbuds', label: '耳机', path: '/icons/items/earbuds.svg' },
  { key: 'mouse', label: '鼠标', path: '/icons/items/mouse.svg' },
  { key: 'keyboard', label: '键盘', path: '/icons/items/keyboard.svg' },
  { key: 'book', label: '书', path: '/icons/items/book.svg' },
  { key: 'notebook', label: '笔记本 / 文具', path: '/icons/items/notebook.svg' },
  { key: 'tshirt', label: '上衣', path: '/icons/items/tshirt.svg' },
  { key: 'shoes', label: '鞋', path: '/icons/items/shoes.svg' },
  { key: 'backpack', label: '包袋', path: '/icons/items/backpack.svg' },
  { key: 'bottle', label: '水杯 / 瓶', path: '/icons/items/bottle.svg' },
  { key: 'other', label: '其他', path: '/icons/items/other.svg' },
]

const iconMap = new Map(PRESET_ICONS.map((i) => [i.key, i]))

/** 预置资产的展示顺序：按 PRESET_ICONS 编排顺序，未知 id 排最后 */
export function presetSortIndex(assetId: string): number {
  const key = assetId.replace(/^preset-/, '') as IconKey
  const index = PRESET_ICONS.findIndex((i) => i.key === key)
  return index === -1 ? 999 : index
}

export function getIconPath(key: IconKey): string {
  return iconMap.get(key)?.path ?? '/icons/items/other.svg'
}

export function getIconLabel(key: IconKey): string {
  return iconMap.get(key)?.label ?? '其他'
}
