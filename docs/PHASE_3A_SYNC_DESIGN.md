# Phase 3A · 个人跨设备同步设计

> 本文只做**架构分析与设计**，不含代码。目的是让 Phase 3B 能直接照着实现，不再重新做选型。
> 事实核查时间：2026-10-06。所有额度数字均来自官方文档（见 §13 引用），未凭记忆估算。
>
> 现状快照：App v0.6.1 · Dexie schema = **v3** · 295 单元测试全绿 · 纯静态部署（`wrangler.jsonc` 无 `main`、无后端）。

---

## 1. 当前状态

| 维度 | 现状 |
|---|---|
| 存储 | 每台设备一份完整 IndexedDB（Dexie v3，6 张表） |
| 部署 | Cloudflare Workers Static Assets，**纯静态，无 `main` 入口，无任何 API** |
| 身份 | **无**。没有账号、没有 token、没有设备标识 |
| 跨设备 | 只能靠导出/恢复 ZIP 手动搬运 |
| 数据真实规模 | 预设分类 ~30 个（其中 preset 资产 156 个）；物品数是**个人量级**，几百到几千 |
| 备份 | ZIP + Replace Restore（`backupRepository.replaceAllWithBackup` 单事务） |

**关键事实（决定了后面的设计）**：

1. `softDelete` 会同时写 `deletedAt` **和** `updatedAt`（`itemRepository.ts:196`）→ 软删可复用现有时间戳，不需要新增字段。
2. `itemRepository.update()` 本来就是**重写 itemTags 关联** → 关联变化天然总是伴随一次 item 写入。
3. Dexie v3 **没有**任何"上次同步到哪"的游标字段 → Phase 3B 必然要动 schema（本阶段不动，见 §16）。

---

## 2. 目标

1. iPhone 与 Windows 最终看到相同数据（**最终一致**，非实时）。
2. **Local-first 不可退化**：离线时新增/编辑/删除/搜索/分类/查看全部可用，且**不因同步失败而丢失或阻塞任何本地操作**。
3. 成本 **0 元**，不新增域名，不租 VPS。
4. 用户分类（自建/重命名/排序）**永不被同步覆盖重置**。
5. ZIP Backup 继续存在，Sync 不替代 Backup。
6. 中国大陆：代理关闭时纯本地，代理恢复后自动追上。

**非目标**：实时推送、多用户、多设备同时在线协同、跨设备全文搜索（在云端）。

---

## 3. 候选方案比较

| | **A. Workers + D1** | **B. Supabase Free** | **C. 本机 MySQL + Tunnel** | **D. 继续 ZIP 手动** |
|---|---|---|---|---|
| 运行费用 | ¥0（额度见 §13） | ¥0 | ¥0（电费忽略） | ¥0 |
| 需要域名 | 否 | 否 | **是**（Tunnel 的稳定域名必须 DNS 托管在 CF；用 Quick Tunnel 则地址每次变） | 否 |
| 中国大陆可用性 | 差（默认 `*.workers.dev` 域在大陆常被干扰） | 很差（`supabase.co` 域名普遍不可直连） | 取决于家宽出口 IP，几乎一定不可直连 | **完全不受影响** |
| 开发复杂度 | 中（Worker 逻辑必须写，但与现有 TS 同语言） | 中低（官方 SDK + Postgres），但**要处理 auth** | **高**（要自建 API 层、鉴权、TLS） | 零 |
| 离线能力 | 满分（同步只做后置动作） | 满分 | 满分 | 满分 |
| 安全 | Worker 校验 secret；D1 不暴露 | 有完整 auth 体系，但为单用户是**杀鸡用牛刀** | **要自己写**；MySQL 端口一旦暴露风险极高 | 无网络暴露 |
| 维护成本 | 低（无服务需常驻） | 低（托管） | **高**（PC 必须 24h 开机；系统更新/重启/睡眠都会中断） | 手动 |
| 数据可迁移性 | 高（标准 SQL） | 中（绑定 Postgres 特性） | 高 | — |
| 供应商锁定 | 低（协议是我自己定义的 JSON） | 中 | 低 | — |
| 免费额度风险 | 无（余量 3 个数量级） | **有**：免费版**1 周不活动自动暂停**、500MB、无自动备份、无 PITR | 不适用 | 不适用 |
| 未来可扩展 | 高（D1 → 多设备 → 可选 R2 存图） | 高 | 低（PC 是单点） | 无 |

### 结论

- **推荐 A（Workers + D1）**：与现有部署**同平台同技术栈**，新增的唯一东西就是 Worker 里的几个函数；额度余量在个人使用量级下几乎用不完；无需域名、无需常驻机器。
- **次选 D（继续 ZIP）**：它**永久保留**，是 Sync 不可用时的兜底，也是 Sync 出故障时的最后恢复手段。它不是"落选的方案"，而是"永远并存的一层"。
- **不推荐 B（Supabase）**：致命点不是费用而是 **1 周不活动自动暂停**——个人物品库恰恰是"平时不动、某天集中整理"的负载；加上 `supabase.co` 在大陆几乎不可直连，而 Supabase 免费版又**没有自定义域名**。
- **不推荐 C（本机 MySQL + Tunnel）**：见 §13 独立评估。

---

## 4. 推荐方案

> **Local-first 同步 = Cloudflare Worker（认证 + 变更日志） + Cloudflare D1（远端同步状态）+ 设备本地 IndexedDB（唯一数据源）**

