# 架构设计（Phase 2E 现状）

> 本文描述**当前代码的真实结构**，不是未来计划。
> 产品长期目标见 [product-goals.md](./product-goals.md)；历史决策与选型理由见 [reference-analysis.md](./reference-analysis.md)。
> 决策标准：长期可维护 > 简单 > 稳定 > Local-first > 少依赖 > 移动端体验 > 视觉精致。
>
> 现状快照：App v0.3.0 · 数据契约 schemaVersion = 2 · 备份格式 v2（兼容导入 v1）· 测试 131 项全绿。

---

## 1. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | React 19 + TypeScript + Vite 7 | |
| 样式 | Tailwind CSS 3 | 移动端优先，375 / 390 / 430px 为主要设计宽度 |
| 路由 | react-router 7 | **固定 BrowserRouter**（URL 干净；部署依赖 SPA fallback，见 §10） |
| 本地数据库 | Dexie.js 4（IndexedDB） | **只有 repository 层可直接 import `db`** |
| 响应式 | dexie-react-hooks（`useLiveQuery`） | 数据变更自动重查，页面不手动刷新 |
| PWA | vite-plugin-pwa（Workbox） | `registerType: autoUpdate`，precache App Shell |
| 测试 | Vitest + fake-indexeddb | domain 纯函数 + repository 集成测试 |
| 备份打包 | JSZip（动态 import） | 仅备份/恢复时按需加载，避免拖慢首屏 |
| ID | ulid | 可排序、URL 安全 |
| 明确不引入 | zustand / Framer Motion / Recharts / i18n / 任何后端 SDK | 见 reference-analysis.md |

## 2. 分层架构（强约束）

```
pages/            纯展示与交互编排，不允许 import db
  ↓
features/data/    hooks（useLiveQuery 封装）+ 视图模型 join
  ↓
db/repositories/  唯一允许 import db 的层；承载事务与业务不变量执行
  ↓
domain/           纯函数（无 IO、无依赖），必须有测试
```

- `db/repositories/`：item / category / tag / asset / backup 五个 repository
- `domain/`：`categoryTree` · `tagNormalize` · `searchItems` · `purchase` · `backup`
- `services/`：`backupService`（ZIP 组装与校验编排）· `pwa`（能力检测与存储持久化）
- **页面绝不直接访问 `db.items` / `db.categories` / `db.tags`**

## 3. 信息架构与路由

底部导航固定 4 项：**首页 · 分类 · 搜索 · 设置**。

| 路由 | 页面 | 导航显示 |
|---|---|---|
| `/` | 首页：大搜索框 + 最近添加 + 分类网格 + 常用标签 | BottomNav + FAB |
| `/categories` | 分类页：分类树（展开/折叠、真实物品数） | BottomNav + FAB |
| `/categories/:id` | 分类详情：含子分类的物品网格 | BottomNav + FAB |
| `/search` | 搜索页：实时搜索 + 标签筛选 + 最近搜索 | BottomNav + FAB |
| `/items/new` | 新增物品（任务流表单） | **隐藏 BottomNav / FAB** |
| `/items/:id` | 物品详情：图标、分类路径、标签、购买信息、备注 | BottomNav |
| `/items/:id/edit` | 编辑物品（任务流表单） | **隐藏 BottomNav / FAB** |
| `/settings` | 设置：备份与恢复 + 分类/标签/图标管理入口 + 关于 | BottomNav |
| `/settings/categories` | 分类管理：新增 / 重命名 / 移动 / 排序 / 删除保护 | BottomNav |
| `/settings/tags` | 标签管理：新增 / 重命名 / 合并 / 删除 | BottomNav |
| `/settings/icons` | 图标库：浏览当前资产 | BottomNav |

规则：

- FAB 只在 首页 / 分类 / 搜索（含分类详情）出现，避免设置页与表单页出现「+」
- 新增 / 编辑属于临时任务流，隐藏底部导航，防止填写中途误触离开
- 表单有未保存改动时返回 → 弹「放弃此次修改？」（继续编辑 / 放弃修改）
- 表单路由不进入 BottomNav 选中态

## 4. Dexie Schema（v2）

```ts
db.version(2).stores({
  items:      'id, categoryId, name, createdAt, updatedAt, deletedAt',
  categories: 'id, parentId, name, sortOrder, deletedAt',
  tags:       'id, &nameNormalized, createdAt',
  itemTags:   '[itemId+tagId], itemId, tagId',
  assets:     'id, kind, createdAt',
  appMeta:    'key',            // seeded / schemaVersion
})
```

