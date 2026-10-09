# Item Storage App 架构审计独立复审（第二轮）

审计日期：2026-10-09（Asia/Shanghai）  
项目：`HrrY1n/item-storage-app`  
第一轮报告：`docs/audit/2026-10-09_architecture_review.md`

## 0. 基准、范围与证据边界

### 0.1 基准核对

本轮开始时：

- 分支：`main`
- HEAD：`9f2ee343d4e066a99679007ec77e4b4d13ff9eec`
- HEAD 与第一轮报告记录的基准完全一致，没有需要换算的旧行号。
- 工作区的产品代码、测试、配置和依赖没有改动。`git status --short --branch` 只显示分支信息以及第一轮报告的未跟踪文件 `docs/audit/2026-10-09_architecture_review.md`；本轮再新增本报告。

第一轮报告因此可以按当前 HEAD 的源码位置复核，但它的结论仍只作为待验证假设。

### 0.2 本轮实际执行

- `npm run typecheck`：通过。
- 完整 `npm test`：39 个套件、658 项通过。沙箱内第一次运行因 `fake-indexeddb/auto/index.mjs` 的 `realpath EPERM` 没有进入测试；获准在沙箱外重跑后才得到上述结果。这个环境错误没有被当作测试通过或失败。
- 定向相关测试：9 个套件、161 项通过。
- F01/F02/F03 及关联问题的新增复现没有写入仓库测试文件：使用现有 esbuild 在内存打包实际模块、内存 IndexedDB、假 fetch，以及 `node:sqlite(':memory:')` 的 Worker 测试适配器。
- 没有连接 Cloudflare Worker/D1、线上服务、真实用户数据、真实双浏览器、iPhone 或日常 Edge profile；没有部署、修复、commit 或 push。

下文的“已复现”指隔离环境中的实际结果，不等同于真实 Cloudflare 平台或线上事故。

## 1. 第一轮结论的可信度

第一轮的总体方向可信：问题集中在同步/恢复的异步边界，不需要大规模重构；三个 P1 都有实际失败路径。但本轮把结论收窄为以下三点：

1. F01 不只是“旧请求没有被 abort”。真正的缺口是没有持久化的会话代次，且业务替换、队列清理和同步状态重置不是一个事务。`AbortController` 只能尽力取消请求，不能让已经被服务端接受的旧 push 消失。
2. F02 的风险比“JSON 解析失败”更宽：客户端把任何 HTTP 200 都包装成成功，并且完全不使用 `acceptedIds`；同时 Worker 返回的是实体 ID，客户端类型却把它叫作 outbox ID。这是协议边界错误，不只是缺一个 `try/catch`。
3. F03 是有条件的跨设备合并问题，不是单设备普通移动都会发生。两个设备各自离线移动不同分类，服务端按实体逐条接受后才会出现环；现有本地移动检查并没有失效，只是覆盖范围不够。

结论可信度汇总：

| 问题 | 第一轮结论 | 本轮结论 | 可信度说明 |
|---|---|---|---|
| F01 | 已确认，P1 | **确认** | 延迟 pull、双引擎、多阶段重新配对均复现；事务失败也能留下半状态 |
| F02 | 已确认，P1 | **确认并扩大边界** | 异常 200 会清 outbox；非法回执、非法游标还会假成功或重复请求 |
| F03 | 已确认，P1 | **确认，但触发条件更窄** | Worker 和客户端内存复现；不是真实 D1/双浏览器联网验收 |
| F04 | 已确认，P2 | **确认** | 删除标签确实没有 dirty 通知，但队列仍在，属于延迟上传而非立即丢数据 |
| F05 | 已确认，P2 | **确认** | V2 保留但没有尾随调度，持续前台也不会自动追赶 |
| F06 | 已确认，P2 | **部分确认** | 引擎状态控制流已复现；Settings 的真实 UI 时序未跑浏览器 |
| F08 | 已确认，P2 | **确认** | 非法业务枚举进入解码对象，备份校验随后拒绝该对象 |

## 2. F01：备份恢复与在途同步竞态

### 2.1 独立复现结果

