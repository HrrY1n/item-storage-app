import type { Asset, Category, Item, ItemTag, Tag } from './types'

/**
 * 同步载荷的编解码（纯函数，无 IO，全部有测试）。
 *
 * ## 为什么不把 Dexie 的表直接序列化上传
 *
 * 三个原因：
 * 1. `itemTags` 是 `[itemId+tagId]` 复合主键的**关联表**，单独同步它需要处理
 *    "关联的删除" —— 而关联本身没有独立生命周期。这里把 `tagIds: string[]`
 *    内聚进 item 载荷，关联的增删改就都变成 item 自身的字段变化。
 * 2. `assets` 的 `blob` 是二进制。preset 图标随 App 包两端自带（不上传）；
 *    `ai_generated` / `from_photo` 本阶段**只同步元数据、不同步二进制**
 *    （见下方 AssetMeta 注释），缺失端回退默认图标。
 * 3. `appMeta` 是**纯本地**状态（seeded / schemaVersion），同步它会污染另一台设备
 *    的初始化标记，可能触发重新 seed、覆盖用户自己整理过的分类名。
 *
 * ## 前向兼容
 *
 * `decode*` 一律**只取已知字段、忽略未知字段**。这样将来给 payload 加字段时，
 * 旧版本 App 拉到新字段会安全忽略，而不是崩掉。
 */

/** 参与同步的实体种类，与 src/domain/types.ts 的 SyncEntity 一致 */
export type SyncEntity = 'item' | 'category' | 'tag'

/** 物品载荷：Item 的业务字段 + 内聚的标签关联 */
export interface ItemPayload {
  name: string
  categoryId: string
  note: string
  iconAssetId: string
  sourceType: string
  status: string
  purchaseDate: string | null
  purchasePriceCents: number | null
  additionalCostCents: number | null
  purchasePlatform: string | null
  warrantyExpiresAt: string | null
  disposedAt: string | null
  disposalMethod: string | null
  salePriceCents: number | null
  disposalNote: string | null
  createdAt: string
  updatedAt: string
  /**
   * ⭐ 内聚的标签关联。push 前从 itemTags 表现读，apply 后重写 itemTags。
   * 这样 itemTags 表本身永远不需要同步。
   */
  tagIds: string[]
}

export interface CategoryPayload {
  parentId: string | null
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
  /** 可选字段：缺省时不写入（老 payload 没有也能解） */
  iconKey?: string
}

export interface TagPayload {
  name: string
  nameNormalized: string
  createdAt: string
  updatedAt: string
}

/**
 * 资产元数据载荷。
 *
 * ⚠️ **本阶段不含 blob** —— `ai_generated` / `from_photo` 的二进制不做跨设备同步
 * （Phase 3B 明确不做，R2 留后续独立阶段）。两端 App 自带全部 preset SVG，
 * 因此 `kind='preset'` 的资产元数据其实也**不需要上传**，
 * 保留此类型是为了将来接R2 时有明确的落点。
 */
export interface AssetMetaPayload {
  kind: string
  path: string | null
  mime: string
  width: number
  height: number
  styleVersion: string | null
  promptVersion: string | null
  sourceAssetId: string | null
  createdAt: string
  /** 本地是否存在二进制。缺失端据此回退默认图标，而不是显示坏图。 */
  hasBlob: boolean
}

/* ---------------------------------------------------------------------- */
/* encode: 本地实体 → 载荷                                                */
/* ---------------------------------------------------------------------- */

export function encodeItemPayload(item: Item, tagIds: string[]): ItemPayload {
  return {
    name: item.name,
    categoryId: item.categoryId,
    note: item.note,
    iconAssetId: item.iconAssetId,
    sourceType: item.sourceType,
    status: item.status,
    purchaseDate: item.purchaseDate,
    purchasePriceCents: item.purchasePriceCents,
    additionalCostCents: item.additionalCostCents,
    purchasePlatform: item.purchasePlatform,
    warrantyExpiresAt: item.warrantyExpiresAt,
    disposedAt: item.disposedAt,
    disposalMethod: item.disposalMethod,
    salePriceCents: item.salePriceCents,
    disposalNote: item.disposalNote,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    tagIds: [...tagIds],
  }
}

export function encodeCategoryPayload(category: Category): CategoryPayload {
  return {
    parentId: category.parentId,
    name: category.name,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    ...(category.iconKey === undefined ? {} : { iconKey: category.iconKey }),
  }
}

export function encodeTagPayload(tag: Tag): TagPayload {
  return {
    name: tag.name,
    nameNormalized: tag.nameNormalized,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  }
}