```
      iPhone (PWA)                          Windows (PWA)
  ┌───────────────────┐                ┌───────────────────┐
  │  Dexie / IndexedDB│                │  Dexie / IndexedDB│
  │  ★ 唯一数据源     │                │  ★ 唯一数据源     │
  │  + syncState(游标)│                │  + syncState(游标)│
  │  + syncQueue(outbox)                │  + syncQueue(outbox)│
  └─────────┬─────────┘                └─────────┬─────────┘
            │  fetch  POST /api/sync/push        │
            │  fetch  GET  /api/sync/pull?after= │
            └──────────┬─────────────────────────┘
                       │  HTTPS（workers.dev 现有域名）
            ┌──────────▼──────────┐
            │  Cloudflare Worker  │  ← 唯一 API 入口
            │  · Bearer token 校验 │     （校验 SHA-256 哈希）
            │  · upsert / pull    │
            │  · 无状态，不存储   │
            └──────────┬──────────┘
                       │  绑定（服务端内部）
            ┌──────────▼──────────┐
            │  D1  (SQLite)        │  ← 只存"同步状态"
            │  sync_records        │     绝不被浏览器直接访问
            │  sync_auth           │
            └─────────────────────┘
```

**为什么 D1 不是"另一个数据库"**：D1 里没有 `items` 业务表可查，没有 category tree 可算日均成本。它只是**一条按 `revision` 排序的变更流**。所有业务计算永远发生在设备本地 Dexie 上。

---

## 5. 本地 / 云端职责边界

| | 本地 Dexie | D1 |
|---|---|---|
| 数据的地位 | **唯一真相来源**（source of truth） | 同步中转站，可随时整个删库重建 |
| 全部 6 张表 | 完整 | 不镜像，只存同步载荷 |
| 搜索 / 分类树 / 日均成本 | ✅ 全部本地算 | ❌ 不参与 |
| 离线可用性 | 完全离线可用 | — |
| 离线资产 Blob | ✅ 本地 | ❌ 不上传（§7） |
| 游标 `lastRevision` / `deviceId` | ✅ `syncState` 表 | 仅记录"某设备最后活跃于哪" |

### 数据同步单位

| 表 | 同步？ | 理由 |
|---|---|---|
| `items` | ✅ 全字段（`tagIds` 内聚，见 §7） | 主体数据 |
| `categories` | ✅ 全字段（含 `parentId` / `sortOrder` / `iconKey`） | 分类树必须跨设备一致 |
| `tags` | ✅ 全字段 | 服务端按 `nameNormalized` 去重（§9） |
| `itemTags` | ⚠️ **不单独同步**，`tagIds: string[]` 作为 `items` 载荷的一个字段 | 关联无独立生命周期；避免"关联的删除"需要 tombstone 的复杂度 |
| `assets`（`kind='preset'`） | ❌ 不上传 | 156 个 SVG 随 App 包发布，两端各自 `syncPresetAssets()` 幂等补齐 |
| `assets`（`ai_generated` / `from_photo`） | ❌ 本阶段不同步（含二进制） | 见 §7 兼容策略 |
| `appMeta` | ❌ 永不 | 它是**本地**状态（`seeded` / `schemaVersion`），同步它等于让一台设备的初始化标记污染另一台 |

> **`appMeta` 不同步是硬规则**。若把它同步上去，设备 B 的 `appMeta.seeded='1'` 会覆盖设备 A，导致 preset 补齐逻辑失效——这正好触碰项目既有不变量"用户分类绝不被版本更新覆盖"。

---

## 6. D1 Schema 草案（只设计，不创建）

### 设计 A：统一变更模型 `sync_records` ⭐ 推荐

```sql
-- 单表：每条记录是某个实体的「最新快照」，按 revision 全局单调递增
CREATE TABLE sync_records (
  revision     INTEGER PRIMARY KEY,           -- 全局单调游标（rowid 别名，零额外成本）
  entity       TEXT    NOT NULL,                  -- 'item' | 'category' | 'tag'
  entity_id    TEXT    NOT NULL,                  -- ULID
  payload      TEXT    NOT NULL,                  -- JSON（只含该实体的业务字段）
  deleted_at   TEXT,                              -- tombstone；非空即已删除
  client_updated_at TEXT NOT NULL,               -- 设备侧原始时间戳（仅记录，不用于排序）
  device_id    TEXT    NOT NULL,                  -- 谁写的
  UNIQUE (entity, entity_id)                      -- ★ 核心：每实体只保留最新一行
);

-- 服务端唯一单调计数器（push 时 +1 并取回）。INTEGER PRIMARY KEY 即 rowid，无额外索引开销
CREATE TABLE sync_revision_seq (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);

-- 认证：只存 secret 的 SHA-256 哈希，绝不存明文
CREATE TABLE sync_auth (
  key_id     TEXT PRIMARY KEY,                    -- 公开的 key id（非秘密），便于轮换
  secret_hash TEXT NOT NULL,                      -- hex(SHA-256(secret))
  created_at TEXT NOT NULL,
  revoked_at TEXT                              -- 可吊销单个设备
);
```

索引刻意精简：1 个 `UNIQUE(entity, entity_id)` + 1 个 tag 专用部分唯一索引。
**每个索引都会让一次写入多算 1 row written**（官方明确说明），所以不做多余索引。

**tag 规范名的数据库级唯一性**（Phase 3B 最终审查第 6 条）：

