import { describe, expect, it } from 'vitest'
import {
  UPDATE_CHECK_THROTTLE_MS,
  UPDATE_RELOAD_GUARD_MS,
  decideApply,
  guardRetryDelay,
  shouldRequestUpdateCheck,
} from './updatePolicy'

const T0 = 1_800_000_000_000

describe('更新检查节流', () => {
  it('1. 首次启动（boot）始终允许检查', () => {
    expect(
      shouldRequestUpdateCheck({ reason: 'boot', online: true, now: T0, lastCheckAt: null }),
    ).toBe(true)
    // 即便之前查过，boot 也允许（新的一次冷启动）
    expect(
      shouldRequestUpdateCheck({ reason: 'boot', online: true, now: T0, lastCheckAt: T0 - 1000 }),
    ).toBe(true)
  })

  it('2. 60 秒内的前台恢复不重复检查', () => {
    expect(
      shouldRequestUpdateCheck({
        reason: 'visible',
        online: true,
        now: T0 + 59_000,
        lastCheckAt: T0,
      }),
    ).toBe(false)
    expect(
      shouldRequestUpdateCheck({
        reason: 'pageshow',
        online: true,
        now: T0 + 59_999,
        lastCheckAt: T0,
      }),
    ).toBe(false)
  })

  it('3. 超过节流窗口后恢复前台会检查', () => {
    expect(
      shouldRequestUpdateCheck({
        reason: 'visible',
        online: true,
        now: T0 + UPDATE_CHECK_THROTTLE_MS,
        lastCheckAt: T0,
      }),
    ).toBe(true)
  })

  it('4. 离线一律不检查（静默，不打扰）', () => {
    for (const reason of ['boot', 'visible', 'pageshow', 'online', 'manual'] as const) {
      expect(
        shouldRequestUpdateCheck({ reason, online: false, now: T0, lastCheckAt: null }),
      ).toBe(false)
    }
  })

  it('5. 手动检查忽略节流', () => {
    expect(
      shouldRequestUpdateCheck({ reason: 'manual', online: true, now: T0 + 100, lastCheckAt: T0 }),
    ).toBe(true)
  })

  it('13. 网络恢复（online）会重新检查', () => {
    expect(
      shouldRequestUpdateCheck({ reason: 'online', online: true, now: T0 + 500, lastCheckAt: T0 }),
    ).toBe(true)
  })

  it('14/15. 已有检查在飞行中时不重复发起', () => {
    expect(
      shouldRequestUpdateCheck({
        reason: 'visible',
        online: true,
        now: T0 + 120_000,
        lastCheckAt: T0,
        inFlight: true,
      }),
    ).toBe(false)
  })
})

describe('是否允许刷新', () => {
  const base = {
    pending: true,
    blocked: false,
    visible: true,
    now: T0,
    lastAutoReloadAt: null,
  }

  it('6. 发现新版本且安全 → 允许刷新', () => {
    expect(decideApply(base)).toBe('apply')
  })

  it('7. 发现新版本但正在编辑 → 推迟（绝不刷新）', () => {
    expect(decideApply({ ...base, blocked: true })).toBe('defer-blocked')
  })

  it('8. 解除阻止后 → 允许刷新', () => {
    expect(decideApply({ ...base, blocked: false })).toBe('apply')
  })

  it('9. 阻止状态下任何情形都不可能得到 apply', () => {
    for (const visible of [true, false]) {
      for (const lastAutoReloadAt of [null, T0 - 1_000_000]) {
        expect(decideApply({ ...base, blocked: true, visible, lastAutoReloadAt })).not.toBe('apply')
      }
    }
  })

  it('页面不可见（后台）→ 推迟到前台', () => {
    expect(decideApply({ ...base, visible: false })).toBe('defer-hidden')
  })

  it('11. 保护窗口内不重复刷新，窗口过后可再次刷新', () => {
    expect(decideApply({ ...base, lastAutoReloadAt: T0 - 1_000 })).toBe('defer-guard')
    expect(decideApply({ ...base, lastAutoReloadAt: T0 - UPDATE_RELOAD_GUARD_MS })).toBe('apply')
  })

  it('没有待应用更新时是 idle', () => {
    expect(decideApply({ ...base, pending: false })).toBe('idle')
  })

  it('保护窗口的重试延迟可计算', () => {
    expect(guardRetryDelay({ ...base, lastAutoReloadAt: T0 - 5_000 })).toBe(
      UPDATE_RELOAD_GUARD_MS - 5_000,
    )
    expect(guardRetryDelay({ ...base, lastAutoReloadAt: null })).toBeNull()
    expect(guardRetryDelay({ ...base, lastAutoReloadAt: T0 - 60_000 })).toBeNull()
  })
})