export function encodeAssetMetaPayload(asset: Asset): AssetMetaPayload {
  return {
    kind: asset.kind,
    path: asset.path,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    styleVersion: asset.styleVersion,
    promptVersion: asset.promptVersion,
    sourceAssetId: asset.sourceAssetId,
    createdAt: asset.createdAt,
    hasBlob: asset.blob != null,
  }
}

/* ---------------------------------------------------------------------- */
/* decode: 载荷 → 本地实体                                                */
/* ---------------------------------------------------------------------- */

/**
 * 把不可信的载荷（来自另一台设备的 JSON）安全地转成 Item。
 *
 * 所有字段都做类型收敛；未知字段被忽略；缺失的可空字段补 null。
 * 刻意**不抛异常** —— 一条坏数据不应该让整批同步失败，静默丢弃即可。
 */
export function decodeItemPayload(id: string, raw: unknown): Item | null {
  const p = asRecord(raw)
  if (p === null) return null
  const name = asString(p.name)
  if (name === null || name === '') return null // 名称是唯一必填项（与 create 的校验一致）

  const item: Item = {
    id,
    name,
    categoryId: asString(p.categoryId) ?? '',
    note: asString(p.note) ?? '',
    iconAssetId: asString(p.iconAssetId) ?? 'preset-other',
    sourceType: (asString(p.sourceType) ?? 'preset') as Item['sourceType'],
    status: (asString(p.status) ?? 'owned') as Item['status'],
    purchaseDate: asNullableString(p.purchaseDate),
    purchasePriceCents: asNullableNumber(p.purchasePriceCents),
    additionalCostCents: asNullableNumber(p.additionalCostCents),
    purchasePlatform: asNullableString(p.purchasePlatform) as Item['purchasePlatform'],
    warrantyExpiresAt: asNullableString(p.warrantyExpiresAt),
    disposedAt: asNullableString(p.disposedAt),
    disposalMethod: asNullableString(p.disposalMethod) as Item['disposalMethod'],
    salePriceCents: asNullableNumber(p.salePriceCents),
    disposalNote: asNullableString(p.disposalNote),
    createdAt: asString(p.createdAt) ?? new Date(0).toISOString(),
    updatedAt: asString(p.updatedAt) ?? new Date(0).toISOString(),
    deletedAt: null, // 软删标记不在 payload 里，由外层记录单独传递
  }
  return item
}

export function decodeCategoryPayload(id: string, raw: unknown): Category | null {
  const p = asRecord(raw)
  if (p === null) return null
  const name = asString(p.name)
  if (name === null || name === '') return null
  const parentId = asNullableString(p.parentId)
  const iconKey = asString(p.iconKey)
  return {
    id,
    parentId,
    name,
    sortOrder: asNumber(p.sortOrder) ?? 0,
    createdAt: asString(p.createdAt) ?? new Date(0).toISOString(),
    updatedAt: asString(p.updatedAt) ?? new Date(0).toISOString(),
    deletedAt: null,
    ...(iconKey === null ? {} : { iconKey }),
  }
}

export function decodeTagPayload(id: string, raw: unknown): Tag | null {
  const p = asRecord(raw)
  if (p === null) return null
  const name = asString(p.name)
  if (name === null || name === '') return null
  return {
    id,
    name,
    // 缺失时用 name 兜底规范化，保证唯一索引永远有值
    nameNormalized: asString(p.nameNormalized) ?? name.trim().toLowerCase(),
    createdAt: asString(p.createdAt) ?? new Date(0).toISOString(),
    updatedAt: asString(p.updatedAt) ?? new Date(0).toISOString(),
  }
}

/** 从载荷还原 item 的 tagIds（过滤掉非字符串的脏数据） */
export function decodeTagIds(raw: unknown): string[] {
  const p = asRecord(raw)
  if (p === null) return []
  const list = p.tagIds
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const v of list) {
    if (typeof v === 'string' && v !== '') out.push(v)
  }
  return [...new Set(out)] // 去重：itemTags 是复合主键，重复会被 Dexie 拒绝
}

/* ---------------------------------------------------------------------- */
/* 工具                                                                    */
/* ---------------------------------------------------------------------- */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 可空字段：null / undefined / 非字符串统一归为 null，数字等非字符串值按字符串接受 */
function asNullableString(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function asNullableNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 收集某个 item 的 tagIds（push 时在事务外读取） */
export async function readTagIdsFor(
  getTagIds: (itemId: string) => Promise<string[]>,
  itemId: string,
): Promise<string[]> {
  return getTagIds(itemId)
}

/** 用新的标签集合重写 itemTags（apply 时使用） */
export function buildItemTagRows(
  itemId: string,
  tagIds: readonly string[],
): ItemTag[] {
  return [...new Set(tagIds)].map((tagId) => ({ itemId, tagId }))
}