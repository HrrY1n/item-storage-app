import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncRepository } from '../db/repositories/syncRepository'
import { recognizeItemImage } from './recognition'

const candidate = { name: '耳机', categoryName: null, note: null, priceText: '0', purchaseDate: '2026-01-15', purchasePlatform: 'jd', warnings: [] }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function setup() {
  vi.spyOn(syncRepository, 'getState').mockResolvedValue({ secret: 'test-pairing-secret' } as never)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ candidate })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('recognition client transport', () => {
  it('uses pairing auth even when sync is paused, and validates success', async () => {
    const fetcher = setup()
    expect(await recognizeItemImage('image', 'order', [], new AbortController().signal)).toEqual(candidate)
    expect(fetcher).toHaveBeenCalledWith('/api/ai/recognize', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-pairing-secret' }) }))
  })
  it('never sends an image before pairing or while offline', async () => {
    const fetcher = setup()
    vi.spyOn(syncRepository, 'getState').mockResolvedValueOnce(null)
    await expect(recognizeItemImage('image', 'photo', [], new AbortController().signal)).rejects.toThrow('配对')
    vi.stubGlobal('navigator', { onLine: false })
    await expect(recognizeItemImage('image', 'photo', [], new AbortController().signal)).rejects.toThrow('离线')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('handles quota errors without a retry or provider fallback', async () => {
    const fetcher = setup()
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'ai-quota-exhausted' }), { status: 429 }))
    await expect(recognizeItemImage('image', 'photo', [], new AbortController().signal)).rejects.toThrow('额度')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid successful fields and an HTML fallback page', async () => {
    const fetcher = setup()
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ candidate: { ...candidate, purchaseDate: '2026-02-30' } })))
    await expect(recognizeItemImage('image', 'order', [], new AbortController().signal)).rejects.toThrow('可靠')
    fetcher.mockResolvedValueOnce(new Response('<html>SPA fallback</html>'))
    await expect(recognizeItemImage('image', 'order', [], new AbortController().signal)).rejects.toThrow('暂时不可用')
  })
  it('does not start an already-cancelled request', async () => {
    const fetcher = setup()
    const controller = new AbortController(); controller.abort()
    await expect(recognizeItemImage('image', 'photo', [], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
