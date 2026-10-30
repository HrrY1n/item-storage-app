import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { initializeLocalData, LOCAL_DATA_VERSION_KEY } from './initialize'
import { PRESET_ICONS } from '../data/icons'
import { readSnapshot, replaceAllWithBackupAndDisableSync } from './repositories/backupRepository'

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
})
afterEach(() => vi.restoreAllMocks())

describe('local initialization fast path', () => {
  it('initializes a fresh database before marking it complete', async () => {
    await initializeLocalData()
    expect(await db.categories.count()).toBe(56)
    expect(await db.assets.count()).toBe(PRESET_ICONS.length)
    expect((await db.appMeta.get(LOCAL_DATA_VERSION_KEY))?.value).toBeTruthy()
  })

  it('does not scan preset assets or open upgrade write transactions on subsequent starts', async () => {
    await initializeLocalData()
    const assets = vi.spyOn(db.assets, 'where')
    const transaction = vi.spyOn(db, 'transaction')
    await initializeLocalData()
    expect(assets).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('retries incomplete initialization and never marks a failed scan complete', async () => {
    vi.spyOn(db.assets, 'where').mockImplementationOnce(() => { throw new Error('scan failed') })
    await expect(initializeLocalData()).rejects.toThrow('scan failed')
    expect(await db.appMeta.get(LOCAL_DATA_VERSION_KEY)).toBeUndefined()
    await initializeLocalData()
    expect((await db.appMeta.get(LOCAL_DATA_VERSION_KEY))?.value).toBeTruthy()
  })

  it('rechecks stale metadata without changing existing identities', async () => {
    await initializeLocalData()
    const preset = (await db.assets.toArray())[0]
    const category = (await db.categories.toArray())[0]
    await db.assets.update(preset.id, { path: '/old-icon.svg', mime: 'image/svg+xml' })
    await db.categories.update(category.id, { name: '我的分类' })
    await db.appMeta.put({ key: LOCAL_DATA_VERSION_KEY, value: 'previous-version' })
    await initializeLocalData()
    expect((await db.assets.get(preset.id))?.path).toBe(preset.path)
    expect((await db.assets.get(preset.id))?.createdAt).toBe(preset.createdAt)
    expect((await db.categories.get(category.id))?.name).toBe('我的分类')
  })

  it('excludes the local completion marker from backups and invalidates it after restore', async () => {
    await initializeLocalData()
    const payload = await readSnapshot()
    expect(payload.appMeta[LOCAL_DATA_VERSION_KEY]).toBeUndefined()
    await replaceAllWithBackupAndDisableSync(payload)
    expect(await db.appMeta.get(LOCAL_DATA_VERSION_KEY)).toBeUndefined()
    await initializeLocalData()
    expect(await db.assets.count()).toBe(PRESET_ICONS.length)
    expect((await db.appMeta.get(LOCAL_DATA_VERSION_KEY))?.value).toBeTruthy()
  })
})
