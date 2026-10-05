/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /**
       * 字号：映射 iOS Dynamic Type 默认显示档（HIG），并按中文密度做半档下调。
       * 另加一组「展示级」字号用于数据指标与页面标题的视觉锚点。
       *
       * 字距按**文字脚本**区分，这是中文排版与英文排版最容易搞错的地方：
       * - 标题（page-title / title-card / section）在中文界面里几乎全是 CJK 字形。
       *   CJK 是方块字、自带左右边距，负字距会让字面互相挤压，正确做法是**略微开一点**。
       * - 指标数字（metric / metric-lg）是纯阿拉伯数字 + 等宽数位，负字距才是正解。
       */
      fontSize: {
        'page-title': ['28px', { lineHeight: '34px', letterSpacing: '0.01em', fontWeight: '600' }],
        'title-card': ['22px', { lineHeight: '28px', letterSpacing: '0.01em', fontWeight: '600' }],
        section: ['17px', { lineHeight: '24px', letterSpacing: '0.02em', fontWeight: '600' }],
        item: ['15px', { lineHeight: '21px', fontWeight: '500' }],
        body: ['16px', { lineHeight: '1.6' }],
        secondary: ['13px', { lineHeight: '19px' }],
        caption: ['12px', { lineHeight: '17px' }],
        /* 展示级：指标数字（等宽数位 + 负字距，避免刷新时宽度跳动） */
        metric: ['30px', { lineHeight: '36px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'metric-lg': ['38px', { lineHeight: '44px', letterSpacing: '-0.025em', fontWeight: '600' }],
        /* 眉标：中文短标签，字距微开（中文不宜大间距） */
        label: ['11px', { lineHeight: '14px', letterSpacing: '0.06em', fontWeight: '500' }],
      },
      /**
       * 颜色：**全部指向 CSS 语义变量**（见 src/index.css 的双主题定义）。
       * 组件写意图（"这是 surface"），主题给值，因此深色模式无需到处写 dark: 变体。
       * 新增颜色前先问：它是不是某个已有 token 的另一种说法？
       */
      colors: {
        /* 页面底 */
        canvas: 'var(--color-canvas)',
        /* 卡片 / 列表行：一「张」内容的载体 */
        surface: {
          DEFAULT: 'var(--color-surface)',
          raised: 'var(--color-surface-raised)',
          sunken: 'var(--color-surface-sunken)',
        },
        /* 物品底衬：图标陈列其上的"展台"，深浅主题观感不同但语义一致 */
        plate: 'var(--color-plate)',
        /* 文字层级 */
        ink: {
          primary: 'var(--color-ink-primary)',
          secondary: 'var(--color-ink-secondary)',
          tertiary: 'var(--color-ink-tertiary)',
          faint: 'var(--color-ink-faint)',
          /* 写在 ink-solid 之上的文字 / 图标 */
          inverse: 'var(--color-ink-inverse)',
          /* 实心墨色块（主按钮、FAB、Toast） */
          solid: 'var(--color-ink-solid)',
        },
        /* 结构线：hairline 统一由这一族控制 */
        line: {
          DEFAULT: 'var(--color-line)',
          strong: 'var(--color-line-strong)',
          inner: 'var(--color-line-inner)',
        },
        /**
         * 品牌强调色：陶土。只用于「有意义的强调」——
         * 选中态、导航指示、极少量点缀，绝不铺面。
         */
        accent: {
          DEFAULT: 'var(--color-accent)',
          soft: 'var(--color-accent-soft)',
          line: 'var(--color-accent-line)',
        },
        /**
         * 金钱语义色：价格 / 总投入 / 日均成本。
         * 与品牌色刻意分开 —— 数据指标不该和"可交互"共用同一种颜色。
         */
        money: {
          DEFAULT: 'var(--color-money)',
          deep: 'var(--color-money-deep)',
          soft: 'var(--color-money-soft)',
          line: 'var(--color-money-line)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          soft: 'var(--color-success-soft)',
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          soft: 'var(--color-danger-soft)',
        },
        overlay: 'var(--color-overlay)',
      },
      spacing: {
        '4.5': '18px',
        '5.5': '22px',
        '14': '56px',
        '18': '72px',
        '22': '88px',
      },
      /**
       * 圆角体系：用"半径大小"表达层级，而不是每个组件各定一个值。
       *
       *   control 10px  → 输入控件、按钮、小缩略图（最小单位）
       *   card    14px  → 独立内容卡片（物品卡、分类卡）
       *   surface 18px  → 承载多块内容的表面（分组列表、信息卡、大图容器）
       *   sheet   22px  → 浮层（对话框、底部面板）
       *   app     28px  → 桌面端 App Shell 取景框
       *   pill    full  → 胶囊（chip、FAB、Toast）
       */
      /* 物体展示容器的统一圆角：与 card 同级，避免"每个组件一个 radius" */
      borderRadius: {
        control: '10px',
        card: '14px',
        surface: '18px',
        sheet: '22px',
        app: '28px',
        pill: '9999px',
      },
      /**
       * 阴影：同样走语义变量 —— 深色主题需要更重、更收敛的阴影，
       * 否则浅色下正好用的值在深色里会变成一圈灰雾。
       */
      boxShadow: {
        /* 卡片：极轻，靠 border 而非阴影建立边界 */
        card: 'var(--shadow-card)',
        /* 抬起：悬浮层/桌面端取景 */
        lift: 'var(--shadow-lift)',
        /* 浮层：对话框 */
        sheet: 'var(--shadow-sheet)',
        /* FAB */
        fab: 'var(--shadow-fab)',
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
