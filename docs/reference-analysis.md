# 参考项目分析（Phase 0 调研结论）

> 调研日期：2026-10-03
> 调研方式：只读访问 GitHub 公开仓库（README / package.json / 目录结构 / 核心源码 / LICENSE），未复制任何代码。
> 需求基线：《私人数字物品库 PRD v1.0》。参考项目只是材料，PRD 才是需求来源。

---

## 一、总览对比表

| 项目 | 值得借鉴 | 不应借鉴 | 对本项目的具体应用 |
|------|---------|---------|------------------|
| **sysadminsmedia/homebox**（Go + Vue/Nuxt，AGPL-3.0） | ① Item / Label / Location 的职责划分思路：Item 多对一归属一棵树、多对多挂扁平标签——正好对应我们的「分类树 + 标签」分工；② 信息层级克制：列表页只展示名称+缩略图+归属，详情页才展开全部字段；③ 导入导出作为一等公民功能 | Location 树、Household、多用户、Docker/Server、保修/价格/购买跟踪、自定义字段、Meilisearch 全文检索。**AGPL-3.0 许可证：只能参考概念，禁止复制任何代码** | 把 HomeBox 的「Location 树」概念换成我们的「Category 分类树」；把它的「Label 扁平多对多」直接对应我们的 Tag；详情页信息分层方式照此思路重新实现 |
| **jymtop/wardrobe**（已迁移至 Mini-Bai-Jeremy/wardrobe；React 19 + TS + Vite 7 + Tailwind 3 + Dexie 4 + vite-plugin-pwa + Framer Motion，README 声明 MIT 但仓库无 LICENSE 文件） | ① 技术栈与本项目几乎完全一致，验证了可行性；② `src/lib/db.ts` 的 Dexie 封装：单 DB 类 + 操作对象（getAll/getById/add/update/delete/按索引查询）；③ `storage.ts` 的导出/导入模式：版本字段 + 逐项校验 + 默认值迁移 + replace/merge 两种模式 + 备份时间提醒；④ Canvas 图片压缩（上传前压缩到 maxWidth 800）；⑤ vite.config.ts 中 vite-plugin-pwa 的标准配置（autoUpdate、manifest、maskable icon、workbox globPatterns） | Base64 图片直接存 IndexedDB（大图会撑爆且拖慢查询，我们必须用独立 Asset 表存 Blob）；统计图表（Recharts Dashboard）；3D 衣柜门动画（过度设计）；樱花粉主题（不符合我们的克制视觉）；把购买价格/穿着频率塞进 Item 模型 | 迁移其「Dexie 单例 + repository 操作对象」模式、`exportData/importData/mergeData` 结构、导入校验函数写法、图片压缩工具、PWA 配置骨架——全部按本项目数据模型重写 |
| **PhuCG/pwa-starter-kit**（React 18 + Vite 6 + Dexie 4 + zustand + react-router 7 + vite-plugin-pwa，**无 LICENSE**） | ① 分层契约：「repo 是唯一的 Dexie 调用方」，features/pages 不直接碰 Dexie；② `domain/` 纯 TS 业务规则层（不变量集中、全部可测）；③ manifest 必须显式设置 `id` 字段（否则改 start_url 会导致已安装应用变成"另一个应用"，IndexedDB 数据被困在旧身份）；④ `launch_handler: focus-existing`（避免两个窗口两个 Dexie 连接阻塞数据库版本升级）；⑤ `navigator.storage.persist()` 防止浏览器自动清除；⑥ 恢复备份前做全量校验、replaceAll 是唯一 awaited 的写操作（"半完成的恢复比失败的恢复更糟糕"）；⑦ 恢复对话框展示数据摘要而非只警告；⑧ 每路由一个 ErrorBoundary（已安装 PWA 没有地址栏，白屏=死胡同）；⑨ Vitest + fake-indexeddb 在 Node 环境测 IndexedDB 逻辑；⑩ `npm run check` = lint + typecheck + test 的单一质量门禁 | zustand + i18next + Biome + vaul 的完整栈对本项目偏重（单人项目无需 i18n；Biome 与主流 ESLint 二选一即可）；其主题系统（data-theme + 内联 no-flash 脚本）v1 不需要深色模式 | 吸收其架构契约而非代码：repo 唯一访问 Dexie、domain 层放分类树循环检测/标签标准化等纯函数并全部测试、manifest id、storage.persist、恢复前校验+摘要+确认、路由级 ErrorBoundary、fake-indexeddb 测试方案 |
| **asdteke/HomeInventory**（React 19 + Vite + Tailwind 前端 + Express/SQLite 后端，MIT） | ① 相机优先的移动端录入思路（我们衣物照片功能 P1 会用到）；② 批量操作、 guarded delete（非空分类删除保护）的交互思路；③ 备份恢复支持"导出前显示内容摘要" | 整个后端（Express/SQLite/JWT/OAuth/2FA）、Household 多家庭、Borrow Center、Personal Vault、QR/条码扫描、保修/发票、购物清单、维护计划、100+ 语言包——全部超出范围 | 仅借鉴「删除保护」与「恢复前摘要」的交互概念；不引入其任何架构（它是 client-server，我们是 local-first） |
| **nikamatveeva/homeos-personal-inventory**（Next.js + Supabase，MIT） | ① Home overview 的克制设计：计数 + 最近添加，没有图表看板；② 跨模块统一搜索入口；③ 移动端导航与响应式布局（公开截图证实移动端体验优秀）；④ 模块化但视觉统一的卡片组织方式 | Next.js、Supabase Auth/PostgreSQL/RLS、room/furniture/shelf 位置体系、内置 AI 助手、六个颜色编码模块（颜色编码过重，我们走统一图标路线） | 首页「最近添加 + 分类入口 + 常用标签」的排版密度参考其 Home overview；确认「不做 Dashboard 也能让首页有信息量」的产品判断 |

