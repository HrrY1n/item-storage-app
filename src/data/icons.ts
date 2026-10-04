import type { IconKey } from '../types'

/**
 * 预置物品图标注册表（Icon Asset Library 的元数据唯一来源）。
 *
 * 视觉资产在 public/icons/items/<key>.svg，由 scripts/gen-item-icons.mjs 生成：
 * 统一 96×96 画布、统一描边与调色板、透明底（底衬交给 CSS 语义 token，
 * 因此浅色与深色主题共用同一套资源）。
 *
 * 这里只管"有什么图标、怎么被找到"：key / 中文名 / 分类 / 检索关键词。
 * 组件与数据层都通过本文件的辅助函数取图标，不直接读路径。
 */
export interface PresetIcon {
  key: IconKey
  /** 中文名（用于图标库与选择器展示） */
  label: string
  /** 随包路径 */
  path: string
  /** 归属分类，用于图标选择器分组浏览 */
  category: IconCategory
  /**
   * 检索关键词：中文别名 + 英文/品牌/俗称。
   * 目标是"输入日常叫法就能找到"，例如 iPad → tablet、充电头 → charger。
   */
  keywords: string[]
}

export type IconCategory = 'digital' | 'office' | 'apparel' | 'life' | 'home' | 'hobby' | 'other'

/** 分类的展示顺序与中文名（'recent' 是选择器里的虚拟分类，不属于图标自身） */
export const ICON_CATEGORIES: { key: IconCategory; label: string }[] = [
  { key: 'digital', label: '数码' },
  { key: 'office', label: '办公' },
  { key: 'apparel', label: '服饰' },
  { key: 'life', label: '生活' },
  { key: 'home', label: '家居' },
  { key: 'hobby', label: '兴趣' },
  { key: 'other', label: '其他' },
]

const icon = (
  key: string,
  label: string,
  category: IconCategory,
  keywords: string[],
): PresetIcon => ({ key, label, path: `/icons/items/${key}.svg`, category, keywords })

