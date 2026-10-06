# Phase 3B · 跨设备同步实现计划

> 本文是**实施计划**，不是设计文档，也不含任何已写代码。等用户确认后才动手。
> 依据：`docs/PHASE_3A_SYNC_DESIGN.md`（v0.6.1 / `c9eced6` 之上）
> 已确认决策：推进 3B · 大陆连通性不阻塞 · 冲突不弹窗（服务端顺序优先）· 不做多账号 · 照片/AI 图标本阶段不同步二进制

---

## 0. 本轮先确认的两处「设计文档缺口」

设计文档里有两个地方**没有落到可实现的粒度**，用户已明确要求实现前说清楚。这里先定，Phase 3B 严格照此执行。

### 0.1 冲突「事后可查」的数据位置与生命周期 ← 用户点名要求

设计文档 §9 只写了「写进 `sync_conflicts` 供设置页查看」，**没有指定表、字段和生命周期**。现在定死：

| 决策项 | 结论 |
|---|---|
| 存哪 | **本地 Dexie 新表 `syncConflicts`**（不是 D1）。理由：冲突是「我的两台设备之间发生了什么」的私有记录，无需跨设备共享；放 D1 会让 pull 协议变复杂且浪费写入额度 |
| 何时写 | Worker 在 push 响应里返回 `conflicts[]`（**只给覆盖方设备**，被覆盖方在下次 pull 时自然拿到最终值）；客户端在**接受 push 的同一个事务**里落库 |
| 关键字段 | `id`（ULID）、`entity`、`entityId`、`detectedAt`（服务端时间）、`loserUpdatedAt`（**被覆盖的旧值时间戳**）、`winnerDeviceId`、`winnerUpdatedAt`、以及 `loserSnapshot` / `winnerSnapshot` 的**关键字段摘要**（物品存 `name` + `note` 前 80 字；分类存 `name`；标签存 `name`） |
| 为什么不存全量 payload | 全量 JSON 会让这张表随冲突数无限膨胀；摘要足够回答「我改的什么被覆盖了」 |
| 生命周期 | **保留最近 50 条**（`detectedAt` 倒序，超出即删）。单用户双设备下真实冲突个位数，50 条约等于「一生看得完」 |
| UI 呈现 | 设置 → 同步 → 「最近的覆盖记录」可展开列表，**只读**，可单条删除，可一键清空。不做成独立页面 |
| 隐私 | 含物品名称/备注摘要，**只存本地**，不进 ZIP 备份（见 §6） |

**被覆盖方完全无感**——这是有意的取舍。它下次 pull 拿到的就是「已经是你没赢的那版」。要在设置页看到全部覆盖关系就靠上面这份本地记录。

### 0.2 「首次启用同步」的两台设备如何配对 ← 用户点名要求

设计文档 §12 只写了「用户在另一台设备上手动粘贴/扫码」，流程是散的。定成明确的 **A/B 引导式配对**：

```
【A 设备（已有数据的那台，通常是 iPhone）】
  设置 → 同步 → 启用同步
  → 生成 key_id + 256-bit secret + 一段「配对码」
  → 配对码 = base64url( 明文 JSON{ v:1, keyId, secret, workerBaseUrl } )
     再用二维码承载（不引入库：Phase 3B 只用剪贴板 + 手输，不做二维码，
       与项目「不做二维码」既有约定一致）
  → 提示：「把这段配对码复制到另一台设备」
  → A 设备此时**尚未启用**（等待对方确认，避免单边写入）

【B 设备（通常是 Windows，第一次打开）】设置 → 同步 → 我是新设备
  → 粘贴配对码 → 校验格式（v/长度/base64）
  → 立刻用该 secret 调 Worker /api/sync/status
       ├─ 401 → 配对码无效，明确提示，不落库
       └─ 200 → 存入本地 syncState，enabled=true
  → **询问**：「云端已有数据（云端 N 条）。要合并到本机，还是以本机为准上传？」
       · 合并（默认）：本机数据进 outbox 全量 push，随后 pull 云端 → 按 revision 收敛
       · 以本机为准：仍走 push，但 UI 明确告知「本机数据将覆盖云端」
  → 立刻触发首次同步

【回到 A 设备】设置 → 同步 → 显示「等待另一台设备确认」
  → 收到任意一次成功 pull（说明 B 已接入并推送）→ 自动 enabled=true 并首次同步
  → 若 24h 内无 B 接入 → A 的 secret 保持「未启用」但不清除；用户可手动改为「单机启用」
```