```sql
CREATE UNIQUE INDEX idx_sync_tag_normalized
  ON sync_records (json_extract(payload, '$.nameNormalized'))
  WHERE entity = 'tag' AND deleted_at IS NULL;
```

「先查后写」在两台设备**真正同时**建同名 tag 时会双双看到"不存在"。
该部分唯一索引让**数据库本身**拒绝这种重复；冲突的那条由 Worker 转成
`merge-tag-into` 指令，客户端在自己的事务里把引用迁到既有 id、删掉自己那份。
`WHERE deleted_at IS NULL` 保证删掉 #Apple 后可以重新创建同名标签。

### 设计 B：关系模型镜像表

`items` / `categories` / `tags` 三张表，各自加 `revision` 列，与 Dexie 同构。

### 两种设计对比

| | A：统一变更模型 ⭐ | B：关系镜像 |
|---|---|---|
| pull 查询 | **1 条 SQL**（走主键有序扫描） | 3 条 + UNION 或 3 次往返 |
| **D1 免费版每次 Worker 调用仅 50 条查询** | 一次 push 一条 upsert，远低于限制 | 3 倍查询数，批量 push 时容易顶到 50 上限 |
| 加字段 | 改 JSON 编码即可，**无需 schema migration** | 需 `ALTER TABLE` + 迁移脚本 |
| 不需要的字段 | 天然不传（如 preset 资产） | 容易"顺手全量传" |
| 云端可查询性 | 差（需 `json_extract`） | 好 |
| 本地关联同步 | 天然（`tagIds` 在 payload 里） | 需额外设计关联表 revision |

**选 A。** 决定性理由是那条 **50 queries/invocation** 的免费版限制，以及"加字段不用迁移"。D1 可查询性对本项目**没有价值**——D1 永远不参与业务计算。

---

## 7. API 草案（只有 3 个端点）

所有请求带 `Authorization: Bearer <secret>`。UI CRUD 100% 发生在本地，云端只做同步。

```
POST /api/sync/push
  body: { deviceId, changes: [{ entity, entityId, payload, deletedAt, clientUpdatedAt, baseRevision }] }
  → 200: { accepted: n, rejected: [{entity, entityId, reason}], currentRevision: n, ignored: [...] }
  作用：批量 upsert。逐条比较 revision（见 §9）

GET /api/sync/pull?after=<revision>&limit=100
  → 200: { changes: [{ revision, entity, entityId, payload, deletedAt, clientUpdatedAt, deviceId }], nextRevision, hasMore }
  作用：拉取 revision > after 的所有实体最新快照

GET /api/sync/status
  → 200: { currentRevision, recordCount, createdAt }
  作用：判断"云端是空库还是已有数据"，供首次启用时决策（§11）
```

**不做** `GET /api/items` 这类 CRUD：云端一旦提供读取接口，它就会变成第二个数据源，与 §4 的"唯一真相在本地"冲突。

### D1 侧必须遵守的两条实现约束

1. **⚠️ 必须显式设置 `run_worker_first: ["/api/*"]`（已更正，见 commit `6ba3275`）。**

   ~~原判断「不用设」是错的~~ —— 只配 `not_found_handling: "single-page-application"` 时，
   **SPA 回落优先级高于 Worker**：地址栏发起的是**导航请求**（`Sec-Fetch-Mode: navigate`），
   会先被资产路由接住并回落 `index.html`；只有 `fetch('/api/...')` 这类子资源请求才会进 Worker。
   **线上实测**：地址栏访问 `/api/sync/status` 返回的是 HTML 而不是 JSON
   （症状是"用 fetch 测一切正常、地址栏一看是 HTML"，极易误判成 Worker 没部署）。

   正确配置（`wrangler.jsonc`，需 wrangler ≥ 4.20.0，当前 4.147.0 ✅）：
   ```jsonc
   "assets": {
     "directory": "./dist",
     "not_found_handling": "single-page-application",
     "run_worker_first": ["/api/*"]
   }
   ```

   ⚠️ **只用路径数组，不要用 `true`**：`true` 会让**所有**请求（含 `.js`/`.css`/`.svg`
   等静态资源）都绕道 Worker，白白增加 Worker 调用量与首屏延迟。
   数组形式只放行 `/api/*`，其余路径照旧走资产路由 + SPA 回落，深链行为不变。
2. **单次 push 的批大小必须 ≤ 32 条**（Phase 3B 复审后修正，原写 500 是错的）。
   两条官方硬约束各自给出的上限：
   - **绑定参数 ≤ 100/query**：Worker 预加载已有记录的查询参数数 ≈ 实体种类(≤3) + 实体id 数 → N ≤ 97
   - **Free 50 queries/invocation**：1 预加载 + N upsert + 1 revision 分配 ≤ 50 → N ≤ 48
   取 32 留余量。推导见 `src/features/sync/syncLimits.ts`。

---

## 8. Sync Protocol

### 每设备持久化状态（Dexie 新增 `syncState` 单行表，Phase 3B）

```
{ key:'sync', deviceId, enabled, secretKeyId,
  lastPulledRevision, lastPushedRevision,
  lastSyncAt, lastError, pendingCount }
```

### 一次同步循环