---

## 二、A. 我们决定借鉴的内容

1. **Dexie 分层（来自 wardrobe + pwa-starter-kit 的交集）**
   - `db/` 目录：Dexie schema 定义 + repository 对象，repository 是唯一直接调用 Dexie 的地方；
   - 纯函数业务规则（分类树循环检测、删除保护、标签 trim/标准化/去重、搜索排序）放在独立 `domain/` 层，不依赖 DOM，全部用 Vitest + fake-indexeddb 测试。

2. **备份/恢复契约（来自 pwa-starter-kit，wardrobe 佐证）**
   - 导入前对整个文件做完整校验，非法文件直接拒绝；
   - 恢复前显示数据摘要（物品/分类/标签/资产数量、导出时间、schemaVersion），用户确认后才执行；
   - 第一版只做「清空后完整恢复」，`replaceAll` 作为原子操作；保留 merge 的接口位置但不实现。

3. **PWA 工程细节（来自 pwa-starter-kit + wardrobe 的 vite 配置）**
   - `vite-plugin-pwa` + `registerType: 'autoUpdate'`；
   - manifest 显式设置 `id`、`display: standalone`、maskable 图标、`theme_color`；
   - `launch_handler: focus-existing` 避免多窗口 Dexie 连接冲突；
   - 启动时调用 `navigator.storage.persist()`；
   - 路由级 ErrorBoundary（PWA 无地址栏，白屏必须有恢复路径）。

4. **导入/导出与图片工具（来自 wardrobe）**
   - 带版本号的导出结构 + 逐项字段校验 + 导入时补默认值的迁移函数；
   - Canvas 图片压缩工具（P1 衣物照片用，P0 先实现工具本身）；
   - `lastBackupAt` 记录与备份提醒的思路（写入 AppMeta）。

5. **产品与视觉组织（来自 homebox + homeos）**
   - Item 单一主分类（树）+ 多标签（扁平多对多）——与 PRD 完全一致；
   - 列表卡片只展示：图标、名称、分类名、少量标签；其余信息进详情页；
   - 首页 = 大搜索框 + 最近添加 + 分类入口 + 常用标签，不做 Dashboard；
   - 非空分类删除保护、分类循环引用保护。

## 三、B. 明确不采用的内容

