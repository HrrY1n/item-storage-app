import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUpdateManager, type PwaUpdateHost } from './updateManager'
import { UPDATE_RELOAD_GUARD_MS } from './updatePolicy'

/**
 * 用假 host 驱动管理器：把"什么时候 reload"这类最容易出错的行为钉死，
 * 不需要 DOM 测试库（项目刻意不引入 jsdom / testing-library）。
 */
function makeHarness(opts: { online?: boolean; visible?: boolean } = {}) {
  const state = {
    online: opts.online ?? true,
    visible: opts.visible ?? true,
    now: 1_000_000,
    reloads: 0,
    updateCalls: 0,
    reloadAt: null as number | null,
    timers: new Map<number, () => void>(),
    timerSeq: 0,
    updateShouldThrow: false,
  }

  const host: PwaUpdateHost = {
    isOnline: () => state.online,
    isVisible: () => state.visible,
    now: () => state.now,
    reload: () => {
      state.reloads++
    },
    updateSw: async () => {
      state.updateCalls++
      if (state.updateShouldThrow) throw new Error('network down')
    },
    readReloadAt: () => state.reloadAt,
    writeReloadAt: (at) => {
      state.reloadAt = at
    },
    setTimeout: (fn) => {
      const id = ++state.timerSeq
      state.timers.set(id, fn)
      return id
    },
    clearTimeout: (id) => {
      state.timers.delete(id)
    },
    // 测试中立即返回，避免等待真实的宽限时间
    wait: async () => {},
  }

  /** 立即执行所有待触发定时器（用于跳过宽限/重试等待） */
  const flushTimers = () => {
    const pending = [...state.timers.values()]
    state.timers.clear()
    for (const fn of pending) fn()
  }

  return { state, host, flushTimers, manager: createUpdateManager(host) }
}

describe('update manager', () => {
  let h: ReturnType<typeof makeHarness>
  beforeEach(() => {
    h = makeHarness()
  })

  it('10. 一次更新只触发一次 reload（applying 关门）', async () => {
    h.manager.markUpdateAvailable()
    await Promise.resolve()
    h.manager.markUpdateAvailable()
    h.manager.tryApply()
    h.manager.tryApply()
    expect(h.state.reloads).toBe(1)
  })

  it('blocked 时绝不 reload，解除后自动补上', async () => {
    h.manager.setBlocked('form', true)
    h.manager.markUpdateAvailable()
    await Promise.resolve()
    expect(h.state.reloads).toBe(0)
    expect(h.manager.getSnapshot().updatePending).toBe(true)

    h.manager.setBlocked('form', false)
    await Promise.resolve()
    expect(h.state.reloads).toBe(1)
  })

  it('多个组件同时声明 blocked 时，最后一个解除才放行', async () => {
    h.manager.setBlocked('form', true)
    h.manager.setBlocked('sheet', true)
    h.manager.markUpdateAvailable()
    await Promise.resolve()

    h.manager.setBlocked('sheet', false)
    await Promise.resolve()
    expect(h.state.reloads).toBe(0)

    h.manager.setBlocked('form', false)
    await Promise.resolve()
    expect(h.state.reloads).toBe(1)
  })

  it('后台（不可见）发现更新不刷新，回到前台才刷新', async () => {
    h.state.visible = false
    h.manager.markUpdateAvailable()
    await Promise.resolve()
    expect(h.state.reloads).toBe(0)

    h.state.visible = true
    h.manager.setVisible(true)
    await Promise.resolve()
    expect(h.state.reloads).toBe(1)
  })

  it('11. reload 保护窗口内不刷新，窗口过后自动重试（不是永久锁）', async () => {
    h.state.reloadAt = h.state.now - 1_000 // 1 秒前刚因更新刷新过
    h.manager.markUpdateAvailable()
    await Promise.resolve()
    expect(h.state.reloads).toBe(0)

    // 推进到保护窗口之后，触发重试定时器
    h.state.now += UPDATE_RELOAD_GUARD_MS + 100
    h.flushTimers()
    await Promise.resolve()
    expect(h.state.reloads).toBe(1)
  })

  it('12. registration.update 抛错不影响 App（静默降级）', async () => {
    h.state.updateShouldThrow = true
    await expect(h.manager.requestCheck('boot')).resolves.toBe(true)
    expect(h.manager.getSnapshot().checking).toBe(false)
    expect(h.state.reloads).toBe(0)
  })

  it('离线时不发起检查；恢复联网后自动检查一次', async () => {
    h.state.online = false
    expect(await h.manager.requestCheck('visible')).toBe(false)
    expect(h.state.updateCalls).toBe(0)

    h.state.online = true
    h.manager.setOnline(true)
    // setOnline → requestCheck('online') 是异步的
    await new Promise((r) => setTimeout(r, 0))
    expect(h.state.updateCalls).toBe(1)
  })

  it('前台恢复走节流：60 秒内不重复 update，之后会', async () => {
    await h.manager.requestCheck('boot')
    expect(h.state.updateCalls).toBe(1)

    h.manager.setVisible(true) // 紧接着的恢复 → 被节流
    await new Promise((r) => setTimeout(r, 0))
    expect(h.state.updateCalls).toBe(1)

    h.state.now += 61_000
    h.manager.setVisible(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.state.updateCalls).toBe(2)
  })

  it('手动检查忽略节流', async () => {
    await h.manager.requestCheck('boot')
    await h.manager.requestCheck('manual')
    expect(h.state.updateCalls).toBe(2)
  })

  it('订阅者能收到状态变化', async () => {
    const listener = vi.fn()
    const unsubscribe = h.manager.subscribe(listener)
    h.manager.markUpdateAvailable()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    h.manager.markOfflineReady()
    expect(h.manager.getSnapshot().offlineReady).toBe(true)
  })
})