三条关键约束：
1. **配对码只在 A 设备内存中明文存在一次**，落库的是它的 SHA-256（由 Worker 存哈希、客户端存 secret 供后续请求用 —— 客户端必须存明文 secret 才能持续发 `Bearer`，但**只存 IndexedDB，不进 ZIP 备份**）。
2. **A 在 B 确认前不启用** → 避免「A 一台设备把空库推上去覆盖 B 的老数据」。
3. 配对码**不写 URL、不写日志、不进 Git**；配对完成后 B 端 UI 提供「清除配对痕迹」（删 secret + 清 deviceId，等价于这台设备退出同步）。

---

## 1. 要修改/新增的文件（完整清单）

### 新增（12）

| 文件 | 层 | 职责 |
|---|---|---|
| `src/features/sync/syncPolicy.ts` | domain 纯函数 | 节流 / 是否该同步 / 错误分类 / 退避计算（**必须有测试**） |
| `src/features/sync/syncPolicy.test.ts` | 测试 | 同上 |
| `src/features/sync/syncEngine.ts` | 编排 | push/pull 循环、事务边界、分批、冲突落库 |
| `src/features/sync/syncEngine.test.ts` | 测试 | 用假 transport + fake-indexeddb 跑完整循环 |
| `src/features/sync/syncTransport.ts` | IO | `fetch` 封装（超时/401/网络错误分类），host 注入便于测 |
| `src/features/sync/SyncContext.tsx` | React | `useSync()` 状态订阅 + `SyncProvider` |
| `src/domain/syncPayload.ts` | domain 纯函数 | 实体 ↔ payload 编解码（**必须有测试**） |
| `src/domain/syncPayload.test.ts` | 测试 | 往返一致性、未知字段容忍 |
| `src/db/repositories/syncRepository.ts` | repository | outbox / syncState / syncConflicts 读写 |
| `src/services/syncService.ts` | services | 浏览器侧唯一装配点（触发点接线、生命周期） |
| `worker/index.ts` | Worker | 4 个 API + 认证 |
| `worker/migrations/0001_init.sql` | SQL | D1 schema |

外加（不入库）：`.tmp/verify/verify-sync.mjs`（端到端验证脚本，沿用既有 `.tmp` 一次性工具惯例）

### 修改（9）

| 文件 | 改什么 |
|---|---|
| `src/db/db.ts` | **v4 migration：只新增 3 张表**，现有 6 表索引串**一字不改**（详见 §2） |
| `src/domain/types.ts` | 新增 `SyncState` / `SyncQueueEntry` / `SyncConflict` / `SyncPayload` 类型 |
| `src/db/repositories/itemRepository.ts` | `create` / `update` / `softDelete` 三处在**现有事务内**追加 outbox 写入（§3） |
| `src/db/repositories/categoryRepository.ts` | 同上（增删改、软删、排序） |
| `src/db/repositories/tagRepository.ts` | 同上（含**合并**逻辑，需写 outbox） |
| `src/db/repositories/backupRepository.ts` | **同步相关表不进入备份/恢复**（§6） |
| `src/services/backupService.ts` | `readSnapshot` 排除 3 张同步表 |
| `src/pages/SettingsPage.tsx` | 「应用」组下新增「同步」组（启用/状态/立即同步/覆盖记录） |
| `src/main.tsx` | `startSync()`（在 `startPwaUpdate()` 之后，不阻塞首屏） |

### 明确不动（8）

`src/domain/lifecycle.ts` `purchase.ts` `searchItems.ts` `backup.ts` · `vite.config.ts` · `src/features/pwa/*` · `src/services/pwaUpdate.ts` · `wrangler.jsonc` 的 `assets` 段（只**新增** `main` / `d1_databases` / `compatibility_date` 已是 2026-10-03 无需改）

