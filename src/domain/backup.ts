/**
 * 备份/恢复的数据契约与**纯校验逻辑**（domain 层：无 Dexie、无 JSZip 依赖，可独立测试）。
 *
 * ZIP 结构：
 *   manifest.json   元信息
 *   data.json       全部业务数据（assets 为元数据，不含二进制）
 *   assets/         仅真实用户二进制资产（preset 静态图标不入 ZIP）
 *
 * 设计原则：
 * - 不做任何 hash / 完整性校验（用户明确要求），只做结构校验。
 * - 任何一项校验失败都返回 ok:false + 原因，**绝不部分写入**。
 */

import type { Asset, AssetKind, Category, Item, ItemTag, Tag } from './types'

/** 当前写入的备份格式版本 */
export const BACKUP_SCHEMA_VERSION = 1

/** 本应用可接受的备份格式版本集合 */
const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1]

/**
 * 需要从备份中迁移的 appMeta 键。
 * 其余 appMeta（如 UI 本地偏好）不属于业务数据，不随备份迁移。
 */
export const MIGRATABLE_APP_META_KEYS = ['seeded', 'schemaVersion'] as const

export interface BackupManifest {
  schemaVersion: number
  exportVersion: string
  exportedAt: string
  itemCount: number
  categoryCount: number
  tagCount: number
  assetCount: number
}

/** data.json 中的资产元数据；file 存在时指向 ZIP 内 assets/<file> */
export interface BackupAssetMeta {
  id: string
  kind: AssetKind
  path: string | null
  mime: string
  width: number
  height: number
  styleVersion: string | null
  promptVersion: string | null
  sourceAssetId: string | null
  createdAt: string
  file?: string
}

export interface BackupData {
  items: Item[]
  categories: Category[]
  tags: Tag[]
  itemTags: ItemTag[]
  assets: BackupAssetMeta[]
  appMeta: Record<string, string>
}

/** 校验通过后可写入数据库的完整载荷 */
export interface BackupPayload {
  items: Item[]
  categories: Category[]
  tags: Tag[]
  itemTags: ItemTag[]
  assets: Asset[]
  appMeta: Record<string, string>
}

/** 解析后的 ZIP 内容（供上层进一步取二进制资产） */
export interface BackupArchive {
  manifest: BackupManifest
  data: BackupData
  /** 文件名 → 二进制内容 */
  assetFiles: Record<string, Uint8Array>
}

