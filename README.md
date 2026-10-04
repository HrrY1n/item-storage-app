# Private Item Library · 私人数字物品库

一个 **local-first（本地优先）** 的个人物品管理 PWA。所有数据存放在浏览器 IndexedDB 中，**没有后端、没有账号、没有云端同步**——你的物品清单完全属于你自己。

适用于记录数码产品、家电、线缆配件、收藏品等个人物品：通过**分类、标签和搜索**整理与找到自己的物品记录。

> 本项目**不做位置树**（不涉及 room / shelf / storage location 等存放位置维度），定位不是"找东西放在哪个房间哪个格子"，而是把物品记录本身整理清楚、随时可查。

---

## 当前状态

Phase 2E 已完成：具备完整的数据管理闭环、离线可用能力，以及购买信息与日均使用成本。

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 0–1 | 竞品调研、许可证核查、架构设计 | ✅ 完成 |
| Phase 2A | UI 原型 · 11 个页面 + 移动端 HIG 精修 | ✅ 完成 |
| Phase 2B | 本地数据层 + 核心 CRUD + 单元测试 | ✅ 完成 |
| Phase 2C | 备份/恢复（ZIP）、PWA 离线安装、CI | ✅ 完成 |
| Phase 2E | 购买信息（日期 / 价格 / 附加花费 / 平台）与日均使用成本 | ✅ 完成 |

**测试**：131 个单元测试全部通过（domain 纯函数 + repository 集成测试）。
**验证**：备份导出、恢复替换、购买信息录入与恢复、离线打开、PWA manifest 均已在真实浏览器 + 生产构建上端到端验证。

---

## 技术栈

| 类别 | 选型 |
|---|---|
| 框架 | React 19 + TypeScript 5.9 |
| 构建 | Vite 7 |
| 样式 | Tailwind CSS 3（移动端优先，375 / 390 / 430px 三档自适应） |
| 本地数据库 | Dexie 4（IndexedDB 封装） + dexie-react-hooks |
| 路由 | react-router 7（BrowserRouter） |
| 备份打包 | JSZip（**按需动态加载**，不进入首屏） |
| PWA | vite-plugin-pwa（Workbox `generateSW`） |
| ID | ulid（可排序、URL 安全） |
| 测试 | Vitest + fake-indexeddb |

刻意**不引入**状态管理库、动画库、图表库与任何后端 SDK——这是一个纯前端、少依赖、可长期维护的项目。

---

## 快速开始

```bash
npm install      # 或 npm ci（严格按 package-lock.json 还原）
npm run dev      # 启动开发服务器 http://localhost:5173
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览生产构建（PWA 需在此模式下验证）
npm run test     # 运行测试
npm run typecheck
```

首次启动会为空数据库写入种子数据：**21 个默认分类 + 73 个内置物品图标**。
已用过的数据库会在每次启动时幂等补齐新增图标（`syncPresetAssets`），无需重置。

> Service Worker 仅在**生产构建**中启用（`npm run build && npm run preview`），开发模式下不注册，避免缓存干扰调试。

---

## 目录结构

```
src/
├── components/     # 通用组件（BottomNav / ItemCard / Dialogs / Toast 等）
├── pages/          # 页面（Home / Categories / Search / Settings 等）
├── features/data/  # useLiveQuery 封装与视图模型
├── db/             # Dexie 实例与 repositories（唯一数据库调用方）
├── domain/         # 纯函数与业务逻辑（搜索打分 / 分类树 / 标签标准化 / 备份校验）
├── services/       # 跨层编排（备份恢复、PWA 能力检测）
├── data/           # 图标注册表
├── mock/           # 演示数据（仅开发环境手动调用）
└── types/
根目录：main.tsx（入口）、App.tsx（路由）、index.css（全局样式与 token）、appInfo.ts（版本号唯一来源）
docs/               # 架构设计、竞品调研、各阶段截图
scripts/            # 图标生成、CDP 驱动的截图与端到端验证脚本
```

分层原则：`domain` 层是纯函数且**全部有测试覆盖**，`db/repositories` 是**唯一**允许直接操作 Dexie 的地方，页面层不接触数据库细节。

