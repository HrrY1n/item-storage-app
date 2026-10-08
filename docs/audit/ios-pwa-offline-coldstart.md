# iOS PWA 离线冷启动回归审计（只读）

- 审计对象：`HrrY1n/item-storage-app` `main` @ `940dca6`（v1.0.0）
- 线上地址：`https://item-storage-app.ciosg716.workers.dev/`
- 时间：2026-10-08
- 范围：PWA 注册 / 更新 / 预缓存 / 导航回落 / Cloudflare 静态路由
- 约束：未修改任何源文件、未改 Cloudflare 配置、未清理 SW / IndexedDB / Cache Storage、未 commit、未 push

> **后续修复状态（v1.0.1，2026-10-08）**：结论 4 的「最小修复」已实施 —— `vite.config.ts` 的
> `navigateFallback` 改为 `/`，并用 `manifestTransforms` 把 `index.html` 清单项改写成 `/`
> （保留原内容哈希 revision）。桌面 Chromium 上 23 项冷启动断言全部通过
> （`npm run verify:pwa-offline`）。**这不等于 iOS 真机已修复**：真机验收仍为 PENDING，
> 本审计里列出的第 5 项真机待确认清单一条都还没被真机验证过。本文档其余内容保持审计当时的原样。

---

## 0. 结论速览

| # | 问题 | 结论 |
|---|---|---|
| 1 | 新版本预缓存能否完整安装 | **能**。桌面 Chromium 实测：唯一资源 167/167 全部入库，缺失 0，SW 激活并接管。所谓「326 项」里有 **159 项是重复条目** |
| 2 | 冷启动失败发生在哪一层 | **导航层**（更准确说：这次顶层导航有没有被 Service Worker 接管）。不是 JS 初始化层 |
| 3 | Phase 2H.1 是否有可证实的回归 | **没有可证实的离线冷启动回归**。PWA 相关代码自 `c9eced6` 起零改动；其引入的逻辑全部在文档加载**之后**执行，无法影响首次导航 |
| 4 | 最小修复 | 让 App Shell 以**非重定向响应**入库（改 `vite.config.ts` 的 `navigateFallback` + `additionalManifestEntries`，不动 Cloudflare、不加缓存、不关自动更新） |
| 5 | 仍需真机确认 | iOS standalone 冷启动时 SW 是否处于 controlling；iOS 是否对 standalone 冷启动强制做 sw.js 更新请求；iOS standalone 与 Safari 的 Cache Storage / SW 注册是否同一容器 |

---

## 1. 配置与代码事实（静态）

### 1.1 生成出来的 Service Worker（`dist/sw.js`，与线上逐字节等价，仅条目顺序不同）

```js
self.skipWaiting(),
e.clientsClaim(),
e.precacheAndRoute([ ...326 项... ], {}),
e.cleanupOutdatedCaches(),
e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("/index.html")))
```

- `registerType: 'autoUpdate'`、`injectRegister: null`（唯一注册点在 `src/main.tsx → startPwaUpdate()`）
- `navigateFallback: '/index.html'`、`cleanupOutdatedCaches: true`、`clientsClaim: true`、`skipWaiting: true`
- `globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}']`、`includeAssets: ['icons/items/*.svg']`

### 1.2 「326 项预缓存」的真实规模

```
manifest entries : 326
unique urls      : 167
duplicated urls  : 159   （156 个 icons/items/*.svg + 3 个 icons/pwa/*.png）
```

成因：`includeAssets` 与 `globPatterns` 覆盖同一批文件，`manifest.icons` 里三条又会被插件自动加进 precache。**workbox 用 `Map` 按 url 去重**（`PrecacheController.addToCacheList`），所以不会有重复请求、不会重复占空间，但会让"326"这个数字看起来像是缓存膨胀了一倍。这是噪声，不是缺陷，也不是回归（Phase 2C 就存在）。

### 1.3 关键 Workbox 语义（已读源码确认）

