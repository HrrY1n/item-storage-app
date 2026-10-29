// 场景 2：详情面板 → 返回物品列表。
// 退出为 closing 态 CSS transition（transform 300ms），结束后 dialog 卸载、列表滚动/焦点恢复。

import { CARD_LINK, LIST_READY, closeDetail, openDetail, openItemList, panelTargets } from './lib.mjs'

export default {
  id: 'item-detail-close',
  title: '详情面板 → 返回物品列表',
  description:
    '详情打开后点击「返回」按钮，面板下移退出（300ms），遮罩淡出，dialog 卸载，背景列表恢复。测量退出位移与卸载时序。',
  viewport: { width: 390, height: 844, dpr: 2 },
  spec: {
    primary: { label: 'panel', signal: 'ty', declaredMs: 300, monotonic: true, eventProperty: 'transform' },
    secondary: [
      { label: 'backdrop', signal: 'o', declaredMs: null, eventProperty: 'opacity' },
      { label: 'listCard', signal: 'y', declaredMs: null },
    ],
  },

  async run(ctx) {
    const { page } = ctx
    await openItemList(page)
    await page.prepareClick(CARD_LINK)
    const returnScroll = await page.ev("scrollY")
    await openDetail(page)
    const before = await page.screenshot('before')

    const record = await page.capture({
      targets: panelTargets(),
      click: 'button[aria-label="返回"]',
      settleMs: 420,
      maxMs: 3200,
    })
    await page.waitAnimationsIdle()
    const after = await page.screenshot('after')

    const checks = [
      {
        name: 'dialog 已卸载（无任何打开弹层）',
        pass: await page.ev(`!document.querySelector('dialog[open]')`),
      },
      {
        name: '路由回到 /items',
        pass: await page.ev(`location.pathname === '/items'`),
      },
      {
        name: '列表仍渲染 12 张卡片且滚动锁已解除',
        pass: await page.ev(
          `document.querySelectorAll('[data-item-card]').length === 12 && document.body.style.overflow !== 'hidden'`,
        ),
      },
    ]

    checks.push({name:"详情关闭后焦点恢复到原卡片",pass:await page.ev("document.activeElement===document.querySelector("+JSON.stringify(CARD_LINK)+")")},
      {name:"详情关闭后窗口滚动位置恢复",pass:Math.abs(await page.ev("scrollY")-returnScroll)<1})
    const stills = []
    for (const fraction of (ctx.runIndex === 1 && !page.skipStills ? [0.25, 0.5, 0.75] : [])) {
      await openDetail(page)
      const shot = await page.stillShot(`mid-${String(Math.round(fraction*100))}`, {
        click: 'button[aria-label="返回"]',
        matchSel: '.modal-sheet-panel',
        matchProp: 'transform',
        fraction,
        expectedMs: 300,
      })
      stills.push(shot)
      await page.until(`!document.querySelector('dialog[open]')`)
      await page.waitAnimationsIdle()
    }

    return { record, shots: [before, after, ...stills], checks }
  },
}
