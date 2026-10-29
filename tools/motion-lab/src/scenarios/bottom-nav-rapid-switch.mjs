// 场景 14：底部导航快速切换/中途改向（REF_03_bottom_nav_switch 的健壮性补充）。
// 主采集：280ms 滑动进行到约一半时改点更远的 Tab，要求指示器从当前位置平滑重定向，
// 不瞬移、不重置、路由与 aria-current 终态正确。附加断言：三连击、同 Tab 重复点击。

import { openItemList } from './lib.mjs'

const NAV = 'nav[aria-label="主导航"]'
const link = href => `${NAV} .nav-links a[href="${href}"]`

export default {
  id: 'bottom-nav-rapid-switch',
  title: '底部导航：中途改向 / 三连击 / 重复点击',
  description:
    '主采集在指示器滑动中途（约 140ms）改点更远目标，验证 CSS 过渡平滑重定向（连续曲线、无位置重置）。' +
    '随后做三连击（概览→列表→分类→搜索）与同 Tab 重复点击的功能断言。',
  viewport: { width: 390, height: 844, dpr: 2 },
  spec: {
    // 输入驱动：改向时刻/幅度由 CDP 点击节奏决定，不做时长/幅度基线断言（见 baseline.mjs 的豁免）。
    inputDriven: true,
    primary: { label: 'indicator', signal: 'tx', declaredMs: null, eventProperty: 'transform' },
    secondary: [{ label: 'route', signal: 'tx', declaredMs: null, allowRemount: true }],
  },

  async run(ctx) {
    const { page } = ctx
    await openItemList(page)
    const categories = await page.prepareClick(link('/categories'))
    const search = await page.prepareClick(link('/search'))
    const before = await page.screenshot('before')

    // 主采集：点击「分类」，约 140ms（滑动中段）改点「搜索」。净位移 = 2 个 Tab 宽。
    const record = await page.captureSequence({
      targets: [
        { sel: '.nav-indicator', label: 'indicator' },
        { sel: '.route-content', label: 'route' },
      ],
      clicks: [{ point: categories }, { point: search, afterMs: 260 }],
      settleMs: 480,
      maxMs: 2600,
    })
    await page.waitAnimationsIdle()
    const after = await page.screenshot('after')

    const txSeries = (record.frames ?? []).map(frame => frame.tg.indicator?.tx).filter(Number.isFinite)
    // 重定向健康度：整条曲线连续（相邻采样差不超过 1.6 个 Tab 宽 = 无瞬移），终态落在搜索位。
    const tabWidth = (record.frames ?? []).find(frame => frame.tg.indicator?.w)?.tg.indicator.w ?? 1
    let maxStep = 0
    for (let i = 1; i < txSeries.length; i++) maxStep = Math.max(maxStep, Math.abs(txSeries[i] - txSeries[i - 1]))
    const checks = [
      {
        name: '滑动中途改向后路由与 aria-current 落在 /search',
        pass: await page.ev(`location.pathname === '/search' && document.querySelector(${JSON.stringify(link('/search'))}).getAttribute('aria-current') === 'page'`),
      },
      {
        name: `重定向曲线连续无瞬移（相邻帧最大位移 ${Math.round(maxStep * 10) / 10}px ≤ 1.6 Tab 宽）`,
        pass: maxStep <= tabWidth * 1.6,
      },
      {
        name: '指示器终态停在搜索位（净位移 2 个 Tab 宽）',
        pass: Math.abs(txSeries.at(-1) - txSeries[0] - 2 * tabWidth) < 1,
      },
    ]

    // 附加 A：三连击（概览→列表→分类→搜索），路由与指示器终态必须正确。
    await page.click(link('/'))
    await page.until(`location.pathname === '/'`)
    await page.waitAnimationsIdle()
    const items = await page.prepareClick(link('/items'))
    const categoriesAgain = await page.prepareClick(link('/categories'))
    const searchAgain = await page.prepareClick(link('/search'))
    await page.dispatchClick(items)
    await page.dispatchClick(categoriesAgain)
    await page.dispatchClick(searchAgain)
    await page.waitAnimationsIdle()
    checks.push({
      name: '三连击后路由停在 /search 且指示器存在',
      pass: await page.ev(`location.pathname === '/search' && !!document.querySelector('.nav-indicator')`),
    })

    // 附加 B：快速重复点击同一 Tab —— 指示器位置不应漂移。
    const txBefore = await page.ev(`new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.nav-indicator')).transform).m41`)
    for (let i = 0; i < 3; i++) await page.dispatchClick(searchAgain)
    await page.waitAnimationsIdle()
    const txAfterRepeat = await page.ev(`new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.nav-indicator')).transform).m41`)
    checks.push({
      name: `重复点击同一 Tab 后指示器位置不漂移（${Math.round(txBefore * 10) / 10} → ${Math.round(txAfterRepeat * 10) / 10}px）`,
      pass: await page.ev(`location.pathname === '/search'`) && Math.abs(txAfterRepeat - txBefore) < 0.5,
    })

    return { record, shots: [before, after], checks, notes: [`tabWidth=${Math.round(tabWidth)}px，重定向最大相邻帧位移 ${Math.round(maxStep * 10) / 10}px`] }
  },
}
