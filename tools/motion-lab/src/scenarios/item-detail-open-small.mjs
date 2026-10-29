// 场景 8：小屏视口（360×760）下的详情面板打开。
// 复用 item-detail-open 的流程，仅改变视口，验证小屏下的面板高度与动画表现。

import { CARD_LINK, closeDetail, openItemList, panelTargets } from './lib.mjs'

export default {
  id: 'item-detail-open-small',
  title: '详情面板打开（360×760 小屏）',
  description: '在 360×760 小屏视口重复「卡片 → 详情」流程，观察面板起始位移（translateY(100dvh)，与内容高度解耦）与入场时长是否一致。',
  viewport: { width: 360, height: 760, dpr: 2 },
  spec: {
    primary: { label: 'panel', signal: 'ty', declaredMs: 480, monotonic: true, eventProperty: 'transform' },
    secondary: [
      { label: 'backdrop', signal: 'o', declaredMs: 220, eventProperty: 'opacity' },
      { label: 'listCard', signal: 'y', declaredMs: null },
    ],
  },

  async run(ctx) {
    const { page } = ctx
    // 与 item-detail-open 相同：内容并行填充与冻结复演冲突，跳过关键帧冻结取证。
    page.skipStills = true
    await openItemList(page)
    const before = await page.screenshot('before')

    const record = await page.capture({
      targets: panelTargets(),
      click: CARD_LINK,
      settleMs: 420,
      maxMs: 3200,
    })
    await page.waitAnimationsIdle()
    const after = await page.screenshot('after')

    const checks = [
      {
        name: '面板 open+ready，视口宽度 360',
        pass: await page.ev(
          `!!document.querySelector('.modal-sheet[data-state="open"][data-ready="true"]') && innerWidth === 360`,
        ),
      },
      {
        name: '面板最终贴底（ty≈0）',
        pass: await page.ev(`Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.modal-sheet-panel')).transform).m42) < 1`),
      },
    ]

    const stills = []
    for (const fraction of (ctx.runIndex === 1 && !page.skipStills ? [0.5] : [])) {
      await closeDetail(page)
      const shot = await page.stillShot(`mid-${Math.round(fraction * 100)}`, {
        click: CARD_LINK,
        matchSel: '.modal-sheet-panel',
        matchProp: 'transform',
        fraction,
        expectedMs: 480,
      })
      stills.push(shot)
      await page.until(`!!document.querySelector('.modal-sheet[data-state="open"][data-ready="true"]')`)
      await page.waitAnimationsIdle()
    }

    return { record, shots: [before, after, ...stills], checks }
  },
}
