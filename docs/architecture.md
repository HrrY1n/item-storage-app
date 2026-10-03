# 架构设计（Phase 1 结论）

> 依据：PRD v1.0 + docs/reference-analysis.md。
> 决策标准：长期可维护 > 简单 > 稳定 > Local-first > 少依赖 > 移动端体验 > 视觉精致。

---

## 1. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | React 19 + TypeScript + Vite 7 | |
| 样式 | Tailwind CSS 3 | 移动端优先，375/390/430px 为主要设计宽度 |
| 路由 | react-router 7 | **固定 BrowserRouter**（不用 HashRouter，URL 更干净；部署时需 SPA fallback） |
| 本地数据库 | Dexie.js 4（IndexedDB） | repo 是唯一调用方 |
| PWA | vite-plugin-pwa | autoUpdate，显式 manifest.id |
| 测试 | Vitest + fake-indexeddb | domain 纯函数 + repository 集成测试 |
| 备份打包 | JSZip | 唯一新增的重依赖，用于 zip 导出/导入 |
| ID | ulid | 可排序、URL 安全 |
| 不引入 | zustand / Framer Motion / Recharts / i18n / 任何后端 SDK | 见 reference-analysis.md |

## 2. 信息架构

底部导航（固定 4 项）：**首页 · 分类 · 搜索 · 设置**；新增物品 = 右下 Floating Action Button（＋）。

```
/                   首页：大搜索框 + 最近添加 + 分类入口 + 常用标签
/categories         分类页：分类树（展开/折叠、数量徽标、进入分类）
/categories/:id     分类详情：该分类（含子分类）下物品网格
/search             搜索页：实时搜索 + 排序优先级结果
/items/new          新增物品（全屏页/底部 Sheet）
/items/:id          物品详情
/items/:id/edit     编辑物品
/settings           设置：分类管理 / 标签管理 / 图标库 / 备份与恢复 / 关于
```

## 3. Dexie Schema（v1）

```ts
db.version(1).stores({
  items:      'id, categoryId, name, createdAt, updatedAt, deletedAt',
  categories: 'id, parentId, name, sortOrder, deletedAt',
  tags:       'id, &nameNormalized, createdAt',
  itemTags:   '[itemId+tagId], itemId, tagId',
  assets:     'id, kind, createdAt',
  appMeta:    'key',            // schemaVersion / exportVersion / lastBackupAt
});
```

要点：
- 主键均为 ULID 字符串，不用自增；
- `tags.nameNormalized` 唯一索引（trim + 大小写折叠），从数据库层保证同名标签不重复；
- `itemTags` 复合主键 `[itemId+tagId]`，天然防重复关联；
- soft delete：items/categories 带 `deletedAt`，查询默认过滤；
- Asset 二进制 Blob 直接存 `assets.blob` 字段（IndexedDB 原生支持 Blob，比 Base64 省 ~33% 空间且可创建 objectURL）。

## 4. 数据模型（domain/types.ts）

```ts
interface Item {
  id: string; name: string; categoryId: string; note: string;
  iconAssetId: string | null;
  sourceType: 'preset' | 'ai_generated' | 'from_photo';
  createdAt: string; updatedAt: string; deletedAt: string | null;
}
interface Category {
  id: string; parentId: string | null; name: string; sortOrder: number;
  createdAt: string; updatedAt: string; deletedAt: string | null;
}
interface Tag { id: string; name: string; nameNormalized: string; createdAt: string; updatedAt: string; }
interface ItemTag { itemId: string; tagId: string; }
interface Asset {
  id: string; kind: 'preset' | 'ai_generated' | 'from_photo';
  path: string | null;      // preset 图标随包路径
  blob: Blob | null;        // 非 preset 的二进制
  mime: string; width: number; height: number;
  styleVersion: string | null; promptVersion: string | null;
  sourceAssetId: string | null; createdAt: string;
}
```

## 5. 领域规则（domain/，纯函数，全部测试）

