/**
 * 数据模型（对应 docs/architecture.md §4，已按用户要求删除全部 hash 字段）。
 * 纯类型定义，无任何依赖 —— db / domain / features / pages 共用。
 */

/**
 * 物品图标 key。
 *
 * 可选值由 src/data/icons.ts 的 PRESET_ICONS 定义（当前 73 个，含独立的 phone / tablet）。
 * 这里刻意用 string 而非字面量联合：图标库会持续扩充，超长联合类型既难维护又容易漏改。
 * 真正的完整性由两点保证 —— 数据层写入时统一走 icons.ts 的辅助函数（带 fallback），
 * 以及 src/data/icons.test.ts 对"每个 key 都有对应 SVG 资源"的断言。
 */
export type IconKey = string

export type AssetKind = 'preset' | 'ai_generated' | 'from_photo'
export type ItemSourceType = AssetKind

/** 购买平台（Phase 2E）；UI 显示映射见 domain/purchase.ts */
export type PurchasePlatform =
  | 'jd'
  | 'taobao'
  | 'pinduoduo'
  | 'zhuanzhuan'
  | 'aihuishou'
  | 'other'

/**
 * 物品生命周期（Phase 2G）。
 *
 * 这三个值对应真实的数据模型，而不是纯 UI 筛选：
 * - wishlist  想要但尚未拥有（可以完全没有购买信息）
 * - owned     正在持有
 * - disposed  已处置（出售 / 丢弃 / 其他），持有天数在此冻结
 */
export type ItemStatus = 'wishlist' | 'owned' | 'disposed'

/** 处置方式。刻意只有三种，不擅自扩充。 */
export type DisposalMethod = 'sold' | 'discarded' | 'other'

/** 当前数据契约版本（v3 = 增加生命周期与保修字段） */
export const CURRENT_SCHEMA_VERSION = 3

export interface Item {
  id: string
  name: string
  categoryId: string
  note: string
  iconAssetId: string
  sourceType: ItemSourceType
  /** 生命周期状态；v2 及更早的数据迁移后一律为 'owned' */
  status: ItemStatus
  /** 购买日期 YYYY-MM-DD；null = 未填写 */
  purchaseDate: string | null
  /** 购买价格，整数「分」（¥1499.99 = 149999）；null = 未填写；允许 0（赠品） */
  purchasePriceCents: number | null
  /** 附加花费（配件/维修/升级/更换部件等额外投入），整数「分」；null = 未填写；允许 0 */
  additionalCostCents: number | null
  /** 购买平台；null = 未填写 */
  purchasePlatform: PurchasePlatform | null
  /** 保修到期日 YYYY-MM-DD；null = 未填写 / 不适用 */
  warrantyExpiresAt: string | null
  /** 处置日期 YYYY-MM-DD；仅 status='disposed' 时有值 */
  disposedAt: string | null
  /** 处置方式；仅 status='disposed' 时有值 */
  disposalMethod: DisposalMethod | null
  /** 出售金额，整数「分」；仅 disposalMethod='sold' 时可非 null；允许 0 */
  salePriceCents: number | null
  /** 处置备注（赠送朋友 / 损坏报废 / 回收…）；可空 */
  disposalNote: string | null
  createdAt: string
  updatedAt: string
  /** soft delete；null = 未删除 */
  deletedAt: string | null
}

export interface Category {
  id: string
  parentId: string | null
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  /** 仅用于 UI 展示的分类小图标（可选） */
  iconKey?: IconKey
}

export interface Tag {
  id: string
  /** 显示名（保留原始大小写，UI 统一加 # 前缀展示） */
  name: string
  /** 标准化名（trim + 去 # + 小写折叠），唯一索引，用于防重复 */
  nameNormalized: string
  createdAt: string
  updatedAt: string
}

export interface ItemTag {
  itemId: string
  tagId: string
}

export interface Asset {
  id: string
  kind: AssetKind
  /** preset 图标随包路径；其他来源为 null */
  path: string | null
  /** 非 preset 的二进制内容（IndexedDB 原生 Blob） */
  blob: Blob | null
  mime: string
  width: number
  height: number
  styleVersion: string | null
  promptVersion: string | null
  sourceAssetId: string | null
  createdAt: string
}

export interface AppMeta {
  key: string
  value: string
}