| 机制 | 实际行为 | 对本项目的影响 |
|---|---|---|
| `deleteOutdatedCaches()`（`cleanupOutdatedCaches: true`） | 只删除**名字里含 `-precache-` 且不是当前 precache 缓存**的其他缓存 | **空操作**。precache 缓存名 = `workbox-precache-v2-<scope>`，跨版本恒定。实测缓存只有 1 个 |
| `PrecacheController.activate` | 删除缓存中**不在新清单内**的全部条目 | 这是唯一真正发生删除的地方。因为只在 install 成功后才 activate，**不会为新版本制造缺口**；但旧版本条目在新 SW activate 的瞬间即消失 |
| `PrecacheController.install` | 逐条 `fetch` + `cachePut`；任意一条 `status >= 400` 即抛 `bad-precaching-response`，整个 install 失败 | 全量失败/全量成功，没有"半装成功" |
| `createHandlerBoundToURL` / `PrecacheStrategy._handleFetch` | 若 precache **未命中**，因为 `fallbackToNetwork` 默认 `true`，会**回落到网络** | **这正是"缓存缺一条 → 顶层导航打到网络 → 超时 → Safari 报错"的传导路径** |
| `NavigationRoute` | 只匹配 `request.mode === 'navigate'`，allowlist 默认 `[/./]` | 配置正确 |

### 1.4 Cloudflare 侧实测

```
GET /index.html           -> 307 Temporary Redirect, Location: /
GET /                     -> 200 text/html, Cache-Control: public, max-age=0, must-revalidate
                             md5 与 dist/index.html 一致（2e336a04…），也与 precache 里的 revision 一致
GET /sw.js                -> 200, Cache-Control: public, max-age=0, must-revalidate
GET /assets/*.js|css      -> 200（ETag 存在，但 Cache-Control 仍是 max-age=0）
预缓存 326 条逐个 GET     -> 325 条 200，仅 index.html 是 307
线上 sw.js 与本地 sw.js   -> 长度一致、条目集合一致（仅 glob 顺序不同）
```

`wrangler.jsonc` 的 `assets.run_worker_first: ["/api/*"]` + `not_found_handling: "single-page-application"` 配置正确，`/api/*` 不会被 SPA 回落吃掉。

---

## 2. 生产构建实测（桌面 Chromium / Edge，持久化 profile）

> 平台声明：以下全部是 **Chromium 结果，不是 iOS WebKit**。它用来在桌面侧排除配置级缺陷，**不能**用来证明 iPhone 上的行为。

用本地静态服务器复刻 Cloudflare 行为（`/index.html` → 307 → `/`、SPA 回落、正确的 `Cache-Control`），`vite build` 产物直接喂给 Edge。

### 2.1 首次联网安装（Phase A）

```
manifest urls: 326
t=0.1s active=activated installing=null waiting=null total=167
after +10s: {"active":"activated","total":167}
missing analysis: {"total":326,"have":167,"missing":0,"sample":[]}
index.html in cache: {
  "key": ".../index.html?__WB_REVISION__=2e336a04a57a5efb67a4820b592a3f32",
  "status":200, "type":"default", "redirected":false,
  "respUrl":"",            ← ★ 异常
  "len":2491, "hasRoot":true, "title":"我的物品库"
}
```

**结论：预缓存完整安装，0 缺失。** `registration.active.state = activated`、`navigator.serviceWorker.controller` 非空、`scope = /`、`updateViaCache = imports`。

### 2.2 完全断网冷启动 / 网络在线但域名不可达（Phase B / C）

| 场景 | 做法 | 结果 |
|---|---|---|
| A 完全断网 | 杀掉浏览器进程 → 关掉服务器 → 重新拉起 → `Network.emulateNetworkConditions{offline:true}` → 导航 `/` | **App 正常渲染**，`title=我的物品库`，controller=1 |
| B 在线但域名不可达 | 杀掉浏览器进程 → 换成黑洞服务器（accept 后永不响应，即"服务器停止响应"）→ 重新拉起 → 导航 `/` | **App 正常渲染**，等待窗口内出画面 |