```
① 触发（任一）：App 启动 / visibilitychange→visible / online / 用户手动点「立即同步」
   └─ 与 Phase 2H.1 的 updatePolicy 同构：统一 requestSync(reason)，内部节流 60s
   └─ navigator.onLine === false → 直接返回，UI 显示「离线」，不报错
② 离线前置检查：deviceId 缺失 / 未启用同步 → 返回
③ PUSH：outbox 中所有变更（分批，每批 ≤32）
     服务端逐条判定 → 返回 accepted / rejected / ignored / currentRevision
     本地：accepted 条目从 outbox 移除（同一 Dexie 事务内）
④ PULL：GET /api/sync/pull?after=lastPulledRevision
     单事务应用到 Dexie + 推进 lastPulledRevision
     ⚠️ 应用远端变更时，同一事务内清除该实体在 outbox 中的残留条目（避免回声）
⑤ 更新 lastSyncAt / lastError
```

**为什么 outbox 表而不是 `updatedAt` 水位线**：水位线（`updatedAt > lastPushedAt`）看似省一张表，但它依赖设备时钟——用户改 iPhone 系统时间、或时区/时钟漂移就会**漏推或重复推**。而所有写操作都已收敛在 repository 层，加一张表进同一事务的成本几乎为零。**选 outbox。**

### 五类变更的处理

| 变更 | 本地行为 | 同步载荷 |
|---|---|---|
| **新增** item | `itemRepository.create` + 同事务写 outbox | `deletedAt: null`，整条 payload |
| **修改** | `update` + 同事务写 outbox | 整条 payload（不做字段级 diff） |
| **soft delete** | 已同时写 `updatedAt`（✅ 已验证） | `deletedAt` 非空 |
| **tag 关联变化** | `update` 本就重写 itemTags（✅ 已验证） | 只改 item 载荷里的 `tagIds`，**不产生独立记录** |
| **category** | 增删改 + `sortOrder` 调整 | 整条 payload；软删走 `deletedAt` |

> **"删除复活"如何被阻止** —— 这是全设计中最重要的一条。
> 普通 LWW 会让"设备 A 删了物品、设备 B 仍持有旧副本并 push"把删除复活。
> 规则：**服务端对 `deleted_at IS NOT NULL` 的记录一律拒绝 upsert**（返回 `ignored: 'tombstoned'`），只有携带显式 `undeleteIntent: true` 的写入（UI 上"恢复物品"操作）才被接受。
> 于是：**删除是单调不可逆的（除显式恢复），只有活跃记录之间才做 LWW。**

---

## 9. Conflict Policy

**推荐：`updatedAt` LWW，但排序权威是服务端 revision，不是设备时钟。**

| 决策点 | 选择 | 理由 |
|---|---|---|
| 比较哪个字段 | 整条记录（不做字段级合并） | 单人使用下字段级合并的收益极低，而可解释性代价很高 |
| 排序由谁决定 | **服务端到达顺序**（`revision` 单调递增） | 设备时钟不可信（可被修改、可漂移、时区不同） |
| 用 `updatedAt` 做什么 | **仅作为审计信息记录**，不参与排序 | 保持"为什么这条赢了"可追溯 |
| 如何避免错误覆盖 | `baseRevision` 乐观并发检查（见下） | 防止陈旧设备整条覆盖新数据 |

### push 逐条判定逻辑

```
对每条 change（客户端声明 baseRevision = 它最后已知的服务端 revision）：
  1. 服务端无该 entity+entity_id         → 接受，分配新 revision
  2. 该记录已 tombstone 且无 undeleteIntent → ignored（不回声复活）
  3. 服务端 revision ≤ baseRevision（客户端基于最新） → 接受
  4. 服务端 revision > baseRevision（期间有别的设备写过）
       → 冲突。服务端顺序优先：接受本条（覆盖），并把被覆盖的旧 payload
         摘要返回给客户端，写进 sync_conflicts 供设置页查看
       → 客户端提示「XX 物品在另一台设备上也被修改，已采用本次修改」
```

**「事后可查」的确切落点**（Phase 3B 实现规格，见 `docs/PHASE_3B_IMPLEMENTATION_PLAN.md` §0.1）：
冲突记录存**本地 Dexie 新表 `syncConflicts`**（不放 D1 —— 冲突是设备间的私有记录，无需跨设备共享），只在**覆盖方设备**落库；
字段含 `entity` / `entityId` / `detectedAt` / `loserUpdatedAt` / `winnerDeviceId` / `winnerUpdatedAt` + **摘要**（不存全量 payload，避免无限膨胀）；
**生命周期：保留最近 50 条**，超出即删；设置 → 同步内只读展示，可单条删除或清空。**被覆盖方完全无感**（它下次 pull 拿到的就是它没赢的那版）。

**为什么冲突时"直接覆盖 + 告知"而不是弹窗让用户选**：这是单人双设备场景，冲突概率极低（通常一方在另一方离线期间只动了几条）。弹窗做字段级三方合并需要保留 base 版本，复杂度和出错面远大于收益。**先做成"服务端顺序优先 + 事后可查"，把用户干预留到真需要时再加。**

### 标签跨设备去重（必须处理）

Dexie 的 `&nameNormalized` 唯一索引**只在单个库内生效**。两台设备离线时各建一个 "Apple" tag，
若只靠"先查后写"，真正并发时两者会同时看到"不存在"→ D1 里出现两条。
因此除预加载判断外，还有**数据库层的部分唯一索引**兜底（见上文 §6.1）；冲突的那条会被转成合并指令。服务端处理：

