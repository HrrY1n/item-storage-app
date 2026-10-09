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
