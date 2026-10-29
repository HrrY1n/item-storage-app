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

## 布局与交互回归

启动 `npm run dev -- --host=127.0.0.1`，再按上述方式启动测试 Edge，运行 `node scripts/verify-design.mjs`。脚本覆盖手机底栏、桌面侧栏与分栏、卡片跳转、点阵保修、逐卡展开/收起（44px 触控区域、Enter/空格键与独立状态）、组合筛选、重置、网格/列表、键盘分段控件、弹窗、深浅主题、减少动效和 375–1440px 的横向溢出检查。截图与断言结果写入 `.tmp/design-optimization/verified/`。

`verify.mjs` 和 `verify-design.mjs` 每次创建临时浏览器上下文，分别验证完整 CRUD 和演示数据界面；关闭连接后自动丢弃该上下文，不清空既有 Profile 的 IndexedDB、同步队列或缓存。

`node scripts/verify-form-state.mjs` 使用相同的 Vite :5173 / Edge :9222 入口，在九个一次性上下文中回归金额提交、转为持有、出售、同步关闭、备份恢复、缺失/删除物品、站内返回草稿确认，以及整页刷新/返回的原生离开提示。API 全部拦截，不连接生产数据或调用模型；结果与截图写入 `.tmp/form-state-verification/`。

`verify-2c.mjs`、`verify-purchase.mjs`、`verify-additional-cost.mjs` 和 `verify-deploy.mjs` 的临时截图写入 `.tmp/browser-verification/` 下对应子目录。`docs/screenshots/` 保留 README 与正式验收文档使用的预览和证据。

`node scripts/verify-list-state.mjs`（2026-10-30 新增）在四个一次性上下文中回归列表会话状态：底栏切页返回/刷新恢复搜索词、排序、视图与状态 tab，重置筛选后的存储写回，损坏 JSON / 非法枚举 / 已删除分类的安全回退，新浏览器上下文不继承旧会话，以及详情面板往返与恢复机制的兼容。结果与截图写入 `.tmp/list-state-verification/`。

**断言语义说明（2026-10-30 修正）**：`verify-interactions.mjs` 与 `verify-categories.mjs` 中的过渡类断言一律"等待终态再断言"（脚本自带 `until`/`poll`，有界超时），因为 React 提交、退出过渡（约 300ms）与 220ms 折叠动画都是异步的，同步求值会把过渡中的 DOM 误判为缺陷。其中"创建面板入场"的三条断言已按 `c1fe47e` 之后的设计更新（入场与异步查询解耦：查询未就绪时面板照常上滑并显示明确的「正在载入表单」占位，见 `deliverables/motion-integration-final/INTEGRATION_RESULT.md`）；判断"动画过渡"还是"真实回归"时，先看断言等待的是过渡中间态还是终态，再用有界轮询复现一次。

## 物品分类与旧库补齐

先启动 `npm run dev -- --host=127.0.0.1` 和生产 preview。此用例需要未使用过的项目测试 Profile，例如另选一个空闲端口 `9234`；不删除或清空之前的测试 Profile：

```powershell
npm run browser:start -- --port=9234
$env:EDGE_TEST_PORT = '9234'
node scripts/verify-categories.mjs
npm run browser:stop -- --port=9234
```

脚本在隔离开发 origin 写入冻结的旧版 6+15 分类和三件验收物品，再由实际 Boot 完成增量升级；逐项检查旧 ID、物品归属、原 outbox、七个一级和 49 个二级、父子件数、直接归入大类的提示、折叠与跳转、表单保存、浅深色、短屏和桌面布局。独立生产 origin 检查全新安装和离线刷新。全程不清空数据库，截图与结果写入 `docs/screenshots/categories/`。

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

`scripts/verify-warranty.mjs` 覆盖默认 12 个月、3/6/24 个月与自定义整月、闰年/月末、日期草稿取消和确认、禁止早于购买日、历史指定日期/空值兼容、无效月数阻止保存、未保存提示、心愿转持有、嵌套弹层 Escape、浅深色、375×568 短屏、桌面和离线保存刷新。新运行的截图与结果写入 `.tmp/browser-verification/warranty/`；[历史 29 项检查结果](docs/screenshots/warranty/results.json)保留，[当前保修录入预览](README.md#保修录入)使用新版截图。测试只通过表单创建带验收前缀的物品并保留它们。

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
5. 覆盖：启动检查 / 节流 / 前台恢复自动升级 / IndexedDB 数据保留 / 表单期间绝不 reload / 浏览器返回的放弃确认 / 离开表单自动应用 / 设置页手动检查（最新 + 离线）

注意事项：

- 全程只用项目隔离 profile（`.tmp/edge-test-profile-*`），不碰日常 Edge
- 测试在启动器会话下另建一次性浏览器上下文，写入合成数据（`update-test-item`、`user-cat-test` 等），结束后丢弃该上下文；既有 profile 的 IndexedDB、outbox 和 SW 缓存保留，不会影响本次首次安装判定
- 脚本内含两次约 61 秒的节流等待，完整运行约 3 分钟
- iOS 挂起无法在无头浏览器中真实模拟：`visibilitychange` 是脚本派发的合成事件，真机仍需人工确认

图标库 2.0 的扩展在 `http://127.0.0.1:4190` 交换构建并改变相同 URL 的 `phone.webp` 内容，检查响应 SHA-256 和浏览器 40px 解码像素均被替换、旧 SVG 元数据原位升级、preset 去重、物品/分类/标签及待同步条目保留，以及在线更新请求返回 503 时不会提示“最新”。它在 `try/finally` 中恢复临时修改的源码和图片；测试产物与测试数据保留在隔离目录，不删除 Profile、IndexedDB 或缓存。

本次还从 `git archive cdb19c0` 在隔离目录构建真实 0.1.0，再与正式 0.2.0 的 `dist` 在 :4191 交换，验证旧版既有机制可更新、156 preset 自动补齐至 219、业务数据/outbox 保留及新图片离线解码。临时扩展脚本保留在 `.tmp/verify/legacy-to-v2.mjs`，结果入库为 `docs/screenshots/icon-library-v2/pwa-legacy-results.json`。此场景不修改当前源码，也不需要清空旧 Profile。
