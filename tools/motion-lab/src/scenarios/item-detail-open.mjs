// 场景 1：物品卡片 → 详情面板打开。
// 面板入场为 CSS transition（transform 480ms，cubic-bezier(0.22,1,0.36,1)，@starting-style）。
// 必须经站内点击触发（携带 itemBackground state）；直连 URL 是整页模式，没有面板动画。

import { CARD_LINK, LIST_READY, closeDetail, openDetail, openItemList, panelTargets } from './lib.mjs'

export default {
  id: 'item-detail-open',
  title: '物品卡片 → 详情面板打开',
  description:
    '在物品列表（390×844）点击第 5 张卡片，详情面板从底部升起。测量 .modal-sheet-panel 的 translateY、遮罩 opacity 与背景列表稳定性。',
  viewport: { width: 390, height: 844, dpr: 2 },
  spec: {
    primary: { label: 'panel', signal: 'ty', declaredMs: 480, monotonic: true, eventProperty: 'transform' },
    secondary: [
      { label: 'backdrop', signal: 'o', declaredMs: 220, eventProperty: 'opacity' },
      { label: 'listCard', signal: 'y', declaredMs: null },
    ],
  },

  async run(ctx) {
    const { page } = ctx
    // 入场采用"动画与异步内容并行"策略：内容在滑动中途填充，冻结复演要求冻结期间
    // 几何完全静止，两者天然冲突，故本场景不做关键帧冻结取证（曲线与截图仍是完整证据）。
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

    const itemPath = await page.ev(`document.querySelector(${JSON.stringify(CARD_LINK)})?.getAttribute('href')`)
    const checks = [
      {
        name: '面板进入 open+ready 终态',
        pass: await page.ev(`!!document.querySelector('.modal-sheet[data-state="open"][data-ready="true"]')`),
      },
      {
        name: `路由切换到详情 ${itemPath ?? ''}`,
        pass: Boolean(itemPath) && (await page.ev(`location.pathname === ${JSON.stringify(itemPath)}`)),
      },
      {
        name: '背景列表未卸载且滚动被锁定',
        pass: await page.ev(
          `document.body.style.overflow === 'hidden' && !!document.querySelector('[data-item-card]:nth-child(5)')`,
        ),
      },
    ]

    // 关键帧（暂停冻结法）：每个分数一轮，先回到关闭态再触发。
    const stills = []
    for (const fraction of (ctx.runIndex === 1 && !page.skipStills ? [0.25, 0.5, 0.75] : [])) {
      await closeDetail(page)
      const shot = await page.stillShot(`mid-${String(Math.round(fraction*100))}`, {
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

    return { record, shots: [before, after, ...stills], checks, notes: [`itemPath=${itemPath ?? '未知'}`] }
  },
}
