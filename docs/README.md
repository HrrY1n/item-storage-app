# 文档与工作区目录

当前维护从这里进入。同步、备份和物品展示约定集中在架构说明中，具体行为由源码和测试验证。

## 当前文档

| 入口 | 用途 |
|---|---|
| [产品目标](product-goals.md) | 产品范围与长期边界 |
| [物品分类](categories.md) | 七个一级、49 个二级分类、旧数据更新与当前页面 |
| [架构与维护入口](architecture.md) | 分层、版本、数据与同步边界 |
| [工程规则](../AGENTS.md) | 数据保护与测试安全要求 |
| [浏览器测试](../BROWSER_TESTING.md) | 隔离 Edge、保修与 PWA 验证 |
| [图标库验收](icon-library-v2-audit.md) | 图标库、PWA 更新与真机验收证据 |
| [图标资源说明](../assets/item-icons/README.md) | 素材规范与来源 |
| [物品展示与财务约定](architecture.md#9-物品展示与财务约定) | 卡片与列表共用的金额、处置与缺失值规则 |
| [文件治理记录](REPOSITORY_GOVERNANCE.md) | 文件保留、归档与清理边界 |

## 审计与来源

`audit/` 保存专项审计；`screenshots/` 保留 README 与正式验收文档使用的预览和证据。未被引用的历史截图和已完成的长篇阶段方案可从 Git 历史查询；临时浏览器截图写入 `.tmp/browser-verification/`，必要约定已合入当前架构。

旧说明从 Git 历史查询，见[历史出处说明](architecture.md#10-旧说明的出处)。用户本地交接快照 `WORKBUDDY_HANDOFF.md` 和已执行迁移保持原样，其中的旧文件名是历史记录。

## 本地文件

| 位置 | 内容与处理方式 |
|---|---|
| `.workbuddy/backups/2026-10-16-icon-sources/` | 新增图标原图 ZIP、校验值与说明；本地保留，不进入 Git |
| `.workbuddy/plans/2026-10-16-workspace-cleanup/` | 本地任务计划、发现与工作日志 |
| `.workbuddy/memory/` | WorkBuddy 原有记忆，保留原样 |
| `.workbuddy/maintenance/` | 整理与删除清单、校验结果；记录操作，不另存旧文件内容 |
| `.tmp/icon-redraw/`、`.tmp/icon-library-v2/` | 图标原图、提示词来源与生成记录，保留既有路径，不作为普通缓存清理 |
| `.tmp/verify/`、`.tmp/audit/` | 仍被历史验收材料引用的本地驱动与证据 |
| `.tmp/edge-test-profile-<port>/` | 隔离 Edge 的测试数据；只通过项目启动和停止脚本使用 |
| `node_modules/.cache/` | TypeScript 增量编译缓存，构建自动生成 |
| `dist/`、`.wrangler/` | 构建产物和本地 Wrangler 状态，不进入 Git |

本地备份和 `.tmp` 不随 GitHub 同步。原图副本仍在本机，长期保存还需另存到其他设备或自己的云盘；业务数据 ZIP 仍需从实际使用的设备导出。