要点：

- 主键均为 ULID 字符串，不用自增
- `tags.nameNormalized` 唯一索引（trim + 去 # + 大小写折叠），从数据库层保证同名标签不重复
- `itemTags` 复合主键 `[itemId+tagId]`，天然防重复关联
- soft delete：items / categories 带 `deletedAt`，所有查询默认过滤
- Asset 二进制 Blob 直接存 `assets.blob`（IndexedDB 原生支持，比 Base64 省空间且可 `createObjectURL`）
- **v1 → v2 迁移**：购买信息为非索引字段，`version(2).upgrade()` 把旧 Item 的
  `purchaseDate` / `purchasePriceCents` / `additionalCostCents` / `purchasePlatform` 补为 `null`，不破坏既有数据
- `appMeta.schemaVersion` 同步升级为 `'2'`（启动时 `upgradeSchemaVersionMeta()` 幂等修正）

## 5. 数据模型（`src/domain/types.ts`）

```ts
interface Item {
  id: string
  name: string
  categoryId: string
  note: string
  iconAssetId: string
  sourceType: 'preset' | 'ai_generated' | 'from_photo'
  // ---- 购买信息（Phase 2E，全部可选）----
  purchaseDate: string | null          // YYYY-MM-DD
  purchasePriceCents: number | null    // 整数「分」，¥1499.99 = 149999，允许 0
  additionalCostCents: number | null   // 附加花费（配件/维修/升级），整数「分」，允许 0
  purchasePlatform:                    // 全部为 null = 未填写
    | 'jd' | 'taobao' | 'pinduoduo' | 'zhuanzhuan' | 'aihuishou' | 'other'
    | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

interface Category {
  id: string; parentId: string | null; name: string; sortOrder: number
  createdAt: string; updatedAt: string; deletedAt: string | null
  iconKey?: IconKey                    // 仅用于分类图标底衬展示
}

interface Tag {
  id: string; name: string; nameNormalized: string
  createdAt: string; updatedAt: string
}

interface ItemTag { itemId: string; tagId: string }

interface Asset {
  id: string; kind: 'preset' | 'ai_generated' | 'from_photo'
  path: string | null                  // preset 图标随包路径
  blob: Blob | null                    // 非 preset 的二进制
  mime: string; width: number; height: number
  styleVersion: string | null; promptVersion: string | null
  sourceAssetId: string | null; createdAt: string
}

interface AppMeta { key: string; value: string }
```

**不包含任何 hash / 完整性校验字段**（sha256、dataSha256 等一律没有）。

## 6. 领域逻辑（`src/domain/`，纯函数，全部有测试）

### 6.1 分类树 `categoryTree.ts`
- `childrenOf(categories, parentId)`：按 `sortOrder` 取直接子分类
- `wouldCreateCycle(categories, categoryId, newParentId)`：沿父链向上检测，**阻止成为自己的父节点 / 移动到自己的后代**
- `collectSubtreeIds(categories, rootId)`：自身 + 全部后代
- `categoryPath(categories, id)`：`数码与电子 / 音频设备`

### 6.2 标签标准化 `tagNormalize.ts`
- trim → 去开头 `#` → 折叠内部空白 → 显示名保留原大小写、比较键统一小写
- `Apple` / `apple` / ` Apple ` / `#APPLE` 视为同一标签（`tags.nameNormalized` 唯一索引兜底）

### 6.3 搜索 `searchItems.ts`
四级数据源打分排序：

| 命中 | 分值 |
|---|---|
| 名称完全匹配 | 100 |
| 名称前缀 | 80 |
| 名称包含 | 60 |
| 标签 | 40 |
| 分类 | 30 |
| 备注 | 10 |

同分按 `createdAt` 新→旧；已软删物品不参与；调用方 150ms debounce；纯内存计算（1000–5000 条规模无压力），不引入搜索引擎。

### 6.4 购买信息与成本 `purchase.ts`

**全部为 derived value，不落库。**

```
totalCost = purchasePriceCents + additionalCostCents      // 两者皆 null → null
dailyCost = totalCost / ownershipDays
```