> `vite.config.ts` **不改** —— 加 Worker 入口后 SPA fallback 行为已验证（`fetch('/api/*')` 正常进 Worker），无需 `run_worker_first`。Phase 3B 会加一条**回归断言**锁住这个行为。

---

## 2. Dexie v3 → v4 迁移方案

### 2.1 新增 3 张表（**只增不改**）

```ts
this.version(4)
  .stores({
    // ⚠️ 与 v3 完全一致，逐字符未改 —— 触发任何索引变化都会让旧库全表重建
    items:      'id, categoryId, name, createdAt, updatedAt, deletedAt',
    categories: 'id, parentId, name, sortOrder, deletedAt',
    tags:       'id, &nameNormalized, createdAt',
    itemTags:   '[itemId+tagId], itemId, tagId',
    assets:     'id, kind, createdAt',
    appMeta:    'key',

    // ↓ 新增
    syncState:     'key',                             // 单行
    syncQueue:     'id, entity, [entity+entityId], createdAt',  // outbox
    syncConflicts: 'id, detectedAt',                  // 覆盖记录（§0.1）
  })
  // 不需要 .upgrade()：三张新表无旧数据，无需回填
```

### 2.2 为什么「只增不改」是硬要求

Dexie 的 `stores()` 中**任何索引串变化都会触发受影响表的索引重建**。项目既有约定已明确记录这个代价（v3 的注释写着「生命周期字段不参与索引，避免为了加索引而触发全表重建」）。因此 v4 的 6 张旧表索引串必须**逐字符沿用 v3**。

### 2.3 零丢失保证

| 风险 | 保证方式 |
|---|---|
| 迁移丢数据 | v4 **无 `.upgrade()` 回调** → 不触碰任何既有行。Dexie 只在缺表时创建空表 |
| 迁移中断 | Dexie 版本切换在单个事务内完成，失败自动回滚到 v3 |
| 迁移前快照 | Phase 3B 第一步就产出一条**「schema v3 → v4」迁移测试**：用 `fake-indexeddb` 造一个含真实数据（1 物品 + 1 用户自建分类 + 1 标签 + 1 关联 + 1 preset 资产）的 v3 库，升级到 v4 后**逐字段断言原 6 张表数据完全相等**，且分类名称未被改写 |
| 真实用户库 | **迁移前提醒用户先导出 ZIP**（一次性提示，写在 Phase 3B 的发布说明里；不强制、不打扰） |

---

## 3. 写入点如何挂 outbox（保证「改了但没同步」不可能发生）

设计原则：**outbox 写入必须和业务写入在同一个 Dexie 事务里**。否则存在「业务写成功、outbox 写失败 → 这条变更永久丢失且没人知道」的窗口。

现有事务位置已核实：

| 仓库 | 现有事务 | 改动 |
|---|---|---|
| `itemRepository.create` | `db.transaction('rw', [db.items, db.itemTags])` L102 | 表清单加 `db.syncQueue` |
| `itemRepository.update` | 同上 L116 | 同上 |
| `itemRepository.softDelete` | **无事务**（单次 update，L194-197） | **需包一层事务**，把 `items.update` + `syncQueue.put` 放进同一事务 |
| `categoryRepository` | L85 有事务 | 表清单加 `db.syncQueue` |
| `tagRepository` | L65 / L74 两个事务 | 都加 `db.syncQueue`；**合并逻辑**要写 outbox（保留哪个 id、删除哪个 id） |

**outbox 条目结构**：`{ id, entity, entityId, op: 'upsert', createdAt }` —— 刻意**不存 payload**。payload 在 push 时从业务表现读，这样同一实体的多次待推变更天然合并成一条，不会因为改了 5 次就推 5 次。

**回声防护**：apply 远端变更的同一事务内，删除该实体在 outbox 中的残留条目。否则「我 pull 到的别人的变更」会被当成「我改的」再推回去，造成无限回环。

---

## 4. D1 要创建什么

### 4.1 表结构（3 张，与 3A 文档一致）

