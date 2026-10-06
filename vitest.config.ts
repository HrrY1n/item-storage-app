import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
    // Worker 侧的纯逻辑（删除不被复活、常数时间比较、游标推进）同样必须被测到 ——
    // 它是安全边界的所在，不能因为放在 worker/ 目录就漏掉。
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    // 少数测试需要读取 index.css / index.html 的原始内容（主题 token 对称性、防闪烁脚本），
    // 打开 CSS 处理才能让 `?raw` 拿到源码而不是被 stub 成空串。
    css: true,
  },
})