桌面侧两种冷启动**都通过**。也就是说：配置本身没有桌面可复现的冷启动缺陷，**失败不在配置层，而在 iOS/WebKit 层或 iOS 设备状态层**。

### 2.3 A/B：那个 `respUrl: ""` 是怎么来的

同一份产物，只改服务器对 `/index.html` 的响应：

| 服务器行为 | 入库的 App Shell 响应 |
|---|---|
| `/index.html` → **307** → `/`（= 线上 Cloudflare） | `type:"default"`, `respUrl:"" ` ← 合成响应，**没有 URL** |
| `/index.html` → **200** 直出 | `type:"basic"`, `respUrl:"http://…/index.html"` ← 正常响应 |

原因：307 使 workbox 的 `copyRedirectedCacheableResponsesPlugin` 触发 `copyResponse()`，用 `new Response(body, init)` 重建了一个**不带 URL 的**响应（重定向响应不能用于满足导航请求，所以必须重建）。

**这是本轮唯一被测量到的、真实存在的、且在 100% 的线上访问中都会发生的异常**：每次离线（以及在线）冷启动，App Shell 都是由一个 `Response.url === ""` 的对象提供的。Chromium 容忍它；WebKit 是否容忍，**无法在桌面验证**。

---

## 3. 失败层判定：导航层，不是 JS 初始化层

| 用户实测 | 说明 | 推断 |
|---|---|---|
| ① 开代理启动 → 正常 | 文档从网络成功加载 | — |
| ② 已打开状态下开飞行模式，切概览/列表/分类 → 全部正常 | 纯客户端路由，**不产生顶层导航请求**；IndexedDB、React、数据层都没问题 | **JS 初始化层与数据层被证明是健康的** |
| ③ 完全关闭后飞行模式重启 → 长时间白屏 → Safari 报错 | 唯一变化是**多了一次顶层导航** | 失败点在这唯一的新动作上 |

再加上"桌面侧同样的冷启动 100% 成功"，可以定位：

- 不是预缓存没装（§2.1 已证完整）
- 不是 JS 崩了（② 已证健康；而且 JS 崩了会是白屏，**不会**出现 Safari 系统错误页）
- 是**这次顶层导航没有被 Service Worker 从缓存里应答**，最终落回网络 → 不可达/超时 → WebKit 抛出「Safari 无法打开网页，因为服务器已经停止响应」

传导路径与 §1.3 表中 `PrecacheStrategy._handleFetch` 的 `fallbackToNetwork` 完全吻合。

---

## 4. 关于启动期 `registration.update()` 与 `fetch(sw.js, {cache:'no-store'})`

**结论：它们不是冷启动失败的原因。相关性 ≠ 因果性。**

理由（时序证据，来自 `src/main.tsx`）：

```
createRoot(...).render(...)      ← 首屏，游戏已经结束
startPwaUpdate()                 ← registerSW() / fetch(sw.js) / registration.update()
startSync(); requestSync('boot')
```

这三件事全部排在 `render()` **之后**。如果首次导航根本没完成，这些代码**一行都不会执行**。因此它们不可能造成"导航失败"。它们只能造成"已经打开的页面在后台多打几次网络请求"。

但它们也不是完全无害（对 iOS 而言）：每次启动会对 `sw.js` 发起 **3 次网络尝试**

1. `registerSW()` → `navigator.serviceWorker.register()` 的隐式 soft update
2. `fetch(swUrl, { cache: 'no-store' })`（显式绕过 HTTP 缓存）
3. `registration.update()`

`updateViaCache` 实测为 `imports`（默认），即主 SW 脚本**不走 HTTP 缓存**。在"网络在线但域名不可达"这种会挂住的网络环境下，这些请求会长时间 pending。

---

## 5. Phase 2H.1（`c9eced6`）回归判定：**无**

```
$ git diff c9eced6..HEAD -- src/services/pwaUpdate.ts src/features/pwa
（空）
```

`pwaUpdate.ts` / `updateManager.ts` / `updatePolicy.ts` 自 2H.1 起**零改动**。2H.1 之后与 PWA 有关的改动只有两处：

