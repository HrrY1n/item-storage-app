# 仓库文件治理记录

更新时间：2026-10-09

本记录描述当前仓库的保留、忽略和清理边界。它不把“文件更少”当成目标：正式源码、测试、部署配置、迁移和仍有证据价值的历史材料都应保持可复现。

## 目录决策

| 文件或目录 | 分类 | 处理 | 原因与风险 |
|---|---|---|---|
| `src/`、`worker/`、`scripts/` | 正式源码与测试 | 保留并跟踪 | 构建、同步 Worker、迁移和验收入口依赖这些文件；不做目录迁移。 |
| `worker/migrations/*.sql` | 正式部署资产 | 保留并跟踪 | D1 迁移是追加执行链；`0002_category_cycle.sql` 不能被 `.gitignore` 隐藏。 |
| `package.json`、`package-lock.json`、`tsconfig*.json`、`vite.config.ts`、`wrangler.jsonc`、`.github/` | 可复现工程配置 | 保留并跟踪 | 新克隆、CI、前端构建和 Worker 部署需要。 |
| `README.md`、`AGENTS.md`、`BROWSER_TESTING.md`、`docs/architecture.md` | 当前维护入口 | 保留并跟踪 | 为用户和后续 Agent 提供真实架构、测试和安全边界。 |
| `docs/PHASE_*`、`docs/reference-analysis.md`、`docs/audit/` 中已跟踪材料 | 历史设计/验收依据 | 保留 | 历史阶段不是临时垃圾；删除或取消跟踪会破坏引用和审计上下文。 |
| `docs/screenshots/` 中 README 引用、设计演进和验收截图 | 正式证据 | 保留 | 现有 README、阶段验收和视觉回归仍使用；不忽略整个目录。 |
| `docs/screenshots/` 中未再引用的历史截图 | 清理候选 | 暂不移除 | 可提出候选清单，但取消跟踪属于用户可见的历史变更，本次没有获得单独批准。 |
| `docs/screenshots/audit-before/` | 本地基线 | 忽略 | 仅供本机审计对照，且已有 `.gitignore` 规则；不影响正式截图。 |
| `dist/`、`.wrangler/`、`coverage/`、`*.tsbuildinfo` | 构建/测试产物 | 忽略 | 可由命令重新生成，不应污染提交。 |
| `.tmp/`、临时浏览器 profile、临时截图目录、日志 | 本地运行态 | 忽略 | 浏览器脚本与会话缓存可能含本机路径或测试状态；Edge profile 必须留在项目 `.tmp` 内。 |
| `.env`、`.env.*`（保留 `.env.example`） | 敏感配置 | 忽略 | 防止本地密钥误提交；真正的密钥若已进历史，不能靠 `.gitignore` 清除。 |
| `*.sqlite`、`*.sqlite3`、`*.db` 及 SQLite journal/WAL | 文件型本地数据库 | 忽略 | 当前测试使用内存 SQLite；规则只防止未来本地数据库意外上传，正式 D1 结构仍以 SQL 迁移提交。 |
| `.workbuddy/`、编辑器和操作系统文件 | 机器/工具状态 | 忽略 | 与项目可复现性无关，可能含个人路径或日志。 |

## 当前结论

- 没有发现应在本次未经批准取消跟踪的正式源码、测试、迁移、CI、PWA 资源或 README 必需图片。
- 没有把 `docs/`、`docs/audit/` 或 `docs/screenshots/` 整体加入忽略，也没有删除历史截图。
- 现有临时审计文件若处于本地忽略状态，只代表它们不会进入下一次提交，不代表它们从 Git 历史中消失。
- 未发现需要在本次提交中轮换的凭据；同步 secret 不应进入备份、日志或仓库，若未来发现历史泄露必须单独轮换并处理历史。

## 验收清单

提交前使用以下只读检查确认边界：

```powershell
git status --short
git ls-files --others --exclude-standard
git ls-files -ci --exclude-standard
git check-ignore -v .tmp/edge-test-profile-9222 dist .wrangler coverage local.sqlite
```

随后运行 `npm ci`、`npm run typecheck`、`npm test`、`npm run build`；浏览器验证必须使用 `AGENTS.md` 规定的项目隔离 Edge 启动/停止命令。
