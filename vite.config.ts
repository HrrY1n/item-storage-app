import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * 应用主题色：必须与 Phase 2H 的浅色 canvas token 一致。
 * （旧值 #FAFAFA 是 2H 之前的 canvas，2H 已改为冷灰 #F2F2F4）
 */
const CANVAS = '#F2F2F4'

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
        // 单页应用离线导航：任意路径回落到 index.html
        navigateFallback: '/index.html',
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
