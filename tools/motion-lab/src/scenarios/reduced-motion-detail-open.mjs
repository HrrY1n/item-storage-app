// 场景 7：prefers-reduced-motion 下的详情面板打开。
// 预期：所有动画被抑制为瞬时切换（transition:none !important + duration 0.01ms），
// 面板仍能完成状态切换（这是功能断言），无动画区间（如实记录，不测帧率）。

import { CARD_LINK, openItemList } from './lib.mjs'
import { panelTargets } from './lib.mjs'

export default {
  id: 'reduced-motion-detail-open',
  title: '减少动态效果：详情面板打开',
  description: 'CDP 模拟 prefers-reduced-motion: reduce 后点击卡片。预期面板瞬时出现（无过渡），本场景验证抑制是否真实生效，不测帧率。',
  viewport: { width: 390, height: 844, dpr: 2 },
  media: { reducedMotion: true },
  spec: {
    reducedMotion: true, maxReducedMs: 50,
    primary: { label: 'panel', signal: 'ty', declaredMs: 480, monotonic: true, eventProperty: 'transform' },
    secondary: [{ label: 'backdrop', signal: 'o', declaredMs: 220 }],
  },

  async run(ctx) {
    const { page } = ctx
    await openItemList(page)
    const before = await page.screenshot('before')

    const record = await page.capture({
      targets: panelTargets(),
      click: CARD_LINK,
      settleMs: 420,
      maxMs: 2600,
    })
    await page.waitAnimationsIdle()
    const after = await page.screenshot('after')

    const itemPath = await page.ev(`document.querySelector(${JSON.stringify(CARD_LINK)})?.getAttribute('href')`)
    const checks = [
      {
        name: '面板仍进入 open+ready 终态（功能不受影响）',
        pass: await page.ev(`!!document.querySelector('.modal-sheet[data-state="open"][data-ready="true"]')`),
      },
      {
        name: '页面 prefers-reduced-motion 确为 reduce',
        pass: await page.ev(`matchMedia('(prefers-reduced-motion: reduce)').matches`),
      },
      {
        name: `路由仍切换到详情`,
        pass: Boolean(itemPath) && (await page.ev(`location.pathname === ${JSON.stringify(itemPath)}`)),
      },
    ]

    return {
      record,
      shots: [before, after],
      checks,
      notes: ['减少动态效果下不采集关键帧冻结截图（无动画可冻结）'],
    }
  },
}
