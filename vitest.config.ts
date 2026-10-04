import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['src/**/*.test.ts'],
    // 少数测试需要读取 index.css / index.html 的原始内容（主题 token 对称性、防闪烁脚本），
    // 打开 CSS 处理才能让 `?raw` 拿到源码而不是被 stub 成空串。
    css: true,
  },
})
