# 浏览器测试隔离

项目的验证脚本只连接本机 CDP，不应该直接使用日常 Edge Profile。启动测试浏览器时使用：

```powershell
npm run browser:start -- --port=9222
node scripts/verify.mjs
npm run browser:stop -- --port=9222
```

需要同时运行第二个 CDP 会话时换端口，例如：

```powershell
npm run browser:start -- --port=9223
node scripts/verify-reduced-motion.mjs
npm run browser:stop -- --port=9223
```

`start-test-edge.mjs` 使用项目 `.tmp` 下的独立 Profile，并强制关闭同步、扩展、首次运行导入和组件更新。测试 Profile 不登录 Microsoft 账户，也不会读取 `%LOCALAPPDATA%\Microsoft\Edge\User Data`。

停止时只使用 `stop-test-edge.mjs` 记录的 PID。不要使用 `taskkill /IM msedge.exe`，因为那会杀掉用户正在使用的正常 Edge。
