import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * 应用主题色：必须与 Phase 2H 的浅色 canvas token 一致。
 * （旧值 #FAFAFA 是 2H 之前的 canvas，2H 已改为冷灰 #F2F2F4）
 */
const CANVAS = '#F2F2F4'

/**
 * 预缓存清单条目：`ManifestEntry` 的必填字段 + workbox 在 transform 阶段附带的 `size`。
 * 这里手写而不从 workbox-build 导入类型 —— workbox-build 是 vite-plugin-pwa 的依赖，
 * 不是本项目的直接依赖，直接 import 它的类型属于隐式依赖。
 */
type PrecacheManifestEntry = {
  url: string
  revision: string | null
  size: number
}

/**
 * App Shell 在预缓存清单里的入口：
 * - 构建产物里的文件名是 `index.html`（workbox 的 glob 结果是相对 globDirectory 的路径）；
 * - 线上 Cloudflare 对 `/index.html` 返回 **307 → `/`**（实测，见
 *   docs/audit/ios-pwa-offline-coldstart.md），workbox 在预缓存时遇到重定向会用
 *   `copyResponse()` 复制出一份 `Response.url === ""` 的合成响应存进 Cache Storage。
 *   桌面 Chromium 能消费这份响应，WebKit 的行为未知 —— 这是 iOS 主屏 PWA 离线冷启动
 *   失败路径上唯一被实测到的异常。
 *
 * 因此把 App Shell 的缓存入口改写成 `/`：线上 `/` 是 200、不重定向，
 * workbox 存进缓存的就是一个 `url` 正常的 `basic` 响应。
 *
 * 这里是**改写已有条目**而不是用 `additionalManifestEntries` 新增一条：
 * - `manifestTransforms` 在 workbox 的 transform 流水线里倒数第二执行，拿到的条目已经带
 *   内容哈希 `revision`，直接沿用即可 —— 既不会退化成时间戳，也不需要读上一次构建
 *   残留的 dist/index.html；
 * - `additionalManifestEntries` 是**最后**一步执行的，拿不到哈希，只能写死或用文件读取，
 *   两条路都被明确禁止；
 * - 改写而不是新增，避免同一份 App Shell 在缓存里存两份。
 */
const APP_SHELL_FILE = 'index.html'
const APP_SHELL_URL = '/'

const mapAppShellToRoot = (
  entries: PrecacheManifestEntry[],
): { manifest: PrecacheManifestEntry[] } => {
  let rewritten = 0
  const manifest = entries.map((entry) => {
    if (entry.url !== APP_SHELL_FILE && entry.url !== `/${APP_SHELL_FILE}`) return entry
    rewritten += 1
    return { ...entry, url: APP_SHELL_URL }
  })
  if (rewritten !== 1) {
    throw new Error(
      `[vite.config] 预期把恰好 1 条 ${APP_SHELL_FILE} 改写为 ${APP_SHELL_URL}，实际匹配 ${rewritten} 条；` +
        '这说明 globPatterns / manifestTransforms 的顺序变了，离线 App Shell 入口可能失效。',
    )
  }
  return { manifest }
}

export default defineConfig({
  /**
   * 文件监听忽略清单。
   * `.tmp/` 放着本地端到端验证用的浏览器 profile 与截图，Edge 运行时每秒都在写文件；
   * 不忽略的话 Vite 会不停触发整页 reload，既干扰人工调试，也会让自动化截图拿到半渲染的页面。
   */
  server: {
    watch: {
      ignored: ['**/.tmp/**', '**/edge-profile/**', '**/dist/**', '**/.wrangler/**'],
    },
  },
  plugins: [
    react(),
    VitePWA({
      // 有新版本时后台自动更新，不设计复杂的版本管理 UI
      registerType: 'autoUpdate',
      /**
       * 注册路径必须唯一：应用代码通过 `virtual:pwa-register` 的 registerSW() 注册，
       * 因此这里显式设为 null，插件不再向 index.html 注入 /registerSW.js
       * （保留 'auto' 会与手动注册并存，出现两个 registration 来源）。
       */
      injectRegister: null,
      /**
       * 物品图标（SVG）显式列入 precache。
       *
       * 不再在这里重复声明 PWA App Icon 的 PNG：workbox 的 `globPatterns` 已经覆盖构建产物里
       * 全部 png，manifest.icons 里的三条也会被插件自动加进 precache —— 显式再写一遍只会
       * 产生同名条目（revision 相同，workbox 的 cache key 一致，不冲突；但没必要）。
       */
      includeAssets: ['icons/items/*.svg'],
      manifest: {
        id: '/',
        name: '私人数字物品库',
        short_name: '物品库',
        description: '本地优先的个人物品管理工具，数据保存在本机浏览器中。',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: CANVAS,
        background_color: CANVAS,
        icons: [
          {
            src: '/icons/pwa/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/pwa/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            /**
             * maskable 与 pwa-512x512.png **内容完全相同**：母版是 full-bleed 方形，
             * 主体最大半径 0.394 ≤ 0.4（规范安全圆），因此不需要为 maskable 单独缩小构图、
             * 更不允许补白边（gen-pwa-icons.mjs 的 assertMaskableSafe 会在生成时强制这条不变量）。
             * 保留独立文件名是为了让 manifest 的 purpose 与文件一一对应，将来若要单独微调 maskable 有落点。
             */
            src: '/icons/pwa/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App Shell 预缓存：HTML / JS / CSS / preset icons / PWA icons
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        /**
         * 单页应用离线导航：任意路径回落到 **`/`**，而不是 `/index.html`。
         * 原因见上面的 `mapAppShellToRoot` —— `/index.html` 在线上会 307 重定向，
         * `/` 不会。
         */
        navigateFallback: APP_SHELL_URL,
        /**
         * 把构建产物里的 `index.html` 清单项改写成 `/`，让 `navigateFallback`
         * 指向的 URL 真的在预缓存清单里，且 revision 仍是那份 HTML 的内容哈希。
         */
        manifestTransforms: [mapAppShellToRoot],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // 当前没有后端 API，不配置任何 runtime caching
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
})
