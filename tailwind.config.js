/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * 字号：映射 iOS Dynamic Type 默认显示档（HIG），并按中文密度做半档下调。
       *   page-title  ← Title 1 (28/34)
       *   title-card  ← Title 2 (22/28)
       *   section     ← Headline (17/22)
       *   item        ← Subhead (15/20)  中文 glyph 密度高于拉丁，卡片标题取 Subhead 档
       *   body        ← Callout (16/21)
       *   secondary   ← Footnote (13/18)
       *   caption     ← Caption 1 (12/16)
       */
      fontSize: {
        'page-title': ['28px', { lineHeight: '34px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'title-card': ['22px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        section: ['17px', { lineHeight: '22px', fontWeight: '600' }],
        item: ['15px', { lineHeight: '20px', fontWeight: '500' }],
        body: ['16px', { lineHeight: '1.5' }],
        secondary: ['13px', { lineHeight: '18px' }],
        caption: ['12px', { lineHeight: '16px' }],
      },
      colors: {
        canvas: '#FAFAFA',
        /* 文字层级（浅色模式）：次级信息必须满足 WCAG AA 4.5:1 */
        ink: {
          primary: '#171717',   /* neutral-900  ~17:1 */
          secondary: '#525252', /* neutral-600   ~7:1 */
          tertiary: '#737373',  /* neutral-500   ~4.6:1 用于必须可读的辅助信息 */
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04)',
      },
      transitionTimingFunction: {
        /* 弹簧近似：临界阻尼（bounce 0），100ms 按压 / 300ms 结构变化 */
        'out-quint': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}