相关代码：`src/services/backupService.ts:239-255`、`src/db/repositories/backupRepository.ts:46-71`、`src/features/sync/syncEngine.ts:99-216`、`src/services/syncService.ts:298-335`。

| 场景 | 隔离方法 | 实际结果 |
|---|---|---|
| pull 已发出，随后恢复 ZIP | 让 `engine.run()` 的 pull 等待闸门；调用 `restoreFromPayload()`；先观察恢复结果，再释放旧响应 | 恢复后本地为 `restored-new`、`enabled=false`、游标为 0；旧响应返回后变为 `remote-old`，游标变为 1；run 仍返回 `ok=true` |
| push 请求进行中，随后恢复 | 在假 fetch 收到 push body 后暂停响应；此时恢复另一份数据 | push body 已经带着恢复前的旧载荷发出；恢复后本地数据仍在，但一个真实服务端若已接受该请求，云端旧写入无法由本地 `disable()` 撤销 |
| 恢复后的同步状态重置失败 | 运行时让 `clearQueue()` 抛错 | `restoreFromPayload()` 仍完成业务表替换；旧 secret、`enabled=true`、旧游标和旧 outbox 可以留下。当前 `catch` 会吞掉这个异常，且不会继续调用 `disable()` |
| 重新配对过程中旧 pull 返回 | 旧引擎等待 pull；执行 `commitJoin(..., 'cloud')` 清空本地并启用新凭据；再释放旧响应 | 旧响应被写入新配对会话；新设备被加入一条旧 pull 的物品，游标也被推进到 1 |
| 多标签页并行 | 同一个内存 IndexedDB 造两个独立 `SyncEngine` 对象，各自暂停 pull；恢复后同时释放 | 两个引擎都能把旧数据写回。它们各自拥有 `inFlight`，没有跨标签页的互斥或失效信号 |

这些复现使用的是内存数据库和假网络；它们证明当前代码的时序行为，不证明线上已经发生过事故。

### 2.2 真实触发条件与影响

必须同时满足“旧同步已经读取凭据并发出请求”和“恢复、关闭或重新配对改变了本地数据/会话”。最典型的是网络慢、用户在设置页确认恢复、旧 pull 延迟返回。

已确认的影响：

- 旧 pull 可以覆盖刚恢复的本地业务数据。
- 旧 pull 可以把游标写到新会话，导致新配对从错误位置开始拉取。
- 旧 push 即使在本地恢复之后才返回，也可能已经改变云端；本地取消不能回滚服务端事务。
- 恢复的 `clearQueue()` 和 `disable()` 是分步操作，后一步失败会留下“业务数据已经替换、同步仍旧有效”的半状态。

需要收窄的一点：现有代码按 outbox **条目 ID** 检查 V1/V2，已经降低了“旧响应直接删除新 V2 条目”的风险；本轮没有把“新 outbox 必然被旧响应删除”作为已证实结论。真正已证实的是旧业务写回和游标错误推进，以及重置失败后的状态不一致。

### 2.3 最小修复方案

建议先做本地会话栅栏，不引入状态管理框架：

1. 在 `syncState` 增加非索引的 `sessionEpoch`（或同义字段），旧数据缺失时按 0 读取；恢复、关闭、重新配对和凭据替换都在本地事务中递增它。
2. `run()` 开始时捕获代次、设备 ID 和 key ID。旧请求返回后，在出队、应用远端批次和推进游标的事务内再次检查代次；不一致就放弃该轮的本地副作用，不能只依赖 `abort()`。
3. 备份恢复把业务表替换、清 outbox、关闭同步、重置游标/错误状态放进同一个 Dexie 事务。`commitJoin('cloud')` 和 `commitJoin('local')` 使用同一套失效规则；不能只修 `restoreFromPayload()`。
4. 跨标签页正确性依靠 IndexedDB 中的代次检查；`BroadcastChannel` 如需加入只能用于提醒/加快取消，不能作为唯一正确性保障。

这个方案能阻止旧响应写入本地新会话，但不能撤销已经被 Worker 接受的旧 push。若产品要求“恢复开始后云端也绝不接受旧写入”，需要后续增加服务端操作代次/栅栏，或在恢复前等待所有在途 push 完成；这不是本地 `abort()` 能保证的事情。

