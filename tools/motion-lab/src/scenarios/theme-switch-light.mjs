import { themeSpec, runTheme } from './theme-switch.mjs'
export default { id: 'theme-switch-light', title: '主题深色→浅色', description: '独立采集深色返回浅色方向。',
  viewport: { width: 390, height: 844, dpr: 2 }, media: { colorScheme: 'light' }, spec: themeSpec, run: ctx => runTheme(ctx, 'light') }
