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

export type IconCategory =
  | 'digital'
  | 'office'
  | 'apparel'
  | 'life'
  | 'care'
  | 'kitchen'
  | 'home'
  | 'hobby'
  | 'other'

/** 分类的展示顺序与中文名（'recent' 是选择器里的虚拟分类，不属于图标自身） */
export const ICON_CATEGORIES: { key: IconCategory; label: string }[] = [
  { key: 'digital', label: '数码' },
  { key: 'office', label: '办公' },
  { key: 'apparel', label: '服饰' },
  { key: 'life', label: '生活' },
  { key: 'care', label: '护理' },
  { key: 'kitchen', label: '厨房' },
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
  icon('tablet', '平板电脑', 'digital', ['平板', 'iPad', 'iPad mini', 'iPad Pro', 'iPad Air', '安卓平板', '平板电脑', 'pad', 'Tablet']),
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

  // ---------------------------------------------------- Phase 2G 新增：数码及配件
  icon('stylus', '触控笔', 'digital', ['触控笔', '手写笔', '电容笔', 'Apple Pencil', '数位笔', 'Stylus']),
  icon('phonecase', '手机壳', 'digital', ['手机壳', '保护壳', '手机套', '壳', 'Case']),
  icon('tabletcase', '平板保护壳', 'digital', ['平板壳', '保护套', '平板保护壳', 'iPad 壳', '平板外套']),
  icon('earbudcase', '耳机盒', 'digital', ['耳机盒', '充电盒', 'AirPods 盒', '收纳盒']),
  icon('dock', '充电底座', 'digital', ['底座', '充电座', '支架底座', 'Dock', '充电支架']),
  icon('wirelesscharger', '无线充', 'digital', ['无线充电', '无线充电器', '感应充电', 'Qi']),
  icon('usbhub', 'USB 集线器', 'digital', ['USB 分线器', '集线器', '扩展坞', 'Hub', '多口充电']),
  icon('hdmiadapter', 'HDMI 转接器', 'digital', ['HDMI', '转接器', '转接头', '适配器', '投屏']),
  icon('netcable', '网线', 'digital', ['网线', '六类网线', '网络线', 'Ethernet', '宽带线']),
  icon('netswitch', '交换机', 'digital', ['交换机', '网络交换机', 'Switch', '路由交换']),
  icon('nas', 'NAS', 'digital', ['NAS', '网络存储', '私有云', '存储服务器', '硬盘阵列']),
  icon('hdddock', '硬盘盒', 'digital', ['硬盘盒', '移动硬盘盒', '硬盘底座', '硬盘托架']),
  icon('cfreader', '读卡器', 'digital', ['读卡器', '内存卡读卡器', '多功能读卡', 'TF 读卡']),
  icon('mousepad', '鼠标垫', 'digital', ['鼠标垫', '桌垫', '垫子', 'Mouse Pad']),
  icon('wristrest', '键盘腕托', 'digital', ['腕托', '手托', '键盘手托', '防腕托']),
  icon('webcam', '摄像头', 'digital', ['摄像头', '网络摄像头', '电脑摄像头', 'Webcam', '会议摄像头']),
  icon('lightring', '直播灯', 'digital', ['直播灯', '补光灯', '环形灯', '摄影灯']),
  icon('recorder', '录音笔', 'digital', ['录音笔', '录音设备', '拾音器', '录音', 'Recorder']),
  icon('projector', '投影仪', 'digital', ['投影仪', '投影机', '家用投影', 'Projector']),
  icon('remote', '遥控器', 'digital', ['遥控器', '遥控', '电视遥控', 'Remote']),
  icon('handheld', '游戏掌机', 'digital', ['掌机', '游戏掌机', 'Switch', '便携游戏机']),
  icon('vrmask', 'VR 设备', 'digital', ['VR', 'VR 头显', 'VR 眼镜', '沉浸设备', '头显']),
  icon('battery', '充电电池', 'digital', ['电池', '充电电池', '五号电池', '电池组', 'Battery']),
  icon('powerstrip', '插线板', 'digital', ['插线板', '排插', '插排', '接线板', '电源排插']),
  icon('cableorganizer', '理线器', 'digital', ['理线器', '理线夹', '绕线器', '线缆管理', '魔术贴']),
  icon('screenprotector', '屏幕保护膜', 'digital', ['保护膜', '钢化膜', '屏幕膜', '贴膜']),
  icon('labelprinter', '标签打印机', 'digital', ['标签机', '标签打印机', '打印标签', 'Label Printer']),

  // ---------------------------------------------------- Phase 2G 新增：个人护理
  icon('electrictoothbrush', '电动牙刷', 'care', ['电动牙刷', '声波牙刷', '刷牙', '牙刷']),
  icon('toothbrush', '牙刷', 'care', ['牙刷', '手动牙刷', '刷牙', '洗牙']),
  icon('shaver', '剃须刀', 'care', ['剃须刀', '电推剪', '刮胡刀', '修面', 'Shaver']),
  icon('trimmer', '理发器', 'care', ['理发器', '电推剪', '头发修剪', '鬓角修剪', 'Trimmer']),
  icon('curlingiron', '卷发棒', 'care', ['卷发棒', '卷发器', '直发夹', '美发器', 'Curling']),
  icon('skincare', '护肤品', 'care', ['护肤', '护肤品', '面霜', '精华', '乳液', '香水乳']),
  icon('perfume', '香水', 'care', ['香水', '香氛', '淡香水', 'Perfume']),
  icon('comb', '梳子', 'care', ['梳子', '发梳', '按摩梳', 'Comb']),
  icon('nailclipper', '指甲剪', 'care', ['指甲剪', '指甲刀', '修甲', 'Nail Clipper']),
  icon('scale', '体重秤', 'care', ['体重秤', '电子秤', '秤', '体重', 'Scale']),

  // ---------------------------------------------------- Phase 2G 新增：厨房
  icon('pot', '锅', 'kitchen', ['锅', '汤锅', '炖锅', '炒锅', '煮锅']),
  icon('pan', '平底锅', 'kitchen', ['平底锅', '煎锅', '不粘锅', 'Pan']),
  icon('knife', '刀具', 'kitchen', ['刀', '菜刀', '刀具', '厨刀', '小刀']),
  icon('cuttingboard', '菜板', 'kitchen', ['菜板', '砧板', '切菜板', '案板']),
  icon('bowl', '碗', 'kitchen', ['碗', '汤碗', '饭碗', 'Bowl']),
  icon('cup', '杯子', 'kitchen', ['杯子', '马克杯', '水杯', '茶杯', 'Cup']),
  icon('kettle', '水壶', 'kitchen', ['水壶', '烧水壶', '电水壶', 'Kettle']),
  icon('airfryer', '空气炸锅', 'kitchen', ['空气炸锅', '气炸锅', '无油炸锅', 'Air Fryer']),
  icon('microwave', '微波炉', 'kitchen', ['微波炉', '微波', 'Microwave']),
  icon('oven', '烤箱', 'kitchen', ['烤箱', '电烤箱', '烘焙', '烤炉', 'Oven']),
  icon('juicer', '榨汁机', 'kitchen', ['榨汁机', '果汁机', '破壁', 'Juicer']),
  icon('blender', '破壁机', 'kitchen', ['破壁机', '料理机', '搅拌机', '辅食机', 'Blender']),
  icon('wineglass', '酒杯', 'kitchen', ['酒杯', '红酒杯', '高脚杯', 'Wine Glass']),
  icon('chopsticks', '筷子', 'kitchen', ['筷子', '木筷', '竹筷', 'Chopsticks']),

  // ---------------------------------------------------- Phase 2G 新增：服饰
  icon('shirt', '衬衫', 'apparel', ['衬衫', '衬衣', '上衣', '白衬衫', 'Shirt']),
  icon('hoodie', '卫衣', 'apparel', ['卫衣', '连帽衫', '帽衫', 'Hoodie']),
  icon('downjacket', '羽绒服', 'apparel', ['羽绒服', '羽绒', '棉服', '冬衣', 'Down Jacket']),
  icon('shorts', '短裤', 'apparel', ['短裤', '五分裤', '运动短裤', 'Shorts']),
  icon('slippers', '拖鞋', 'apparel', ['拖鞋', '居家拖鞋', '凉拖', 'Slippers']),
  icon('belt', '腰带', 'apparel', ['腰带', '皮带', '裤带', 'Belt']),
  icon('gloves', '手套', 'apparel', ['手套', '棉手套', '保暖手套', 'Gloves']),
  icon('scarf', '围巾', 'apparel', ['围巾', '丝巾', '披肩', '围脖', 'Scarf']),

  // ---------------------------------------------------- Phase 2G 新增：办公
  icon('ruler', '尺子', 'office', ['尺子', '直尺', '三角尺', '卷尺', 'Ruler']),
  icon('deskorg', '桌面收纳', 'office', ['桌面收纳', '收纳架', '文件架', '桌面整理', '置物架']),

  // ---------------------------------------------------- Phase 2G 新增：运动 / 兴趣
  icon('dumbbell', '哑铃', 'hobby', ['哑铃', '力量', '健身器材', '举重', 'Dumbbell']),
  icon('yogamat', '瑜伽垫', 'hobby', ['瑜伽垫', '垫子', '健身垫', 'Yoga Mat']),
  icon('basketball', '篮球', 'hobby', ['篮球', '球', '运动球', 'Basketball']),
  icon('football', '足球', 'hobby', ['足球', '运动球', '足', 'Football']),
  icon('badminton', '羽毛球拍', 'hobby', ['羽毛球拍', '球拍', '羽毛球', 'Badminton']),
  icon('pingpong', '乒乓球拍', 'hobby', ['乒乓球拍', '乒乓', '球拍', 'Ping Pong']),
  icon('bicycle', '自行车', 'hobby', ['自行车', '单车', '骑行', 'Bicycle', 'Bike']),
  icon('helmet', '头盔', 'hobby', ['头盔', '安全帽', '骑行头盔', 'Helmet']),
  icon('camplight', '露营灯', 'hobby', ['露营灯', '营地灯', '户外灯', '感应灯', '营灯']),
  icon('tent', '帐篷', 'hobby', ['帐篷', '天幕', '露营帐篷', 'Tent']),
  icon('tripod', '三脚架', 'hobby', ['三脚架', '脚架', '支架', 'Tripod']),
  icon('fishingrod', '钓鱼竿', 'hobby', ['钓鱼竿', '鱼竿', '钓具', 'Fishing Rod']),
  icon('skateboard', '滑板', 'hobby', ['滑板', '街式滑板', '滑板车', 'Skateboard']),

  // ---------------------------------------------------- Phase 2G 新增：工具与生活
  icon('screwdriver', '螺丝刀', 'life', ['螺丝刀', '起子', '螺丝起子', 'Screwdriver']),
  icon('wrench', '扳手', 'life', ['扳手', '工具', '套筒', '维修工具', 'Wrench']),
  icon('flashlight', '手电筒', 'life', ['手电筒', '手电', '强光手电', 'Flashlight']),
  icon('storagebox', '收纳盒', 'life', ['收纳盒', '整理箱', '储物盒', '收纳箱', 'Storage Box']),
  icon('documentbag', '文件袋', 'life', ['文件袋', '文件包', '资料袋', '公文包']),
  icon('idcard', '证件夹', 'life', ['证件夹', '卡包', '证件套', '名片夹', 'ID Card']),
  icon('pillbox', '药盒', 'life', ['药盒', '分装药盒', '药丸盒', '药板', 'Pill Box']),
  icon('humidifier', '加湿器', 'home', ['加湿器', '香薰机', '空气加湿', 'Humidifier']),
  icon('purifier', '空气净化器', 'home', ['空气净化器', '净化器', '除甲醛', '空气净化', 'Air Purifier']),

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