```sql
INSERT INTO sync_records (entity, entity_id, payload, ...)
VALUES ('tag', :id, ...)
ON CONFLICT(entity, entity_id) DO UPDATE SET ... 
-- 并在插入前先查：SELECT revision, entity_id FROM sync_records
--                WHERE entity='tag' AND json_extract(payload,'$.nameNormalized') = ?
-- 命中 → 返回既有 entity_id，客户端把本地 tag 合并（重写 itemTags 引用后删除本地副本）
```
客户端收到"tag 被合并"响应后，在一个事务内：更新所有引用 → 删除本地重复 tag。**不丢标签，不产生重复。**

### 明确不引入 CRDT / OT

理由：本项目是**单用户、极少并发写**。CRDT 的复杂度（id 时钟、墓碑 GC、状态膨胀）会持续污染代码与心智模型，而它解决的问题在个人使用规模下**实际不存在**。若未来真出现"两台设备同时高频编辑同一物品"，届时在 `sync_records` 上加 per-field 版本即可演进——**统一变更模型的好处就是它允许后期加字段级版本而不需要迁移表**。

---

## 10. Offline / Retry

| 场景 | 行为 |
|---|---|
| `navigator.onLine === false` | **直接跳过**，UI「离线 · 有 N 项待同步」。不弹错 |
| Worker/D1 不可达 | 捕获 → 记 `lastError` → 指数退避重试（30s → 2min → 10min → 30min 封顶，带 ±20% 抖动），最多 5 次后转为"等待手动重试" |
| 请求超时 | `AbortController` 15s 取消 |
| **本地数据** | **任何情况下都不因同步失败被修改、删除、回滚**。outbox 是唯一待发队列，失败时原样保留 |
| UI |  设置 → 同步：一行状态（`未启用 / 已同步 · 上次 12:03 / N 项待同步 / 离线 / 同步失败，可重试`）+「立即同步」按钮。**不做控制台、不做历史页** |
| 与 PWA 更新的关系 | 同步**绝不能触发 reload**；表单编辑中同步静默进行（与 §Phase 2H.1 的 `useUpdateGuard` 互不干扰，两者节流各自独立） |

**中国大陆的具体含义**：`workers.dev` 域在大陆连通性不稳定。设计上的应对是——① 同步**永不阻塞首屏**（启动后异步触发，且非 App 可用性的前置条件）；② 失败完全静默；③ `online` 事件自动追赶；④ 实测阶段必须在**代理关闭**的条件下验证 App 完全可用。

---

## 11. Backup / Restore 与 Sync 的交互

**第一版最安全的方案 = 不自动合并，明确二选一。**

ZIP Restore 是 Replace Restore（整体替换），而 Sync 是增量合并——两者语义直接冲突。任何"自动决定谁覆盖谁"的启发式都可能在用户毫不知情时丢掉一整台设备的新数据。

| 时机 | 行为 |
|---|---|
| 导出 ZIP | 与 Sync 完全独立，不含任何 sync 状态。ZIP 始终是**云端之外**的第二份备份 |
| **恢复备份后** | **同步被关闭**：清凭据（secret / keyId）、游标归零、清空 outbox。本地数据**完全不受影响**，也不会误推任何东西到云端。用户想恢复同步时在设置页重新走一次「创建 / 加入」即可（secret 已清，需重新生成）。<br>⚠️ 不用「二选一自动合并」：Replace Restore 与增量同步语义冲突，任何自动决策都可能在用户不知情时丢掉一整台设备的新数据。（Phase 3B 复审第 10 条确定；实现见 `backupService.restoreFromPayload`）|
| 何时暂停同步 | 恢复流程中同步**暂停**（复用 Phase 2H.1 的 `useUpdateGuard` 思路），恢复完成后由用户选择 |
| 恢复后 `appMeta` | 保持现有行为（`seeded='1'`）。**`appMeta` 永不同步**（§5），因此不会影响另一台设备 |
| 云端数据丢失 | D1 整个库可删（`/api/sync/status` 报告空库 → 提示"云端为空，是否把本机数据上传作为初始数据"） |

> D1 免费版有 **7 天 Time Travel**，但**不能把它当备份**：只保留 7 天，且这是 Cloudflare 侧的运维特性而非用户可管理的备份。ZIP 仍是唯一由用户掌控的备份。

---

## 12. Authentication

### 威胁模型（单用户，诚实版）

单用户 PWA **没有真正的安全边界**。同源 XSS 可以读取一切。因此目标不是"绝对安全"，而是：

1. D1 即使被完整泄漏，**攻击者也无法登录**（只存哈希）
2. secret 不出现在 URL、日志、Git、剪贴板历史里
3. 单个设备泄漏可单独吊销，不影响其他设备
4. 密钥强度由**长度**保证，不依赖用户记忆

### 方案

```
首次启用同步（在一台设备上）：
  1. crypto.getRandomValues(new Uint8Array(32))  →  base64url
     ⇒ 256-bit 随机 secret，熵 ≈ 190+ bits
  2. 用户在另一台设备上手动粘贴/扫码输入
  3. Worker: POST /api/sync/bootstrap
       key_id      = crypto.randomUUID()          （公开，非秘密）
       secret_hash = hex(await crypto.subtle.digest('SHA-256', secret))
       只存 hash；明文 secret 只在此刻存在于两个设备

每台设备：
  ① 生成 deviceId（ULID），存 syncState
  ② 存 secret 到 IndexedDB 的 syncState 表
     ⚠️ 不写 localStorage（XSS 同样能读，但 localStorage 会被任何脚本/扩展扫到，
        IndexedDB 至少需要知道表名与结构）
  ③ 请求头：Authorization: Bearer <secret>

Worker 校验（每个 /api/* 请求）：
  1. 拆 Bearer，取 token
  2. SELECT secret_hash FROM sync_auth WHERE revoked_at IS NULL
  3. hex(SHA-256(token)) 与库中哈希做**常数时间比较**
     （Workers 无 crypto.subtle.timingSafeEqual，用手写循环逐字节比较，
       长度不等时仍走完固定轮次，避免时序泄露）
  4. 不匹配 → 401，不透露"存在但密钥错"还是"密钥不存在"（统一文案）
  5. 计数：同一 key_id 连续失败 → 429（防在线爆破）
```