- `calculateTotalCostCents(price, additional)`：都为 null → null（信息不足不显示 ¥0.00）；只填其一 → 取该值；负数/非有限 → null
- `calculateOwnershipDays(purchaseDate, today?)`：**按日历日计算**，把 `YYYY-MM-DD` 转 UTC 日序号相减（不用毫秒差，避免时区偏一天）；含购买当天（今天买 = 1 天，昨天买 = 2 天）；跨月/跨年/闰年正确；未来或非法日期 → `null`（不抛错）
- `calculateDailyCostCents(totalCostCents, purchaseDate, today?)`：缺日期或缺成本 → null；总投入 0（赠品）→ 0
- 展示：`formatCents`（¥1,499.00）· `formatPurchaseDate`（2026年1月1日）· `platformLabel`（京东/淘宝/拼多多/转转/爱回收/其他）
- 输入：`parsePriceInput`（`1499` / `1499.9` / `1499.99`，最多两位小数，非法 → null）· `centsToPriceInput` 回填

### 6.5 备份契约 `backup.ts`
见 §8。

## 7. Repository 职责

| Repository | 职责要点 |
|---|---|
| `itemRepository` | create / update（重写 itemTags 关联）/ softDelete / 按分类子树查询 / 最近添加 / 计数；名称为空拒绝写入 |
| `categoryRepository` | 增删改 + 移动（循环保护）+ 同级排序（交换 sortOrder）+ `deleteGuarded`（含子分类或含物品时拒绝并给出中文原因） |
| `tagRepository` | 增删改 + 合并（关联转移并去重）+ 重复保护 + `getOrCreate` |
| `assetRepository` | preset 资产读取 + `iconUrl`（preset → 包内路径，其他 → objectURL） |
| `backupRepository` | `readSnapshot` 全量快照（含软删记录）/ `replaceAllWithBackup` 单事务原子替换 |

初始化：`seedIfEmpty()` 仅在**真正空库**时写入 6 个一级 + 15 个二级默认分类与 12 个 preset 资产，幂等（`appMeta.seeded`）。

## 8. 备份与恢复（Phase 2C 已完成）

```
private-item-library-backup-YYYY-MM-DD.zip
├── manifest.json   { schemaVersion, exportVersion, exportedAt, itemCount, categoryCount, tagCount, assetCount }
├── data.json       { items, categories, tags, itemTags, assets(元数据), appMeta }
└── assets/         <assetId>.<ext>   （仅非 preset 的二进制资产）
```

- 导出：`buildBackupArchive` → `exportBackup` → 浏览器下载；文件名 `private-item-library-backup-YYYY-MM-DD.zip`
- 校验（**只做结构校验，不做哈希/密码学完整性验证**）：ZIP 可解析 → manifest.json 存在 → data.json 存在 → `schemaVersion` 受支持 → 必需字段存在且类型正确 → 生成数量摘要
- 安全约定：**校验阶段绝不写库**；用户确认摘要后才在**单个 Dexie transaction** 内 clear + bulkAdd，失败整体回滚
- Replace Restore，不做 merge；恢复后 `appMeta.seeded` 强制为 `'1'`，避免重新 seed
- **版本兼容**：
  - `BACKUP_SCHEMA_VERSION = 2`（导出写 v2，含全部购买字段）
  - 支持导入 `schemaVersion = 1` 的旧备份：v1 Item 没有购买字段，导入时迁移为 `null`
  - 恢复后 `appMeta.schemaVersion` 统一写为当前契约 `'2'`
  - 不支持的版本（如 99）直接拒绝并说明原因

## 9. Icon Asset Library

- 当前可用：**12 个 preset 线性图标**（`public/icons/items/*.svg`，1:1、浅底、无文字），随应用打包，不进备份 ZIP 的 `assets/`
- 资产表记录 `kind='preset'`、`path` 指向包内路径；`Item.iconAssetId` 引用（如 `preset-earbuds`）
- 展示顺序按内置编排顺序（`presetSortIndex`），不随数据库返回顺序漂移
- `ai_generated` / `from_photo` **仅保留数据结构与类型，UI 不开放入口**；后续阶段用统一 Style Contract 的 AI 图标包整体替换 preset，页面无需改动

## 10. PWA 与部署（Phase 2C 已完成）

`vite.config.ts` 中的 `VitePWA` 配置：