- `vite.config.ts`：把 `includeAssets` 里 PNG 的显式声明删掉（注释性质，`globPatterns` 本来已覆盖）→ 无行为变化
- `src/main.tsx`：新增 `startSync()` / `requestSync('boot')`（未启用同步时零网络请求，且非阻塞）

2H.1 相对 Phase 2C（`7b53b0e`）改了：
- `injectRegister: 'auto'` → `null`，注册点从 index.html 内联脚本改为 `startPwaUpdate()`
- 新增 boot / pageshow / visibilitychange 的主动更新检查
- 新增 `onNeedReload` → `markUpdateAvailable()` → 条件满足时 `window.location.reload()`

这三项都发生在文档加载之后，**无法影响首次导航**。没有找到可证实的冷启动回归。

⚠️ 唯一值得后续观察的 2H.1 副作用：`skipWaiting + clientsClaim + onNeedReload` 组合会在新版本 activate 时**立即 reload 页面**（有 15s sessionStorage 防循环窗口）。它不影响离线冷启动，但会让"频繁迭代"期间用户被反复打断。

---

## 6. `cleanupOutdatedCaches` 与版本切换的缓存缺口

- `cleanupOutdatedCaches`：**空操作**，已证实（缓存名跨版本恒定，实测只有 1 个 cache）→ **不存在**由它导致的资源缺失。
- 真正会删东西的是 `PrecacheController.activate`（删除不在新清单内的条目）。因为只在 install 成功后执行，**新版自身不会缺**。
- 存在的理论空窗：`skipWaiting` 使新 SW 一装好就 activate，旧条目立刻被删，而**当时打开的页面仍在跑旧版本 HTML/JS**。本项目产物是单 bundle（`index-*.js` + `index-*.css` 全部 precache），风险低；若将来引入按需 chunk，这个空窗会变成真问题。
- 本次**未能**在桌面跑通"新旧交替"运行时验证（沙箱进程资源耗尽，EBUSY），该项标记：**静态证实 + 运行时未验证**。

---

## 7. 前台更新检查 60s → 15–30 分钟：需要吗？

`updatePolicy.ts` 的节流只对 `visible` / `pageshow` 生效：

```ts
if (input.reason === 'manual' || input.reason === 'online' || input.reason === 'boot') return true
```

- **能做到**：减少 iOS 上"切回前台 / pageshow"时对 `sw.js` 的网络请求次数；降低在坏网络里挂起的请求数量。
- **做不到**：
  - 改不了冷启动 —— `boot` 绕过节流，且冷启动失败发生在这些代码执行之前
  - 修不了 SW 不接管导航
  - 修不了预缓存缺失
- 建议：**不要把它当作冷启动的修复手段**。作为"减少 iOS 无谓网络请求"的卫生措施可以做，优先级排在 §8 的 A/B 之后。

---

## 8. 最小修复建议（按优先级）

### A. 让 App Shell 以非重定向响应入库 —— 推荐首选

- **问题**：`navigateFallback: '/index.html'`，而 Cloudflare 对 `/index.html` 返回 `307 → /`，workbox 因此把 App Shell 存成一个 `Response.url === ""` 的合成响应（§2.3 已实测）。
- **改法（只动 `vite.config.ts`，不动 Cloudflare，不增加缓存量，不关自动更新）**：

  ```ts
  workbox: {
    navigateFallback: '/',
    additionalManifestEntries: [{ url: '/', revision: <构建期 hash 或时间戳> }],
    // 其余不变
  }
  ```

  `/` 在 Cloudflare 上是 200 直出（已实测），会以 `type:"basic"`、`url` 正确的响应入库。
- **替代方案**（需改 Cloudflare，本轮不做）：让 `/index.html` 直出 200。
- **收益**：消除一个在每次冷启动都存在的、可在桌面测量的异常形态；风险极低；改动面最小。

### B. 启动期不要立刻打网络

