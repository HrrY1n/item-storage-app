import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkServiceWorkerUpdate } from './checkServiceWorkerUpdate'

function harness() {
  const worker = new EventTarget() as ServiceWorker
  let state: ServiceWorkerState = 'installing'
  Object.defineProperty(worker, 'state', { get: () => state })
  const registration = {
    installing: worker,
    waiting: null,
    update: vi.fn(async () => {}),
  } as unknown as ServiceWorkerRegistration
  const change = (next: ServiceWorkerState) => {
    state = next
    worker.dispatchEvent(new Event('statechange'))
  }
  return { registration, change }
}

afterEach(() => vi.useRealTimers())

describe('checkServiceWorkerUpdate', () => {
  it('未注册和检查失败均不能报告成功', async () => {
    await expect(checkServiceWorkerUpdate(undefined)).rejects.toThrow('not registered')
    const h = harness()
    vi.mocked(h.registration.update).mockRejectedValueOnce(new Error('network failed'))
    await expect(checkServiceWorkerUpdate(h.registration)).rejects.toThrow('network failed')
  })

  it('等待真实安装/激活，慢于 900ms 时也不提前完成', async () => {
    vi.useFakeTimers()
    const h = harness()
    const done = vi.fn()
    const checking = checkServiceWorkerUpdate(h.registration).then(done)
    await vi.advanceTimersByTimeAsync(5000)
    expect(done).not.toHaveBeenCalled()
    h.change('installed')
    expect(done).not.toHaveBeenCalled()
    h.change('activated')
    await checking
    expect(done).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('没有新 worker 时直接完成；已激活的安装也能处理', async () => {
    const h = harness()
    h.change('activated')
    await expect(checkServiceWorkerUpdate(h.registration)).resolves.toBeUndefined()
    Object.assign(h.registration, { installing: null })
    await expect(checkServiceWorkerUpdate(h.registration)).resolves.toBeUndefined()
  })

  it('预缓存安装失败或超时明确失败，移除监听器和定时器', async () => {
    vi.useFakeTimers()
    const h = harness()
    const failed = expect(checkServiceWorkerUpdate(h.registration)).rejects.toThrow('installation failed')
    await Promise.resolve()
    h.change('redundant')
    await failed
    expect(vi.getTimerCount()).toBe(0)

    const slow = harness()
    const timedOut = expect(checkServiceWorkerUpdate(slow.registration)).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(120_000)
    await timedOut
    expect(vi.getTimerCount()).toBe(0)
  })
})