### 2.4 兼容、测试、风险与建议

- 数据迁移：`sessionEpoch` 是非索引字段，现有 Dexie schema 不需要升级迁移；旧行读取时补默认值即可。若选择新表或索引，才需要单独评估 schema 版本。
- 永久回归：延迟 pull 恢复、延迟 push 恢复、恢复/重新配对中途失败、旧代次不能推进新游标、恢复后新 outbox 不被旧响应处理、两个引擎对象共享数据库的测试。
- 回归风险：中高。事务表集合、配对流程和同步引擎都会触及，但正常本地 CRUD 不应等待网络。
- 回退方案：先保留旧恢复入口，新增代次逻辑只在同步状态存在时启用；若验收失败，回退该批代码即可，不需要回滚用户业务表或 schema。
- 是否现在处理：**是，第一批只处理 F01 及其回归测试**。它是恢复、关闭、换机三个破坏性边界的共同基础。

## 3. F02：异常 HTTP 200 响应

### 3.1 独立复现结果

相关代码：`src/features/sync/syncTransport.ts:121-152,201-242`、`src/features/sync/syncEngine.ts:133-166,185-203`、`worker/index.ts:183-224`、`worker/pushPipeline.ts:144-209`。

在有一个本地 item outbox 的情况下，假 fetch 返回下列 push body：

| 响应 | 当前结果 |
|---|---|
| HTTP 200 + HTML | `ok=true`、`pending=0`、无错误 |
| HTTP 200 + 空内容 | `ok=true`、`pending=0`、无错误 |
| HTTP 200 + `{}` | `ok=true`、`pending=0`、无错误 |
| `accepted:'bad'`、`acceptedIds` 非数组等非法回执 | `ok=true`、`pending=0`；`pushed` 变为 `NaN`（序列化显示为 null） |
| 形状正确的 tombstone ignored | `pending=0`。这可能是合理的终结语义，但当前代码没有证明是哪一条被终结 |
| 非法 dedup 指令 `kind:'not-supported'`，指向本地存在的 tag | outbox 被清掉，tag 被本地删除；`kind` 未校验 |

pull 侧也存在独立问题：

- HTTP 200 + HTML/空内容被当作空页，`ok=true`，游标不变且没有错误提示。
- `changes:[null]` 会进入引擎并抛异常；结果是 `ok=false, errorKind='unknown'`，但 `lastError` 仍为 null，因为兜底 catch 没有给局部 `errorKind` 赋值。
- 合法形式的 change 加 `nextRevision:'not-a-number'` 时，结果仍为 `ok=true`，游标可写成 `NaN`。
- `hasMore=true` 且 `nextRevision` 不大于当前游标时，假服务端连续收到重复 pull；本轮测试在第 4 次人为返回离线才停止。真实响应若一直如此，可能持续请求到超时。

### 3.2 哪些情况会误删 outbox

`SyncTransport.push()` 只看 HTTP 状态码；JSON 解析失败时 `data=null`，仍返回成功对象。随后 `SyncEngine` 只用“本批条目当前是否还在队列”决定 `dequeue`，完全没有使用 `acceptedQueueIds`。因此，只要 HTTP 是 200，即使没有任何明确成功确认，本批仍可能整体出队。

还有一个协议不一致：Worker 的 `pushPipeline.ts:178` 把 `change.entityId` 放进 `acceptedIds`；客户端在 `syncTransport.ts:215` 把它命名为 `acceptedQueueIds`。它们不是同一种 ID，且客户端当前没有使用它。若以后直接按这个字段删除，会在同 ID 跨实体或混合回执时产生新的错删风险。

正常 ignored/dedup 不应被简单地无限重试，但也不能与“响应无法确认”混为一谈：

- `accepted`：只有回执明确指向本批某个条目时才出队。
- `ignored`：只有原因属于已定义的终结原因，并且指向准确条目时才出队；非法实体应进入可诊断的失败/隔离路径。
- `dedup`：只有指令形状、重复 ID、规范 ID 都合法，且本地合并事务完成后，才清除原 tag 条目。
- 缺字段、类型错误、游标不合法：保留 outbox，不推进游标，不显示成功。