export const PRESET_ICONS: PresetIcon[] = [
  // ------------------------------------------------------------ 数码
  icon('phone', '手机', 'digital', ['手机', '电话', 'iPhone', '安卓', 'Android', '智能机', '移动电话']),
  icon('tablet', '平板电脑', 'digital', ['平板', 'iPad', '安卓平板', '平板电脑', 'pad', 'Tablet']),
  icon('laptop', '笔记本电脑', 'digital', ['笔记本', '电脑', 'MacBook', '笔电', '便携电脑', 'Laptop']),
  icon('desktop', '台式电脑', 'digital', ['台式机', '主机', '电脑', 'PC', '工作站', 'Desktop']),
  icon('monitor', '显示器', 'digital', ['屏幕', '显示屏', '外接屏', '显示器', 'Monitor']),
  icon('smartwatch', '智能手表', 'digital', ['手表', '智能表', 'Apple Watch', '运动表', 'Watch']),
  icon('band', '智能手环', 'digital', ['手环', '运动手环', '腕带', 'Band']),
  icon('earbuds', '无线耳机', 'digital', ['耳机', 'AirPods', '蓝牙耳机', '入耳', '真无线', 'Earbuds']),
  icon('headphones', '头戴式耳机', 'digital', ['耳机', '头戴', '耳罩', '降噪耳机', 'Headphones']),
  icon('speaker', '音箱', 'digital', ['音响', '蓝牙音箱', '喇叭', '低音炮', 'Speaker']),
  icon('microphone', '麦克风', 'digital', ['话筒', '麦', '录音', '麦克风', 'Mic']),
  icon('camera', '相机', 'digital', ['照相机', '单反', '微单', '相机', 'Camera']),
  icon('lens', '镜头', 'digital', ['镜头', '定焦', '变焦', 'Lens']),
  icon('gameconsole', '游戏机', 'digital', ['主机', 'Switch', 'PS5', '掌机', '游戏机', 'PlayStation']),
  icon('gamepad', '游戏手柄', 'digital', ['手柄', '控制器', 'Gamepad', 'Controller']),
  icon('keyboard', '键盘', 'digital', ['键盘', '机械键盘', 'Keyboard']),
  icon('mouse', '鼠标', 'digital', ['鼠标', 'Mouse', '光标']),
  icon('trackpad', '触控板', 'digital', ['触控板', '触摸板', '数位板', 'Trackpad']),
  icon('charger', '充电器', 'digital', ['充电头', '电源适配器', '快充', '插头', '充电器', 'Charger']),
  icon('powerbank', '充电宝', 'digital', ['移动电源', '充电宝', '电池', 'Power Bank']),
  icon('cable', '数据线', 'digital', ['线', '充电线', '数据线', 'Type-C', 'lightning', '线材']),
  icon('hdd', '移动硬盘', 'digital', ['硬盘', '移动硬盘', '存储', '固态硬盘', 'HDD', 'SSD']),
  icon('usb', 'U 盘', 'digital', ['U盘', '优盘', '闪存盘', 'U 盘', 'USB', '闪存']),
  icon('sdcard', '存储卡', 'digital', ['内存卡', 'TF卡', '存储卡', 'SD卡', 'MicroSD']),
  icon('router', '路由器', 'digital', ['路由', '网络', 'WiFi', '无线网', 'Router']),
  icon('printer', '打印机', 'digital', ['打印', '打印机', 'Printer']),
  icon('ereader', '电子书阅读器', 'digital', ['阅读器', 'Kindle', '墨水屏', '电纸书', '阅读器']),

  // ------------------------------------------------------------ 办公
  icon('book', '书籍', 'office', ['书', '图书', '书籍', '小说', 'Book']),
  icon('notebook', '笔记本', 'office', ['本子', '记事本', '纸品', '手账', '笔记本', 'Notebook']),
  icon('folder', '文件夹', 'office', ['文件', '资料', '档案', '文件夹', 'Folder']),
  icon('pen', '笔', 'office', ['钢笔', '签字笔', '圆珠笔', '笔', 'Pen']),
  icon('calculator', '计算器', 'office', ['计算器', 'Calculator']),
  icon('scissors', '剪刀', 'office', ['剪刀', '剪子', 'Scissors']),
  icon('stapler', '订书机', 'office', ['订书器', '订书机', 'Stapler']),

  // ------------------------------------------------------------ 服饰
  icon('tshirt', '上衣', 'apparel', ['T恤', '短袖', '卫衣', '上衣', '衣服', 'T-shirt']),
  icon('pants', '裤子', 'apparel', ['裤', '长裤', '牛仔裤', '裤装', 'Pants']),
  icon('coat', '外套', 'apparel', ['夹克', '大衣', '外套', '羽绒服', 'Coat', 'Jacket']),
  icon('shoes', '鞋', 'apparel', ['皮鞋', '鞋子', '鞋履', '鞋', 'Shoes']),
  icon('sneakers', '运动鞋', 'apparel', ['球鞋', '跑鞋', '运动鞋', 'Sneakers']),
  icon('hat', '帽子', 'apparel', ['帽', '棒球帽', '帽子', 'Hat', 'Cap']),
  icon('glasses', '眼镜', 'apparel', ['眼镜', '墨镜', '太阳镜', 'Glasses']),
  icon('watch', '手表', 'apparel', ['手表', '腕表', '机械表', 'Watch']),
  icon('backpack', '双肩包', 'apparel', ['背包', '书包', '双肩包', '包', 'Backpack']),
  icon('handbag', '手提包', 'apparel', ['包', '手提包', '单肩包', '托特包', 'Bag']),
  icon('wallet', '钱包', 'apparel', ['钱夹', '钱包', 'Wallet']),

  // ------------------------------------------------------------ 生活
  icon('bottle', '水杯', 'life', ['杯子', '水壶', '水杯', '杯', 'Bottle']),
  icon('thermos', '保温杯', 'life', ['保温壶', '保温杯', '焖烧杯', 'Thermos']),
  icon('umbrella', '雨伞', 'life', ['伞', '雨伞', '遮阳伞', 'Umbrella']),
  icon('key', '钥匙', 'life', ['钥匙', '门卡', 'Key']),
  icon('toolbox', '工具箱', 'life', ['工具', '工具箱', '五金', 'Toolbox']),
  icon('firstaid', '药箱', 'life', ['药品', '急救', '药箱', '常备药', 'First Aid']),
  icon('luggage', '行李箱', 'life', ['旅行箱', '拉杆箱', '行李箱', 'Luggage']),
  icon('towel', '毛巾', 'life', ['毛巾', '浴巾', '面巾', 'Towel']),
  icon('cleaning', '清洁用品', 'life', ['清洁剂', '洗护', '清洁', '喷雾', 'Cleaning']),

  // ------------------------------------------------------------ 家居
  icon('tv', '电视', 'home', ['电视机', '电视', 'TV', '显示器']),
  icon('fan', '风扇', 'home', ['电扇', '风扇', '循环扇', 'Fan']),
  icon('ac', '空调', 'home', ['空调', '冷气', 'Air Conditioner']),
  icon('fridge', '冰箱', 'home', ['冰箱', '冷柜', 'Fridge']),
  icon('washer', '洗衣机', 'home', ['洗衣机', '洗烘一体', 'Washer']),
  icon('vacuum', '吸尘器', 'home', ['吸尘器', '除螨仪', '扫地机', 'Vacuum']),
  icon('hairdryer', '吹风机', 'home', ['吹风', '电吹风', '吹风机', 'Hair Dryer']),
  icon('ricecooker', '电饭煲', 'home', ['电饭锅', '电饭煲', '炊具', 'Rice Cooker']),
  icon('coffee', '咖啡机', 'home', ['咖啡机', '胶囊咖啡', '意式', 'Coffee']),
  icon('desklamp', '台灯', 'home', ['台灯', '阅读灯', '护眼灯', 'Desk Lamp']),

  // ------------------------------------------------------------ 兴趣
  icon('instrument', '乐器', 'hobby', ['吉他', '乐器', '尤克里里', 'Instrument', 'Guitar']),
  icon('vinyl', '唱片', 'hobby', ['黑胶', '唱片', 'CD', '专辑', 'Vinyl']),
  icon('toy', '玩具', 'hobby', ['玩偶', '毛绒', '玩具', '公仔', 'Toy']),
  icon('model', '模型', 'hobby', ['手办', '模型', '拼装', 'Figure', 'Model']),
  icon('cards', '卡牌', 'hobby', ['卡牌', '集换卡', '扑克', 'Cards']),
  icon('souvenir', '纪念品', 'hobby', ['徽章', '纪念章', '奖牌', '纪念品', 'Souvenir']),

  // ------------------------------------------------------------ 其他
  icon('gift', '礼物', 'other', ['礼物', '礼盒', '礼品', 'Gift']),
  icon('collectionbox', '收藏盒', 'other', ['收纳', '收藏盒', '盒子', '储物', 'Box']),
  icon('other', '通用物品', 'other', ['其他', '通用', '杂物', '未分类', 'Other']),
]

