-- =====================================================================
-- Phase 3B · 跨设备同步 —— D1 初始 schema
--
-- 由用户在 Cloudflare Dashboard → Storage & Databases → D1
-- → 选中数据库 → Console → 粘贴本文件内容 → Execute 执行。
-- 不需要 wrangler 命令行认证。
--
-- 设计依据：docs/PHASE_3A_SYNC_DESIGN.md §6
-- 实施计划：docs/PHASE_3B_IMPLEMENTATION_PLAN.md §4
--
-- ⚠️ 全部语句使用 IF NOT EXISTS / OR IGNORE，可重复执行安全。
-- ⚠️ D1 里存的是**同步状态**，不是业务数据库 —— 没有 items 这类表，
--    所有业务计算永远发生在设备本地 Dexie 上。
-- =====================================================================


-- ---------------------------------------------------------------------
-- ① 变更日志：同步的唯一真相
--
-- 每个实体在这里只保留**最新一行**（UNIQUE(entity, entity_id)），
-- 于是 pull 就是「拉revision > 游标」这一条有序查询。
--
-- revision 用 INTEGER PRIMARY KEY（即 rowid 的别名）：
--   - rowid 本身就是索引，零额外存储与零额外 rows written
--   - ⚠️ **刻意不用 AUTOINCREMENT**（实测确认）：显式赋值后它仍会推进sqlite_sequence，
--     既污染出 sqlite_sequence 表，也让"revision 完全由我们控制"不直观。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_records (
  -- 全局单调游标。客户端 lastPulledRevision 指向"已应用到这里"
  revision          INTEGER PRIMARY KEY,
  -- 实体种类：'item' | 'category' | 'tag'
  -- 刻意**不含** assets（照片/AI 图标二进制不做同步）与 appMeta（纯本地状态）
  entity            TEXT    NOT NULL,

  -- 实体 id（ULID）
  entity_id         TEXT    NOT NULL,

  -- 该实体的最新快照（JSON 文本）
  -- 只含业务字段；items 内聚 tagIds，故 itemTags 表本身不需要同步
  payload           TEXT    NOT NULL,

  -- 墓碑。非空即已删除。
  -- ★ 删除单调不可逆的载体：对已 tombstone 的记录，服务端一律拒绝
  --   复活写入（除显式 undeleteIntent），这是"旧设备不能复活已删数据"的关键。
  deleted_at        TEXT,

  -- 设备侧的 updatedAt，**仅作审计记录，不参与任何排序**
  -- （排序权威是服务端 revision —— 设备时钟可被修改、可漂移）
  client_updated_at TEXT    NOT NULL,

  -- 谁写的。冲突可查时作为胜方标识
  device_id         TEXT    NOT NULL,

  -- 每实体只保留最新一行 ★ 这是「无日志膨胀」的关键
  UNIQUE (entity, entity_id)
);


-- ---------------------------------------------------------------------
-- ①-b tag 规范化名的**部分唯一索引**（并发去重的最终保证）
--
-- 问题：nameNormalized 存在 JSON payload 里，靠"先查后写"去重时，
--   两台设备**真正同时**创建同名 tag 会各自看到"不存在"，然后各自写入 →
--   数据库层出现重复。本索引让数据库本身拒绝这种重复。
--
-- 为什么是「部分」索引（WHERE entity='tag' AND deleted_at IS NULL）：
--   · 只约束活跃的 tag —— 已删除的 tag 不该继续占用这个名字
--     （用户删掉 #Apple 后应能重新创建同名标签）
--   · 不约束 item/category 行 —— 它们的 payload 里没有 nameNormalized，
--     若参与索引会让无意义的 NULL 互相冲突
--
-- 索引冲突如何处理：Worker 把该条转为 dedupDirective（合并指令），
-- 客户端在自己的事务里把引用迁到既有 id、删掉自己那份。
--   → 用户看到的是「两个 #Apple 变成一个」，而不是同步失败。
--
-- ⚠️ 代价：索引会让每次 tag 写入**多算 1 rows written**（官方规则）。
--   个人使用下 tag 变更极少，这个代价可以忽略。
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_tag_normalized
  ON sync_records (json_extract(payload, '$.nameNormalized'))
  WHERE entity = 'tag' AND deleted_at IS NULL;


