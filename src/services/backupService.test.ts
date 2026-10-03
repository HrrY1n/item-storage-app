import { beforeEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { readAndValidateBackup, buildBackupArchive, buildBackupFileName } from './backupService'
import type { Snapshot } from '../db/repositories/backupRepository'
import { db } from '../db/db'

function makeSnapshot(): Snapshot {
  return {
    items: [
      {
        id: 'item-1',
        name: 'AirPods Pro 2',
        categoryId: 'cat-1',
        note: '通勤用',
        iconAssetId: 'preset-earbuds',
        sourceType: 'preset',
        purchaseDate: '2026-01-01',
        purchasePriceCents: 149_900,
        purchasePlatform: 'jd',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
      },
    ],
    categories: [
      {
        id: 'cat-1',
        parentId: null,
        name: '音频设备',
        sortOrder: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
      },
    ],
    tags: [
      {
        id: 'tag-1',
        name: '随身',
        nameNormalized: '随身',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    itemTags: [{ itemId: 'item-1', tagId: 'tag-1' }],
    assets: [
      {
        id: 'preset-earbuds',
        kind: 'preset',
        path: '/icons/items/earbuds.svg',
        blob: null,
        mime: 'image/svg+xml',
        width: 96,
        height: 96,
        styleVersion: null,
        promptVersion: null,
        sourceAssetId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    appMeta: { seeded: '1', schemaVersion: '2' },
  }
}

async function zipBytes(zip: JSZip): Promise<Uint8Array> {
  return zip.generateAsync({ type: 'uint8array' })
}

describe('buildBackupArchive：导出结构', () => {
  it('ZIP 内包含 manifest.json、data.json 与 assets/ 目录', async () => {
    const { zip } = await buildBackupArchive(makeSnapshot())
    expect(zip.file('manifest.json')).not.toBeNull()
    expect(zip.file('data.json')).not.toBeNull()
    expect(zip.folder('assets')).not.toBeNull()
  })

  it('manifest 字段与计数正确且不含任何 hash 字段', async () => {
    const { zip, manifest } = await buildBackupArchive(makeSnapshot())
    const raw = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(raw).toEqual(manifest)
    expect(raw.itemCount).toBe(1)
    expect(raw.categoryCount).toBe(1)
    expect(raw.tagCount).toBe(1)
    expect(raw.assetCount).toBe(1)
    for (const forbidden of ['sha256', 'dataSha256', 'hash']) {
      expect(Object.keys(raw)).not.toContain(forbidden)
    }
  })

  it('data.json 完整包含四类数据与资产元数据', async () => {
    const { zip } = await buildBackupArchive(makeSnapshot())
    const raw = JSON.parse(await zip.file('data.json')!.async('string'))
    expect(raw.items).toHaveLength(1)
    expect(raw.items[0].name).toBe('AirPods Pro 2')
    expect(raw.categories).toHaveLength(1)
    expect(raw.tags).toHaveLength(1)
    expect(raw.itemTags).toEqual([{ itemId: 'item-1', tagId: 'tag-1' }])
    expect(raw.assets).toHaveLength(1)
    expect(raw.assets[0].id).toBe('preset-earbuds')
    expect(raw.appMeta.seeded).toBe('1')
  })

  it('preset 静态图标不重复写入 assets/', async () => {
    const { zip } = await buildBackupArchive(makeSnapshot())
    expect(zip.file('assets/preset-earbuds.svg')).toBeNull()
    expect(
      Object.keys(zip.files).filter((p) => p.startsWith('assets/') && !zip.files[p].dir),
    ).toHaveLength(0)
  })

  it('真实二进制资产写入 assets/ 并在元数据中带 file 引用', async () => {
    const snap = makeSnapshot()
    snap.assets.push({
      id: 'asset-photo-1',
      kind: 'from_photo',
      path: null,
      blob: new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' }),
      mime: 'image/png',
      width: 200,
      height: 200,
      styleVersion: null,
      promptVersion: null,
      sourceAssetId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const { zip } = await buildBackupArchive(snap)
    expect(zip.file('assets/asset-photo-1.png')).not.toBeNull()

    const raw = JSON.parse(await zip.file('data.json')!.async('string'))
    const meta = raw.assets.find((a: { id: string }) => a.id === 'asset-photo-1')
    expect(meta.file).toBe('asset-photo-1.png')
  })

  it('文件名格式为 private-item-library-backup-YYYY-MM-DD.zip', () => {
    expect(buildBackupFileName(new Date(2026, 9, 3))).toBe(
      'private-item-library-backup-2026-10-03.zip',
    )
  })
})

describe('readAndValidateBackup：正常路径', () => {
  it('读取合法备份并返回摘要与 payload', async () => {
    const { zip } = await buildBackupArchive(makeSnapshot())
    const r = await readAndValidateBackup(await zipBytes(zip))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.summary.itemCount).toBe(1)
    expect(r.summary.categoryCount).toBe(1)
    expect(r.payload.items[0].name).toBe('AirPods Pro 2')
    expect(r.payload.appMeta.seeded).toBe('1')
  })

  it('schema v2 导出：manifest 版本为 2，data.json 含购买信息字段', async () => {
    const { zip, manifest } = await buildBackupArchive(makeSnapshot())
    expect(manifest.schemaVersion).toBe(2)
    const raw = JSON.parse(await zip.file('data.json')!.async('string'))
    expect(raw.items[0].purchaseDate).toBe('2026-01-01')
    expect(raw.items[0].purchasePriceCents).toBe(149_900)
    expect(raw.items[0].purchasePlatform).toBe('jd')
  })

  it('schema v2 恢复：购买信息完整还原，版本号为 2', async () => {
    const { zip } = await buildBackupArchive(makeSnapshot())
    const r = await readAndValidateBackup(await zipBytes(zip))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.items[0].purchaseDate).toBe('2026-01-01')
    expect(r.payload.items[0].purchasePriceCents).toBe(149_900)
    expect(r.payload.items[0].purchasePlatform).toBe('jd')
    expect(r.payload.appMeta.schemaVersion).toBe('2')
  })

  it('v1 旧备份可导入：购买字段迁移为 null，版本号升级为 2', async () => {
    const { zip, manifest, data } = await buildBackupArchive(makeSnapshot())
    // 手工降级为 v1 备份：manifest 版本改 1，Item 删除购买字段
    const v1Manifest = { ...manifest, schemaVersion: 1 }
    const v1Data = JSON.parse(JSON.stringify(data)) as typeof data
    const v1Items = v1Data.items as unknown as Record<string, unknown>[]
    delete v1Items[0].purchaseDate
    delete v1Items[0].purchasePriceCents
    delete v1Items[0].purchasePlatform
    zip.file('manifest.json', JSON.stringify(v1Manifest))
    zip.file('data.json', JSON.stringify(v1Data))

    const r = await readAndValidateBackup(await zipBytes(zip))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.items[0].purchaseDate).toBeNull()
    expect(r.payload.items[0].purchasePriceCents).toBeNull()
    expect(r.payload.items[0].purchasePlatform).toBeNull()
    expect(r.payload.appMeta.schemaVersion).toBe('2')
  })

  it('v1 manifest + v2 数据（带购买字段）也能通过校验（向后兼容读取）', async () => {
    const { zip, manifest } = await buildBackupArchive(makeSnapshot())
    zip.file('manifest.json', JSON.stringify({ ...manifest, schemaVersion: 1 }))
    const r = await readAndValidateBackup(await zipBytes(zip))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.items[0].purchaseDate).toBeNull()
  })

  it('资产元数据缺失对应文件时退化为 blob=null，不整包失败', async () => {
    const { zip } = await buildBackupArchive(makeSnapshot())
    const raw = JSON.parse(await zip.file('data.json')!.async('string'))
    raw.assets[0].file = 'missing.png'
    zip.file('data.json', JSON.stringify(raw))
    const r = await readAndValidateBackup(await zipBytes(zip))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.assets[0].blob).toBeNull()
  })
})

describe('readAndValidateBackup：失败必须拒绝且不改动数据库', () => {
  beforeEach(async () => {
    await Promise.all([
      db.items.clear(),
      db.categories.clear(),
      db.tags.clear(),
      db.itemTags.clear(),
      db.assets.clear(),
      db.appMeta.clear(),
    ])
  })

  async function expectRejected(bytes: Uint8Array, keyword: string) {
    await db.items.add({
      id: 'guard',
      name: '哨兵记录',
      categoryId: 'c',
      note: '',
      iconAssetId: 'preset-other',
      sourceType: 'preset',
      purchaseDate: null,
      purchasePriceCents: null,
      purchasePlatform: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    })
    const r = await readAndValidateBackup(bytes)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(keyword)
    // 关键：任何失败都不能动数据库
    expect(await db.items.count()).toBe(1)
    expect((await db.items.get('guard'))?.name).toBe('哨兵记录')
  }

  it('ZIP 损坏 / 非 ZIP 内容被拒绝', async () => {
    await expectRejected(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'ZIP')
  })

  it('缺少 manifest.json 被拒绝', async () => {
    const { data } = await buildBackupArchive(makeSnapshot())
    const z = new JSZip()
    z.file('data.json', JSON.stringify(data))
    await expectRejected(await zipBytes(z), 'manifest.json')
  })

  it('缺少 data.json 被拒绝', async () => {
    const { manifest } = await buildBackupArchive(makeSnapshot())
    const z = new JSZip()
    z.file('manifest.json', JSON.stringify(manifest))
    await expectRejected(await zipBytes(z), 'data.json')
  })

  it('manifest.json 不是合法 JSON 被拒绝', async () => {
    const snap = makeSnapshot()
    const { zip } = await buildBackupArchive(snap)
    const z = new JSZip()
    z.file('manifest.json', '{ 这不是 JSON')
    z.file('data.json', await zip.file('data.json')!.async('string'))
    await expectRejected(await zipBytes(z), 'JSON')
  })

  it('data.json 不是合法 JSON 被拒绝', async () => {
    const { zip } = await buildBackupArchive(makeSnapshot())
    const z = new JSZip()
    z.file('manifest.json', await zip.file('manifest.json')!.async('string'))
    z.file('data.json', '<<< broken')
    await expectRejected(await zipBytes(z), 'JSON')
  })

  it('不支持的 schemaVersion 被拒绝', async () => {
    const { zip } = await buildBackupArchive(makeSnapshot())
    const raw = JSON.parse(await zip.file('manifest.json')!.async('string'))
    raw.schemaVersion = 99
    zip.file('manifest.json', JSON.stringify(raw))
    await expectRejected(await zipBytes(zip), '不支持的备份版本')
  })

  it('data.json 字段结构错误被拒绝', async () => {
    const { zip } = await buildBackupArchive(makeSnapshot())
    const raw = JSON.parse(await zip.file('data.json')!.async('string'))
    raw.items = 'not-an-array'
    zip.file('data.json', JSON.stringify(raw))
    await expectRejected(await zipBytes(zip), 'items')
  })
})
