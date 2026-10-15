# 仓库文件治理记录

更新时间：2026-10-16

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
| `docs/screenshots/` 中历史阶段截图 | 历史验收依据 | 保留 | README 使用 `current/` 的当前预览；旧阶段截图继续承载设计演进和验收上下文。 |
| `docs/screenshots/audit-before/` | 本地基线 | 忽略 | 仅供本机审计对照，且已有 `.gitignore` 规则；不影响正式截图。 |
| `dist/`、`.wrangler/`、`coverage/`、`*.tsbuildinfo` | 构建/测试产物 | 忽略 | 可由命令重新生成，不应污染提交。 |
| `.tmp/`、临时浏览器 profile、临时截图目录、日志 | 本地运行态 | 忽略 | 浏览器脚本与会话缓存可能含本机路径或测试状态；Edge profile 必须留在项目 `.tmp` 内。 |
| `.tmp/icon-redraw/`、`.tmp/icon-library-v2/` 中原图、生成记录和 `source-images.zip` | 图像来源材料 | 本地保留并另行备份 | 不属于可随手删除的缓存；`prompts.json` 记录来源与校验值。仅可清理已确认与正式资源一致的编码副本等可再生中间产物。 |
| `.env`、`.env.*`（保留 `.env.example`） | 敏感配置 | 忽略 | 防止本地密钥误提交；真正的密钥若已进历史，不能靠 `.gitignore` 清除。 |
| `*.sqlite`、`*.sqlite3`、`*.db` 及 SQLite journal/WAL | 文件型本地数据库 | 忽略 | 当前测试使用内存 SQLite；规则只防止未来本地数据库意外上传，正式 D1 结构仍以 SQL 迁移提交。 |
| `.workbuddy/`、编辑器和操作系统文件 | 机器/工具状态 | 忽略 | 与项目可复现性无关，可能含个人路径或日志。 |

## 当前结论

- 没有发现应在本次未经批准取消跟踪的正式源码、测试、迁移、CI、PWA 资源或 README 必需图片。
- 没有把 `docs/`、`docs/audit/` 或 `docs/screenshots/` 整体加入忽略，也没有删除历史截图。
- 现有临时审计文件若处于本地忽略状态，只代表它们不会进入下一次提交，不代表它们从 Git 历史中消失。
- 未发现需要在本次提交中轮换的凭据；同步 secret 不应进入备份、日志或仓库，若未来发现历史泄露必须单独轮换并处理历史。

## 2026-10-16 清理与文档更新

- 删除 59 个已停用测试 Profile / 旧构建目录 / WebP 暂存目录，共 35,114 个文件、1,815,051,905 字节（约 1.69 GiB），并移除 6 个失效的测试 PID 记录。
- 删除前核对目标解析后的绝对路径均在项目 `.tmp` 内，确认没有运行中的项目测试 Edge、嵌套 Git 仓库或目录重解析点；不接触日常浏览器、`.wrangler`、依赖和用户数据目录。
- WebP 暂存副本逐张与 `public/icons/items/` 校验一致后清理。原有 156 SVG、全部 219 WebP、原图、生成记录和源图 ZIP 保留，ZIP SHA-256 与图标验收报告一致。
- README 更新至 0.2.0，补充 219 图标、更新机制和验证入口；旧 SVG 预览替换为 `docs/screenshots/current/` 的正式构建截图，历史阶段截图不删除。
- 原有未跟踪文件 `docs/WORKBUDDY_HANDOFF.md` 保持原样，不纳入本次提交。

## 验收清单

提交前使用以下只读检查确认边界：

```powershell
git status --short
git ls-files --others --exclude-standard
git ls-files -ci --exclude-standard
git check-ignore -v .tmp/edge-test-profile-9222 dist .wrangler coverage local.sqlite
```

随后运行 `npm ci`、`npm run typecheck`、`npm test`、`npm run build`；浏览器验证必须使用 `AGENTS.md` 规定的项目隔离 Edge 启动/停止命令。
