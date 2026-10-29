import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { itemRepository } from '../../db/repositories/itemRepository'
import { tagRepository } from '../../db/repositories/tagRepository'
import { syncRepository } from '../../db/repositories/syncRepository'
import { replaceAllWithBackupAndDisableSync } from '../../db/repositories/backupRepository'
import { buildBackupArchive, readAndValidateBackup } from '../../services/backupService'
import { SyncEngine } from './syncEngine'
import type { SyncEngineHost } from './syncEngine'
import type { RemoteChange } from './syncTransport'
import type { SyncEntity } from '../../domain/syncPayload'
import { SYNC_PROTOCOL_VERSION } from '../../domain/syncProtocol'

/**
 * 边缘风险复现（2026-10-30 审计 HYPOTHESIS 的端到端验证）：
 *
 * 「恢复 ZIP 备份 → 以本机数据重新配对（local 方向）」路径上，
 * 恢复会清空 outbox —— 若此前有一个**尚未上云的标签物理删除**，
 * 删除事实随 outbox 一起丢失；重连后从 revision=0 全量拉取，
 * 云端仍存活的同名标签会被拉回本地（删除被静默撤销）。
 *
 * 本测试用与 syncEngine.test.ts 相同的内存假云端（FakeCloud）执行**真实生产代码路径**：
 * tagRepository.delete → buildBackupArchive → replaceAllWithBackupAndDisableSync →
 * commitJoin 的 local 分支语义（initCredentials + enqueueAll({preserveDeletes:true})）→ engine.run()。
 */

const BASE = 'https://example.test'
const SECRET = 's'.repeat(40)

const baseInput = {
  name: '标签回弹样品',
  categoryId: 'c1',
  iconAssetId: 'preset-other',
  note: '',
  tagIds: [] as string[],
  purchaseDate: null as string | null,
  purchasePriceCents: null as number | null,
  additionalCostCents: null as number | null,
  purchasePlatform: null as 'jd' | null,
  status: 'owned' as const,
  warrantyExpiresAt: null,
  disposedAt: null,
  disposalMethod: null,
  salePriceCents: null,
  disposalNote: null,
}

class FakeCloud {
  private rows = new Map<string, { revision: number; deletedAt: string | null; change: RemoteChange }>()
  private seq = 0

  async push(deviceId: string, changes: Array<{ queueId?: string; entity: SyncEntity; entityId: string; payload: unknown; deletedAt: string | null; clientUpdatedAt: string; baseRevision: number; undeleteIntent?: boolean }>): Promise<{ accepted: number; acceptedQueueIds: string[]; ignored: Array<{ queueId: string; entity: SyncEntity; entityId: string; reason: string }>; currentRevision: number }> {
    const acceptedQueueIds: string[] = []
    const ignored: Array<{ queueId: string; entity: SyncEntity; entityId: string; reason: string }> = []
    const accepted = changes.filter((c) => {
      const key = `${c.entity}:${c.entityId}`
      const existing = this.rows.get(key)
      if (existing !== undefined && existing.deletedAt !== null && c.undeleteIntent !== true) {
        ignored.push({ queueId: c.queueId ?? `${c.entity}:${c.entityId}`, entity: c.entity, entityId: c.entityId, reason: 'tombstoned' })
        return false
      }
      acceptedQueueIds.push(c.queueId ?? `${c.entity}:${c.entityId}`)
      this.seq += 1
      this.rows.set(key, {
        revision: this.seq,
        deletedAt: c.deletedAt,
        change: { revision: this.seq, entity: c.entity, entityId: c.entityId, payload: c.payload, deletedAt: c.deletedAt, clientUpdatedAt: c.clientUpdatedAt, deviceId },
      })
      return true
    }).length
    return { accepted, acceptedQueueIds, ignored, currentRevision: this.seq }
  }

  pull(after: number): { changes: RemoteChange[]; nextRevision: number; hasMore: boolean } {
    const all = [...this.rows.values()]
      .filter((r) => r.revision > after)
      .sort((a, b) => a.revision - b.revision)
      .map((r) => r.change)
    return { changes: all, nextRevision: all.length === 0 ? after : all[all.length - 1]!.revision, hasMore: false }
  }

  get recordCount(): number {
    return this.rows.size
  }
}

let cloud: FakeCloud

