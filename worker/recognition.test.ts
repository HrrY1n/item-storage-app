import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index'
import { createSqliteD1 } from './sqliteD1.testHarness'
import { RECOGNITION_BODY_BYTES } from '../src/domain/recognition'
import { RECOGNITION_MODEL } from './recognition'

const secret = 'recognition-test-secret-'.repeat(3)
const image = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(40)
const candidate = { name: '耳机', categoryName: '音频设备', note: '黑色', priceText: '199.90', purchaseDate: '2026-01-31', purchasePlatform: 'jd', warnings: [] }
let tick = Date.now()
beforeEach(() => { tick += 10000; vi.spyOn(Date, 'now').mockReturnValue(tick) })
afterEach(() => vi.restoreAllMocks())

async function fixture() {
  const db = createSqliteD1()
  const run = vi.fn(async (_model: string, _input: Record<string, unknown>) => ({ choices: [{ message: { content: JSON.stringify(candidate) } }] }))
  const env = { SYNC_DB: db.db, AI: { run }, AI_FREE_PLAN_CONFIRMED: 'true' }
  await worker.fetch(new Request('https://test.example/api/sync/bootstrap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }),
  }), env)
  const call = (body: unknown = { mode: 'order', image, categoryNames: ['音频设备'] }, token: string | null = secret, over = {}) =>
    worker.fetch(new Request('https://test.example/api/ai/recognize', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }), { ...env, ...over })
  return { db, run, call }
}
const payload = async (response: Response) => JSON.parse(await (response as unknown as { text(): Promise<string> }).text())

describe('authenticated free-tier recognition endpoint', () => {
  it('requires pairing auth before spending model quota', async () => {
    const { call, run } = await fixture()
    expect((await call(undefined, null)).status).toBe(401)
    expect((await call(undefined, 'wrong-secret')).status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })
  it('fails closed without explicit Free-plan confirmation or AI binding', async () => {
    const { call, run } = await fixture()
    expect((await call(undefined, secret, { AI_FREE_PLAN_CONFIRMED: 'false' })).status).toBe(503)
    expect((await call(undefined, secret, { AI: undefined })).status).toBe(503)
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects oversized chunked input and remote image URLs before inference', async () => {
    const { call, run } = await fixture()
    expect((await call('x'.repeat(RECOGNITION_BODY_BYTES + 1))).status).toBe(413)
    expect((await call({ mode: 'order', image: 'https://example.com', categoryNames: [] })).status).toBe(400)
    expect((await call({ mode: 'execute', image, categoryNames: [] })).status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
  it('uses only the fixed model and returns validated candidates without business writes', async () => {
    const { call, run, db } = await fixture()
    const response = await call()
    expect(response.status).toBe(200)
    expect(await payload(response)).toEqual({ candidate })
    expect(run).toHaveBeenCalledWith(RECOGNITION_MODEL, expect.objectContaining({ max_completion_tokens: 1024, stream: false, store: false }))
    expect(run.mock.calls[0]?.[1]).not.toHaveProperty('tools')
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM sync_records').get()).toMatchObject({ n: 0 })
    expect((await call()).status).toBe(429)
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('does not return model-inferred purchase information for physical photos', async () => {
    const { call, run } = await fixture()
    run.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ ...candidate, priceText: '¥199', purchaseDate: 'invalid', purchasePlatform: 'invalid' }) } }] })
    const response = await call({ mode: 'photo', image, categoryNames: ['音频设备'] })
    expect(response.status).toBe(200)
    expect(await payload(response)).toMatchObject({ candidate: { name: '耳机', priceText: null, purchaseDate: null, purchasePlatform: null, warnings: [] } })
  })
  it('returns reliable fields even if one optional model field is malformed', async () => {
    const { call, run, db } = await fixture()
    run.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ ...candidate, purchaseDate: '2026-02-30' }) } }] })
    const response = await call()
    expect(response.status).toBe(200)
    expect(await payload(response)).toMatchObject({ candidate: { name: '耳机', priceText: '199.90', purchaseDate: null, warnings: [expect.stringContaining('购买日期')] } })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM sync_records').get()).toMatchObject({ n: 0 })
  })
  it('never retries or switches providers when quota is exhausted', async () => {
    const { call, run } = await fixture()
    run.mockRejectedValueOnce(new Error('Daily neurons quota exceeded'))
    const response = await call()
    expect(response.status).toBe(429)
    expect(await payload(response)).toEqual({ error: 'ai-quota-exhausted' })
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('does not expose malformed output or internal provider errors', async () => {
    const { call, run } = await fixture()
    run.mockResolvedValueOnce({ choices: [{ message: { content: '{"purchaseDate":"2026-02-30"}' } }] })
    expect((await call()).status).toBe(502)
  })
})
