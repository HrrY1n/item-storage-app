# 当前架构与维护入口

> 本文描述仓库当前真实实现（2026-10）。当前维护约定集中在这里；已删除的旧阶段方案可从 Git 历史查询。

## 1. 运行边界与版本契约

| 契约 | 当前值 | 说明 |
|---|---:|---|
| App/package | `0.2.1` | 产品版本，不等于数据或同步协议版本 |
| Dexie | `4` | IndexedDB schema；不得删除已有迁移链 |
| Backup | `3` | ZIP `manifest.json`/`data.json` 契约；导入保留旧版本迁移 |
| Sync wire | `2` | `src/domain/syncProtocol.ts`；push/pull 成功响应和请求必须带版本 |
| Worker DB | D1 `sync_records` | 远端镜像，不是本地业务数据库；分类环由 Worker 预检 + D1 trigger 拒绝 |

版本关系：改 UI/业务功能通常只改 App 版本；增加本地字段要考虑 Dexie migration；改变 ZIP 字段要改 backup schema 与校验/迁移；改变 Worker/client 的 HTTP 字段要提升同步协议版本并保留明确失败路径。

## 2. 真实目录与允许依赖

```text
src/
  App.tsx, pages/                 页面与交互编排，不直接访问 db
  components/                     可复用展示控件
  features/data/                  useLiveQuery hooks 与视图模型
  features/sync/                  SyncEngine、Transport、策略、React Context
  services/                       备份/PWA/同步装配等跨领域流程
  db/                             Dexie 实例、seed、同步脏标记
  db/repositories/                数据访问、事务和业务不变量的执行边界
  domain/                         纯类型、编解码器和规则函数；应可单测
  data/                            内置图标和静态数据
  mock/                            仅开发演示数据
worker/
  index.ts                        HTTP/认证/协议装配
  syncLogic.ts                    Worker 纯判定、分页和分类图预检
  pushPipeline.ts                 D1 push 预加载、整批事务、重试和回执
  syncSql.ts                      SQL 单一来源
  migrations/                     按顺序执行的 D1 迁移
scripts/                          浏览器/PWA/图标验证和生成工具
docs/                             当前架构与历史设计/审计说明
```

依赖方向：`pages → features/services → repositories/domain`；页面不 import `db`，domain 不做 IO，repository 才直接 import Dexie。同步是有意的跨层例外：Worker 复用协议/domain 纯代码，但不得把浏览器数据库或 React 引入 Worker。`worker/` 只通过 SQL/JSON 与 D1 交互。

## 3. 本地数据与云同步调用链

```text
React page
  → repository transaction (business row + outbox)
  → markSyncDirty / debounce
  → SyncContext → SyncEngine
      → SyncTransport (protocol v2, timeout, response validation)
      → Worker /api/sync/push
          → auth → request validation → pushPipeline → D1 batch/trigger
      → exact queue-id dequeue
      → Worker /api/sync/pull (strict revision page)
      → applyRemote transaction (business rows + echo/outbox rules)
      → markSyncedForSession(epoch fence)
```

Local-first invariant：保存、编辑和删除先提交 IndexedDB；网络失败只保留 outbox 与游标，不回滚用户本地 CRUD。push 只有服务端明确确认的 queue ID 才能出队；ignored/dedup 是明确终态，损坏响应、未确认条目和协议不兼容都保留。分类成环被服务端标记为 `category-cycle`，客户端记录可读冲突并应用权威分类快照。

本地写入经 2.5 秒 debounce 聚合，引擎串行执行。`visible` 前台恢复触发受 60 秒节流；`boot`、`manual`、`online` 和 `local-change` 不受该节流限制，避免已保存的改动因节流而滞留。判定与覆盖用例见 `src/features/sync/syncPolicy.ts` 及对应测试。

## 4. 会话、恢复和关闭边界

### 默认分类更新

`src/data/categories.ts` 是默认物品分类的唯一来源：7 个一级、49 个二级，220 个图标各有一个类型归属。它与 `src/data/icons.ts` 中用于素材浏览的九类分组独立。分类封面复用已存在的物品图标。