---

## 已实现功能

- **物品管理**：新增 / 编辑 / 查看 / 软删除，支持名称、备注、标签与内置图标（**当前仅 preset icon**，尚未支持照片上传）
- **分类树**：最多两级，展开折叠、数量徽标、祖先链计数
- **标签系统**：自动标准化去重，支持合并与重命名
- **搜索**：实时匹配，按名称 / 分类 / 标签加权打分排序，含最近搜索记录
- **管理页面**：分类管理（移动、排序、删除保护）、标签管理、图标库
- **删除保护**：分类非空时禁止删除，软删除（`deletedAt`）保留数据
- **购买信息**：记录购买日期 / 价格 / 附加花费 / 平台，自动算出**总投入**与**日均使用成本**（详见下方章节）
- **备份与恢复**：导出完整 ZIP 备份，从备份原子替换恢复
- **PWA**：可安装到主屏幕，App Shell 离线可用
- **存储持久化**：启动时尽力申请 `navigator.storage.persist()`

---

## 备份与恢复

### 导出

设置 → 数据管理 → 导出备份，生成 `private-item-library-backup-YYYY-MM-DD.zip`：

```
manifest.json    schemaVersion / exportVersion / exportedAt / 四个计数
data.json        items · categories · tags · itemTags · assets 元数据 · appMeta
assets/          仅真实用户二进制资产（preset 静态图标随包交付，不重复打包）
```

备份**不含任何哈希校验字段**——这是刻意的设计取舍：备份的价值在于可恢复，而非密码学防篡改。

### 恢复

设置 → 数据管理 → 恢复备份，选择 ZIP 后：

1. **解析与校验**（此阶段**完全不触碰数据库**）
   — ZIP 可读、`manifest.json` 与 `data.json` 存在、`schemaVersion` 受支持、必需字段存在且类型正确
2. **展示摘要**并明确提示「恢复后将替换当前数据」
3. 用户确认后，在**单个 Dexie transaction** 中完整替换

任何一步失败都会**拒绝导入并保持当前数据库完全不变**，不会出现"清空一半后失败"的中间状态。第一版仅实现 **Replace Restore**，不做合并。

---

## 购买信息与日均使用成本

每件物品可记录**购买日期**、**购买价格**、**附加花费**（配件 / 维修 / 升级 / 更换部件等额外投入）与**购买平台**，系统据此自动计算**总投入**与**日均使用成本**——把一次性支出换算成「每天花多少钱」，便于判断长期持有是否划算。

```
总投入       = 购买价格 + 附加花费（缺省的一侧按 0 计；两者都未填则不显示）
日均使用成本 = 总投入 ÷ 持有天数
持有天数     = 今天 - 购买日期 + 1（含购买当天，今天买算持有 1 天）
```

### 设计约定

| 约定 | 原因 |
|---|---|
| 价格用**整数「分」**存储（`purchasePriceCents` / `additionalCostCents`） | 避免浮点累积误差：`¥1499.99` 存为 `149999` |
| 日期统一 `YYYY-MM-DD` | 精度到天，不引入时间与时区语义 |
| 天数按**日历日**计算 | 先转 UTC 日序号再相减，不受本地时区 / 夏令时影响，**不会差一天** |
| 价格 `0` 视为赠品 | 允许填写，日均成本为 `0` 而非报错 |
| 未来日期 / 非法日期返回 `null` | 历史脏数据不会让页面崩溃，UI 静默不显示 |
| 总投入（`totalCostCents`）是**派生值**，不落库 | 随时可由两个存储字段算出，避免冗余与不一致 |

### 支持的购买平台

京东 · 淘宝 · 拼多多 · 转转 · 爱回收 · 其他

购买信息是**纯记录性**的：不参与搜索排序，不做价格统计分析，也没有任何联网抓取或比价行为。

---

## 安装到手机

### iPhone / iPad

1. 使用 **Safari** 打开本页面
2. 点击底部「分享」按钮
3. 向下滚动，选择「添加到主屏幕」

