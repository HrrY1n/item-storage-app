// 场景 4：底部导航切换（物品 → 分类）。
// 两层动画：.nav-indicator 选中底板位移（transform 280ms）+ .route-content 页面横移 keyframes（180ms）。

import { openItemList } from './lib.mjs'

const NAV_LINK = 'nav[aria-label="主导航"] a[href="/categories"]'
const ITEMS_LINK = 'nav[aria-label="主导航"] a[href="/items"]'

export default {
  id: 'bottom-nav-switch',
  title: '底部导航：物品 → 分类',
  description: '点击底栏「分类」入口，测量选中底板 .nav-indicator 的连续位移（transform 280ms）与页面内容 route-forward 过渡（180ms keyframes）。',
  viewport: { width: 390, height: 844, dpr: 2 },
  spec: {
    primary: { label: 'indicator', signal: 'tx', declaredMs: 280, monotonic: true, eventProperty: 'transform' },
    secondary: [{ label: 'route', signal: 'tx', declaredMs: 180, allowRemount: true, eventProperty: 'route-forward' }],
  },

  async run(ctx) {
    const { page } = ctx
    await openItemList(page)
    const before = await page.screenshot('before')

    const record = await page.capture({
      targets: [
        { sel: '.nav-indicator', label: 'indicator' },
        { sel: '.route-content', label: 'route' },
      ],
      click: NAV_LINK,
      settleMs: 420,
      maxMs: 2600,
    })
    await page.waitAnimationsIdle()
    const after = await page.screenshot('after')

    const checks = [
      {
        name: '分类入口 aria-current=page',
        pass: await page.ev(`document.querySelector(${JSON.stringify(NAV_LINK)}).getAttribute('aria-current') === 'page'`),
      },
      {
        name: '路由已切换到 /categories',
        pass: await page.ev(`location.pathname === '/categories'`),
      },
      {
        name: '底板实际位移与一个 Tab 宽一致',
        pass: (() => { const values=record.frames.map(f=>f.tg.indicator).filter(Boolean); return Math.abs(values.at(-1).tx-values[0].tx-values.at(-1).w)<1 })(),
      },
    ]

    const stills = []
    for (const fraction of (ctx.runIndex === 1 && !page.skipStills ? [0.25, 0.5, 0.75] : [])) {
      await page.click(ITEMS_LINK)
      await page.until(`location.pathname === '/items'`)
      await page.waitAnimationsIdle()
      const shot = await page.stillShot(`mid-${Math.round(fraction * 100)}`, {
        click: NAV_LINK,
        matchSel: '.nav-indicator',
        matchProp: 'transform',
        // Route overflow changes the mobile viewport until its own animation ends.
        settleSel: '.route-content',
        fraction,
        expectedMs: 280,
      })
      stills.push(shot)
      await page.until(`location.pathname === '/categories'`)
      await page.waitAnimationsIdle()
    }

    return { record, shots: [before, after, ...stills], checks }
  },
}