首次安装由 `seedIfEmpty` 写入完整树；旧库在 Boot 中调用 `upgradeDefaultCategories`。升级与分类 outbox 在同一事务提交，提交后才通知同步。既有分类 ID、createdAt、物品归属和自定义排序保留；仅旧默认名称对应改为新名称，为缺少封面的分类补图。新增分类采用稳定 ID，不复活 tombstone，也不重建被用户改名或移除的旧二级分类。只有未经调整的旧默认根顺序会按新版顺序排列。

`appMeta.defaultCategoriesVersion` 记录默认内容版本，不改变 Dexie / Backup / Sync wire 版本。该标记随 ZIP 备份保留，避免恢复后撤销用户的分类调整；旧 ZIP 在恢复事务内完成分类补齐。云端恢复继续使用云端分类快照，不在 pull 后重新套用默认树；旧设备启动后新增的分类通过既有 outbox 同步到其他设备。完整分类和页面规则见 [分类说明](categories.md)。

### 同步会话

- `syncState.sessionEpoch` 是旧请求的事务栅栏；凭据、启用状态和重新配对导致旧响应失效。
- 以本机数据加入新空间时，游标和上次同步时间从新空间起算；本地业务数据保留，outbox 会重建但物理删除 tombstone 也必须保留。
- 使用云端恢复或 ZIP 恢复时，业务表替换、outbox 清理/重建和禁用旧同步会话在同一个本地事务边界内完成。
- 关闭同步不删除业务数据；恢复码/secret 不进入 ZIP 备份。
- F01 已发送到 Worker 的旧写入无法被本地 session epoch 撤销，这是已知残余风险。

## 5. 如何改动数据字段

### 本地持久化字段

1. 更新 `src/domain/types.ts` 与创建/编辑/解码路径。
2. 若涉及 IndexedDB store/index，追加 `src/db/db.ts` 的新 `version()` migration；不要改写或删除旧 migration。
3. 更新 repository、seed、backup 校验/迁移、相关页面和测试。
4. 用旧库 migration、CRUD、备份恢复和 `npm run typecheck`/`npm test` 验证。

### 备份字段

更新 `src/domain/backup.ts` 的 schema 常量、manifest/data 校验、旧版本迁移和 `backup*.test.ts`；只有在导入校验成功且用户确认后才调用 restore 写库。循环分类必须在校验阶段拒绝，不能让 restore 先清空再失败。

### 同步字段

同步 payload 必须同时更新 `src/domain/syncPayload.ts`、`SyncTransport` 的运行时 validator、Worker `syncLogic/pushPipeline/syncSql`、迁移（如有）和 Worker/client 契约测试。涉及 wire 语义时提升 `SYNC_PROTOCOL_VERSION`；旧/新组合必须明确失败，不能用默认值伪造成功。

## 6. 测试与验证入口

```powershell
npm ci
npm run typecheck
npm test
npm run build

# 浏览器只能使用项目隔离 Edge profile
npm run browser:start -- --port=9222
node scripts/verify.mjs
npm run browser:stop -- --port=9222
```

同步重点测试：`src/features/sync/*test.ts`、`worker/protocolContract.test.ts`、`worker/workerPushAssembly.test.ts`。后者用真 `node:sqlite` 适配器验证 D1 batch、tag 唯一索引和分类 trigger，不连接真实 D1。浏览器测试禁止使用用户 Edge profile、导入浏览器数据或 `taskkill /IM msedge.exe`。

## 7. 常见故障的安全诊断

| 现象 | 先看什么 | 安全结论 |
|---|---|---|
| 同步失败且有待同步 | 设置页摘要、`syncState.lastError`、outbox count | 不手工清空 IndexedDB；协议/冲突错误先升级 Worker/client 或处理冲突 |
| push 后数据仍待同步 | 服务端 HTTP 状态、`acceptedQueueIds`/ignored reason | 只有明确终态才出队；损坏 200 必须保留队列 |
| 游标不动 | `lastPulledRevision`、pull page revision/order | 不手工推进游标；修复服务端页面后重试 |
| 分类冲突 | 设置页“最近的覆盖记录”中的 `category-cycle` | 客户端使用 Worker 返回的权威分类快照，不静默改写历史环 |
| 恢复失败 | `readAndValidateBackup` 返回错误，恢复前快照 | 校验失败不写库；需要先导出当前 ZIP 再排查 |

