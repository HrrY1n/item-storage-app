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
-- revision 用 INTEGER PRIMARY KEY AUTOINCREMENT：
--   - rowid 本身就是索引，零额外存储与零额外 rows written
--   - 单调递增且不复用 → 天然是全局游标
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_records (
  -- 全局单调游标。客户端 lastPulledRevision 指向"已应用到这里"
  revision          INTEGER PRIMARY KEY AUTOINCREMENT,

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
-- ③ 认证：只存 secret 的 SHA-256 哈希
--
-- ⚠️ 绝不存明文secret。D1 一旦被完整泄漏，攻击者也无法直接登录。
--
-- 为什么不做 PBKDF2 / scrypt / argon2 拉伸：
-- 那些算法是给**低熵人类密码**用的。本方案的 secret 是 256-bit 全随机
-- （熵 190+ bits），熵已足够；再拉伸只是白白拖慢每次请求，
-- 而 Workers 免费版 CPU 限 10ms/invocation，拉伸有超时风险。
--
-- 每个设备一个 key_id，便于单独吊销（revoked_at）。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_auth (
  -- 公开标识，**不是秘密**。写在 URL 里也无所谓（但我们仍不放）
  key_id      TEXT PRIMARY KEY,

  -- hex(SHA-256(secret))。服务端用**常数时间比较**比对。
  secret_hash TEXT NOT NULL,

  created_at  TEXT NOT NULL,

  -- 非空即已吊销。吊销某台设备不影响其他设备。
  revoked_at  TEXT
);


-- =====================================================================
-- 执行后的校验（可选，在 Console 里跑一次看看结果）
--
-- 应看到 3 个表：
--   SELECT name FROM sqlite_master WHERE type='table'
--     ORDER BY name;
--   → sync_auth, sync_records, sync_revision_seq
--
-- 计数器初始值：
--   SELECT revision FROM sync_revision_seq WHERE id = 1;
--   → 0
--
-- 索引确认（应只有 UNIQUE(entity, entity_id) 一个二级索引）：
--   PRAGMA index_list(sync_records);
--
-- ⚠️ 每个索引都会让一次写入**多算 1 rows written**（Cloudflare 官方说明），
--    所以索引刻意保持克制：主键 + 1 个 UNIQUE，没有别的。
--    tag 去重要用的 nameNormalized 无法用普通索引覆盖
--    （它在 JSON 里），而 tags 表规模远小于 items，
--    扫小表在个人使用量级下完全可接受。
-- =====================================================================