- 把 `requestCheck('boot')` 从"注册完立刻"延后到 `offlineReady` 之后 + 首次空闲/交互之后再发。
- 保留 `navigator.onLine === false` 时跳过（已有）。
- **注意**：这不修冷启动导航，只是移除 iOS 启动瞬间挂住的网络请求的诱因。

### C. 把已存在的 `offlineReady` 暴露出来（仅评估，本轮不实现 UI）

- `PwaUpdateSnapshot.offlineReady` **已经存在且有值**（workbox `installed` 事件触发），但全项目**零消费点**（只有 `UpdateBanner` 用了 `updatePending/blocked/applying`）。
- 建议在设置页加一行"离线可用：是/否（App Shell 已缓存）"，或至少在 `window.__pwa` 上暴露。
- **价值**：这是后续所有 iOS 真机排查的前置条件 —— 一次就能区分「SW 根本没装成功」和「SW 装好了但导航没被接管」。成本最低、收益最高。

### D. 顺手清理（可选）

- 去掉 `includeAssets` 里与 `globPatterns` 重复的 159 条：把 precache 清单从 326 条降到 167 条。纯噪声清理，无行为变化。

### E. 明确不建议

- 扩大缓存 / 提高缓存上限
- 关闭 PWA 自动更新
- 删除 Cache Storage / SW 注册
- 改 `run_worker_first` 或 D1 / 同步协议

---

## 9. 现有生产冒烟测试的覆盖缺口

`scripts/verify-deploy.mjs` 的离线步骤（第 4 项）实质是：

```js
Network.emulateNetworkConditions({ offline: true })
Page.reload()          // ← 在"已经打开的页面"上 reload
```

它**没有**覆盖：

1. 已安装 PWA 的 SW 注册 / 激活 / controlling 状态断言（只判了 `active || installing`）
2. precache 是否**装全**（关键 App Shell 是否真的在 Cache Storage 里）
3. **完全终止浏览器进程后**重启的离线导航（真正的冷启动）
4. 网络接口在线但**目标域名不可达/超时**的导航
5. 新旧 SW 交替时的缓存缺口
6. standalone 与 Safari 页面态的区分（桌面无法模拟，只能标注）

建议补充的诊断范围（本轮未实现）：SW 状态机快照（active/installing/waiting/controller/scope）、Cache Storage 全量清点 + 与 precache 清单求差、杀进程后重启的离线/黑洞导航、版本切换前后缓存条目 diff。

---

## 10. 必须回到 iPhone 真机确认的项

1. **冷启动瞬间 `navigator.serviceWorker.controller` 是否为 null**（需要在首帧之前埋点，或在设置页显示）。
2. **iOS standalone 冷启动是否会强制重新请求 `sw.js`** —— 若会，则"网络在线但域名不可达"必然挂起，这与"长时间白屏 → 服务器停止响应"的症状最吻合。
3. **iOS standalone 与 Safari 是否共享同一份 SW 注册 / Cache Storage**（历史上 iOS 对主屏 Web App 使用独立数据容器，且 SW 注册有被系统回收的报告）。这正是"不能默认两者共享相同状态"的原因。
4. **设备上 Cache Storage 里是否真的有 `index.html`** —— 若被 iOS 回收，则一切配置修复都无效，需要重新「添加到主屏幕」并联网完整打开一次。
5. **`Response.url === ""` 的 App Shell 在 WebKit 上能否满足导航请求** —— §8-A 的修复是否真的解决问题，只能靠真机验证。

---

## 附：本轮产生的证据文件（均在 `.tmp/`，已被 gitignore）

- `.tmp/audit/coldstart.mjs` —— 冷启动驱动（A 断网 / B 黑洞 / D 版本交替）
- `.tmp/audit/phaseA.mjs` —— 预缓存安装进度与缺失分析
- `.tmp/audit/ab.mjs` —— 307 与 200 的 A/B 对照
- `.tmp/audit/server.mjs` —— 复刻 Cloudflare 行为的静态服务器（normal / blackhole / noredirect）
- `.tmp/audit/live_precache_check.mjs` —— 线上 326 条预缓存资源可达性
- `.tmp/audit/report.json`