诊断日志不得包含恢复码、Bearer secret、真实用户数据或完整 payload。生产 D1 迁移只按 `worker/migrations/*.sql` 顺序执行，验证前不要在真实库尝试破坏性 SQL。

## 8. 保留与暂不实施的设计

## 8.1 推荐目标形态与本轮范围

```text
UI pages/components
        ↓
feature hooks + sync context
        ↓
services (workflow) ───────→ domain codecs/rules (pure)
        ↓                              ↑
repositories (Dexie transactions) ────┘

Worker HTTP → protocol validators → push/pull pure logic → SQL/D1 migrations
```

推荐目标仍是这套小型分层：把协议版本/运行时校验集中在 Transport 与 Worker 边界，把分类/备份规则留在 domain，把事务留在 repository；不要为了文件行数拆 `SyncEngine` 或迁移页面目录。本轮已完成的低风险优化是维护入口文档、协议常量/契约测试、分类图诊断与备份拒环校验。需要单独批准的中高风险工作包括拆分同步引擎、迁移目录、增加状态管理库或重写 D1 数据模型。

保留：Local-first + outbox、Dexie repository 事务、F01 session epoch、Worker D1 batch、tombstone 单调性、tag 去重、备份 Replace Restore、无第三方状态库。

本轮不做：全量 Clean Architecture/DDD、同步引擎大拆分、目录迁移、CRDT/OT、DI 容器、引入 ESLint/新依赖、删除历史截图或重写 Git 历史。这些没有足够的低风险收益或需要单独批准。

## 9. 物品展示与财务约定

`src/features/data/itemPresentation.ts` 是卡片与列表的共享展示模型，组件消费同一结果；金额和天数复用 `domain/purchase.ts`、`domain/lifecycle.ts`，不在各页面另算。对应行为由 `itemPresentation.test.ts`、`lifecycle.test.ts` 和 `purchase.test.ts` 验证。

- 总投入 = 购买价 + 附加花费，金额以整数分存储；两者都未填时为空，真实零金额仍为零。
- 已出售且填写金额时，实际持有成本 = 总投入 − 出售金额，允许为负；卡片盈亏 = 出售金额 − 总投入，正为盈利、负为亏损、零为持平。总投入与实际持有成本不能混用。
- 持有天数按日历日计算、含购买当天；已处置物品冻结到处置日。必要日期缺失或非法时隐藏相关指标，不补成零。日均成本使用实际持有成本和持有天数。
- 有出售金额时，卡片指标为持有天数、出售回收、日均成本；总投入与盈亏另行展示。出售金额未填时不制造零元回收或盈亏，而是展示已有总投入及可计算指标。
- 丢弃、其他处置不显示出售回收和盈亏；心愿卡片不显示成本指标。缺失处置方式显示中性的“已处置”，只计入“全部”筛选，不冒充其他处置，也不从备注推断方式。
- 已处置副标题使用处置日期，缺失时显示日期未知；只有出售显示图片结果文字。保修在持有态展示；处置不使用危险色，不把图标灰化或遮毁。
- 金额完整显示，不使用省略号截断；指标可通过字号和布局适配。处置二级筛选属于页面 UI 状态，不进入业务数据库、备份或同步。

## 10. 旧说明的出处

已完成阶段的长篇方案和旧版首次安装清单不再作为维护入口。当前同步、备份和展示约定以上文及对应测试为准。需要追溯旧文时，使用 `git log --all -- docs/` 找到历史提交，再用 `git show <commit>:docs/<filename>` 读取；无需在工作区保留另一份归档。

已执行的 `worker/migrations/` 保持追加式迁移链，用户交接快照也保留原样；其中的旧方案文件名是历史出处记录，不能为了整理文件改写已执行的迁移。
