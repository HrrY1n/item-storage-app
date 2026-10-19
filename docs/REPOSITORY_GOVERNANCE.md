# 仓库文件维护

更新时间：2026-10-19

工作区保留当前维护、构建和验证需要的材料。已完成的方案通过 Git 历史追溯；确认不再使用的临时实验直接删除，避免长期保留另一套归档。

## 保留边界

| 文件或目录 | 处理与原因 |
|---|---|
| `src/`、`worker/`、`scripts/` | 保留正式源码、回归测试与当前验证入口 |
| `worker/migrations/*.sql` | 保留追加式迁移链，不改写已执行文件及其历史出处注释 |
| 工程配置、锁文件、`.github/` | 保证可复现安装、检查、构建和部署 |
| [当前文档目录](README.md)、[架构说明](architecture.md) | 集中维护当前版本、数据边界、同步与展示约定 |
| `docs/audit/`、`docs/screenshots/` | 保留专项审计及文档引用的预览和正式验收证据；未引用的历史截图通过 Git 历史追溯 |
| `public/`、`assets/` | 保留当前图标、应用母版和来源元数据；旧 SVG 兼容已有记录 |
| `.tmp/icon-redraw/`、`.tmp/icon-library-v2/` | 原图、生成记录与来源 ZIP，保持路径和内容，不作为普通缓存删除 |
| `.workbuddy/backups/` | 保留原图独立副本、校验值与手机业务数据导出说明，不进入 Git |
| `.tmp/edge-test-profile-<port>/` | 保留测试数据库和缓存；只使用项目 launcher 管理进程 |
| `.workbuddy/memory/`、用户交接快照 | 保留原有记录，其中的旧文件名属于历史上下文 |
| `node_modules/.cache/`、`dist/`、`.wrangler/` | 忽略可再生缓存、构建产物和本地运行态 |

## 2026-10-19 冗余清理

- 删除 101 张未被文档引用的历史截图，以及已由 `verify-design.mjs` 覆盖的两个旧截图脚本 `shoot.mjs`、`shoot-award.mjs`，共约 21.82 MiB。当前四组预览和验收证据保留，所有本地文档链接有效。
- 保留备份恢复、购买信息、附加花费及部署回归脚本，将它们的临时截图改写到已忽略的 `.tmp/browser-verification/` 子目录，避免重新加入旧产物。
- 正式源码、测试、迁移、图标资源及来源、用户交接快照、浏览器数据均保持原样。PWA 两张内容相同但用途独立的图标保留各自路径。
- 删除清单、原文件校验值和保护文件校验结果记录在 `.workbuddy/maintenance/2026-10-19-redundant-files/`，不额外保存被删除内容。文件可从清理前提交 `da901f7` 恢复。

## 2026-10-16 清理记录

- 删除 6 份已完成的长篇方案、调研和旧版验收说明，当前同步与处置展示约定并入架构说明。
- 删除 115 个旧实验文件，包括探索截图、修复草稿、旧构建片段及已淘汰应用图标母版。当前母版、物品图标原图、独立备份和浏览器数据均保留。
- README、文档索引、源码及测试注释改指向现行约定，移除指向旧方案的链接和章节编号；不为失效引用新增运行时代码。
- 已跟踪的旧文件可从 Git 历史查询，方法见[旧说明的出处](architecture.md#10-旧说明的出处)。已执行迁移与用户交接快照不改写。
- 本地删除清单和校验结果存放在 `.workbuddy/maintenance/2026-10-16-delete-obsolete/`，只记录路径、大小和校验值，不另存被删除内容。未进入 Git 的旧实验文件删除后不能从 Git 恢复。
- 根目录工作记录集中在 `.workbuddy/plans/`；TypeScript 缓存显式生成到 `node_modules/.cache/`，避免再次散落根目录。

## 验证入口

删除前核对绝对路径边界、目录重解析点、嵌套 Git、文件清单及校验值；删除后检查有效引用、本地 Markdown 链接、受保护文件和只改注释的源码。

```powershell
npm run typecheck
npm test
npm run build
```

浏览器验证遵守 [AGENTS.md](../AGENTS.md) 和 [BROWSER_TESTING.md](../BROWSER_TESTING.md)。不通过清空 IndexedDB 或同步 outbox 让验证通过，不连接生产 D1。