### 首次配对流程（Phase 3B 落地规格）

A/B 引导式配对（详细见 `docs/PHASE_3B_IMPLEMENTATION_PLAN.md` §0.2）：

1. **A 设备**（已有数据的一侧）生成 `key_id` + 256-bit secret + **配对码** = `base64url({v,keyId,secret,workerBaseUrl})`
2. A **暂不启用**（等对方确认）→ 避免单边把空库推上去覆盖对方老数据
3. 用户把配对码复制/手输到 **B 设备**
4. B 立刻用该 secret 调 `/api/sync/status` 校验 → 401 即配对码无效、不落库；200 才存 `syncState` 并启用
5. B 询问「云端已有数据：以云端为准 / 以本机为准」→ 首次同步
   （⚠️ 此处是**加入方**的抉择，与上面 Restore 的「关闭同步」是不同场景）
6. A 收到任意一次成功 pull（说明 B 已接入）→ 自动启用并首次同步；24h 无接入则保持未启用，可手动改「单机启用」

配对码**不写 URL / 不写日志 / 不进 Git**；**不做二维码**（沿用项目既有「不做二维码」约定，用剪贴板 + 手输）。

### 明确不做的事

| 不做 | 原因 |
|---|---|
| secret 放进 URL query | 会进浏览器历史、Referer、Cloudflare 访问日志 |
| secret 提交进 Git | 仓库是 Public |
| `SELECT ... WHERE secret = ?` 明文比对 | D1 一旦泄漏即全盘失守 |
| PBKDF2 / scrypt / Argon2 拉伸 | **它们是给低熵人类密码用的**。256-bit 全随机 secret 的熵已足够，再拉伸只是无意义地拖慢每次请求（且 Workers 免费版 CPU 限 10ms） |
| OAuth / 邮箱 / 密码找回 | 单用户不做账号系统（§16 提案） |
| 把 secret 写进构建产物 | 同上 |

### 可选加固（不进入 3B）

在 Worker 前挂 Cloudflare Access Service Token：secret 之上再叠一层，且不占 D1 设计。代价是 iPhone 侧要处理 token 刷新 + Access 免费版 50 seats。**列为 Phase 3C 可选，不进第一版。**

---

## 13. Free-tier 用量估算（基于官方数字）

### 官方额度（2026-10-06 核对）

| | Workers Free | D1 Free（Workers Free 计划） |
|---|---|---|
| Requests | **100,000 / 天**（UTC 0 点重置） | — |
| Rows read | — | **5,000,000 / 天** |
| Rows written | — | **100,000 / 天** |
| Storage | — | **5 GB**（账号总计）；单库 Free 上限 500 MB |
| CPU / invocation | 10 ms | — |
| Queries / invocation | — | **50** |
| 数据库数量 | — | 10 |
| Time Travel | — | 7 天 |
| 数据传输 | 无 egress 计费 | 无 egress 计费 |

Supabase Free 对照：500 MB 库、**1 周不活动自动暂停**、5 GB egress、无自动备份、无 PITR、**免费版不含自定义域名**。

### 稳态估算（每天 10 次同步，每次平均 10 条变更）

假设 10,000 件物品规模（**已预留 10 倍余量**），变更载荷平均 400 B：

| 指标 | 单次同步 | 每天 10 次 | 占免费额度 | 余量 |
|---|---|---|---|---|
| Worker requests | 2（push + pull），但 >32 条变更要分多次 push | 20~24 | 0.02% | 4000× |
| D1 rows written | 10 条 × 2（表 + UNIQUE 索引）= 20 | 200 | **0.2%** | 500× |
| D1 rows read | pull 走主键有序扫描，≈ 拉回条数 = 10 | 100 | 0.002% | 50000× |
| D1 storage | — | ~13,500 行 × 400 B ≈ **5.4 MB** | 0.1% | 900× |

### 各物品规模下的结论

| 规模 | 总行数（item+cat+tag） | Storage | 单次全量 pull 的 rows read | 结论 |
|---|---|---|---|---|
| 100 | ~250 | ~0.1 MB | 250 | ✅ 无忧 |
| 1,000 | ~1,300 | ~0.5 MB | 1,300 | ✅ 无忧 |
| 5,000 | ~5,800 | ~2.3 MB | 5,800 | ✅ 无忧 |
| 10,000 | ~10,750 | ~4.3 MB | 10,750 | ✅ 无忧 |

**结论：长期稳态运行在免费额度内，余量 3 个数量级以上，不存在超额风险。**

### 唯一需要注意的尖峰：首次 bootstrap

10,000 件物品首次全量上传：10,750 行 × 2（表 + 索引）≈ **21,500 rows written**，占当日 100,000 的 **21.5%**。

- ✅ 仍然在额度内
- ⚠️ 但**必须分批**（每批 ≤32），否则撞上绑定参数（100/query）与查询数（50/invocation）限制
- 📌 因此 `/api/sync/status` 必须先问"云端是否空库"，空库才允许走 bootstrap 全量写入

