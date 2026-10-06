import { describe, expect, it } from 'vitest'
import {
  buildPullPage,
  bytesToHex,
  decidePush,
  parseBearer,
  summarize,
  timingSafeEqualHex,
  toBase64Url,
} from './syncLogic'

/**
 * Worker 侧纯逻辑测试。
 * 重点：删除不被复活、冲突判定、认证比较、分页游标。
 */

const change = (over: Partial<Parameters<typeof decidePush>[0]['change']> = {}) => ({
  entity: 'item' as const,
  entityId: 'i1',
  payload: { name: 'X' },
  deletedAt: null,
  clientUpdatedAt: '2026-01-02T00:00:00.000Z',
  baseRevision: 0,
  ...over,
})

const existing = (over: Partial<Parameters<typeof decidePush>[0]['existing']> = {}) =>
  ({
    revision: 10,
    deletedAt: null,
    clientUpdatedAt: '2026-01-01T00:00:00.000Z',
    deviceId: 'device-a',
    payload: { name: '旧名' },
    ...over,
  }) as Parameters<typeof decidePush>[0]['existing']

describe('decidePush · 删除不被复活（核心不变量）', () => {
  it('已 tombstone 且无 undeleteIntent → 忽略，★ 即使 baseRevision 极新也不能复活', () => {
    const d = decidePush({
      change: change({ baseRevision: 999_999 }),
      existing: existing({ revision: 5, deletedAt: '2026-01-01T00:00:00.000Z' }),
      revisionFrom: 100,
    })
    expect(d.kind).toBe('ignore-tombstone')
    expect(d.recordConflict).toBe(false)
    expect(d.revision).toBeUndefined()
  })

  it('tombstone 判定优先于一切 —— 连"实体不存在"的判断都在其后', () => {
    // 记录存在且已删除 → 必须是 ignore-tombstone，而不是 accept-new
    const d = decidePush({
      change: change(),
      existing: existing({ deletedAt: '2026-01-01T00:00:00.000Z' }),
      revisionFrom: 1,
    })
    expect(d.kind).toBe('ignore-tombstone')
  })

  it('显式 undeleteIntent 可以恢复（唯一合法出口）', () => {
    const d = decidePush({
      change: change({ undeleteIntent: true }),
      existing: existing({ deletedAt: '2026-01-01T00:00:00.000Z' }),
      revisionFrom: 100,
    })
    // 服务端 rev(10) > base(0) → 冲突，但仍然接受（恢复必须可行）
    expect(d.kind).toBe('accept-conflict')
    expect(d.revision).toBe(100)
  })
})

describe('decidePush · 常规判定', () => {
  it('服务端无该记录 → accept-new', () => {
    const d = decidePush({ change: change(), existing: null, revisionFrom: 42 })
    expect(d.kind).toBe('accept-new')
    expect(d.revision).toBe(42)
    expect(d.recordConflict).toBe(false)
  })

  it('客户端基于最新（base ≥ 服务端 rev）→ accept-fresh，无冲突记录', () => {
    const d = decidePush({ change: change({ baseRevision: 10 }), existing: existing({ revision: 10 }), revisionFrom: 42 })
    expect(d.kind).toBe('accept-fresh')
    expect(d.recordConflict).toBe(false)
  })

  it('服务端 rev > base（并发修改）→ 仍覆盖，但标记冲突供事后可查', () => {
    const d = decidePush({ change: change({ baseRevision: 3 }), existing: existing({ revision: 10 }), revisionFrom: 42 })
    expect(d.kind).toBe('accept-conflict')
    expect(d.revision).toBe(42)
    expect(d.recordConflict).toBe(true)
  })

  it('非法实体类型 → ignore-invalid', () => {
    const d = decidePush({
      change: change({ entity: 'asset' as never }),
      existing: null,
      revisionFrom: 1,
    })
    expect(d.kind).toBe('ignore-invalid')
    expect(d.ignoreReason).toBe('invalid-entity')
  })

  it('每批 revision 连续递增（客户端推进游标才不会漏）', () => {
    const revs = [10, 11, 12].map((from) => decidePush({ change: change(), existing: null, revisionFrom: from }).revision)
    expect(revs).toEqual([10, 11, 12])
  })
})

describe('summarize', () => {
  it('物品：名称 + 备注前 80 字', () => {
    expect(summarize({ name: '耳机', note: '通勤降噪' })).toBe('耳机 · 通勤降噪')
  })

  it('备注过长被截断', () => {
    const long = 'x'.repeat(200)
    const s = summarize({ name: 'N', note: long }) ?? ''
    expect(s).toContain('…')
    expect(s.length).toBeLessThan(120)
  })

  it('只有名称时只返回名称', () => {
    expect(summarize({ name: '耳机', note: '' })).toBe('耳机')
  })

  it('两者都空 → null', () => {
    expect(summarize({ name: '', note: '' })).toBeNull()
  })

  it('非对象 → null', () => {
    expect(summarize(null)).toBeNull()
    expect(summarize('str')).toBeNull()
  })
})

