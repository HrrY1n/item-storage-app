# Browser test safety

Browser verification in this project must use the project-local Edge profile and launcher:

```powershell
npm run browser:start -- --port=9222
node scripts/verify.mjs
npm run browser:stop -- --port=9222
```

For a second CDP session, use another port (for example `9223`). The launcher creates or reuses only a profile under `.tmp\edge-test-profile-<port>` and always passes `--disable-sync`, `--no-first-run`, `--no-default-browser-check`, `--disable-extensions`, and `--disable-features=ImportOnEachLaunch`.

Do not launch Edge without an explicit project-local `--user-data-dir`. Do not use the signed-in Edge profile under `%LOCALAPPDATA%\Microsoft\Edge\User Data`, do not import browser data, and do not run `taskkill /IM msedge.exe`. Stop only the PID recorded by `scripts/stop-test-edge.mjs`, so the user's normal Edge session is never touched.

## Engineering entrypoint

- Read [`docs/architecture.md`](docs/architecture.md) before changing persistence, backup, or sync boundaries.
- `npm run typecheck`, `npm test`, and `npm run build` are the minimum pre-commit checks.
- Local business writes stay local-first; do not clear IndexedDB or the sync outbox to make a test pass.
- Sync wire changes must update `src/domain/syncProtocol.ts`, both client/Worker runtime validators, and contract tests.
- D1 migrations under `worker/migrations/` are append-only and must be tested with the SQLite harness before deployment.

## Workspace hygiene

- 日常开发目录固定为 D:\Codex\Markitem App；不得在 D:\Codex 根目录随意创建新的 Markitem 项目目录，或因新任务自动复制整个项目形成长期副本。
- 临时测试文件优先放在已忽略的项目 .tmp/，只使用合成测试数据；禁止自动清理真实业务数据或用户手动存放的文件。
- 额外 Git worktree 统一放在 D:\Codex-Worktrees\Markitem App\；新增长生命周期工作区前先说明理由，临时工作结束后安排 worktree 注销及目录收尾。
- 历史审计与正式交付报告归档至 D:\ProjectArchive\Markitem App\，不把大体积截图、日志或 ZIP 作为新增审计证据提交到项目仓库。