```sql
-- ① 变更日志（唯一真相）
CREATE TABLE sync_records (
  revision          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity            TEXT NOT NULL,          -- 'item' | 'category' | 'tag'
  entity_id         TEXT NOT NULL,
  payload           TEXT NOT NULL,          -- JSON
  deleted_at        TEXT,
  client_updated_at TEXT NOT NULL,
  device_id         TEXT NOT NULL,
  UNIQUE (entity, entity_id)
);

-- ② 全局单调计数器
CREATE TABLE sync_revision_seq (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL
);
INSERT INTO sync_revision_seq (id, revision) VALUES (1, 0);

-- ③ 认证（只存哈希）
CREATE TABLE sync_auth (
  key_id      TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,      -- hex(SHA-256(secret))
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);
```

### 4.2 建表 SQL 由谁执行（用户提问触发的补漏）

Phase 3B 的 D1 schema **只建 3 张表、一条 INSERT**，完全可以**零工具**执行。三种方式都可行：

| 方式 | 怎么做 | 是否需要 wrangler 认证 |
|---|---|---|
| **① 面板 Console（推荐）** | Storage & Databases → D1 → 选中库 → **Console** → 粘贴 SQL → Execute | ❌ 不需要 |
| ② Worker 自建 | Worker 里 `env.DB.exec(CREATE TABLE IF NOT EXISTS ...)` 幂等初始化 | ❌ 不需要（但把 schema 藏进 Worker 代码，代码更重） |
| ③ wrangler CLI | `npx wrangler d1 execute <db> --remote --file=worker/migrations/0001_init.sql` | ✅ 需要 |

**选 ①**：schema 是 3 条 CREATE + 1 条 INSERT，面板粘贴一次就完事，**不需要给 WorkBuddy 任何 Cloudflare 凭据**，也与项目既有约定一致。SQL 文件仍会入库（作为 schema 的唯一真相来源与未来迁移的基线）。

> 采用 `CREATE TABLE IF NOT EXISTS` 写法，重复执行安全。

### 4.3 索引克制

只有 `PRIMARY KEY(revision)` 与 `UNIQUE(entity, entity_id)`。每个索引都会让一次写入**多算 1 row written**（官方明确说明），不做多余索引。

`tag` 按 `nameNormalized` 去重会扫小表 —— `tags` 规模远小于 `items`，可接受，**不加 JSON 索引**（`json_extract` 无法用普通索引，收益低于成本）。

### 4.4 额度自检（10,000 物品规模）

首次 bootstrap 10,750 行 × 2（表 + UNIQUE）≈ 21,500 rows written = 当日 100,000 的 **21.5%** → **必须分批**。

⚠️ **复审修正**：原先写「≤500 条/次」是**错的**。D1 官方限制 **bound parameters per query = 100**，而 Worker 预加载查询的参数量 ≈ 3 + N，500 会直接超限（D1 在运行时才拒绝，用户看到的是「同步莫名失败」）。

两条约束各自给出的上限：绑定参数 → N ≤ 97；Free 50 queries/invocation → N ≤ 48。**取 32**（见 `src/features/sync/syncLimits.ts`）。10,750 条 ÷ 32 ≈ 336 批，稳态每天 10 次同步 ≈ 200 rows written = **0.2%**。
---

## 5. Worker 要增加哪些接口

新增 `worker/index.ts` + `wrangler.jsonc` 加 `"main": "./worker/index.ts"` 与 `d1_databases` 绑定。**`assets` 段一字不改。**

### 5.1 四个端点

```
POST /api/sync/bootstrap     首次配对：写入 sync_auth，返回 { ok, keyId }
POST /api/sync/push          批量 upsert 变更 → { accepted, ignored, conflicts, currentRevision }
GET  /api/sync/pull?after=&limit=100   拉 revision > after → { changes, nextRevision, hasMore }
GET  /api/sync/status                → { currentRevision, recordCount }
```

全部要求 `Authorization: Bearer <secret>`，除 `/status` 外都要求 `deviceId`。

### 5.2 认证（每个请求，无例外）