function makeDevice(): { engine: SyncEngine; host: SyncEngineHost } {
  const host: SyncEngineHost = {
    isOnline: () => true,
    now: () => 1_000_000,
    async fetch(url, init) {
      if (url.endsWith('/api/sync/status')) {
        return { status: 200, text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, currentRevision: 0, recordCount: cloud.recordCount }) }
      }
      if (url.endsWith('/api/sync/push')) {
        const body = JSON.parse(init.body ?? '{}') as { deviceId: string; changes: Parameters<FakeCloud['push']>[1] }
        const r = await cloud.push(body.deviceId, body.changes)
        return {
          status: 200,
          text: async () => JSON.stringify({
            protocolVersion: SYNC_PROTOCOL_VERSION,
            ...r,
            dedupDirectives: [],
            authoritativeChanges: [],
            conflicts: [],
          }),
        }
      }
      if (url.includes('/api/sync/pull')) {
        const after = Number(new URL(url).searchParams.get('after') ?? '0')
        const r = cloud.pull(after)
        return { status: 200, text: async () => JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, ...r }) }
      }
      return { status: 404, text: async () => '' }
    },
  }
  return { engine: new SyncEngine(host, { baseUrl: BASE }), host }
}

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.categories.clear(),
    db.tags.clear(),
    db.itemTags.clear(),
    db.assets.clear(),
    db.appMeta.clear(),
    db.syncQueue.clear(),
    db.syncState.clear(),
    db.syncConflicts.clear(),
  ])
  cloud = new FakeCloud()
  await db.categories.add({
    id: 'c1',
    parentId: null,
    name: '分类',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  })
})

describe('备份恢复 → 以本机数据重新配对的标签删除回弹', () => {
  it('未上云的标签删除在恢复+重连后被云端旧记录撤销（删除回弹）', async () => {
    // 1. 建立数据并首次同步：云端拥有 item + tag
    const { engine } = makeDevice()
    await syncRepository.setState({ enabled: true, secret: SECRET, deviceId: 'dev-A' })
    const tag = await tagRepository.create('旧标签')
    const item = await itemRepository.create({ ...baseInput, tagIds: [tag.id] })
    await engine.run()
    expect((await db.tags.toArray()).map(t => t.id)).toContain(tag.id)

    // 2. 本地物理删除标签（同步事件入队但**不上云** —— 模拟期间离线）
    await tagRepository.delete(tag.id)
    expect(await db.tags.get(tag.id)).toBeUndefined()
    expect((await db.syncQueue.toArray()).some(e => e.entity === 'tag' && e.entityId === tag.id)).toBe(true)
    // 此时不调用 engine.run()，删除事件滞留 outbox

    // 3. 导出备份（此刻标签已不在备份内容中），经真实校验路径后按生产恢复事务落库
    //    （replaceAllWithBackupAndDisableSync 清空 outbox、禁用同步）
    const { zip } = await buildBackupArchive()
    const validated = await readAndValidateBackup(await zip.generateAsync({ type: 'uint8array' }))
    if (!validated.ok) throw new Error(validated.error)
    expect(validated.payload.tags.map(t => t.id)).not.toContain(tag.id)
    await replaceAllWithBackupAndDisableSync(validated.payload)
    expect(await db.tags.get(tag.id)).toBeUndefined()
    // 恢复清空了 outbox：删除事实就此丢失
    expect(await db.syncQueue.toArray()).toHaveLength(0)

    // 4. 「以本机数据重新配对」= commitJoin('local') 的核心语义：
    //    同事务内换凭据启用 + enqueueAll({preserveDeletes:true})，游标归零
    //    （此处直接复现其落库效果；commitJoin 本身不经网络，语义见 services/syncService.ts）
    await syncRepository.setState({ enabled: true, secret: SECRET, deviceId: 'dev-A2' })
    await syncRepository.setState({ lastPulledRevision: 0, lastSyncAt: null })
    await syncRepository.enqueueAll({ preserveDeletes: true })

    // 5. 同步：push 本机现状（无标签）→ pull revision=0 全量
    await engine.run()

    // 6. 断言云端存活的标签是否被拉回本地
    const tagsAfter = await db.tags.toArray()
    const rebound = tagsAfter.find(t => t.id === tag.id)
    // 已确认的回弹：未上云的删除被云端旧记录撤销（见 06 报告的中级边缘风险）
    expect(rebound?.name).toBe('旧标签')
    // 物品的关联不会被恢复（云端物品已被本机 push 覆盖为无标签），仅标签行本身回弹
    const links = await db.itemTags.where('itemId').equals(item.id).toArray()
    expect(links).toHaveLength(0)
  })
})
