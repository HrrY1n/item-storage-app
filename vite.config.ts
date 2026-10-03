import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** 应用主题色（与 tailwind canvas / index.html theme-color 保持一致） */
const CANVAS = '#FAFAFA'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 有新版本时后台自动更新，不设计复杂的版本管理 UI
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // public/ 下需要一并进入 precache 清单的静态资源
      includeAssets: ['icons/items/*.svg', 'icons/pwa/apple-touch-icon-180x180.png'],
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
