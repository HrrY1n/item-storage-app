import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { exportBackup, readAndValidateBackup } from '../../services/backupService'
import { syncRepository } from './syncRepository'
import { readSnapshot, replaceAllWithBackup } from './backupRepository'

/**
 * Phase 3B 步 6 的硬保证：**ZIP 备份不包含 secret / 任何同步状态**。
 *
 * 为什么这是安全底线：
 * - `syncState` 存的是 **Bearer secret 明文**
 * - 备份 ZIP 会被用户发到微信 / 网盘 / 邮件 / 换机
 * - 一旦 secret 进了备份文件，就等于凭据跟着备份一起扩散，
 *   且**恢复旧备份会把旧 secret 带回来**，与云端已轮换的密钥冲突
 *
 * 另外 `syncQueue` 是待推队列（恢复后语义已失效，应改为全量重推），
 * `syncConflicts` 是设备本地的覆盖记录 —— 三张表都不该进备份。
 */

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.categories.clear(),
    db.tags.clear(),
    db.itemTags.clear(),
    db.assets.clear(),
    db.appMeta.clear(),
    db.syncState.clear(),
    db.syncQueue.clear(),
    db.syncConflicts.clear(),
  ])
})

describe('readSnapshot 排除同步表', () => {
  it('快照里不含 syncState / syncQueue / syncConflicts 字段', async () => {
    await syncRepository.setState({ enabled: true, secret: 'super-secret-value', keyId: 'k1', deviceId: 'd1' })
    await syncRepository.enqueue('item', 'i1')
    await syncRepository.recordConflict({
      entity: 'item',
      entityId: 'i1',
      detectedAt: '2026-10-06T00:00:00.000Z',
      loserUpdatedAt: null,
      winnerDeviceId: 'd1',
      winnerUpdatedAt: null,
      loserSummary: 'a',
      winnerSummary: 'b',
    })

    const snapshot = await readSnapshot()
    expect(Object.keys(snapshot).sort()).toEqual(
      ['appMeta', 'assets', 'categories', 'itemTags', 'items', 'tags'],
    )
  })
})

describe('导出的 ZIP 不含任何 secret', () => {
  it('secret 不会出现在 data.json / manifest.json / 任何文件里', async () => {
    const SECRET = 'THIS-IS-A-VERY-DISTINCTIVE-SECRET-0123456789'
    await syncRepository.setState({ enabled: true, secret: SECRET, keyId: 'k1', deviceId: 'd1' })
    await syncRepository.enqueue('item', 'i1')

    const result = await exportBackup()
    const text = await result.blob.text()

    expect(text).not.toContain(SECRET)
    // 顺带确认 zip 里连同步相关的键名都没有
    expect(text).not.toContain('syncState')
    expect(text).not.toContain('syncQueue')
  })

  it('恢复备份后不会把旧 secret 带回来', async () => {
    const OLD_SECRET = 'OLD-SECRET-0123456789-ABCDEF'
    await syncRepository.setState({ enabled: true, secret: OLD_SECRET, keyId: 'k1', deviceId: 'd1' })
    const exported = await exportBackup()

    // 用户在另一台设备/另一段时间改用了新 secret
    await syncRepository.setState({ secret: 'NEW-SECRET', keyId: 'k1' })

    // 恢复旧备份
    const parsed = await readAndValidateBackup(exported.blob)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    await replaceAllWithBackup(parsed.payload)

    // 恢复动作**不应该**动 syncState —— 用户的同步凭据不归备份管
    expect((await syncRepository.getState())?.secret).toBe('NEW-SECRET')
  })

  it('恢复备份后 outbox 保持原样（不被清空也不被替换）', async () => {
    await syncRepository.setState({ enabled: true, secret: 's', keyId: 'k', deviceId: 'd' })
    await syncRepository.enqueue('item', 'pending-item')
    const exported = await exportBackup()

    const parsed = await readAndValidateBackup(exported.blob)
    if (!parsed.ok) throw new Error(parsed.error)
    await replaceAllWithBackup(parsed.payload)

    // 待推条目仍在 —— 关掉/恢复同步都不该让用户的改动消失
    const left = await syncRepository.listQueue()
    expect(left.map((r) => r.entityId)).toEqual(['pending-item'])
  })
})

describe('恢复备份后需要重置游标（由上层编排）', () => {
  it('lastPulledRevision 不会被 replaceAllWithBackup 自动改动', async () => {
    // 这是刻意的：restoreFromPayload / replaceAllWithBackup 不知道同步的存在，
    // 因此上层（backupService.restoreFromPayload）负责在恢复后把游标归零、
    // 并提示用户二选一。见 PHASE_3B_IMPLEMENTATION_PLAN.md §6。
    await syncRepository.setState({ enabled: true, secret: 's', keyId: 'k', deviceId: 'd' })
    await syncRepository.markSynced(42)
    const exported = await exportBackup()

    const parsed = await readAndValidateBackup(exported.blob)
    if (!parsed.ok) throw new Error(parsed.error)
    await replaceAllWithBackup(parsed.payload)

    // 仍为 42 —— 上层负责归零，这里断言"底层不擅自改"
    expect((await syncRepository.getState())?.lastPulledRevision).toBe(42)
  })
})