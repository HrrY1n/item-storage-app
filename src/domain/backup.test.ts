import { describe, expect, it } from 'vitest'
import {
  BACKUP_SCHEMA_VERSION,
  toBackupPayload,
  toSummary,
  validateBackupData,
  validateManifest,
  type BackupData,
} from './backup'

/** 以当前格式版本（v2）校验 */
const validateCurrent = (raw: unknown) => validateBackupData(raw, BACKUP_SCHEMA_VERSION)

/** 构造一份完全合法的最小备份数据 */
function validData(): BackupData {
  return {
    items: [
      {
        id: 'item-1',
        name: 'MacBook Pro 14',
        categoryId: 'cat-1',
        note: '工作主力机',
        iconAssetId: 'preset-laptop',
        sourceType: 'preset',
        purchaseDate: '2026-01-01',
        purchasePriceCents: 1_499_900,
        purchasePlatform: 'jd',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      },
    ],
    categories: [
      {
        id: 'cat-1',
        parentId: null,
        name: '电脑设备',
        sortOrder: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
        iconKey: 'laptop',
      },
    ],
    tags: [
      {
        id: 'tag-1',
        name: '常用',
        nameNormalized: '常用',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    itemTags: [{ itemId: 'item-1', tagId: 'tag-1' }],
    assets: [
      {
        id: 'preset-laptop',
        kind: 'preset',
        path: '/icons/items/laptop.svg',
        mime: 'image/svg+xml',
        width: 96,
        height: 96,
        styleVersion: null,
        promptVersion: null,
        sourceAssetId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    appMeta: { seeded: '1', schemaVersion: '1' },
  }
}

const validManifest = {
  schemaVersion: BACKUP_SCHEMA_VERSION,
  exportVersion: '0.2.0',
  exportedAt: '2026-01-01T00:00:00.000Z',
  itemCount: 1,
  categoryCount: 1,
  tagCount: 1,
  assetCount: 1,
}

describe('validateManifest', () => {
  it('合法 manifest 通过', () => {
    expect(validateManifest(validManifest).ok).toBe(true)
  })

  it('不支持的 schemaVersion 被拒绝并说明原因', () => {
    const r = validateManifest({ ...validManifest, schemaVersion: 99 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不支持的备份版本')
  })

  it('schemaVersion 类型错误被拒绝', () => {
    expect(validateManifest({ ...validManifest, schemaVersion: '1' }).ok).toBe(false)
  })

  it('缺少 exportVersion 被拒绝', () => {
    const { exportVersion, ...rest } = validManifest
    expect(validateManifest(rest).ok).toBe(false)
  })

  it('数量字段类型错误被拒绝', () => {
    expect(validateManifest({ ...validManifest, itemCount: '1' }).ok).toBe(false)
  })

  it('非对象输入被拒绝', () => {
    expect(validateManifest('not-an-object').ok).toBe(false)
  })
})

describe('validateBackupData', () => {
  it('合法 data.json 通过', () => {
    expect(validateCurrent(validData()).ok).toBe(true)
  })

  it('items 不是数组被拒绝', () => {
    expect(validateCurrent({ ...validData(), items: {} }).ok).toBe(false)
  })

  it('item 缺少必填字段被拒绝', () => {
    const d = validData()
    delete (d.items[0] as Partial<typeof d.items[0]>).note
    expect(validateCurrent(d).ok).toBe(false)
  })

  it('item.deletedAt 类型错误被拒绝', () => {
    const d = validData()
    d.items[0].deletedAt = 123 as unknown as null
    expect(validateCurrent(d).ok).toBe(false)
  })

  it('tag 缺少 nameNormalized 被拒绝（唯一索引依赖该字段）', () => {
    const d = validData()
    delete (d.tags[0] as Partial<typeof d.tags[0]>).nameNormalized
    expect(validateCurrent(d).ok).toBe(false)
  })

  it('category.sortOrder 类型错误被拒绝', () => {
    const d = validData()
    d.categories[0].sortOrder = '1' as unknown as number
    expect(validateCurrent(d).ok).toBe(false)
  })

  it('itemTags 字段类型错误被拒绝', () => {
    const d = validData()
    ;(d.itemTags[0] as unknown as { tagId: unknown }).tagId = 42
    expect(validateCurrent(d).ok).toBe(false)
  })

  it('assets 字段结构错误被拒绝', () => {
    const d = validData()
    d.assets[0].width = '96' as unknown as number
    expect(validateCurrent(d).ok).toBe(false)
  })

  it('appMeta 非对象被拒绝', () => {
    expect(validateCurrent({ ...validData(), appMeta: [] }).ok).toBe(false)
  })

  it('appMeta 值非字符串被拒绝', () => {
    expect(validateCurrent({ ...validData(), appMeta: { seeded: 1 } }).ok).toBe(false)
  })

  it('缺失 appMeta 视为空对象（旧备份兼容）', () => {
    const { appMeta, ...rest } = validData()
    const r = validateCurrent(rest)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.appMeta).toEqual({})
  })
})

describe('toBackupPayload', () => {
  it('preset 资产不带二进制：blob 为 null', () => {
    const payload = toBackupPayload(validData())
    expect(payload.assets).toHaveLength(1)
    expect(payload.assets[0].blob).toBeNull()
    expect(payload.items).toHaveLength(1)
  })

  it('带 file 的资产从 ZIP 二进制还原为 Blob', () => {
    const d = validData()
    d.assets[0] = {
      ...d.assets[0],
      kind: 'from_photo',
      path: null,
      mime: 'image/png',
      file: 'asset-1.png',
    }
    const bytes = new Uint8Array([137, 80, 78, 71])
    const payload = toBackupPayload(d, { 'asset-1.png': bytes })
    expect(payload.assets[0].blob).not.toBeNull()
    expect(payload.assets[0].blob?.size).toBe(4)
  })

  it('只迁移白名单内的 appMeta，恢复后版本号升级到当前契约', () => {
    const d = validData()
    d.appMeta = { seeded: '1', schemaVersion: '1', someUiPref: 'keep-out' }
    const payload = toBackupPayload(d)
    expect(payload.appMeta.seeded).toBe('1')
    expect(payload.appMeta.schemaVersion).toBe('2')
    expect(payload.appMeta.someUiPref).toBeUndefined()
  })

  it('源数据未标记 seeded 时自动补上，避免恢复后被重新 seed', () => {
    const d = validData()
    d.appMeta = {}
    expect(toBackupPayload(d).appMeta.seeded).toBe('1')
  })
})

describe('toSummary', () => {
  it('提取 UI 摘要字段', () => {
    const s = toSummary(validManifest)
    expect(s.itemCount).toBe(1)
    expect(s.exportedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('v1 旧备份迁移（schemaVersion = 1）', () => {
  /** v1 备份里的 Item 没有购买信息字段 */
  function v1Data() {
    const d = validData()
    const items = d.items as unknown as Record<string, unknown>[]
    delete items[0].purchaseDate
    delete items[0].purchasePriceCents
    delete items[0].purchasePlatform
    return d
  }

  it('v1 Item 导入时购买字段迁移为 null', () => {
    const r = validateBackupData(v1Data(), 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.items[0].purchaseDate).toBeNull()
      expect(r.value.items[0].purchasePriceCents).toBeNull()
      expect(r.value.items[0].purchasePlatform).toBeNull()
    }
  })

  it('v1 备份恢复后 appMeta.schemaVersion 升级为 2', () => {
    const r = validateBackupData(v1Data(), 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const payload = toBackupPayload(r.value)
      expect(payload.appMeta.schemaVersion).toBe('2')
    }
  })
})

describe('v2 购买字段校验', () => {
  it('v2 缺少购买字段被拒绝', () => {
    const d = validData()
    const items = d.items as unknown as Record<string, unknown>[]
    delete items[0].purchasePriceCents
    expect(validateCurrent(d).ok).toBe(false)
  })

  it('v2 购买平台枚举非法被拒绝', () => {
    const d = validData()
    d.items[0].purchasePlatform = 'xianyu' as unknown as 'jd'
    expect(validateCurrent(d).ok).toBe(false)
  })

  it('v2 购买价格类型非法被拒绝', () => {
    const d = validData()
    d.items[0].purchasePriceCents = '1499' as unknown as number
    expect(validateCurrent(d).ok).toBe(false)
  })

  it('v2 三个字段全为 null 也合法（全部可选）', () => {
    const d = validData()
    d.items[0].purchaseDate = null
    d.items[0].purchasePriceCents = null
    d.items[0].purchasePlatform = null
    expect(validateCurrent(d).ok).toBe(true)
  })
})
