/**
 * 数据模型（对应 docs/architecture.md §4，已按用户要求删除全部 hash 字段）。
 * 纯类型定义，无任何依赖 —— db / domain / features / pages 共用。
 */

/**
 * 物品图标 key。
 *
 * 可选值由 src/data/icons.ts 的 PRESET_ICONS 定义（当前 73 个，含独立的 phone / tablet）。
 * 这里刻意用 string 而非字面量联合：图标库会持续扩充，超长联合类型既难维护又容易漏改。
 * 真正的完整性由两点保证 —— 数据层写入时统一走 icons.ts 的辅助函数（带 fallback），
 * 以及 src/data/icons.test.ts 对"每个 key 都有对应 SVG 资源"的断言。
 */
export type IconKey = string

export type AssetKind = 'preset' | 'ai_generated' | 'from_photo'
export type ItemSourceType = AssetKind

/** 购买平台（Phase 2E）；UI 显示映射见 domain/purchase.ts */
export type PurchasePlatform =
  | 'jd'
  | 'taobao'
  | 'pinduoduo'
  | 'zhuanzhuan'
  | 'aihuishou'
  | 'other'

/**
 * 物品生命周期（Phase 2G）。
 *
 * 这三个值对应真实的数据模型，而不是纯 UI 筛选：
 * - wishlist  想要但尚未拥有（可以完全没有购买信息）
 * - owned     正在持有
 * - disposed  已处置（出售 / 丢弃 / 其他），持有天数在此冻结
 */
export type ItemStatus = 'wishlist' | 'owned' | 'disposed'

/** 处置方式。刻意只有三种，不擅自扩充。 */
export type DisposalMethod = 'sold' | 'discarded' | 'other'

/** 当前数据契约版本（v3 = 增加生命周期与保修字段） */
export const CURRENT_SCHEMA_VERSION = 3

export interface Item {
  id: string
  name: string
  categoryId: string
  note: string
  iconAssetId: string
  sourceType: ItemSourceType
  /** 生命周期状态；v2 及更早的数据迁移后一律为 'owned' */
  status: ItemStatus
  /** 购买日期 YYYY-MM-DD；null = 未填写 */
  purchaseDate: string | null
  /** 购买价格，整数「分」（¥1499.99 = 149999）；null = 未填写；允许 0（赠品） */
  purchasePriceCents: number | null
  /** 附加花费（配件/维修/升级/更换部件等额外投入），整数「分」；null = 未填写；允许 0 */
  additionalCostCents: number | null
  /** 购买平台；null = 未填写 */
  purchasePlatform: PurchasePlatform | null
  /** 保修到期日 YYYY-MM-DD；null = 未填写 / 不适用 */
  warrantyExpiresAt: string | null
  /** 处置日期 YYYY-MM-DD；仅 status='disposed' 时有值 */
  disposedAt: string | null
  /** 处置方式；仅 status='disposed' 时有值 */
  disposalMethod: DisposalMethod | null
  /** 出售金额，整数「分」；仅 disposalMethod='sold' 时可非 null；允许 0 */
  salePriceCents: number | null
  /** 处置备注（赠送朋友 / 损坏报废 / 回收…）；可空 */
  disposalNote: string | null
  createdAt: string
  updatedAt: string
  /** soft delete；null = 未删除 */
  deletedAt: string | null
}

export interface Category {
  id: string
  parentId: string | null
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  /** 仅用于 UI 展示的分类小图标（可选） */
  iconKey?: IconKey
}

export interface Tag {
  id: string
  /** 显示名（保留原始大小写，UI 统一加 # 前缀展示） */
  name: string
  /** 标准化名（trim + 去 # + 小写折叠），唯一索引，用于防重复 */
  nameNormalized: string
  createdAt: string
  updatedAt: string
}

export interface ItemTag {
  itemId: string
  tagId: string
}

export interface Asset {
  id: string
  kind: AssetKind
  /** preset 图标随包路径；其他来源为 null */
  path: string | null
  /** 非 preset 的二进制内容（IndexedDB 原生 Blob） */
  blob: Blob | null
  mime: string
  width: number
  height: number
  styleVersion: string | null
  promptVersion: string | null
  sourceAssetId: string | null
  createdAt: string
}