```
1. 取 Bearer token，缺失/格式错 → 401
2. SELECT secret_hash FROM sync_auth WHERE revoked_at IS NULL
3. hex(SHA-256(token)) 与库中哈希做**常数时间比较**
   —— Workers 没有 crypto.subtle.timingSafeEqual，必须手写：
      长度不同也走完固定轮次（按 max(len) 循环），避免时序泄露
4. 不匹配 → 401（统一文案，不区分"不存在"与"错误"）
5. 同一 key_id 连续失败计数 → 429（防在线爆破；计数用 Worker isolate 内存即可，不落 D1）
6. secret 永不进 URL / 日志 / 错误信息
```

### 5.3 push 的逐条判定（与 3A §9 一致）

```
对每条 change（客户端带 baseRevision）：
  ① 服务端无该 entity+entity_id                    → 接受，分配新 revision
  ② 该记录已 tombstone 且无 undeleteIntent          → ignored('tombstoned')  ★删除不被复活
  ③ 服务端 revision ≤ baseRevision（客户端基于最新） → 接受
  ④ 服务端 revision > baseRevision（期间被其他设备写过）
       → 冲突：**服务端顺序优先，直接覆盖**
       → 返回 conflicts[] = { entity, entityId, loserUpdatedAt,
                             winnerDeviceId, winnerUpdatedAt,
                             loserSummary, winnerSummary }（仅摘要，非全量 payload）
```

**tag 去重**：push 前先按 `nameNormalized` 查已有记录，命中则返回既有 `entity_id`；客户端在事务内重写引用后删除本地副本（§0.3）。

### 5.4 关键实现约束（会直接决定 3B 能否跑通）

| 约束 | 出处 |
|---|---|
| **SPA fallback 只对 navigation 请求生效**，`fetch('/api/*')` 正常进 Worker —— 前提 `compatibility_date ≥ 2025-04-01`（当前 2026-10-03 ✅），所以 `assets` 段无需改 | 官方 SPA 文档 |
| 单次 push **≤ 32 条** | D1 Free：**50 queries/invocation** 且 **100 bound params/query**（两条都是硬约束） |
| **禁止 `SELECT *`** | pull 恒为 `WHERE revision > ? ORDER BY revision LIMIT ?`；`/status` 用 `COUNT(*)` |
| `revision` 用 `INTEGER PRIMARY KEY AUTOINCREMENT` | rowid 即索引，零额外成本，天然单调不复用 |

---

## 6. ZIP Backup / Restore 与 3 张新表的交互

**决定：3 张同步表一律不进备份、不参与恢复。**

| 表 | 理由 |
|---|---|
| `syncState` | 含 **Bearer secret 明文**。ZIP 可能被发到微信/网盘/邮件，绝不能让备份文件携带同步凭据 |
| `syncQueue`（outbox） | 本地待发队列，恢复旧备份后语义已失效（恢复后要全量重推，见下） |
| `syncConflicts` | 设备本地的覆盖记录，与数据本身无关 |

因此：
- `backupRepository.readSnapshot()` **不读**这 3 张表 → 备份文件结构与 v2 契约**完全不变**（重要：不破坏现有 `backup.ts` 的结构校验与 v1 兼容导入）
- `restoreFromPayload()` **不清**这 3 张表
- **Restore 后的处理**（与 3A §11 一致，不做自动合并）：`lastPulledRevision = 0`、全量本地数据进 outbox、UI 弹**非阻塞确认**二选一 —— 「以本机为准（覆盖云端）」/「以云端为准（丢弃本机）」/「取消并暂停同步」

---

## 7. 实施顺序（9 步，每步都可独立验证与回滚）