- `categoryTree.ts`：建树、排序、`wouldCreateCycle(categoryId, newParentId)`、`hasItems(categoryId)`（删除保护）、`collectDescendantIds`
- `tagNormalize.ts`：trim、去 # 前缀、大小写折叠、去重
- `searchItems.ts`：四级数据源（名称/标签/分类/备注）打分排序：名称完全匹配(100) > 名称前缀(80) > 名称包含(60) > 标签(40) > 分类(30) > 备注(10)；实时增量搜索由调用方 debounce 150ms
- `backupSchema.ts`：导出结构校验（schemaVersion 检查、字段完整性、非法文件拒绝）

## 6. Icon Asset Library

- `features/icons/`：PresetIconPicker（网格选择器）+ assetService（getIconURL：preset → 包内路径；其他 → URL.createObjectURL(blob)）
- **Phase 2A（UI Prototype）**：只准备 8–12 个风格一致的临时占位物品图（1:1、物体居中、浅背景、无文字），仅用于完成 UI 验证；资源必须可替换
- **后续阶段**：用 AI 按统一 Style Contract 批量生成正式精美图标（目标约 40 个，覆盖 PRD 附录 A 常见物品形态）整体替换占位图
- ai_generated / from_photo 只保留数据结构与类型，UI 不开放入口

## 7. 备份与恢复（P0）

```
private-item-library-backup-YYYY-MM-DD.zip
├── manifest.json   { schemaVersion, exportVersion, exportedAt, itemCount, categoryCount, tagCount, assetCount }
├── data.json       { items, categories, tags, itemTags, assets(元数据) }
└── assets/         <assetId>.<ext>  （非 preset 的二进制资产）
```

- 导出：repo 读全量 → manifest + data + assets 打 zip → 触发下载 → 写 AppMeta.lastBackupAt
- 恢复校验（刻意保持简单，不做哈希/密码学完整性验证）：① ZIP 可解析；② manifest.json 存在；③ data.json 存在；④ schemaVersion 受支持；⑤ 必需字段存在且类型基本正确；⑥ 生成数据数量摘要
- 恢复流程：选 zip → 校验（失败即拒绝并说明原因）→ 弹出摘要（数量/导出时间/版本）→ 用户确认 → 单个 Dexie transaction 内 clear + bulkPut（原子）→ 完成提示
- 第一版不做 merge

## 8. PWA

- manifest：`id: '/private-item-library/'`、`display: standalone`、`theme_color: #FFFFFF`、`background_color: #FAFAFA`、192/512 PNG + maskable、`launch_handler: focus-existing`
- `viewport-fit: cover` + `env(safe-area-inset-*)` 处理 iPhone 刘海与底部 Home 条
- 启动时 `navigator.storage.persist()`
- workbox：precache 全部构建产物 + 预置图标；运行时无网络请求（v1.0 纯离线）
- 每个路由一个 ErrorBoundary + 全局一个，白屏提供「重载」按钮

## 9. 视觉规范（落地到 Tailwind）

- 背景：`bg-[#FAFAFA]`（极浅灰），卡片 `bg-white rounded-2xl border border-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]`
- 文字层级：标题 `text-[17px] font-semibold text-neutral-900` / 正文 `text-[15px] text-neutral-700` / 辅助 `text-[13px] text-neutral-400`
- 点击目标 ≥ 44px；BottomNav 高度 56px + safe-area padding
- ItemCard：图标占视觉中心（1:1，约卡片宽 60%），下方名称 + 分类名 + ≤2 个 TagChip
- 无渐变、无玻璃拟态、无 Dashboard；转场仅用 150–200ms opacity/transform

## 10. 页面-组件映射

| 页面 | 关键组件 |
|---|---|
| 首页 | SearchBar（点击跳 /search）、SectionHeader、ItemCard 横滑列表（最近添加）、CategoryCard 网格、TagChip 流式布局 |
| 分类页 | CategoryTreeNode（递归、展开/折叠、数量徽标）、管理模式（新增/重命名/排序/移动/删除） |
| 搜索页 | SearchInput（自动聚焦、实时结果）、SearchResultList（按优先级排序、高亮来源） |
| 新增/编辑 | ItemForm：名称、CategoryPicker（树形选择）、TagPicker（多选+即时创建）、PresetIconPicker、备注 |
| 详情页 | 大图标、分类路径面包屑、TagChip、备注、编辑/删除（软删）按钮 |
| 设置页 | 分组列表：分类管理、标签管理、图标库浏览、导出备份、恢复备份、关于（schemaVersion） |