### 3.3 最小修复方案、兼容与测试

最小完整方案是“端点级严格校验 + 精确回执”，而不是只给 `JSON.parse` 加异常分支：

1. `SyncTransport` 区分网络失败、JSON 解析失败和协议校验失败；push、pull、status 各自校验必需字段、数字范围、布尔值和数组成员。
2. push 请求给每条变更带一个 outbox 条目 ID，Worker 原样回传每条的 accepted/ignored/dedup 终结结果；或者至少回传不可歧义的 `(entity, entityId)`。不能继续把实体 ID冒充 outbox ID。
3. 引擎只按明确的每条终结结果出队；批次中未确认的条目继续保留。非法 dedup 指令不得触发本地 tag 删除。
4. pull 要求 revision 为有限非负整数、页内严格递增、`nextRevision` 不倒退且 `hasMore` 时必须前进；空页只能返回当前游标。验证失败时不 apply、不推进游标。
5. 引擎在 pull 失败或兜底异常时不得调用 `markSynced`；catch 要把未知错误写入可等待的错误状态。

数据迁移：本地表不需要迁移。兼容风险在 Worker/客户端协议，需要同源部署时先让服务端兼容新旧回执，或在客户端和 Worker 一起发布；不能只升级一端后依赖默认空数组。

永久回归至少包含：四种 200 损坏 body、字段缺失/类型错误、accepted/ignored/dedup 混合批次、非法 dedup 不改本地 tag、pull 非法游标/不前进游标、坏页不清 outbox、不推进 cursor，以及 Worker fetch→内存 D1 的真实响应装配测试。

风险中等，主要是协议字段和旧 Worker 的兼容；建议在 F01 之后立即处理，**不与 F03 的分类语义放在同一个补丁**。

## 4. F03：跨设备分类树成环

### 4.1 独立复现结果

相关代码：`src/db/repositories/categoryRepository.ts:58-84`、`src/domain/categoryTree.ts:18-35`、`src/features/sync/syncEngine.ts:481-496`、`worker/syncLogic.ts:86-107`、`worker/pushPipeline.ts:144-180`、`src/domain/backup.ts:411-438`。

复现步骤：

1. 初始 A、B 都是根分类。
2. 设备甲离线把 A 移到 B 下；设备乙离线把 B 移到 A 下。两边各自调用 `wouldCreateCycle()` 都返回 false，因为本地看到的另一节点仍是根。
3. 把两条更新依次交给真实 `executePush()` 和内存 SQLite。
4. 再把两条 remote change 交给真实 `SyncEngine.applyRemote` 路径。

实际结果：

- Worker 第一次接受 A→B，第二次接受 B→A；两条记录都为 `accepted=1`，数据库最终确实是 A.parentId=B、B.parentId=A。
- 客户端把两行持久化为循环关系；`childrenOf(categories, null)` 返回 0 个根。
- `CategoriesPage` 和 `CategoryManagePage` 都从根开始渲染，因此常规分类入口为空。物品行没有被删除，物品总列表仍可查；知道分类 ID 时，详情深链仍可能显示该分类，故“不可访问”应理解为正常树入口不可发现，而不是数据库物品全部消失。
- `validateBackupData()` 目前也接受这个循环备份；它只做行结构检查。

这次复现是真实 Worker push pipeline + 内存 SQLite 和真实客户端 apply，但不是 Cloudflare D1 或两个真实浏览器的联网实验。

### 4.2 服务端与客户端应各自守什么

- 客户端 `categoryRepository.move()` 继续做即时校验，给用户清楚的错误；它只能保证本地当下的快照。
- 服务端是合并后的权威点，必须在同一串行写入逻辑中维护全局分类图约束，否则每个客户端都合法也无法避免组合成环。
- 客户端的远端 apply 和备份校验应作为第二道防线：收到会形成环的远端数据时不能直接写入并推进游标；备份导入可以在写入前拒绝整个包。
- 数据库外键不能表达任意深度的无环约束，不应为了这个问题引入通用 ORM 或全局状态层。

