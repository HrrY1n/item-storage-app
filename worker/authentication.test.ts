import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'
import { createSqliteD1 } from './sqliteD1.testHarness'

afterEach(() => vi.restoreAllMocks())

async function fixture() {
  const database = createSqliteD1()
  const env = { SYNC_DB: database.db }
  const secret = 'audit-auth-secret-'.repeat(3)
  const response = await worker.fetch(new Request('https://test.example/api/sync/bootstrap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }),
  }), env)
  expect(response.status).toBe(200)
  const status = (token = secret) => worker.fetch(new Request('https://test.example/api/sync/status', {
    headers: { Authorization: `Bearer ${token}` },
  }), env)
  return { env, status }
}

describe('authentication failure isolation', () => {
  it('rate limits wrong credentials without locking out the correct recovery secret', async () => {
    const { status } = await fixture()
    for (let i = 0; i < 10; i++) expect((await status('incorrect-secret')).status).toBe(401)
    expect((await status('incorrect-secret')).status).toBe(429)
    expect((await status()).status).toBe(200)
    expect((await status('incorrect-secret')).status).toBe(429)
  })

  it('does not put malformed request content into diagnostic logs', async () => {
    const { env } = await fixture()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const marker = 'S3CR3T'
    const response = await worker.fetch(new Request('https://test.example/api/sync/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `${marker}-not-json`,
    }), env)
    expect(response.status).toBe(500)
    expect(log).toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker)
  })
})