| 不采用 | 来源 | 原因 |
|--------|------|------|
| Location / room / shelf 位置树 | homebox, HomeInventory, homeos | PRD 明确不做 |
| 任何后端 / 数据库服务器 / Docker | homebox, HomeInventory, homeos | Local-first，v1.0 零服务器 |
| 账号 / 认证 / 多用户 / Household | 全部参考项目 | PRD 明确不做 |
| QR 码 / 条形码扫描 | HomeInventory | PRD 明确不做 |
| 价格 / 保修 / 发票 / 库存进销存 | homebox, HomeInventory | PRD 明确不做 |
| 统计图表 / Dashboard | wardrobe(Recharts), homebox | PRD 明确首页不做看板 |
| Base64 图片存 IndexedDB 主表 | wardrobe | 独立 Asset 表存 Blob，Item 只存 iconAssetId |
| zustand / i18next / Next.js / Supabase | pwa-starter-kit, homeos | 单人单语言项目，React 状态 + hooks 足够，减少依赖 |
| 复制任何源代码 | 所有仓库 | homebox 为 AGPL-3.0（网络 copyleft）；wardrobe 与 pwa-starter-kit 无 LICENSE 文件（默认保留版权）。只借鉴模式，全部重新实现 |

## 四、C. 本项目最终采用的设计

不是任何仓库的复制品，是按 PRD 重新组合的方案：

### 技术栈
React 19 + TypeScript + Vite 7 + Tailwind CSS 3 + Dexie.js 4 + react-router 7 + vite-plugin-pwa + Vitest（+ fake-indexeddb）。不引入 zustand / Framer Motion（v1 动画用 CSS transition 克制实现）/ Recharts / 任何后端。

### 分层架构（借鉴 pwa-starter-kit 契约，简化其栈）

```
src/
├── app/            # App 壳、路由、路由级 ErrorBoundary、BottomNav、FAB
├── components/     # 通用 UI：ItemCard / CategoryCard / TagChip / SearchBar / EmptyState / Sheet / Toast
├── pages/          # HomePage / CategoriesPage / SearchPage / ItemDetailPage / ItemEditPage / SettingsPage
├── features/       # items / categories / tags / search / icons / backup —— 页面级组合逻辑
├── db/             # Dexie schema（唯一 Dexie 入口）+ repositories + seed（默认分类树）
├── domain/         # 纯 TS：类型、分类树不变量、标签标准化、搜索排序、备份校验 —— 全部可测
├── services/       # backup（zip 打包/解包）、image（压缩）、asset（blob 存取）
├── utils/          # id（ULID）、date、debounce
└── assets/         # 预置图标（preset icons）
```

与 PRD 建议结构的差异说明：将「类型 + 业务不变量」从 `types/` + 散落各处的校验集中到 `domain/`，原因是 pwa-starter-kit 证明了「纯函数领域层 + fake-indexeddb 测试」是个人项目长期可维护性的关键，而 PRD 第十七章要求的测试（分类树循环保护、标签标准化、搜索排序、备份校验）恰好全部是纯函数，放在 domain 层可以不起浏览器就完成测试。

### 数据流契约
- 页面/组件 → hooks → repository（唯一 Dexie 调用方）→ Dexie；
- 业务规则一律调用 domain 纯函数，校验失败抛错，UI 层捕获后 Toast；
- localStorage 只存 UI 偏好（如分类页展开状态、最近使用的分类）。

### PWA 方案
vite-plugin-pwa（autoUpdate）+ 显式 manifest.id + standalone + maskable 图标 + storage.persist() + 路由级 ErrorBoundary。目标：iPhone Safari 添加主屏幕后独立启动、离线可用。

### Icon Asset Library
- Asset 独立表：Blob 存 `assets` 表（blobKey = asset id），元数据含 kind / mime / width / height / styleVersion / promptVersion / sourceAssetId / sha256；
- Item 只引用 iconAssetId，多物品可复用同一 Asset；
- v1.0 只实现 `kind: 'preset'`（随应用打包的 SVG/PNG 预置图标），数据结构保留 ai_generated / from_photo；
- 统一 Style Contract（1:1、单物体居中、浅底、轻 3D 插画感）写入 docs，作为未来 AI 生成的固定约束。

### 备份方案（P0）
导出 `private-item-library-backup-YYYY-MM-DD.zip`：manifest.json（schemaVersion / exportVersion / exportedAt / 各项数量 / sha256 校验）+ data.json（稳定字段名）+ assets/（二进制资产）。导入：解析 zip → 全量校验 → 显示摘要 → 用户确认 → 原子替换。zip 用 JSZip（单一成熟依赖）。

### 测试方案（P0）
Vitest + fake-indexeddb，覆盖 PRD 第十七章全部要求：分类树（父子创建/循环保护/非空删除保护）、标签（trim/标准化/去重）、搜索（名称/标签/分类/备注及排序优先级）、备份（export/import/schemaVersion/非法文件拒绝）。