| 步 | 内容 | 产出/验收 |
|---|---|---|
| **1** | v3→v4 migration + **迁移零丢失测试** | 旧库升级后 6 张表逐字段相等；`npm test` 绿 |
| **2** | `syncPolicy.ts` + `syncPayload.ts` + 各自测试 | 纯逻辑，node 环境可测 |
| **3** | `syncRepository.ts`（outbox/state/conflicts） | fake-indexeddb 集成测试 |
| **4** | 三个 repository 挂 outbox（含 softDelete 补事务、tag 合并） | 现有 repository 测试**全部仍绿**（回归重点） |
| **5** | D1 migration SQL（**只写文件，不执行**） | SQL 可 review；`wrangler` 未认证不阻塞 |
| **6** | `worker/index.ts` 四个端点 + 认证 | 纯函数逻辑可单测（比较器/判定分支） |
| **7** | `syncEngine` + `syncTransport` + `SyncContext` + 设置页 UI + `startSync()` | `npm run typecheck` 绿 |
| **8** | 端到端验证 `.tmp/verify/verify-sync.mjs` | 见 §8 |
| **9** | 文档（README / architecture / BROWSER_TESTING）+ 版本号 + commit / push | 不 force push |

**版本号建议 `0.7.0`**（新增功能，非 patch）。三处同步：`src/appInfo.ts` / `package.json` / `package-lock.json`。
> ⚠️ 沿用既有教训：`sed` 全局替换 `"version": "0.6.1"` 会**误伤恰好同版本的依赖**。必须**只替换 lock 文件前两处**（文件头 + `packages[""]`），改完 `git diff package-lock.json` 逐行核对。

**commit 拆分**（不堆成一个巨型提交）：
1. `feat: add sync policy, payload codec and outbox queue (v3→v4 migration)`
2. `feat: add sync worker api and d1 schema`
3. `feat: wire sync engine, settings UI and lifecycle triggers`
4. `docs: document cross-device sync`

---

## 8. 验收清单（全部满足才算 Phase 3B PASS）

### 8.1 自动化测试

- `syncPolicy` / `syncPayload` / `worker` 判定逻辑：**全部纯函数，必须有测试**
- **v3→v4 迁移测试**：含真实数据的 v3 库升级后 6 张表逐字段不变、用户自建分类名未被改写
- **既有 295 个测试必须全绿**（尤其 `itemRepository` / `categoryRepository` / `tagRepository` / `backupRepository`）
- `npm run typecheck` / `npm test` / `npm run build` 全绿

### 8.2 端到端（沿用 `.tmp/verify/` + 隔离 Edge profile）

用**两个独立 browser context 模拟 iPhone 与 Windows**：

1. A 建物品 / 标签 / 自建分类 → 同步 → **B pull 后全部可见**
2. B 改同一物品 → 同步 → A 可见 B 的修改
3. A 软删 → 同步 → B 消失
4. **B 用旧副本 push → A 上物品不得复活**（验证 tombstone 单调）
5. A、B 各建同名标签 → 同步后**无重复、引用正确**
6. **离线**：断网后 A 仍可增删改查（本地完整可用）→ 恢复 → 自动追赶
7. **关闭代理**：确认 App 完全可用，同步仅静默失败
8. **冲突可查**：制造冲突 → 设置页「最近的覆盖记录」出现该条 → 含被覆盖摘要
9. **备份不含 secret**：导出 ZIP → 检查不含 `syncState` / secret
10. SPA fallback 回归：`fetch('/api/status')` 返回 JSON（**不是** HTML）
11. **SW 状态记录**：记录 push/pull 前后的 service worker 与网络状态，确认同步**不触发 reload**

### 8.3 手工确认（无法自动化）

- **真实 iPhone Safari 主屏 PWA** 同步到 Windows（真机后台恢复后自动追赶）
- 大陆网络（代理关闭）实测

---

## 9. 明确不做（Phase 3B）

- ❌ 照片 / AI 图标**二进制**跨设备同步（`ai_generated` / `from_photo` 只同步元数据，缺失端 fallback；R2 留后续阶段）
- ❌ 冲突**人工合并弹窗**（服务端顺序优先 + 事后可查）
- ❌ 实时推送（WebSocket / SSE）
- ❌ 多用户 / 共享库 / 家庭协作
- ❌ CRDT / OT
- ❌ Cloudflare Access 加固（Phase 3C 可选）
- ❌ 二维码配对（与项目既有「不做二维码」约定一致，用剪贴板 + 手输）
- ❌ zustand 等状态库（沿用 Context + hook）
- ❌ 删除或简化现有 ZIP Backup
- ❌ 注册 / 邮箱 / 密码找回 / OAuth / 用户中心 / 多租户

