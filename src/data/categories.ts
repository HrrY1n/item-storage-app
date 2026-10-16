import type { IconKey } from '../domain/types'

export const DEFAULT_CATEGORIES_VERSION = 2

export interface DefaultSubcategory {
  name: string
  /** 每个内置图标只归入一个默认物品分类；第一项用于分类封面。 */
  iconKeys: IconKey[]
  /** 旧默认名称用于保留原分类 ID；用户改名后的分类不会被改回。 */
  legacyName?: string
}

export interface DefaultCategoryRoot {
  key: string
  name: string
  iconKey: IconKey
  legacyName?: string
  legacyIconKey?: IconKey
  children: DefaultSubcategory[]
}

/** 默认物品分类；与图标浏览器的九种素材分组各自独立。 */
export const DEFAULT_CATEGORY_TREE: DefaultCategoryRoot[] = [
  { key: "digital", name: "数码与电子", iconKey: "laptop", legacyName: "数码与电子", legacyIconKey: "laptop", children: [
    { name: "电脑设备", iconKeys: ["laptop","desktop","monitor","ram","graphicscard","laptopstand","monitorarm"], legacyName: "电脑设备" },
    { name: "手机与平板", iconKeys: ["phone","tablet","stylus","phonecase","tabletcase","screenprotector"], legacyName: "手机与平板" },
    { name: "音频设备", iconKeys: ["earbuds","headphones","speaker","microphone","earbudcase","recorder"], legacyName: "音频设备" },
    { name: "存储设备", iconKeys: ["hdd","usb","sdcard","nas","hdddock"], legacyName: "存储设备" },
    { name: "配件与线材", iconKeys: ["charger","powerbank","cable","dock","wirelesscharger","dockingstation","battery","powerstrip","cableorganizer"], legacyName: "配件与线材" },
    { name: "键鼠与输入设备", iconKeys: ["keyboard","tabletkeyboard","mouse","trackpad","mousepad","wristrest"] },
    { name: "摄影摄像", iconKeys: ["camera","djipocket","djiaction","lens","webcam","lightring","tripod"] },
    { name: "游戏设备", iconKeys: ["gameconsole","gamepad","handheld","vrmask"] },
    { name: "网络与智能设备", iconKeys: ["router","netcable","netswitch","opticalmodem","smartplug"] },
    { name: "智能穿戴", iconKeys: ["smartwatch","band"] },
  ] },
  { key: "office", name: "学习与办公", iconKey: "book", legacyName: "学习与办公", legacyIconKey: "book", children: [
    { name: "书籍与阅读", iconKeys: ["book","ereader"], legacyName: "书籍" },
    { name: "笔记本与纸品", iconKeys: ["notebook","stickynotes"], legacyName: "笔记本与纸品" },
    { name: "文具", iconKeys: ["pen","calculator","scissors","stapler","ruler","tape","binderclip","paperclip","pencilcase"], legacyName: "文具" },
    { name: "文件资料", iconKeys: ["folder","documentbag","idcard","filebox","ringbinder"], legacyName: "文件资料" },
    { name: "办公设备", iconKeys: ["printer","labelprinter","whiteboard"] },
    { name: "桌面收纳", iconKeys: ["deskorg"] },
  ] },
  { key: "apparel", name: "衣物与穿搭", iconKey: "tshirt", legacyName: "衣物与穿搭", legacyIconKey: "tshirt", children: [
    { name: "上衣", iconKeys: ["tshirt","shirt","hoodie","sweater"], legacyName: "上衣" },
    { name: "裤装与裙装", iconKeys: ["pants","shorts","skirt"], legacyName: "裤装" },
    { name: "外套", iconKeys: ["coat","downjacket"], legacyName: "外套" },
    { name: "鞋履", iconKeys: ["shoes","sneakers","slippers","boots","sandals"], legacyName: "鞋履" },
    { name: "包袋", iconKeys: ["backpack","handbag","wallet"], legacyName: "包袋" },
    { name: "配饰", iconKeys: ["hat","glasses","watch","belt","gloves","scarf"], legacyName: "配饰" },
    { name: "贴身衣物", iconKeys: ["socks","underwear"] },
    { name: "运动与家居服", iconKeys: ["sportswear","pajamas"] },
  ] },
  { key: "life", name: "生活与护理", iconKey: "bottle", legacyName: "生活用品", legacyIconKey: "bottle", children: [
    { name: "随身日用", iconKeys: ["bottle","thermos","umbrella","key","towel"] },
    { name: "旅行用品", iconKeys: ["luggage"] },
    { name: "洗漱与美发", iconKeys: ["electrictoothbrush","toothbrush","toothpaste","shaver","trimmer","curlingiron","hairdryer","shampoo","bodywash","comb","nailclipper"] },
    { name: "护肤与美妆", iconKeys: ["skincare","perfume","cleanser","sunscreen"] },
    { name: "清洁与衣物洗护", iconKeys: ["cleaning","trashcan","tissues","wetwipes","detergent","hanger","dryingrack"] },
    { name: "健康与用药", iconKeys: ["firstaid","pillbox","scale"] },
    { name: "五金与修缮", iconKeys: ["toolbox","screwdriver","wrench","flashlight","tapemeasure","hammer","pliers","sewingkit"] },
    { name: "日常收纳", iconKeys: ["storagebox","hook","storagebag"] },
  ] },
  { key: "home", name: "家居与厨房", iconKey: "chair", children: [
    { name: "家具与陈设", iconKeys: ["bed","wardrobe","bookshelf","shelf","chair","mirror"] },
    { name: "床品与布艺", iconKeys: ["pillow","duvet","bedsheet","curtains"] },
    { name: "照明用品", iconKeys: ["desklamp"] },
    { name: "家用电器", iconKeys: ["fan","ac","fridge","washer","vacuum","humidifier","purifier"] },
    { name: "家庭影音", iconKeys: ["tv","projector","remote"] },
    { name: "厨房电器", iconKeys: ["ricecooker","coffee","kettle","airfryer","microwave","oven","juicer","blender"] },
    { name: "锅具与厨具", iconKeys: ["pot","pan","knife","cuttingboard","spatula","bottleopener"] },
    { name: "餐具与杯壶", iconKeys: ["bowl","cup","wineglass","chopsticks","plate","spoon","fork"] },
    { name: "厨房收纳", iconKeys: ["lunchbox","foodcontainer","spicejar"] },
  ] },
  { key: "hobby", name: "兴趣与收藏", iconKey: "collectionbox", legacyName: "收藏与纪念", legacyIconKey: "backpack", children: [
    { name: "运动健身", iconKeys: ["dumbbell","yogamat","jumprope","resistanceband","foamroller"] },
    { name: "球类运动", iconKeys: ["basketball","football","badminton","pingpong"] },
    { name: "户外与骑行", iconKeys: ["bicycle","helmet","camplight","tent","fishingrod","skateboard"] },
    { name: "音乐与乐器", iconKeys: ["instrument","vinyl"] },
    { name: "绘画与手作", iconKeys: ["paintbrushes"] },
    { name: "玩具与模型", iconKeys: ["toy","model"] },
    { name: "卡牌与拼图", iconKeys: ["cards","puzzle"] },
    { name: "纪念与收藏", iconKeys: ["souvenir","gift","collectionbox","certificate"] },
  ] },
  { key: "other", name: "其他", iconKey: "other", legacyName: "其他", legacyIconKey: "other", children: [

  ] },
]