export interface BackupSummary {
  exportedAt: string
  itemCount: number
  categoryCount: number
  tagCount: number
  assetCount: number
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------- 基础断言

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNullableString = (v: unknown): v is string | null => v === null || isString(v)

// ---------------------------------------------------------------- manifest

export function validateManifest(raw: unknown): ValidationResult<BackupManifest> {
  if (!isRecord(raw)) return { ok: false, error: 'manifest.json 格式错误：不是合法对象' }

  const { schemaVersion, exportVersion, exportedAt, itemCount, categoryCount, tagCount, assetCount } =
    raw

  if (!isNumber(schemaVersion)) {
    return { ok: false, error: 'manifest.json 缺少或错误的 schemaVersion' }
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    return {
      ok: false,
      error: `不支持的备份版本（schemaVersion=${schemaVersion}），当前支持 ${SUPPORTED_SCHEMA_VERSIONS.join('、')}`,
    }
  }
  if (!isString(exportVersion)) return { ok: false, error: 'manifest.json 缺少 exportVersion' }
  if (!isString(exportedAt)) return { ok: false, error: 'manifest.json 缺少 exportedAt' }

  if (!isNumber(itemCount)) return { ok: false, error: 'manifest.json 缺少或错误的 itemCount' }
  if (!isNumber(categoryCount)) {
    return { ok: false, error: 'manifest.json 缺少或错误的 categoryCount' }
  }
  if (!isNumber(tagCount)) return { ok: false, error: 'manifest.json 缺少或错误的 tagCount' }
  if (!isNumber(assetCount)) return { ok: false, error: 'manifest.json 缺少或错误的 assetCount' }

  return {
    ok: true,
    value: {
      schemaVersion,
      exportVersion,
      exportedAt,
      itemCount,
      categoryCount,
      tagCount,
      assetCount,
    },
  }
}

// ---------------------------------------------------------------- data.json

function validateItem(raw: unknown, i: number): ValidationResult<Item> {
  if (!isRecord(raw)) return { ok: false, error: `items[${i}] 不是合法对象` }
  if (!isString(raw.id) || raw.id === '') return { ok: false, error: `items[${i}].id 无效` }
  if (!isString(raw.name)) return { ok: false, error: `items[${i}].name 无效` }
  if (!isString(raw.categoryId)) return { ok: false, error: `items[${i}].categoryId 无效` }
  if (!isString(raw.note)) return { ok: false, error: `items[${i}].note 无效` }
  if (!isString(raw.iconAssetId)) return { ok: false, error: `items[${i}].iconAssetId 无效` }
  if (!isString(raw.sourceType)) return { ok: false, error: `items[${i}].sourceType 无效` }
  if (!isString(raw.createdAt)) return { ok: false, error: `items[${i}].createdAt 无效` }
  if (!isString(raw.updatedAt)) return { ok: false, error: `items[${i}].updatedAt 无效` }
  if (!isNullableString(raw.deletedAt)) return { ok: false, error: `items[${i}].deletedAt 无效` }

  return {
    ok: true,
    value: {
      id: raw.id,
      name: raw.name,
      categoryId: raw.categoryId,
      note: raw.note,
      iconAssetId: raw.iconAssetId,
      sourceType: raw.sourceType as Item['sourceType'],
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      deletedAt: raw.deletedAt,
    },
  }
}

function validateCategory(raw: unknown, i: number): ValidationResult<Category> {
  if (!isRecord(raw)) return { ok: false, error: `categories[${i}] 不是合法对象` }
  if (!isString(raw.id) || raw.id === '') return { ok: false, error: `categories[${i}].id 无效` }
  if (!isNullableString(raw.parentId)) return { ok: false, error: `categories[${i}].parentId 无效` }
  if (!isString(raw.name)) return { ok: false, error: `categories[${i}].name 无效` }
  if (!isNumber(raw.sortOrder)) return { ok: false, error: `categories[${i}].sortOrder 无效` }
  if (!isString(raw.createdAt)) return { ok: false, error: `categories[${i}].createdAt 无效` }
  if (!isString(raw.updatedAt)) return { ok: false, error: `categories[${i}].updatedAt 无效` }
  if (!isNullableString(raw.deletedAt)) return { ok: false, error: `categories[${i}].deletedAt 无效` }

  return {
    ok: true,
    value: {
      id: raw.id,
      parentId: raw.parentId,
      name: raw.name,
      sortOrder: raw.sortOrder,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      deletedAt: raw.deletedAt,
      ...(isString(raw.iconKey) ? { iconKey: raw.iconKey as Category['iconKey'] } : {}),
    },
  }
}

function validateTag(raw: unknown, i: number): ValidationResult<Tag> {
  if (!isRecord(raw)) return { ok: false, error: `tags[${i}] 不是合法对象` }
  if (!isString(raw.id) || raw.id === '') return { ok: false, error: `tags[${i}].id 无效` }
  if (!isString(raw.name)) return { ok: false, error: `tags[${i}].name 无效` }
  if (!isString(raw.nameNormalized) || raw.nameNormalized === '') {
    return { ok: false, error: `tags[${i}].nameNormalized 无效` }
  }
  if (!isString(raw.createdAt)) return { ok: false, error: `tags[${i}].createdAt 无效` }
  if (!isString(raw.updatedAt)) return { ok: false, error: `tags[${i}].updatedAt 无效` }

  return {
    ok: true,
    value: {
      id: raw.id,
      name: raw.name,
      nameNormalized: raw.nameNormalized,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    },
  }
}

function validateItemTag(raw: unknown, i: number): ValidationResult<ItemTag> {
  if (!isRecord(raw)) return { ok: false, error: `itemTags[${i}] 不是合法对象` }
  if (!isString(raw.itemId)) return { ok: false, error: `itemTags[${i}].itemId 无效` }
  if (!isString(raw.tagId)) return { ok: false, error: `itemTags[${i}].tagId 无效` }
  return { ok: true, value: { itemId: raw.itemId, tagId: raw.tagId } }
}

function validateAssetMeta(raw: unknown, i: number): ValidationResult<BackupAssetMeta> {
  if (!isRecord(raw)) return { ok: false, error: `assets[${i}] 不是合法对象` }
  if (!isString(raw.id) || raw.id === '') return { ok: false, error: `assets[${i}].id 无效` }
  if (!isString(raw.kind)) return { ok: false, error: `assets[${i}].kind 无效` }
  if (!isNullableString(raw.path)) return { ok: false, error: `assets[${i}].path 无效` }
  if (!isString(raw.mime)) return { ok: false, error: `assets[${i}].mime 无效` }
  if (!isNumber(raw.width)) return { ok: false, error: `assets[${i}].width 无效` }
  if (!isNumber(raw.height)) return { ok: false, error: `assets[${i}].height 无效` }
  if (!isNullableString(raw.styleVersion)) {
    return { ok: false, error: `assets[${i}].styleVersion 无效` }
  }
  if (!isNullableString(raw.promptVersion)) {
    return { ok: false, error: `assets[${i}].promptVersion 无效` }
  }
  if (!isNullableString(raw.sourceAssetId)) {
    return { ok: false, error: `assets[${i}].sourceAssetId 无效` }
  }
  if (!isString(raw.createdAt)) return { ok: false, error: `assets[${i}].createdAt 无效` }
  if (raw.file !== undefined && !isString(raw.file)) {
    return { ok: false, error: `assets[${i}].file 无效` }
  }

  return {
    ok: true,
    value: {
      id: raw.id,
      kind: raw.kind as AssetKind,
      path: raw.path,
      mime: raw.mime,
      width: raw.width,
      height: raw.height,
      styleVersion: raw.styleVersion,
      promptVersion: raw.promptVersion,
      sourceAssetId: raw.sourceAssetId,
      createdAt: raw.createdAt,
      ...(isString(raw.file) ? { file: raw.file } : {}),
    },
  }
}

/** 逐项映射，任一失败即整体失败（保留首个错误以便定位） */
function mapValidated<T, R>(
  raw: unknown,
  field: string,
  validate: (v: unknown, i: number) => ValidationResult<R>,
): ValidationResult<T[]> {
  if (!Array.isArray(raw)) return { ok: false, error: `data.json 的 ${field} 必须是数组` }
  const out: R[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = validate(raw[i], i)
    if (!r.ok) return { ok: false, error: r.error }
    out.push(r.value)
  }
  return { ok: true, value: out as unknown as T[] }
}

export function validateBackupData(raw: unknown): ValidationResult<BackupData> {
  if (!isRecord(raw)) return { ok: false, error: 'data.json 格式错误：不是合法对象' }

  const items = mapValidated<Item, Item>(raw.items, 'items', validateItem)
  if (!items.ok) return items

  const categories = mapValidated<Category, Category>(raw.categories, 'categories', validateCategory)
  if (!categories.ok) return categories

  const tags = mapValidated<Tag, Tag>(raw.tags, 'tags', validateTag)
  if (!tags.ok) return tags

  const itemTags = mapValidated<ItemTag, ItemTag>(raw.itemTags, 'itemTags', validateItemTag)
  if (!itemTags.ok) return itemTags

  const assets = mapValidated<BackupAssetMeta, BackupAssetMeta>(
    raw.assets,
    'assets',
    validateAssetMeta,
  )
  if (!assets.ok) return assets

  // appMeta 可选：缺失时视为空对象（旧备份兼容）
  let appMeta: Record<string, string> = {}
  if (raw.appMeta !== undefined) {
    if (!isRecord(raw.appMeta)) return { ok: false, error: 'data.json 的 appMeta 必须是对象' }
    for (const [k, v] of Object.entries(raw.appMeta)) {
      if (!isString(v)) return { ok: false, error: `data.json 的 appMeta.${k} 必须是字符串` }
      appMeta[k] = v
    }
  }

  return {
    ok: true,
    value: {
      items: items.value,
      categories: categories.value,
      tags: tags.value,
      itemTags: itemTags.value,
      assets: assets.value,
      appMeta,
    },
  }
}

/** 把 Uint8Array 复制为独立 ArrayBuffer（满足 BlobPart 的类型要求） */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return ab
}