### 4.3 两种最小策略比较

| 策略 | 做法 | 兼容性 | 收敛性 | 数据风险 |
|---|---|---|---|---|
| A. 服务端拒绝成环更新（推荐第一步） | Worker 在串行处理 category 更新时检查候选父链；若成环，不写该条，返回 `category-cycle` 及权威的当前分类值/冲突信息 | 需要新增明确的 ignored/conflict 回执；旧客户端若只清 outbox 会留下本地环，因此必须配合权威值回传或下一次 pull | 服务端按到达顺序保留一条，客户端应用同一个权威结果后可收敛 | 一次移动会被拒绝，记录本身不丢；不会无提示地重写整棵树 |
| B. 服务端确定性修正 | 先按固定全序选择胜出的父边，另一条父边置根，并产生可拉取的修正 revision | 对数据更主动，旧客户端可能短暂看到不同结构；需要额外修正回执 | 若规则只依赖完整服务端状态且所有设备都拉到修正，可收敛 | 用户的一次移动会被系统改成另一种结构；需要处理既有环和修正回环 |

不建议只在客户端发现环后随意断开父边：服务端仍会保存环，其他设备还会继续拉到不同结果。也不建议在没有数据语义、冲突记录和迁移方案前自动重写全部分类结构。

推荐先采用策略 A。它是最小改动，也最容易解释“谁的移动被拒绝、为什么”。如果产品将来要求两边移动都尽量保留，再单独论证策略 B 的确定性规则。

### 4.4 兼容、测试、风险与建议

- 数据迁移：没有 schema 迁移，但已有云端/本地环不能因为新增校验就凭空消失。上线前要有只读检测；如何处理已存在的环必须另行决定，未决定前宁可报告并阻止继续扩散，不要静默断边。
- 永久回归：两设备相反移动；同一 pull 页内成环；跨 pull 页成环；服务端拒绝后的客户端权威值处理；远端异常分类不推进游标；备份导入拒绝环且数据库不变。
- 风险：中等偏高，风险不在代码量，而在“拒绝哪一次用户操作”的产品语义。策略 A 比自动修正更容易回退。
- 是否现在处理：**是，但排在 F01/F02 之后**。先把响应终结语义固定，再加入 category-cycle 的明确结果，避免两个协议变化同时发生。

## 5. 关联问题 F04/F05/F06/F08 的复审

| 问题 | 独立结论 | 实际触发与影响 | 与 P1 的关系 | 最小处理、迁移、回归与时机 |
|---|---|---|---|---|
| F04 删除标签无 dirty | **确认** | `tagRepository.delete()` 的事务会写 delete outbox，但没有调用 `markSyncDirty()`；隔离复现为通知 0、队列仍有 delete。只删除标签且无其他事件时会延迟上传，不是队列立即丢失 | 共享 outbox 和 dirty 总线，不共享恢复会话或 Worker 协议 | 在事务成功后补一次通知；事务失败不通知。改 `tagRepository.ts`，加通知/失败测试。低风险，近期小批处理 |
| F05 飞行中改动无尾随调度 | **确认** | V1 push 暂停期间保存 V2，debounce 到期看到 `inFlight` 后直接放弃；隔离结果为 push 次数 1、V2 pending=1。云端会落后到下一次手动/前台/网络事件 | 共享 `SyncEngine.inFlight`、`localChangeDebounce` 和 `syncService` 调度；不需要改 Worker | 在统一调度处记录“运行中又变脏”，当前轮结束后最多补跑一次；失败/离线不自旋。改 `syncService.ts`/调度测试，保留互斥。中风险，F01 后处理 |
| F06 结果/错误在 UI 前被丢弃 | **部分确认** | `SyncContext.syncNow()` 等待 `run()` 却不检查 outcome；Settings 成功 toast 只看 Promise 是否抛错。`changes:[null]` 复现为 outcome unknown 但 `lastError=null`。未做真实浏览器 toast 验收 | 共享 `run()` 的 outcome、`markSynced/markError` 和设置页；与恢复事务分开，不能用“静默”代替成功 | 让 `syncNow()` 返回/判断 outcome；只有完整成功才提示完成；兜底错误写入并等待，pull 失败不 markSynced。改 `SyncContext.tsx`、`SettingsPage.tsx`、`syncEngine.ts` 及跨层测试。中低风险，F02 后处理 |
| F08 同步解码不守业务契约 | **确认** | `decodeItemPayload()` 把任意字符串断言为 status/sourceType/disposalMethod；非法 status=`broken` 能进入本地 Item，备份校验随后报 `items[0].status 无效`。Worker 入口也只检查 changes 是数组 | 与 F02 同属不可信远端输入，但一个是 envelope/回执，一个是业务 payload；混在一批会放大回归面 | 复用已有枚举/生命周期规范化，非法已知字段拒绝或隔离，保留未知未来字段兼容；Worker 至少校验 envelope。无本地迁移，需旧客户端兼容策略。中风险，F02 后单独处理 |