describe('parseBearer', () => {
  it('正确解析', () => {
    expect(parseBearer('Bearer abc123')).toBe('abc123')
  })

  it('大小写不敏感', () => {
    expect(parseBearer('bearer abc123')).toBe('abc123')
  })

  it('缺前缀 / 空token / null → null', () => {
    expect(parseBearer('abc123')).toBeNull()
    expect(parseBearer('Bearer ')).toBeNull()
    expect(parseBearer(null)).toBeNull()
  })
})

describe('timingSafeEqualHex（Workers 无 timingSafeEqual，手写实现）', () => {
  it('相同哈希 → true', () => {
    expect(timingSafeEqualHex('deadbeef', 'deadbeef')).toBe(true)
  })

  it('不同哈希 → false', () => {
    expect(timingSafeEqualHex('deadbeef', 'deadbeee')).toBe(false)
  })

  it('长度不同 → false', () => {
    expect(timingSafeEqualHex('dead', 'deadbeef')).toBe(false)
  })

  it('空字符串自比较 → true', () => {
    expect(timingSafeEqualHex('', '')).toBe(true)
  })

  it('首字符不同也判false', () => {
    expect(timingSafeEqualHex('aaaaaaaa', 'baaaaaaa')).toBe(false)
  })
})

describe('bytesToHex', () => {
  it('小写十六进制', () => {
    expect(bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer)).toBe('deadbeef')
  })

  it('补零到两位', () => {
    expect(bytesToHex(new Uint8Array([0x0f]).buffer)).toBe('0f')
  })
})

describe('buildPullPage（游标推进正确性）', () => {
  const row = (rev: number) => ({
    revision: rev,
    entity: 'item',
    entity_id: 'i' + rev,
    payload: '{"name":"X"}',
    deleted_at: null,
    client_updated_at: 't',
    device_id: 'd',
  })

  it('nextRevision 取本页最大 revision', () => {
    const p = buildPullPage([row(5), row(6), row(7)], 1, 10)
    expect(p.nextRevision).toBe(7)
    expect(p.hasMore).toBe(false)
    expect(p.changes).toHaveLength(3)
  })

  it('空结果不推进游标（避免把未同步的数据跳过）', () => {
    const p = buildPullPage([], 12, 10)
    expect(p.nextRevision).toBe(12)
    expect(p.changes).toEqual([])
  })

  it('多取一条用于判断 hasMore，并截回 limit 条', () => {
    const p = buildPullPage([row(1), row(2), row(3)], 0, 2)
    expect(p.hasMore).toBe(true)
    expect(p.changes.map((c) => c.revision)).toEqual([1, 2])
    expect(p.nextRevision).toBe(2)
  })

  it('坏 JSON 的载荷降级为 null，不让整批失败', () => {
    const bad = { ...row(1), payload: 'not json' }
    const p = buildPullPage([bad], 0, 10)
    expect(p.changes[0].payload).toBeNull()
  })

  it('保留 tombstone 与设备信息（删除必须同步过去）', () => {
    const r = { ...row(1), deleted_at: '2026-01-01T00:00:00.000Z', device_id: 'dev-b' }
    const p = buildPullPage([r], 0, 10)
    expect(p.changes[0].deletedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(p.changes[0].deviceId).toBe('dev-b')
  })
})
describe('toBase64Url（配对码的编码，必须与标准 base64 一致）', () => {
  /** 用标准 base64 当对照真值。表里是预先算好的 base64url（无 padding）。 */
  const cases: Array<[string, string]> = [
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ]

  it.each(cases)('ASCII %j → %j', (plain, expected) => {
    const bytes = new Uint8Array(plain.length)
    for (let i = 0; i < plain.length; i += 1) bytes[i] = plain.charCodeAt(i)
    expect(toBase64Url(bytes)).toBe(expected)
  })

  it('只使用 URL-safe 字母表（无 + / = ）', () => {
    // 0xFB 0xFF 0xBE 在标准 base64 里会产生 + 与 /，URL-safe 必须是 - 与 _
    const bytes = new Uint8Array([0xfb, 0xff, 0xbe, 0x00, 0x3e, 0x3f])
    const out = toBase64Url(bytes)
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/)
    // 标准 base64：+/8+AD4= → URL-safe: -_--AD4_
    expect(out).toBe('-_--AD4_')
  })

  it('任意长度都不丢字符（逐长度覆盖 0..40）', () => {
    // 防回归：曾出现过"提前 break 导致输出被截断"的实现 bug
    for (let n = 0; n <= 40; n += 1) {
      const bytes = new Uint8Array(n)
      for (let i = 0; i < n; i += 1) bytes[i] = (i * 37 + n * 11) % 256
      const out = toBase64Url(bytes)
      const expectedLen = n === 0 ? 0 : Math.ceil((n * 8) / 6)
      expect(out.length).toBe(expectedLen)
    }
  })
})
