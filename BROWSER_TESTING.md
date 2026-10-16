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

## 图标库 2.0

先完成生产构建并启动 preview，再连接项目隔离 Profile：

```powershell
npm run build
npm run preview -- --host=127.0.0.1 --port=4173 --strictPort
# 在另一终端运行；已有同端口测试 Edge 时可直接执行 verify:icons。
npm run browser:start -- --port=9222
npm run verify:icons
npm run browser:stop -- --port=9222
```

`scripts/verify-icon-library.mjs` 检查九类动态数量、移动三列分类/四列图标、全局搜索、滚动恢复、单击后仅更新待保存表单、最近使用/选中状态、键盘焦点、浅深色、桌面布局，以及全部注册 WebP 的离线解码、768×768 尺寸和透明角落。它复用测试 Profile 的数据与缓存，不清空存储；截图和结果写入 `docs/screenshots/icon-library-v2/`。

## 按月保修与日期确认（0.2.1）

先构建并在 :4173 启动生产 preview（同上）。验证可复用隔离 Profile，不清空 IndexedDB；第二个浏览器会话示例：

```powershell
npm run browser:start -- --port=9224
$env:EDGE_TEST_PORT = '9224'
npm run verify:warranty
npm run browser:stop -- --port=9224
```

`scripts/verify-warranty.mjs` 覆盖默认 12 个月、3/6/24 个月与自定义整月、闰年/月末、日期草稿取消和确认、禁止早于购买日、历史指定日期/空值兼容、无效月数阻止保存、未保存提示、心愿转持有、嵌套弹层 Escape、浅深色、375×568 短屏、桌面和离线保存刷新。本轮 29 项全部通过；四张 390×844 真实截图和结果在 `docs/screenshots/warranty/`。测试只通过表单创建带验收前缀的物品并保留它们。

iPhone 真机仍需人工确认：部署 0.2.1 并完成更新后，打开购买日期，先改年、再改月和日，弹层应保持打开；取消应保留旧值，只有点「确定」才更新表单。分别验证按月选择、清除/不适用和「转为持有」，最后保存并重新打开物品。桌面 Edge 移动视口无法代替 iOS Safari/PWA 的真机验收。

## PWA 更新端到端测试（Build A → Build B）

验证"手机端停在旧版本"这类问题，**不能只靠单元测试**：需要在同一个 origin 上先后提供两套生产构建。

脚本：`scripts/verify-pwa-update.mjs`（从已有 Build A → B 工具扩展）

```powershell
npm run browser:start -- --port=9223
npm run verify:pwa-update
npm run browser:stop -- --port=9223
npm run build                          # 恢复正式版本 dist
```

它做了什么：

1. 临时把 `APP_VERSION` 改成 0.6.0 构建一次（Build A）、再改成 0.6.1 构建一次（Build B），分别落到本次专用的 `.tmp/icon-v2-pwa-swap-<时间>/a|b`
2. 起一个本地静态服务（含 SPA fallback，`sw.js` 用 `no-store`），通过指针文件切换当前生效的构建 —— **同一 origin 换内容**
3. 切换内容后**不做整页导航**（否则浏览器直接拉新 HTML，会绕过 Service Worker，测的就不是 SW 更新）
4. 用「已加载 bundle 的文件名 hash」判定当前页面跑的是哪一套，而不是靠页面文案
5. 覆盖：启动检查 / 节流 / 前台恢复自动升级 / IndexedDB 数据保留 / 表单期间绝不 reload / 离开表单自动应用 / 设置页手动检查（最新 + 离线）

注意事项：

- 全程只用项目隔离 profile（`.tmp/edge-test-profile-*`），不碰日常 Edge
- 测试会在该 profile 的 IndexedDB 里写入临时数据（`update-test-item`、`user-cat-test` 等），**不会**接触任何真实用户数据
- 脚本内含两次约 61 秒的节流等待，完整运行约 3 分钟
- iOS 挂起无法在无头浏览器中真实模拟：`visibilitychange` 是脚本派发的合成事件，真机仍需人工确认

图标库 2.0 的扩展在 `http://127.0.0.1:4190` 交换构建并改变相同 URL 的 `phone.webp` 内容，检查响应 SHA-256 和浏览器 40px 解码像素均被替换、旧 SVG 元数据原位升级、preset 去重、物品/分类/标签及待同步条目保留，以及在线更新请求返回 503 时不会提示“最新”。它在 `try/finally` 中恢复临时修改的源码和图片；测试产物与测试数据保留在隔离目录，不删除 Profile、IndexedDB 或缓存。

本次还从 `git archive cdb19c0` 在隔离目录构建真实 0.1.0，再与正式 0.2.0 的 `dist` 在 :4191 交换，验证旧版既有机制可更新、156 preset 自动补齐至 219、业务数据/outbox 保留及新图片离线解码。临时扩展脚本保留在 `.tmp/verify/legacy-to-v2.mjs`，结果入库为 `docs/screenshots/icon-library-v2/pwa-legacy-results.json`。此场景不修改当前源码，也不需要清空旧 Profile。
