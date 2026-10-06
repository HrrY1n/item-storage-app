import { describe, expect, it } from 'vitest'
import { allocateRevisions, currentRevision, hasAnyAuth } from './syncSql'

/**
 * revision 分配与认证的数据库交互测试（Phase 3B 复审第 2 条）。
 *
 * 用一个**内存版D1**（语义与 SQLite 一致，带单线程执行器）来验证：
 * 两个并发 push 不会拿到重叠的 revision 区间。
 *
 * 旧实现是两条独立语句：
 *   UPDATE sync_revision_seq SET revision = revision + N
 *   SELECT revision FROM sync_revision_seq
 * 并发时会交错成A.UPDATE → B.UPDATE → A.SELECT → B.SELECT，
 * 两者读到同一个末值 → **完全重叠的 revision 区间**，
 * 后写的记录覆盖先写的，客户端推进游标后漏数据。
 */

/** 内存版 D1：单线程执行器 + 真实 SQL 语义（用 Python/sqlite 无法跑，这里手写） */
class FakeD1 {
  private seq = 0
  private authRows: Array<{ id: number; key_id: string; secret_hash: string }> = []

  /** 记录执行过的语句类型，用来断言是否用了 RETURNING */
  readonly statements: string[] = []
  /** 模拟 D1 异常：UPDATE ... RETURNING 不返回结果行 */
  suppressReturning = false

  prepare(sql: string) {
    const self = this
    let bound: unknown[] = []
    const stmt = {
      bind(...values: unknown[]) {
        bound = values
        return stmt
      },
      async run() {
        self.statements.push(sql.trim().split('\n')[0] ?? sql)
        // 只实现本项目实际用到的两条语句
        if (sql.includes('UPDATE sync_revision_seq')) {
          self.seq += Number(bound[0] ?? 0)
          if (self.suppressReturning) {
            return { success: true, meta: { rows_written: 1 }, results: [] }
          }
          // D1 行为：写语句的 RETURNING 行放在 run() 的 results 里
          return { success: true, meta: { rows_written: 1 }, results: [{ revision: self.seq }] }
        }
        if (sql.includes('INSERT INTO sync_auth')) {
          // schema 保证只有 id=1 一行
          if (self.authRows.some((r) => r.id === 1)) {
            throw new Error('UNIQUE constraint failed: sync_auth.id')
          }
          self.authRows.push({ id: 1, key_id: String(bound[0]), secret_hash: String(bound[1]) })
          return { success: true, results: [] }
        }
        return { success: true, results: [] }
      },
      async first<T = unknown>(): Promise<T | null> {
        const trimmed = sql.trim()
        if (trimmed.includes('FROM sync_revision_seq')) {
          return { revision: self.seq } as unknown as T
        }
        if (trimmed.includes('FROM sync_auth')) {
          return (self.authRows[0] as unknown as T) ?? null
        }
        return null
      },
    }
    return stmt
  }

  /** 直接改末值，模拟"别人抢先分配了" */
  bump(by: number): void {
    this.seq += by
  }

  get value(): number {
    return this.seq
  }

  insertAuth(keyId: string, hash: string): void {
    this.authRows.push({ id: 1, key_id: keyId, secret_hash: hash })
  }
}

describe('allocateRevisions · 原子分配（复审第 2 条）', () => {
  it('单次分配返回正确的起始值', async () => {
    const db = new FakeD1()
    expect(await allocateRevisions(db, 5)).toBe(1)
    expect(await currentRevision(db)).toBe(5)
  })

  it('第二次分配不与第一次重叠', async () => {
    const db = new FakeD1()
    const first = await allocateRevisions(db, 3)
    const second = await allocateRevisions(db, 4)
    expect(first).toBe(1) // 区间 1..3
    expect(second).toBe(4) // 区间 4..7
    expect(second).toBeGreaterThan(first + 3 - 1)
  })

  it('⭐ 两个并发分配不得取得重叠 revision', async () => {
    const db = new FakeD1()
    // 并发发起两个分配（Promise.all 让交错发生在 await 点）
    const [a, b] = await Promise.all([allocateRevisions(db, 5), allocateRevisions(db, 5)])
    // 两个区间不能相交：|a - b| 必须 >= 5
    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(5)
  })

  it('大量并发分配：每个区间长度正确且互不重叠', async () => {
    const db = new FakeD1()
    const starts = await Promise.all(
      Array.from({ length: 20 }, () => allocateRevisions(db, 3)),
    )
    // 排序后相邻差值都必须 >= 3（即区间不重叠）
    const sorted = [...starts].sort((x, y) => x - y)
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(3)
    }
    // 总共分配了 20 × 3 = 60
    expect(await currentRevision(db)).toBe(60)
  })

  it('分配 0 条不改变末值', async () => {
    const db = new FakeD1()
    await allocateRevisions(db, 5)
    const before = await currentRevision(db)
    expect(await allocateRevisions(db, 0)).toBe(before)
    expect(await currentRevision(db)).toBe(before)
  })

  it('★ RETURNING 拿不到结果时抛错，绝不退回「UPDATE 后再 SELECT」的交错路径', async () => {
    // 这是第一版修复的真实缺陷：写了 RETURNING 却仍用单独的 SELECT 读值。
    // 模拟 D1 返回空 results 的异常情况（first 会返回"别人的值"）
    const brokenDb = new FakeD1()
    brokenDb.suppressReturning = true
    // 绝不能返回 999（那是另一条路径读到的别人的值）
    await expect(allocateRevisions(brokenDb, 3)).rejects.toThrow('revision allocation failed')
  })

  it('⭐ 用的是单语句 UPDATE ... RETURNING（而非两条语句）', async () => {
    const db = new FakeD1()
    await allocateRevisions(db, 2)
    const updates = db.statements.filter((s) => s.includes('UPDATE sync_revision_seq'))
    expect(updates).toHaveLength(1)
    expect(updates[0]).toContain('RETURNING')
  })
})

describe('hasAnyAuth · 单空间检测', () => {
  it('空库返回 false', async () => {
    expect(await hasAnyAuth(new FakeD1())).toBe(false)
  })

  it('已有认证记录返回 true', async () => {
    const db = new FakeD1()
    db.insertAuth('k1', 'hash1')
    expect(await hasAnyAuth(db)).toBe(true)
  })

  it('第二次 bootstrap 会被 schema 拒绝（模拟 UNIQUE 冲突）', async () => {
    const db = new FakeD1()
    db.insertAuth('k1', 'hash1')
    // 直接走 insert 语句（Worker 的 bootstrap 逻辑）
    const stmt = db.prepare('INSERT INTO sync_auth (id, key_id, secret_hash, created_at) VALUES (1, ?1, ?2, ?3)')
    await expect(stmt.bind('k2', 'hash2', 'now').run()).rejects.toThrow('UNIQUE')
  })
})