- `registerType: 'autoUpdate'`，`injectRegister: 'auto'`
- manifest：`id: '/'`、`display: standalone`、`orientation: portrait`、`theme_color`/`background_color` = `#FAFAFA`、192/512 PNG + maskable 512、`lang: zh-CN`
- Workbox：`globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}']` 预缓存 App Shell 与全部静态资源；`navigateFallback: '/index.html'` 实现单页离线导航；`cleanupOutdatedCaches` + `clientsClaim` + `skipWaiting`
- iOS 适配：`viewport-fit=cover` + `env(safe-area-inset-*)`（顶栏与底部导航）、`apple-touch-icon`、`apple-mobile-web-app-capable`、`apple-mobile-web-app-title`
- 存储：`navigator.storage.persist()` 尽力申请（`services/pwa.ts`），失败静默降级；长期安全仍依赖定期导出备份
- 部署：Cloudflare Pages（构建 `npm run build`、输出 `dist`、Node 22）；`public/_redirects` 提供 SPA fallback，保证深链刷新不 404

## 11. CI

`.github/workflows/ci.yml`：push main / PR 触发，Node 22 + `npm ci` → `npm run test` → `npm run build`。

## 12. 视觉规范（已落地到 Tailwind）

- 背景 `bg-canvas #FAFAFA`；卡片 `bg-white rounded-2xl border border-black/[0.05] shadow-card`
- 文字层级 token（映射 iOS Dynamic Type）：`page-title 28/34` · `title-card 22/28` · `section 17/22` · `item 15/20` · `body 16` · `secondary 13/18` · `caption 12/16`
- 文字色 token：`ink-primary #171717` · `ink-secondary #525252` · `ink-tertiary #737373`（辅助信息满足 WCAG AA 4.5:1）
- 间距尺度 4 / 8 / 12 / 16 / 20 / 24 / 32；页面左右 padding 20px
- 点击目标 ≥ 44px（导航项 54px、chips 36px、返回键 44×44）
- 控件层材质 `.chrome`：`rgba(255,255,255,.72)` + `blur(20px) saturate(180%)` + 亮顶边，仅用于导航与吸顶栏
- 动效：按压 `scale(0.97)` / 100ms；只动 `transform` / `opacity`；尊重 `prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast`
- 无渐变、无深色模式、无 Dashboard

## 13. 页面-组件映射

| 页面 | 关键组件 |
|---|---|
| 首页 | SearchBar（跳 `/search`）、SectionHeader、ItemCard 横滑（最近添加）、CategoryCard 网格、TagChip 流式布局、空库 Empty State + CTA |
| 分类页 | CategoryIconTile（轻 tint 底衬）、可展开分类块（数量 + 二级摘要）、管理入口跳设置 |
| 分类详情 | ItemCard 网格 + `categoryPath` 面包屑 |
| 搜索页 | 搜索框（自动聚焦、150ms debounce）、ResultRows（48px 缩略图 + 命中来源）、最近搜索（localStorage）、EmptyState |
| 新增/编辑 | ItemForm：PresetIcon 网格、CategoryPicker（两级 chips）、TagPicker（多选 + 即时创建）、**购买信息（日期 / 价格 / 附加花费 / 平台 chips + 实时日均成本预览）**、备注；ConfirmDialog 处理未保存离开 |
| 详情页 | 大图标、分类路径、TagChip、购买信息卡片（总投入 / 平台·日期 / 已持有天数 / 日均成本，三字段全空则隐藏）、备注、编辑与软删（ConfirmDialog） |
| 设置 | 分组列表：导出备份、恢复备份、分类管理、标签管理、图标库、关于（App 版本） |
| 分类管理 | 树形行 + 上下移 + 编辑对话框（改名 + 选父级，排除自身与后代）+ 删除保护提示 |
| 标签管理 | 新增行 + 标签行（重命名 / 合并 / 删除）+ 关联数量统计 |
| 图标库 | preset 资产网格 |

## 14. 测试与验证

- 单元/集成测试 **131 项**（Vitest + fake-indexeddb）：`domain` 纯函数全覆盖 + repository 事务与不变量 + 备份 v2 导出 / v2 恢复 / v1→v2 迁移
- 提交前必须 `npm run test` 与 `npm run build` 全绿
- 浏览器端到端验证脚本（CDP 驱动无头 Edge，dev-only，不参与构建）：
  - `scripts/shoot.mjs`：多视口（375/390/430）截图 + 渲染校验 + 横向溢出检查
  - `scripts/verify.mjs`：Phase 2B 全流程（空库 → 新增 → 刷新 → 编辑 → 搜索 → 分类 → 删除 → 刷新）
  - `scripts/verify-purchase.mjs`：Phase 2E 全流程（含日均成本核对 + 导出 → 清空 → 恢复）