### 5.1 F07-F15 的证据复核结论

本轮没有重新做全仓扫描；只检查第一轮提供的证据是否与当前 HEAD 的代码/测试范围冲突。未发现冲突。

| 问题 | 结论可信度 | 本轮判断 | 是否现在处理 |
|---|---|---|---|
| F07 共享空间认证失败锁定 | 确认 | `failures` 以 keyId 计数且在校验 token 前锁定；属于 Worker 可用性问题，不与本地 P1 共用状态 | 暂缓；除非威胁模型要求更细粒度限流 |
| F09 PWA guard 漏分类/标签/恢复 | 部分确认 | 调用点缺失已由源码证明，未做真实 SW/UI 时序 | 近期独立处理，不塞入同步 P1 |
| F10 缺失与加载中共用 undefined | 确认 | hook 返回值与页面分支使“不存在”分支不可达 | 小修，可独立处理 |
| F11 大额非整元金额显示四舍五入 | 确认 | 纯 formatter 边界可直接复现；不影响数据库金额 | 小修，可独立处理 |
| F12 Dialog 缺少模态语义/焦点 | 确认实现缺失 | DOM/键盘设备表现未复验，但共享组件确实没有语义和焦点逻辑 | 近期独立处理 |
| F13 架构文档与实现不一致 | 确认 | 第一轮的源码对照仍成立 | 文档批次处理，不和数据修复混合 |
| F14 跨层/真实入口回归缺口 | 确认 | 完整 658 项通过仍没有覆盖恢复竞态、损坏 200、真实 UI；v1→v4 和 fetch→D1 入口也需单独钉住 | 随对应修复补，不单独建立大测试平台 |
| F15 未接线策略/旧 helper | 确认 | 第一轮的引用与控制流证据足够 | 暂缓清理，避免误删兼容导出 |

## 6. 推荐实施顺序与文件边界

### 批次 1：F01，会话失效与恢复原子性

只触及本地同步/恢复边界：

- 实现边界：`src/domain/types.ts`、`src/db/repositories/syncRepository.ts`、`src/db/repositories/backupRepository.ts`、`src/services/backupService.ts`、`src/services/syncService.ts`、`src/features/sync/syncEngine.ts`。
- 测试边界：`src/features/sync/syncEngine.test.ts`、`src/services/backupService.test.ts`、`src/services/syncService.test.ts`、必要时新增现有目录下的恢复/状态回归测试，但本轮不新增。
- 不触及：Worker 协议、分类冲突语义、页面视觉、PWA、依赖和数据库索引。
- 验收：旧 pull/push 完成后不能改写恢复数据或新会话游标；恢复和换机流程失败不留下半状态；普通本地保存不等待网络。

### 批次 2：F02，严格响应和精确 outbox 终结

- 实现边界：`src/features/sync/syncTransport.ts`、`src/features/sync/syncEngine.ts`、`worker/pushPipeline.ts`、`worker/index.ts`。
- 测试边界：`syncTransport.test.ts`、`syncEngine.test.ts`、`worker/workerPushAssembly.test.ts`，增加 Worker→客户端响应契约测试。
- 不触及：分类树的选边规则、UI 提示文案重做。
- 验收：所有损坏 200 保留 outbox；合法 ignored/dedup 不无限重试且只影响明确条目；pull 坏页不推进游标；协议字段没有实体 ID/outbox ID 混淆。