已从主屏幕启动时，设置页会显示「已从主屏幕运行」。本项目不会尝试自动触发 iOS 安装弹窗（iOS 不支持该能力）。

### Android / 桌面 Chrome

浏览器会自动提示安装，或在地址栏/菜单中选择「安装应用」。

---

## 部署

路由使用 **BrowserRouter**（URL 干净，无 `#`）。因此部署平台**必须配置 SPA fallback**，把所有未知路径回落到 `index.html`，否则直接访问 `/items/:id`、`/categories/:id`、`/search` 会得到 404。

```toml
# Netlify — netlify.toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

```json
// Vercel — vercel.json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

```nginx
# nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

> GitHub Pages 不支持服务端 rewrite，需额外提供 `404.html` 拷贝 `index.html` 的方案，或改用 Netlify / Vercel / Cloudflare Pages。

Service Worker 的 `navigateFallback` 已配置为 `/index.html`，因此在**已缓存**的情况下，离线访问任意路由同样可以打开。

---

## 界面预览

Phase 2B · UI 原型

| 首页 | 分类 | 搜索 |
|---|---|---|
| ![首页](docs/screenshots/01-home.png) | ![分类](docs/screenshots/02-categories.png) | ![搜索](docs/screenshots/04-search.png) |

| 新增物品 | 物品详情 | 设置 |
|---|---|---|
| ![新增](docs/screenshots/06-item-new.png) | ![详情](docs/screenshots/07-item-detail.png) | ![设置](docs/screenshots/08-settings.png) |

Phase 2E · 购买信息与日均使用成本

| 新增表单 | 详情页展示 | 购买信息随备份恢复 |
|---|---|---|
| ![表单](docs/screenshots/phase2e/01-form-preview.png) | ![详情](docs/screenshots/phase2e/02-detail.png) | ![恢复后](docs/screenshots/phase2e/04-after-restore.png) |

Phase 2C · 备份恢复与离线验证

| 恢复确认 | 恢复后 | 离线打开 |
|---|---|---|
| ![恢复确认](docs/screenshots/phase2c/02-restore-confirm.png) | ![恢复后](docs/screenshots/phase2c/03-restored-home.png) | ![离线](docs/screenshots/phase2c/04-offline-home.png) |

更多截图见 [`docs/screenshots/`](docs/screenshots/)（含 Phase 2B 真实数据流程验证）。

---

## 数据说明

Dexie Schema 现为 **v2**，共 6 张表：

```ts
db.version(2).stores({
  items:      'id, categoryId, name, createdAt, updatedAt, deletedAt',
  categories: 'id, parentId, name, sortOrder, deletedAt',
  tags:       'id, &nameNormalized, createdAt',
  itemTags:   '[itemId+tagId], itemId, tagId',
  assets:     'id, kind, createdAt',
  appMeta:    'key',
})
```

版本演进：

| 版本 | 变更 |
|---|---|
| v1 | 初始 6 张表 |
| v2 | `Item` 增加购买信息字段（含附加花费）；均为非索引字段，无需改动 `stores`，由 `upgrade` 把旧记录补为 `null` |

```ts
export interface Item {
  // …其余基础字段
  purchaseDate: string | null              // YYYY-MM-DD
  purchasePriceCents: number | null        // 整数「分」，允许 0（赠品）
  additionalCostCents: number | null       // 附加花费，整数「分」（配件/维修/升级等）
  purchasePlatform: PurchasePlatform | null
}
```

购买信息字段均为 `null` 时表示未填写，UI 会静默隐藏相关区块。备份文件同样包含这些字段，因此购买信息会随备份一起导出与恢复。

数据仅保存在**当前设备当前浏览器**中。应用会在启动时尽力申请持久化存储，但这只是一项偏好请求：浏览器可以拒绝，用户清理浏览数据时依然会被清除。

**定期导出备份是保护数据的可靠手段。**

---

## 持续集成

`.github/workflows/ci.yml` 在每次 push 与 PR 时执行 `npm ci` → `npm run test` → `npm run build`，确保主分支始终处于可构建、测试通过的状态。

---

## License

未提供开源许可证，保留所有权利。