---

## 10. 建议的提交与部署顺序

1. 完成 1–4 步 → 跑测试 → commit 1 → push（此时 App 已具备 outbox，但**未启用**同步，行为完全不变）
2. 完成 5–7 步 → 跑测试 → commit 2+3 → push
3. **部署由用户在 Cloudflare 面板完成**（沿用既有约定：WorkBuddy 不碰 wrangler 认证）
4. 完成 8 步端到端 → commit 4

### 需要用户手动做的三件事（按顺序，**都在代码写完之后**）

| # | 时机 | 操作 | 产出什么 |
|---|---|---|---|
| 1 | 代码 push 后 | Storage & Databases → D1 → **Create database**，命名 `item-sync`（< 32 字符、ASCII、用连字符） | `database_id`（一串 UUID） |
| 2 | 拿到 id 后告诉 WorkBuddy | 我把 `database_name` + `database_id` + `binding: "DB"` 回填 `wrangler.jsonc` | 配置就位 |
| 3 | 部署后 | D1 → 选中 `item-sync` → **Console** → 粘贴 `worker/migrations/0001_init.sql` 内容 → Execute | 3 张表就绪 |

**为什么不能更早**：第1 步创建的数据库是**空库**，而 schema 要等代码定稿（第 5 步的 SQL 文件）才有最终形态；先建库再改 schema 容易留下与代码不一致的表结构。**先把代码写完、SQL 定稿，再一次性建库 + 执行**，只需做一次。

> **回滚安全**：任何一步出问题，`git revert` 该步 commit 即可。同步功能默认关闭，不影响既有 App 行为。

---

## 附：最终审查（第三轮）的落点

| # | 问题 | 结论 |
|---|---|---|
| 1 | revision 分配与写入要同事务 | ✅ `db.batch([...upserts, bump])`；每条 upsert 在 SQL 内读计数器。**用真实 SQLite 验证**：提交顺序与 revision 顺序一致、失败整批回滚 |
| 2 | tombstone 要落到最终 SQL | ✅ `ON CONFLICT ... DO UPDATE ... WHERE ...` 由数据库层挡住 stale 写入。**已验证**：preload active → A 删 → B stale upsert → 仍 tombstoned |
| 3 | 配对码要能刷新后重建 | ✅ `currentPairingCode()` 从本地 `syncState` 重新编码，**不再调 bootstrap** |
| 4 | join 在用户决策前零副作用 | ✅ 拆成 `validateJoinPairingCode()`（只认证，不写任何本地状态）与 `commitJoin()`（确认后才落凭据） |
| 5 | 「以云端为准」要真清数据 | ✅ `wipeSyncableLocalData()` 清 items/categories/tags/itemTags + `clearQueue()`（assets/appMeta 刻意保留）；**取消「以本机覆盖整个云端」的虚假承诺**（第一版无 server-side replace） |
| 6 | tag 并发唯一性 | ✅ **方案 A**：D1 加部分唯一索引（数据库层保证）；Worker 对索引冲突降级为合并指令 |
| 7 | 文档清理 | ✅ `syncPolicy` 的「500 条/批」改为 32；SQL 校验说明改为「4 项（含 sqlite_sequence）」 |

### 本轮修掉的两个真实 bug（都属于"看起来实现了"）

1. **base64url decode 完全错误** → **B 设备永远无法加入**。
   `fromBase64Url` 先把 `-_` 换成 `+/`，却仍用 URL-safe 字母表 `indexOf`；
   且第三字节掩码写成 `& 0x0f` 而非 `& 0x03`。双重错误叠加成乱码，`JSON.parse` 必失败。
   为什么第一版没发现：只测了 encode（对照标准 base64 一致）—— **"encode 对"推不出 "decode 对"**。
2. **SQLite 占位符语义**：带子查询时 `?N` 会与子查询里的占位符一起被重新编号；
   而重复编号会让参数整体错位（实测 `payload` 收到 NULL → NOT NULL 约束失败）。
   最终采用**递增且不重复**的 `?1..?8`。