### 批次 3：F03，服务端分类图约束

- 实现边界：`worker/syncLogic.ts`/`worker/pushPipeline.ts` 的分类候选检查、`src/features/sync/syncEngine.ts` 的防御性 apply、`src/domain/backup.ts` 的备份图校验。
- 测试边界：Worker 内存 SQLite、`syncEngine.test.ts`、`domain/backup.test.ts` 和分类树测试。
- 不触及：全量分类重写、CRDT/OT、客户端单独“猜测”哪条边应删除。
- 验收：两设备相反移动有明确终结结果；服务端和客户端最终都能得到同一无环图；已有环的处理先报告/阻止，不能静默丢分类。

### 批次 4：低风险同步补强

按小批次分别处理 F04、F05、F06、F08。F04 可以单独一小改动；F05/F06 共享调度和结果链，但仍应保持同一补丁内的文件范围可读；F08 不要和 F01 的事务改造混在一起。

### 批次 5：页面、文档和测试缺口

再处理 F07/F09-F15 中真正有需求的项目。F10/F11/F13 成本低；F12 需要键盘/读屏验收；F14 的测试应随真实修复补，不以“增加数量”为目标。

## 7. 必须保留的架构与数据不变量

1. 本地 Dexie 仍是业务真相；网络同步是后置镜像，不能阻塞或回滚用户本地保存。
2. 业务表和 outbox 入队继续在同一事务；网络请求不能进入 Dexie 事务。
3. 恢复是 Replace Restore：解析校验阶段不写库，业务替换原子完成，ZIP 不携带 secret、syncState、syncQueue 或冲突表。
4. 旧请求只能清理它自己明确确认的 outbox 条目；V1/V2 的新条目必须保留。
5. 游标只在完整、合法且已应用的 pull 页之后推进，不能用“HTTP 200”代替成功确认。
6. Worker 的 revision 分配、记录写入和 tombstone 防线继续保持在同一 D1 batch/SQL 约束中。
7. 分类图必须无环；修复不能物理删除分类或关联物品，也不能在没有可解释规则时批量改父级。
8. 标签物理删除的 tombstone、物品标签关联清理和唯一名称约束不能被协议修复破坏。
9. 现有浏览器隔离规则继续有效：如需真实浏览器验收，只使用项目 launcher 和项目本地 profile。

## 8. 不建议现在做的事情

- 不引入全局状态框架、CRDT/OT、通用 repository 基类、DI 容器或新的 shared package。
- 不用 `AbortController` 单独宣称解决 F01；它不能撤销已经到达服务端的请求。
- 不把客户端发现的分类环随意断开，也不在没有既有数据策略前自动重写整棵树。
- 不以“所有 ignored 都重试”解决 F02；那会制造无限重试；也不以“所有 200 都成功”保住现状。
- 不为 `sessionEpoch` 仅仅增加索引或新 schema 版本；非索引字段已有兼容读取方式。
- 不先清理 F15 的旧接口，不把文档更新、视觉重做和 P1 数据边界塞进同一批。

## 9. 最终结论

**项目可以进入代码修复阶段。第一批只应修复 F01：为恢复、关闭、重新配对建立持久化会话失效栅栏，把业务替换、outbox 清理和同步状态重置做成原子边界，并同步加入延迟 pull/push、失败和多引擎回归测试。**

这样安排的原因是 F01 是最危险的破坏性边界，且能先保护后续修复不被旧请求干扰；F02 虽然实现较小，但涉及 Worker/客户端协议，应作为第二批单独验收；F03 还需要明确用户数据语义和既有环处理政策，排在协议稳定之后。F04-F06/F08 不应被忽略，但不需要用一个“大同步重构”来处理。

本轮没有修改任何产品代码、测试、配置、依赖或第一轮报告，也没有开始第三轮修复。

风险提示：以上结论来自当前 HEAD 的内存/隔离复现；Cloudflare D1 的真实部署行为、真实多标签页和移动端生命周期仍需在代码修复后按项目安全规则验收。
