import { describe, expect, it } from 'vitest'
import { BACKUP_SCHEMA_VERSION, validateBackupData } from './backup'
import { statusOf, effectiveCostCents, dailyCostOf, ownershipDaysOf } from './lifecycle'

/**
 * 备份 / 恢复对生命周期的兼容契约。
 *
 * 三条主线：
 *  1. 新版本（v3）导出 → 恢复，六个生命周期字段完整 round-trip
 *  2. 旧版本（v1 / v2）备份 → 恢复，自动补默认值，**不丢任何已有字段**
 *  3. 导入即规范化：非「出售」方式的出售金额一律清空
 */
const TODAY = '2026-10-05'

const baseRaw = {
  id: 'i1',
  name: 'iPhone 17 pro',
  categoryId: 'c1',
  note: '',
  iconAssetId: 'preset-phone',
  sourceType: 'preset',
  purchaseDate: '2025-05-17',
  purchasePriceCents: 800_000,
  additionalCostCents: 20_000,
  purchasePlatform: 'jd',
  warrantyExpiresAt: '2027-05-17',
  status: 'disposed',
  disposedAt: '2026-05-20',
  disposalMethod: 'sold',
  salePriceCents: 450_000,
  disposalNote: '转手给同事',
  createdAt: '2025-05-17T10:00:00.000Z',
  updatedAt: '2026-05-20T10:00:00.000Z',
  deletedAt: null,
}

const emptyBackup = {
  categories: [],
  tags: [],
  itemTags: [],
  assets: [],
  appMeta: {},
}

function validateItems(rawItems: unknown[], schemaVersion: number) {
  return validateBackupData(
    { ...emptyBackup, items: rawItems },
    schemaVersion,
  )
}

describe('备份 v3：生命周期字段完整 round-trip', () => {
  it('当前导出格式是 v3', () => {
    expect(BACKUP_SCHEMA_VERSION).toBe(3)
  })

  it('六个新字段原样保存并还原', () => {
    const r = validateItems([baseRaw], 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = r.value.items[0]

    expect(item.status).toBe('disposed')
    expect(item.disposedAt).toBe('2026-05-20')
    expect(item.disposalMethod).toBe('sold')
    expect(item.salePriceCents).toBe(450_000)
    expect(item.disposalNote).toBe('转手给同事')
    expect(item.warrantyExpiresAt).toBe('2027-05-17')

    // 恢复后立刻能算出正确的净成本与冻结天数
    expect(effectiveCostCents(item)).toBe(370_000) // 820000 - 450000
    const days = ownershipDaysOf(item, TODAY)
    expect(days).toBe(369) // 2025-05-17 → 2026-05-20 含首尾
    expect(dailyCostOf(item, TODAY)).toBeCloseTo(370_000 / 369, 6)
  })

  it('v3 也接受 wishlist（可完全没有购买信息）', () => {
    const r = validateItems(
      [
        {
          ...baseRaw,
          status: 'wishlist',
          purchaseDate: null,
          purchasePriceCents: null,
          additionalCostCents: null,
          purchasePlatform: null,
          warrantyExpiresAt: null,
          disposedAt: null,
          disposalMethod: null,
          salePriceCents: null,
          disposalNote: null,
        },
      ],
      3,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = r.value.items[0]
    expect(statusOf(item)).toBe('wishlist')
    expect(ownershipDaysOf(item, TODAY)).toBeNull()
    expect(effectiveCostCents(item)).toBeNull()
  })
})

describe('备份兼容：旧版本导入自动补默认值', () => {
  it('v1 备份（无购买信息）→ status=owned，其余新字段 null，购买字段也补 null', () => {
    const r = validateItems(
      [
        {
          id: 'old-1',
          name: '旧记录',
          categoryId: 'c1',
          note: '',
          iconAssetId: 'preset-laptop',
          sourceType: 'preset',
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
          deletedAt: null,
        },
      ],
      1,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = r.value.items[0]
    expect(item.status).toBe('owned')
    expect(item.purchaseDate).toBeNull()
    expect(item.purchasePriceCents).toBeNull()
    expect(item.additionalCostCents).toBeNull()
    expect(item.purchasePlatform).toBeNull()
    expect(item.warrantyExpiresAt).toBeNull()
    expect(item.disposedAt).toBeNull()
    expect(item.disposalMethod).toBeNull()
    expect(item.salePriceCents).toBeNull()
    expect(item.disposalNote).toBeNull()
    // 旧字段完整保留
    expect(item.name).toBe('旧记录')
    expect(item.iconAssetId).toBe('preset-laptop')
  })

  it('v2 备份（有购买信息、无生命周期）→ 补 owned + null，购买数据不丢', () => {
    const r = validateItems(
      [
        {
          id: 'v2-1',
          name: 'MacBook',
          categoryId: 'c1',
          note: '主力机',
          iconAssetId: 'preset-laptop',
          sourceType: 'preset',
          purchaseDate: '2024-01-01',
          purchasePriceCents: 1_499_900,
          additionalCostCents: 0,
          purchasePlatform: 'jd',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          deletedAt: null,
        },
      ],
      2,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = r.value.items[0]
    expect(item.status).toBe('owned')
    expect(item.purchaseDate).toBe('2024-01-01')
    expect(item.purchasePriceCents).toBe(1_499_900)
    expect(item.purchasePlatform).toBe('jd')
    expect(item.warrantyExpiresAt).toBeNull()
    expect(item.salePriceCents).toBeNull()
  })

  it('v3 里出现非法 status / disposalMethod → 明确拒绝而不是静默吞掉', () => {
    expect(validateItems([{ ...baseRaw, status: 'lost' }], 3).ok).toBe(false)
    expect(validateItems([{ ...baseRaw, disposalMethod: 'donated' }], 3).ok).toBe(false)
    expect(validateItems([{ ...baseRaw, salePriceCents: '4500' }], 3).ok).toBe(false)
  })
})

describe('导入即规范化：不变量在数据层被强制', () => {
  it('非「出售」方式：出售金额一律清空', () => {
    for (const method of ['discarded', 'other'] as const) {
      const r = validateItems([{ ...baseRaw, disposalMethod: method }], 3)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.items[0].salePriceCents).toBeNull()
    }
  })

  it('非「已处置」状态：全部处置字段清空', () => {
    const r = validateItems([{ ...baseRaw, status: 'owned' }], 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = r.value.items[0]
    expect(item.disposedAt).toBeNull()
    expect(item.disposalMethod).toBeNull()
    expect(item.salePriceCents).toBeNull()
    expect(item.disposalNote).toBeNull()
  })

  it('负数出售金额被清空为 null', () => {
    const r = validateItems([{ ...baseRaw, salePriceCents: -100 }], 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.items[0].salePriceCents).toBeNull()
  })

  it('空白处置备注被 trim 成 null', () => {
    const r = validateItems([{ ...baseRaw, disposalNote: '   ' }], 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.items[0].disposalNote).toBeNull()
  })
})