### 测试方式的关键改进

Worker SQL 测试改用 **node:sqlite（真实 SQLite）**，而非手写的假 D1 ——
第1、2 条要验证的都是"数据库层原子性"，假实现可能恰好掩盖竞态
（第二轮的三次修复失败都是测试先抓出来的，这次直接上真库）。

### schema 的两处调整

- `revision` 由 `INTEGER PRIMARY KEY AUTOINCREMENT` 改为 `INTEGER PRIMARY KEY`：
  实测确认 AUTOINCREMENT 在**显式赋值后仍会推进 sqlite_sequence**，
  既污染出 `sqlite_sequence` 表，也让"revision 完全由我们控制"不直观。
- 新增 `idx_sync_tag_normalized` 部分唯一索引（见 §6 方案 A）。

---

## 附：最终审查（第三轮）的落点

| # | 问题 | 结论 |
|---|---|---|
| 1 | revision 分配与写入要同事务 | ✅ `db.batch([...upserts, bump])`；每条 upsert 在 SQL 内读计数器。**用真实 SQLite 验证**：提交顺序与 revision 顺序一致、失败整批回滚 |
| 2 | tombstone 要落到最终 SQL | ✅ `ON CONFLICT ... DO UPDATE ... WHERE ...` 由数据库层挡住 stale 写入。**已验证**：preload active → A 删 → B stale upsert → 仍 tombstoned |
| 3 | 配对码要能刷新后重建 | ✅ `currentPairingCode()` 从本地 `syncState` 重新编码，**不再调 bootstrap** |
| 4 | join 在用户决策前零副作用 | ✅ 拆成 `validateJoinPairingCode()`（只认证，不写任何本地状态）与 `commitJoin()`（确认后才落凭据） |
| 5 | 「以云端为准」要真清数据 | ✅ `wipeSyncableLocalData()` 清 items/categories/tags/itemTags + `clearQueue()`（assets/appMeta 刻意保留）；**取消「以本机覆盖整个云端」的虚假承诺**（第一版无 server-side replace） |
| 6 | tag 并发唯一性 | ✅ **方案 A**：D1 加部分唯一索引（数据库层保证）；Worker 对索引冲突降级为合并指令 |
| 7 | 文档清理 | ✅ `syncPolicy` 的「500 条/批」改为 32；SQL 校验说明改为「4 项（含 sqlite_sequence）」 |

### 本轮修掉的两个真实 bug（都属于"看起来实现了"）

1. **base64url decode 完全错误** → **B 设备永远无法加入**。
   `fromBase64Url` 先把 `-_` 换成 `+/`，却仍用 URL-safe 字母表 `indexOf`；
   且第三字节掩码写成 `& 0x0f` 而非 `& 0x03`。双重错误叠加成乱码，`JSON.parse` 必失败。
   为什么第一版没发现：只测了 encode（对照标准 base64 一致）—— **"encode 对"推不出 "decode 对"**。
2. **SQLite 占位符语义**：带子查询时 `?N` 会与子查询里的占位符一起被重新编号；
   而重复编号会让参数整体错位（实测 `payload` 收到 NULL → NOT NULL 约束失败）。
   最终采用**递增且不重复**的 `?1..?8`。

### 测试方式的关键改进

Worker SQL 测试改用 **node:sqlite（真实 SQLite）**，而非手写的假 D1 ——
第1、2 条要验证的都是"数据库层原子性"，假实现可能恰好掩盖竞态
（第二轮的三次修复失败都是测试先抓出来的，这次直接上真库）。

### schema 的两处调整

- `revision` 由 `INTEGER PRIMARY KEY AUTOINCREMENT` 改为 `INTEGER PRIMARY KEY`：
  实测确认 AUTOINCREMENT 在**显式赋值后仍会推进 sqlite_sequence**，
  既污染出 `sqlite_sequence` 表，也让"revision 完全由我们控制"不直观。
- 新增 `idx_sync_tag_normalized` 部分唯一索引（见 §6 方案 A）。