const byKey = new Map(PRESET_ICONS.map((i) => [i.key, i]))

/** 预置资产的展示顺序：按 PRESET_ICONS 编排顺序，未知 id 排最后 */
export function presetSortIndex(assetId: string): number {
  const key = assetId.replace(/^preset-/, '')
  const index = PRESET_ICONS.findIndex((i) => i.key === key)
  return index === -1 ? 9999 : index
}

/** assetId（preset-<key>）→ 元数据；非 preset 或未知 key 返回 undefined */
export function presetIconOfAssetId(assetId: string): PresetIcon | undefined {
  if (!assetId.startsWith('preset-')) return undefined
  return byKey.get(assetId.slice('preset-'.length))
}

export function getIconPath(key: IconKey): string {
  return byKey.get(key)?.path ?? '/icons/items/other.svg'
}

export function getIconLabel(key: IconKey): string {
  return byKey.get(key)?.label ?? '通用物品'
}

export function getIconCategory(key: IconKey): IconCategory {
  return byKey.get(key)?.category ?? 'other'
}

/** 按分类取图标（保持 PRESET_ICONS 的编排顺序） */
export function iconsInCategory(category: IconCategory): PresetIcon[] {
  return PRESET_ICONS.filter((i) => i.category === category)
}

/**
 * 图标检索：名称 / 关键词 / key 三路匹配，均为大小写无关的子串匹配。
 * 空查询返回全部（供"完整网格"使用）。
 */
export function searchIcons(query: string): PresetIcon[] {
  const q = query.trim().toLowerCase()
  if (!q) return PRESET_ICONS
  return PRESET_ICONS.filter((i) => {
    if (i.key.toLowerCase().includes(q)) return true
    if (i.label.toLowerCase().includes(q)) return true
    return i.keywords.some((k) => k.toLowerCase().includes(q))
  })
}
