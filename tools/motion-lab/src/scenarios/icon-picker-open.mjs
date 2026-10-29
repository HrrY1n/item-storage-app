// 场景 5a：图标选择器打开（picker 面板 transform 340ms）。

import { openIconPicker, openItemForm, PICKER_BACKDROP, PICKER_PANEL } from './iconPickerLib.mjs'

export default {
  id: 'icon-picker-open',
  title: '图标选择器：打开',
  description: '新增物品表单中点击「更换物品图标」，内层 picker 面板从底部升起（transform 340ms），外层表单保持打开。',
  viewport: { width: 390, height: 844, dpr: 2 },
  spec: {
    primary: { label: 'picker', signal: 'ty', declaredMs: 340, monotonic: true, eventProperty: 'transform' },
    secondary: [{ label: 'pickerBackdrop', signal: 'o', declaredMs: 220, eventProperty: 'opacity' }],
  },

  async run(ctx) {
    const { page } = ctx
    await openItemForm(page)
    const before = await page.screenshot('before')

    const record = await page.capture({
      targets: [
        { sel: PICKER_PANEL, label: 'picker' },
        { sel: PICKER_BACKDROP, label: 'pickerBackdrop' },
      ],
      click: 'button[aria-label="更换物品图标"]',
      settleMs: 420,
      maxMs: 2600,
    })
    await page.waitAnimationsIdle()
    const after = await page.screenshot('after')

    const checks = [
      {
        name: 'picker 面板 open 终态',
        pass: await page.ev(`!!document.querySelector('.modal-sheet[data-sheet="picker"][data-state="open"]')`),
      },
      {
        name: '外层新增表单面板未被关闭',
        pass: await page.ev(`!!document.querySelector('dialog[aria-label="新增物品"][open]')`),
      },
      {
        name: '图标浏览器已挂载',
        pass: await page.ev(`!!document.querySelector('[data-icon-browser]')`),
      },
    ]

    const { closeIconPicker } = await import('./iconPickerLib.mjs')
    const stills = []
    for (const fraction of (ctx.runIndex === 1 && !page.skipStills ? [0.25, 0.5, 0.75] : [])) {
      await closeIconPicker(page)
      const shot = await page.stillShot(`mid-${Math.round(fraction * 100)}`, {
        click: 'button[aria-label="更换物品图标"]',
        matchSel: PICKER_PANEL,
        matchProp: 'transform',
        fraction,
        expectedMs: 340,
      })
      stills.push(shot)
      await page.until(`!!document.querySelector('.modal-sheet[data-sheet="picker"][data-state="open"]')`)
      await page.waitAnimationsIdle()
    }

    return { record, shots: [before, after, ...stills], checks }
  },
}