### 严禁 `SELECT *`

- ❌ 禁止 `SELECT * FROM sync_records`（无 WHERE）—— 10,750 行全扫，每天 10 次就是 10.7 万 rows read，虽仍在额度内但**完全浪费**
- ✅ pull 恒为 `WHERE revision > ? ORDER BY revision LIMIT ?`（走主键，天然有序）
- ✅ tag 去重查 `nameNormalized` 需建索引或走小表扫描——`tags` 表远小于 `items`，可接受
- ✅ `/api/sync/status` 用 `SELECT COUNT(*)` 走索引计数，不取行内容

---

## 14. 独立评估：本机 MySQL + Navicat

### Navicat 是什么

**Navicat 只是数据库管理 GUI 客户端**（连服务器、看数据、做备份导出、执行 SQL）。它**不是同步基础设施**，不提供任何同步协议、API 端点或冲突处理。把"装了 Navicat"当成"具备同步能力"是概念错误。

### 用本机 MySQL 支撑 iPhone 同步要解决的问题

| 问题 | 现实 |
|---|---|
| **PC 必须 24h 开机** | 是。MySQL 停了同步就停。睡眠 / 关机 / Windows 更新重启 / 停电，全都会中断 |
| **公网 IP** | 家宽普遍在 CGNAT 后面，**没有公网 IP**，端口转发无效 |
| **Cloudflare Tunnel** | 可解决公网问题，但**需要域名托管在 Cloudflare**（有域名的话，稳定 URL 有保障；没有域名只能用 Quick Tunnel，**每次重启地址就变**，iPhone 侧要重新配置 → 不可接受） |
| **TLS** | MySQL 自身证书配置繁琐；走 Tunnel 可由边缘终止，但仍是额外一层 |
| **认证** | MySQL 原生账号体系面向"用户"，不面向"设备"。要做 API 层 + 认证 = **自己写一遍 Worker API** |
| **数据库端口暴露** | 一旦为了图省事直接暴露 3306 到公网，等于把一个无 WAF、无速率限制、无审计的数据库开放互联网 |
| **备份** | 得自己写定时导出 + 异地存放，否则 PC 一坏数据全没 |
| **移动端协议** | iPhone 上的 PWA **不能直连 MySQL 协议**（浏览器无 MySQL 客户端，MySQL 也不支持 CORS）。所以还必须自建一层 HTTP API —— **这层 API 和 Worker+D1 做的是同一件事，但成本高得多** |

### 判断

**不推荐。** 用 Tunnel + 自建 API 暴露本机 MySQL，和 D1 方案**工作量相同**，但额外背上：PC 常开、无公网 IP、域名依赖、TLS 配置、备份责任、端口暴露风险。

> 结论不是"MySQL 不好"，而是：**D1 方案 = MySQL 方案省掉了所有自建运维部分**。已装的 MySQL + Navicat 在**数据可视化 / 手工查询备份文件**场景仍然有用，但**与跨设备同步无关**。

---

## 15. Risks

| # | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| R1 | **`workers.dev` 域在大陆连通性不稳定** —— 这是本方案最大不确定性 | 🔴 高 | 同步永不阻塞首屏；失败完全静默；`online` 自动追赶；Phase 3B **必须在关闭代理条件下实测**。若长期不可用：唯一彻底的解法是买一个域名（~¥60/年）绑 custom domain（**不是 workers.dev**，稳定性显著不同）——此决策留给用户 |
| R2 | 设备时钟被修改 → 时间戳错乱 | 🟡 中 | 排序**完全不看**客户端时间戳，用服务端 revision；`clientUpdatedAt` 仅审计 |
| R3 | 两端版本不同（老设备缺新 preset SVG） | 🟡 中 | 已有 `syncPresetAssets()` 幂等补齐 + 图标 fallback；`iconAssetId` 是逻辑引用 |
| R4 | D1 故障 / 额度耗尽 | 🟢 低 | 余量 3 个数量级；失败静默；ZIP backup 兜底；`/api/sync/status` 可查 |
| R5 | 同 origin Worker 引入后 SPA fallback 行为变化 | 🔴 高（**已实际发生**） | ⚠️ 原判断「只有 navigation 回落 HTML，可接受」**低估了它**：地址栏访问 `/api/*` 确实会拿到 HTML，排查时极易误判成 Worker 没部署。**已修**：`assets.run_worker_first: ["/api/*"]`（commit `6ba3275`）。验证方式：部署后地址栏访问 `/api/sync/status` 应返回 401 JSON 而非 HTML |
| R6 | `ai_generated` / `from_photo` 资产跨设备缺失 | 🟡 中 | 3B 不同步其二进制；同步元数据并让缺失端回退默认图标。将来走 R2（免费 10 GB） |
| R7 | 同步与 PWA 更新的 reload 互相干扰 | 🟢 低 | 两者独立节流；同步**永不触发 reload**；`useUpdateGuard` 只管版本更新 |
| R8 | 用户误以为"同步 = 备份"，删了云端 | 🟡 中 | UI 文案明确"备份"与"同步"是两件事；`/api/sync/status` 支持云端重建引导 |
| R9 | 标签跨设备重复 | 🟡 中 | 服务端按 `nameNormalized` 去重 + 客户端事务内合并（§9） |
| R10 | 首次 bootstrap 大批量写入 | 🟢 低 | 分批 ≤32；先查 status 确认云端为空 |

