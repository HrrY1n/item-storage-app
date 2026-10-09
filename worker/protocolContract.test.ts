import { describe, expect, it } from 'vitest'
import worker from './index'
import { createSqliteD1 } from './sqliteD1.testHarness'
import { SYNC_PROTOCOL_VERSION } from '../src/domain/syncProtocol'

const BASE = 'https://sync.example.test'
const SECRET = 's'.repeat(40)

type TestResponse = { status: number; text(): Promise<string> }

function request(path: string, method: string, body?: unknown, secret?: string): Request {
  const headers = new Map<string, string>()
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (secret !== undefined) headers.set('authorization', `Bearer ${secret}`)
  return {
    url: `${BASE}${path}`,
    method,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: async () => body,
  } as unknown as Request
}

async function call(
  db: ReturnType<typeof createSqliteD1>['db'],
  path: string,
  method: string,
  body?: unknown,
  secret?: string,
): Promise<{ status: number; payload: unknown }> {
  const response = (await worker.fetch(request(path, method, body, secret), { SYNC_DB: db } as never)) as unknown as TestResponse
  return { status: response.status, payload: JSON.parse(await response.text()) }
}

describe('Worker ↔ client v2 protocol contract', () => {
  it('bootstrap → push → pull passes through real SQLite and preserves queue ids', async () => {
    const d1 = createSqliteD1()
    const bootstrap = await call(d1.db, '/api/sync/bootstrap', 'POST', { secret: SECRET, keyId: 'key-a' })
    expect(bootstrap).toEqual({
      status: 200,
      payload: { protocolVersion: SYNC_PROTOCOL_VERSION, ok: true, keyId: 'key-a' },
    })

    const status = await call(d1.db, '/api/sync/status', 'GET', undefined, SECRET)
    expect(status.payload).toMatchObject({ protocolVersion: SYNC_PROTOCOL_VERSION, recordCount: 0, currentRevision: 0 })

    const push = await call(
      d1.db,
      '/api/sync/push',
      'POST',
      {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        deviceId: 'device-a',
        changes: [
          {
            queueId: 'queue-item-1',
            entity: 'item',
            entityId: 'item-1',
            payload: { name: '键盘', categoryId: 'c1', iconAssetId: 'preset-other', createdAt: 't', updatedAt: 't' },
            deletedAt: null,
            clientUpdatedAt: '2026-10-09T00:00:00.000Z',
            baseRevision: 0,
          },
        ],
      },
      SECRET,
    )
    expect(push.status).toBe(200)
    expect(push.payload).toMatchObject({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accepted: 1,
      acceptedQueueIds: ['queue-item-1'],
    })

    const pull = await call(d1.db, `/api/sync/pull?protocolVersion=${SYNC_PROTOCOL_VERSION}&after=0&limit=100`, 'GET', undefined, SECRET)
    expect(pull.status).toBe(200)
    expect(pull.payload).toMatchObject({ protocolVersion: SYNC_PROTOCOL_VERSION, nextRevision: 1, hasMore: false })
    expect(pull.payload).toMatchObject({ changes: [{ entity: 'item', entityId: 'item-1', revision: 1 }] })
  })

  it('old push request is explicitly rejected by the new Worker', async () => {
    const d1 = createSqliteD1()
    expect((await call(d1.db, '/api/sync/bootstrap', 'POST', { secret: SECRET, keyId: 'key-a' })).status).toBe(200)

    const response = await call(d1.db, '/api/sync/push', 'POST', { deviceId: 'old-client', changes: [] }, SECRET)
    expect(response).toEqual({ status: 426, payload: { error: 'protocol-version-required' } })
  })
})
