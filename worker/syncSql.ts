/**
 * Worker 侧的 D1 SQL 片段（可单测）。
 *
 * 之所以从 index.ts 里拆出来：revision 分配是**并发正确性**的关键路径，
 * 必须能被直接测到，而不必去mock 整个 Worker 环境。
 */

interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ results?: unknown[] }>
      first<T = unknown>(): Promise<T | null>
    }
  }
}

/** 取出 bind() 之后的语句形状（D1 的 bind 返回新对象） */
type BoundStmt = ReturnType<D1Like['prepare']>['bind'] extends (
  ...args: unknown[]
) => infer R
  ? R
  : never

/**
 * ⭐ 原子分配一段连续的 revision，返回**起始值**。
 *
 * ## 为什么必须原子（复审第 2 条）
 *
 * 旧实现是两条独立语句：
 * ```
 * UPDATE sync_revision_seq SET revision = revision + N WHERE id = 1
 * SELECT revision FROM sync_revision_seq WHERE id = 1
 * ```
 * 并发的两个 push 会交错成A.UPDATE → B.UPDATE → A.SELECT → B.SELECT，
 * **两者读到同一个末值，于是拿到完全重叠的 revision 区间**。
 * 后写的记录覆盖先写的，客户端推进游标后会漏掉数据。
 *
 * ## 解法：UPDATE ... RETURNING，且**真的从它的返回值里读**
 *
 * ⚠️ 第一版修复时踩过的坑，值得记下来：
 *   我写了 `UPDATE ... RETURNING`，却仍然用**随后一条 SELECT** 去读末值。
 *   那跟旧的 bug 是**同一个交错模式**，只是换了条 UPDATE 语句 ——
 *   单元测试（20 个并发分配）立刻暴露了大量重叠区间。
 *
 *   正确做法：把RETURNING 的结果**直接从这次写入里取出来**。
 *   `UPDATE ... RETURNING` 是单条语句，自增与取值在同一原子操作内完成，
 *   不存在任何"取到别人的值"的可能。
 *
 * ## D1 的一个坑
 *
 * D1 把 `INSERT/UPDATE/DELETE` 当作**写**操作，`RETURNING` 的行要通过
 * **`.run()`** 的 `results` 拿；用 `.first()` 对写语句会返回空 —— 那样会写出
 * "写入成功但读到 undefined"的假象。因此这里必须用 run() 并读 results。
 *
 * @param count 本批需要预留的条数
 * @returns 分配到的区间起始 revision
 */
export async function allocateRevisions(db: D1Like, count: number): Promise<number> {
  if (count <= 0) {
    return currentRevision(db)
  }

  // 单语句原子自增；末值直接从 RETURNING 的结果读出。
  // ⚠️ 用 run() 而非 first()：D1 对写语句的 first() 返回空。
  const result = await db
    .prepare('UPDATE sync_revision_seq SET revision = revision + ?1 WHERE id = 1 RETURNING revision')
    .bind(count)
    .run()

  const row = (result.results ?? [])[0] as { revision?: unknown } | undefined
  const end = typeof row?.revision === 'number' ? row.revision : null

  if (end === null) {
    // RETURNING 没拿到结果。理论上 D1 不会走到这里；真走到了宁可保守处理 ——
    // **绝不能**退回"UPDATE 后再 SELECT"那条交错路径。
    throw new Error('revision allocation failed: D1 did not return the updated revision')
  }

  return end - count + 1
}

/** 读取当前 revision 末值 */
export async function currentRevision(db: D1Like): Promise<number> {
  const stmt: BoundStmt = db
    .prepare('SELECT revision FROM sync_revision_seq WHERE id = 1')
    .bind()
  const row = await stmt.first()
  const revision = (row as { revision?: unknown } | null)?.revision
  return typeof revision === 'number' ? revision : 0
}

/**
 * 同步空间是否已存在。
 *
 * 第一版只有单空间：sync_auth 里最多一行（schema 用 CHECK(id=1) 表达）。
 * 这个查询用于 bootstrap 前给出友好提示；**真正的保证是 INSERT 的 CHECK 约束**。
 */
export async function hasAnyAuth(db: D1Like): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM sync_auth LIMIT 1').bind().first<{ id: number }>()
  return row !== null
}