export interface AppMeta {
  key: string
  value: string
}

/* ======================================================================
 * 跨设备同步（Phase 3B）
 *
 * 三张新表，其中 syncState / syncQueue / syncConflicts 都属于**纯本地状态**：
 *  - syncState 含 Bearer secret 明文，因此**绝不进入 ZIP 备份**
 *  - syncQueue 是 outbox，备份恢复后语义失效（恢复后改为全量重推）
 *  - syncConflicts 是本设备的覆盖记录，与数据本身无关
 * 详见 docs/PHASE_3B_IMPLEMENTATION_PLAN.md §6
 * ==================================================================== */

/** 参与同步的实体种类。刻意不含 assets / appMeta（见 3A 设计 §5）。 */
export type SyncEntity = 'item' | 'category' | 'tag'

export interface SyncState {
  /** 固定为 'sync'，单行 */
  key: string
  /** 本机设备标识（ULID），用于在 D1 侧标记「谁写的」，以及冲突可查的胜方 */
  deviceId: string | null
  /** 同步是否已启用。默认 false —— 未显式启用前完全不影响既有行为。 */
  enabled: boolean
  /** 服务端分配的公开 key id（非秘密），便于日后轮换 secret */
  keyId: string | null
  /**
   * Bearer secret 明文。只存 IndexedDB，**不进备份、不进 URL、不写日志**。
   * D1 侧只保存它的 SHA-256。
   */
  secret: string | null
  /**
   * 已成功应用的最大服务端 revision。pull 的游标。
   * 0 = 从未同步过（也是「恢复备份后」重置的值）
   */
  lastPulledRevision: number
  /** 上次成功同步时间（ISO），仅用于 UI 展示 */
  lastSyncAt: string | null
  /** 上次失败的原因，仅用于 UI 展示；不阻塞任何本地操作 */
  lastError: string | null
  /** outbox 中的待发条数，仅用于 UI 展示（真实值以 count 查询为准） */
  pendingCount: number
}

/** outbox 操作类型 */
export type SyncQueueOp = 'upsert' | 'delete'

/**
 * outbox 条目。
 *
 * ⚠️ 刻意**不存 payload** —— upsert 时才从业务表现读。
 * 这样同一实体改了 5 次只会推 1 条，也不会出现「outbox 与业务表内容不一致」。
 *
 * ⚠️ delete 是例外：**物理删除的实体读不到数据**，所以删除必须把必要元信息
 *（deletedAt / clientUpdatedAt）随条目一起存下来。
 * 这正是 tag 删除 / 合并能够跨设备同步的原因 —— 业务表里那条记录已经没了，
 * 但 outbox 里还留着「某时刻该 tag 被删除」这条事实。
 */
export interface SyncQueueEntry {
  id: string
  entity: SyncEntity
  entityId: string
  /** 省略视为 'upsert'（兼容 v4 早期的既有数据） */
  op?: SyncQueueOp
  /** 仅 op='delete' 有值：删除发生的时间 */
  deletedAt?: string | null
  /** 仅 op='delete' 有值：删除方的 updatedAt（审计用，不参与排序） */
  clientUpdatedAt?: string | null
  createdAt: string
}

/**
 * 「冲突事后可查」的落点（3B 规格：本地表，只在**覆盖方**设备落库）。
 *
 * 只存**摘要**而非全量 payload，避免这张表随冲突数无限膨胀。
 * 生命周期：保留最近 50 条。
 */
export interface SyncConflict {
  id: string
  entity: SyncEntity
  entityId: string
  /** 冲突被服务端判定的时间（ISO） */
  detectedAt: string
  /** 被覆盖方的原始 updatedAt（谁被盖掉了） */
  loserUpdatedAt: string | null
  /** 胜出设备 */
  winnerDeviceId: string | null
  /** 胜出方的 updatedAt */
  winnerUpdatedAt: string | null
  /** 被覆盖内容的可读摘要，如物品的 name / note 前 80 字 */
  loserSummary: string | null
  /** 胜出内容的可读摘要 */
  winnerSummary: string | null
}
