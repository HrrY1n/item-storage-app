/**
 * 数据模型（对应 docs/architecture.md §4，已按用户要求删除全部 hash 字段）。
 * 纯类型定义，无任何依赖 —— db / domain / features / pages 共用。
 */

export type IconKey =
  | 'laptop'
  | 'phone'
  | 'earbuds'
  | 'mouse'
  | 'keyboard'
  | 'book'
  | 'notebook'
  | 'tshirt'
  | 'shoes'
  | 'backpack'
  | 'bottle'
  | 'other'

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

/** 当前数据契约版本（v2 = 增加购买信息与附加花费字段） */
export const CURRENT_SCHEMA_VERSION = 2

export interface Item {
  id: string
  name: string
  categoryId: string
  note: string
  iconAssetId: string
  sourceType: ItemSourceType
  /** 购买日期 YYYY-MM-DD；null = 未填写 */
  purchaseDate: string | null
  /** 购买价格，整数「分」（¥1499.99 = 149999）；null = 未填写；允许 0（赠品） */
  purchasePriceCents: number | null
  /** 附加花费（配件/维修/升级/更换部件等额外投入），整数「分」；null = 未填写；允许 0 */
  additionalCostCents: number | null
  /** 购买平台；null = 未填写 */
  purchasePlatform: PurchasePlatform | null
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