/**
 * 把校验后的数据转换为可直接写入数据库的载荷。
 * 二进制资产从 ZIP 内的 assets/ 读取；缺失则退化为 blob=null（不整包失败）。
 */
export function toBackupPayload(
  data: BackupData,
  assetFiles: Record<string, Uint8Array> = {},
): BackupPayload {
  const assets: Asset[] = data.assets.map((meta) => {
    const bytes = meta.file ? assetFiles[meta.file] : undefined
    return {
      id: meta.id,
      kind: meta.kind,
      path: meta.path,
      blob: bytes ? new Blob([toArrayBuffer(bytes)], { type: meta.mime }) : null,
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
      styleVersion: meta.styleVersion,
      promptVersion: meta.promptVersion,
      sourceAssetId: meta.sourceAssetId,
      createdAt: meta.createdAt,
    }
  })

  // 只迁移白名单内的 appMeta，并保证 seeded 标记存在（避免恢复后又被重新 seed）
  const appMeta: Record<string, string> = {}
  for (const key of MIGRATABLE_APP_META_KEYS) {
    const v = data.appMeta[key]
    if (isString(v)) appMeta[key] = v
  }
  if (data.appMeta.seeded !== '1') appMeta.seeded = '1'

  return {
    items: data.items,
    categories: data.categories,
    tags: data.tags,
    itemTags: data.itemTags,
    assets,
    appMeta,
  }
}

/** 从已解析的 manifest + data 生成用于 UI 展示的摘要 */
export function toSummary(manifest: BackupManifest): BackupSummary {
  return {
    exportedAt: manifest.exportedAt,
    itemCount: manifest.itemCount,
    categoryCount: manifest.categoryCount,
    tagCount: manifest.tagCount,
    assetCount: manifest.assetCount,
  }
}
