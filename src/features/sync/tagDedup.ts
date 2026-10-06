/**
 * tag 去重（Phase 3B 复审第 9 条）。
 *
 * ## 问题
 *
 Dexie 的 `tags.nameNormalized` 唯一索引**只在单个库内生效**。
 * 两台设备各自离线创建 `#Apple` → 各自本地都成功 →
 * push 后 D1 里会有两条 `entity='tag'` 的记录 → pull 回来时本地唯一索引
 * 会让第二条**插入失败**，或者（若客户端做了兜底）留下两个重复标签。
 *
 * ## 第一版方案：服务端按 nameNormalized 归一
 *
 * push 一条 tag 之前，服务端先查 `payload.nameNormalized` 是否已存在：
 *  - 不存在 → 接受，按新记录写入
 *  - 存在且是**同一条记录** → 正常更新
 *  - 存在但是**别的 entity_id** → 告知客户端"合并到既有那条"
 *
 * 客户端拿到 mergeTo 指令后，在一个事务里：
 *  1. 把引用了本地 tagId 的所有 item 的 tagIds 改成既有的 entity_id
 *  2. 删除本地那个重复 tag
 *
 * 代价与取舍：这是"服务端权威去重"，不做字段级合并、不做向量时钟。
 * 单用户两台设备的场景下，"同名标签本来就是同一个东西"，归一是符合直觉的。
 */

/** 服务端返回的 tag 归一指令 */
export interface TagDedupDirective {
  kind: 'merge-tag-into'
  /** 本次上传的（重复）entity_id */
  duplicateId: string
  /** 云端既有的（胜出）entity_id */
  canonicalId: string
}

/**
 * 从 payload 里安全取出 nameNormalized。
 * 缺省返回 null（非 tag 或载荷损坏）。
 */
export function readNameNormalized(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const p = payload as Record<string, unknown>
  const v = p.nameNormalized
  return typeof v === 'string' && v !== '' ? v : null
}

/**
 * 判定一条 tag 变更与既有记录的关系。
 *
 * @param change      本次上传的 tag
 * @param existingAtKey `nameNormalized` → 既有记录的查询结果（不含自身）
 * @returns null 表示照常处理；TagDedupDirective 表示需要客户端合并
 */
export function resolveTagDedup(
  change: { entityId: string; payload: unknown },
  existingAtKey: Map<string, { entityId: string }>,
): TagDedupDirective | null {
  const key = readNameNormalized(change.payload)
  if (key === null) return null

  const hit = existingAtKey.get(key)
  if (hit === undefined) return null

  // 同一条记录的重命名 → 不是重复
  if (hit.entityId === change.entityId) return null

  return {
    kind: 'merge-tag-into',
    duplicateId: change.entityId,
    canonicalId: hit.entityId,
  }
}

/**
 * 在一批变更里找出所有 tag 的 nameNormalized（供 Worker 预加载查询用）。
 *
 * @returns key → entityId 的映射（同一 key 出现多次时保留第一条）
 */
export function collectTagKeys(
  changes: ReadonlyArray<{ entity: string; entityId: string; payload: unknown }>,
): Map<string, { entityId: string }> {
  const out = new Map<string, { entityId: string }>()
  for (const c of changes) {
    if (c.entity !== 'tag') continue
    const key = readNameNormalized(c.payload)
    if (key === null) continue
    if (!out.has(key)) out.set(key, { entityId: c.entityId })
  }
  return out
}