-- ---------------------------------------------------------------------
-- ② 全局 revision 计数器
--
-- 为什么不用 AUTOINCREMENT 自增：那样每条记录单独分配 revision，
-- 无法保证一次 push 的多条记录拿到**连续**的 revision 区间。
-- 客户端 push 响应里回传 currentRevision 作为新游标，
-- 若两条记录 revision 不连续，客户端推进游标就会漏掉中间那条。
--
-- 做法：push 起始时把计数器按本批条数 +1，取回末值，
-- 本批所有记录共用这段区间。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_revision_seq (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL
);

INSERT OR IGNORE INTO sync_revision_seq (id, revision) VALUES (1, 0);


-- ---------------------------------------------------------------------
-- ③ 认证：单用户 · 单同步空间 · 一个共享 secret
--
-- Phase 3B 第一版的信任模型（刻意简化）：
--   · 整个数据库**只有一个**同步空间
--   · 两台设备**共享同一个** secret
--   · 因此**不提供**"单独吊销某台设备"的能力
--     （两设备共享凭据，吊销一台等于吊销全部）。per-device token 留后续 Phase。
--
-- ★ 单空间这个不变量由 **schema 表达**，不依赖代码约定：
--   id INTEGER PRIMARY KEY CHECK (id = 1) 保证最多只能有一行，
--   第二次 INSERT 必然违反 CHECK → Worker 返回 409。
--
-- ⚠️ 绝不存明文 secret。D1 一旦被完整泄漏，攻击者也无法直接登录。
--
-- 为什么不做 PBKDF2 / scrypt / argon2 拉伸：
-- 那些算法是给**低熵人类密码**用的。本方案的 secret 是 256-bit 全随机
-- （熵 190+ bits），熵已足够；再拉伸只是白白拖慢每次请求，
-- 而 Workers 免费版 CPU 限 10ms/invocation，拉伸有超时风险。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_auth (
  -- ★ 固定为 1：既是主键又是一个 CHECK 约束 —— 任何 INSERT 都必须写 1，
  --   于是**最多只能存在一行**。第二台设备无法创建新空间。
  id           INTEGER PRIMARY KEY CHECK (id = 1),

  -- 公开标识，**不是秘密**。仅用于日志与将来扩展，本版不做吊销。
  key_id       TEXT NOT NULL,

  -- hex(SHA-256(secret))。服务端用**常数时间比较**比对。
  secret_hash  TEXT NOT NULL,

  created_at   TEXT NOT NULL
);


-- =====================================================================
-- 执行后的校验（可选，在 Console 里跑一次看看结果）
--
-- 应看到 **4** 项：3 张业务表 + SQLite 自动创建的 `sqlite_sequence`
--   SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
--   → sqlite_sequence, sync_auth, sync_records, sync_revision_seq
--
-- ⚠️ `sqlite_sequence` 由 SQLite 自动维护，**只要用了 AUTOINCREMENT 就会存在**。
--   本schema 刻意不用 AUTOINCREMENT（revision 由 sync_revision_seq 显式分配），
--   但 D1 可能在某些路径下自行创建该表 —— 看到它属正常，不是建表出错。
--   校验时只需确认 **3 张业务表都在**即可。
--
-- 计数器初始值：
--   SELECT revision FROM sync_revision_seq WHERE id = 1;
--   → 0
--
-- 索引确认（应有 2 个二级索引：UNIQUE(entity,entity_id) + tag 规范化名唯一索引）：
--   PRAGMA index_list(sync_records);
--
-- ⚠️ 每个索引都会让一次写入**多算 1 rows written**（Cloudflare 官方说明），
--    所以索引刻意保持克制：主键 + 1 个 UNIQUE，没有别的。
--    tag 去重要用的 nameNormalized 无法用普通索引覆盖
--    （它在 JSON 里），而 tags 表规模远小于 items，
--    扫小表在个人使用量级下完全可接受。
-- =====================================================================