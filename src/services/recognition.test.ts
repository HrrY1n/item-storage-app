import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncRepository } from '../db/repositories/syncRepository'
import { prepareRecognitionImage, recognizeItemImage } from './recognition'

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
  it('keeps usable fields with a warning, but rejects an empty result and HTML fallback', async () => {
    const fetcher = setup()
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ candidate: { ...candidate, purchaseDate: '2026-02-30' } })))
    await expect(recognizeItemImage('image', 'order', [], new AbortController().signal)).resolves.toMatchObject({ name: '耳机', priceText: '0', purchaseDate: null, warnings: [expect.stringContaining('购买日期')] })
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ candidate: { priceText: '-1' } })))
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

describe('local recognition image preparation', () => {
  function canvasFixture() {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-image')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const decode = vi.fn(async () => {})
    vi.stubGlobal('Image', class { naturalWidth = 1170; naturalHeight = 10000; decode = decode; src = '' })
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
    const encoded = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(40)
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), toDataURL: vi.fn(() => encoded) }
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
    return { canvas, context, revoke, decode, encoded }
  }
  const file = new File(['image'], 'order.png', { type: 'image/png' })
  it('crops original pixels before resizing, preserving long screenshot text detail', async () => {
    const { canvas, context, revoke, encoded } = canvasFixture()
    await expect(prepareRecognitionImage(file, { top: 40, bottom: 60 })).resolves.toEqual({ image: encoded, width: 936, height: 1600 })
    expect(canvas.width).toBe(936)
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 4000, 1170, 2000, 0, 0, 936, 1600)
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85)
    expect(revoke).toHaveBeenCalledWith('blob:test-image')
  })
  it('keeps the full preview aspect ratio and enforces byte limits', async () => {
    const { canvas, revoke } = canvasFixture()
    expect(await prepareRecognitionImage(file)).toMatchObject({ width: 187, height: 1600 })
    canvas.toDataURL.mockReturnValue('data:image/jpeg;base64,/9j/' + 'A'.repeat(600000))
    await expect(prepareRecognitionImage(file)).rejects.toThrow('裁剪')
    expect(canvas.toDataURL).toHaveBeenLastCalledWith('image/jpeg', 0.5)
    expect(revoke).toHaveBeenCalledTimes(2)
  })
  it('rejects invalid crops and releases object URLs after decode failures', async () => {
    const { decode, revoke } = canvasFixture()
    for (const crop of [{ top: -1, bottom: 20 }, { top: 50, bottom: 50 }, { top: 90, bottom: 101 }, { top: NaN, bottom: 50 }]) {
      await expect(prepareRecognitionImage(file, crop)).rejects.toThrow('有效的裁剪')
    }
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    decode.mockRejectedValueOnce(new Error('decode'))
    await expect(prepareRecognitionImage(file)).rejects.toThrow('无法读取')
    expect(revoke).toHaveBeenCalledTimes(1)
  })
})