---

## 16. Phase 3B 最小实现范围

### 必须做

1. **Dexie v3 → v4 migration**，新增两张表（**不改动任何现有表结构与索引**，只新增）：
   ```
   syncState:  'key'                                  // 单行，存 deviceId / 游标 / 状态
   syncQueue:  'id, entity, [entity+entityId], createdAt'  // outbox
   ```
   ⚠️ v4 migration **只允许新增表**。现有 `items`/`categories`/`tags`/`itemTags`/`assets`/`appMeta` 一律不动。
2. `worker/` 目录 + `wrangler.jsonc` 加 `"main"`（纯新增，不影响现有 assets 配置）
3. Worker：`bootstrap` / `push` / `pull` / `status` 四个函数 + 常数时间哈希校验
4. D1 migration SQL（1 张表 + 1 计数器 + 1 认证表）
5. `src/features/sync/`：`syncEngine`（编排）+ `syncTransport`（fetch）+ `outbox`（事务）+ 纯逻辑 `syncPolicy`（节流 / 背压 / 错误分类）
6. `src/domain/syncPayload.ts`：实体 ↔ payload 编解码（**纯函数，必须有测试**）
7. 设置页「同步」分组：启用 / 状态 / 立即同步 / 关闭
8. 触发点接线：启动、`visibilitychange`、`online`、手动（**与 Phase 2H.1 的 `updatePolicy` 同构但独立**）

### 必须测（遵循项目既有约定）

- **纯逻辑必须有测试**：`syncPolicy`（节流/离线/重试退避）、`syncPayload`（往返编解码、未知字段容忍）、冲突判定（§9 的 4 条分支）、tombstone 不可逆性
- **Dexie v3 → v4 migration 测试**：断言旧库升级后 6 张原表数据**逐字节不变**（沿用现有 repository 测试夹具）
- **标签合并测试**：两端各建同名 tag → push → 合并后无重复且 itemTags 引用正确
- **必须跑浏览器端到端**（沿用 `.tmp/verify/` + 隔离 Edge profile 模式）：两台"设备"（两个 browser context）→ A 建物品 → 同步 → B 拉取可见 → B 改 → A 同步可见 → A 软删 → B 同步后消失（**验证不复活**）
- 回归全绿：`npm run typecheck` · `npm test` · `npm run build`

### 明确不做（Phase 3B）

- ❌ 不同步 `assets` 的二进制（照片 / AI 图标）→ 留给 R2
- ❌ 不做实时推送（WebSocket / SSE）—— D1 是 HTTP 查询模型，轮询式同步对个人使用完全够
- ❌ 不做冲突人工解决 UI（先"服务端顺序优先 + 事后可查"）
- ❌ 不做同步历史 / 日志页
- ❌ 不做多用户、共享库、家庭协作
- ❌ 不做 Cloudflare Access 加固（列 Phase 3C 可选）
- ❌ 不引入 CRDT / OT
- ❌ 不引入状态库（zustand 等）—— 沿用项目"Context + hook"既有做法
- ❌ **不删除 / 不简化现有 ZIP Backup**

---

## 17. PRODUCT_GOAL_CHANGE_PROPOSAL（待用户确认，暂不修改 product-goals.md）

当前 `docs/product-goals.md` 把 **「账号系统」** 列为长期非目标。本设计**没有**引入账号系统——但为了把话说清楚，建议把该条**细化**为：

> ### 账号系统
>
> - ❌ **不做**公开的多用户账号体系：不注册、无邮箱登录、无密码找回、无 OAuth、无社交、无用户中心、无多租户 SaaS。
> - ✅ **允许**可选的**单用户私人跨设备同步**：由用户自持的随机 secret 授权，设备数不限，不承载任何第三方内容。

**理由**：现有措辞在字面上会让"加同步"看起来违反产品定位，从而在未来的 Phase 评审中被反复重新讨论。细化后，边界依然清晰（**不做多用户账号**），但为已在范围内的私人同步留出明确依据。

**同时建议在「核心功能」补一行**：物品 · 分类树 · 标签 · 搜索 · 统一图标 · 购买信息 · 总投入 · 日均使用成本 · **私人跨设备同步（可选）** · Backup · PWA

> ⚠️ **本节只是提案。未获用户明确确认前不修改 `docs/product-goals.md`。**

---

## 附：数据流一图（一次 push 的完整判定）

```
设备本地                    Worker                      D1 (sync_records)
───────                    ──────                      ────────────────
repository 写入
 └ 同一 Dexie 事务
    ├ 业务表 upsert
    └ syncQueue.insert

syncEngine 收集 outbox
 └ POST /api/sync/push { deviceId, changes[], Bearer }
                              │
                              ├─ 验证 Bearer → SHA-256 → 常数时间比对
                              ├─ 分配 revision（sync_revision_seq +1）
                              │
                              └─ 逐条 upsert：
                                   服务端无记录?           → 接受
                                   已 tombstone?         → ignored（不复活）
                                   rev ≤ baseRevision?   → 接受（无并发）
                                   rev > baseRevision?   → 覆盖，返回旧摘要（冲突）
                              │
  ◄── { accepted, ignored, conflicts, currentRevision }
  │
  ├ 同一事务：清 outbox 已接受条目
  │
  └ GET /api/sync/pull?after=lastPulledRevision
       ◄── { changes[revision > after], nextRevision }
  └ 同一事务：应用远端变更 + 推进游标 + 清除回声 outbox 条目
```