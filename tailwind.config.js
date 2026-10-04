/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * 字号：映射 iOS Dynamic Type 默认显示档（HIG），并按中文密度做半档下调。
       * 另加一组「展示级」字号用于数据指标与页面标题的视觉锚点。
       */
      fontSize: {
        'page-title': ['28px', { lineHeight: '34px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'title-card': ['22px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        section: ['17px', { lineHeight: '24px', letterSpacing: '-0.005em', fontWeight: '600' }],
        item: ['15px', { lineHeight: '21px', fontWeight: '500' }],
        body: ['16px', { lineHeight: '1.6' }],
        secondary: ['13px', { lineHeight: '19px' }],
        caption: ['12px', { lineHeight: '17px' }],
        /* 展示级：指标数字（等宽数位，避免跳动） */
        metric: ['30px', { lineHeight: '36px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'metric-lg': ['38px', { lineHeight: '44px', letterSpacing: '-0.025em', fontWeight: '600' }],
        /* 眉标：中文短标签，字距微开（中文不宜大间距） */
        label: ['11px', { lineHeight: '14px', letterSpacing: '0.06em', fontWeight: '500' }],
        /* 拉丁眉标：全大写 + 明显字距，用于英文小标题 */
        eyebrow: ['10.5px', { lineHeight: '14px', letterSpacing: '0.16em', fontWeight: '600' }],
      },
      colors: {
        canvas: '#FAFAFA',
        /**
         * 单一强调色：陶土（clay）。
         * 只用于「有意义的强调」——指标、选中态点缀、关键分隔线，绝不铺面。
         * 对比度：#B4553B on #FFF ≈ 4.9:1（AA 达标）
         */
        accent: {
          DEFAULT: '#B4553B',
          soft: '#F7F0EB',
          line: '#E7D9CF',
        },
        /* 文字层级（浅色模式）：次级信息必须满足 WCAG AA 4.5:1 */
        ink: {
          primary: '#171717',   /* ~17:1 */
          secondary: '#525252', /* ~7:1 */
          tertiary: '#737373',  /* ~4.6:1 必须可读的辅助信息 */
          faint: '#A3A3A3',     /* 仅用于占位符/装饰，不承载语义 */
        },
        /* 结构线：hairline 统一由这一族控制 */
        line: {
          DEFAULT: 'rgba(23,23,23,0.06)',
          strong: 'rgba(23,23,23,0.10)',
          inner: 'rgba(23,23,23,0.045)',
        },
      },
      spacing: {
        '4.5': '18px',
        '5.5': '22px',
        '14': '56px',
        '18': '72px',
        '22': '88px',
      },
      boxShadow: {
        /* 卡片：极轻，靠 border 而非阴影建立边界 */
        card: '0 1px 2px rgba(16,16,16,0.045)',
        /* 抬起：悬浮层/桌面端取景 */
        lift: '0 18px 48px -20px rgba(16,16,16,0.22), 0 4px 12px -6px rgba(16,16,16,0.10)',
        /* 浮层：对话框 */
        sheet: '0 24px 64px -16px rgba(16,16,16,0.28)',
        /* FAB */
        fab: '0 8px 22px -6px rgba(16,16,16,0.32), 0 2px 6px -2px rgba(16,16,16,0.18)',
      },
      transitionTimingFunction: {
        /* 结构变化：临界阻尼，不回弹 */
        'out-quint': 'cubic-bezier(0.22, 1, 0.36, 1)',
        /* 微交互：轻微过冲，制造"有弹性"的手感（spring bounce ≈ 0.2） */
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        /* 进出场对称曲线 */
        'in-out-quint': 'cubic-bezier(0.83, 0, 0.17, 1)',
      },
      /* 说明：入场动画不在此处定义。
         它们在 src/index.css 中按 prefers-reduced-motion 门控 —— 动画是渐进增强，
         绝不能成为"内容可见"的前提条件（动画被暂停/降级时内容必须照常显示）。 */
    },
  },
  plugins: [],
}
