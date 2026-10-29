// 场景 5b：图标选择器关闭（picker 面板退出 300ms，只关闭最上层）。

import { openIconPicker, openItemForm, PICKER_BACKDROP, PICKER_PANEL } from './iconPickerLib.mjs'

export default {
  id: 'icon-picker-close',
  title: '图标选择器：关闭',
  description: '图标选择器打开后点击「关闭」，内层 picker 面板下移退出（300ms），外层新增表单与输入保留。',
  viewport: { width: 390, height: 844, dpr: 2 },
  spec: {
    primary: { label: 'picker', signal: 'ty', declaredMs: 300, monotonic: true, eventProperty: 'transform' },
    secondary: [{ label: 'pickerBackdrop', signal: 'o', declaredMs: null, eventProperty: 'opacity' }],
  },

  async run(ctx) {
    const { page } = ctx
    await openItemForm(page)
    await page.typeText('input[aria-label="物品名称"]', "MotionLab draft")
    await openIconPicker(page)
    const before = await page.screenshot('before')

    const record = await page.capture({
      targets: [
        { sel: PICKER_PANEL, label: 'picker' },
        { sel: PICKER_BACKDROP, label: 'pickerBackdrop' },
      ],
      click: '.modal-sheet[data-sheet="picker"] button[aria-label="关闭"]',
      settleMs: 420,
      maxMs: 2600,
    })
    await page.waitAnimationsIdle()
    const after = await page.screenshot('after')

    const retained = await page.typeText('input[aria-label="物品名称"]', " retained")
    const checks = [
      {
        name: 'picker 面板已卸载',
        pass: await page.ev(`!document.querySelector('.modal-sheet[data-sheet="picker"]')`),
      },
      {
        name: '外层新增表单仍打开',
        pass: await page.ev(`!!document.querySelector('dialog[aria-label="新增物品"][open]')`),
      },
      {
        name: '名称输入框仍可交互',
        pass: retained === "MotionLab draft retained",
      },
    ]

    const stills = []
    for (const fraction of (ctx.runIndex === 1 && !page.skipStills ? [0.25, 0.5, 0.75] : [])) {
      await openIconPicker(page)
      const shot = await page.stillShot(`mid-${Math.round(fraction * 100)}`, {
        click: '.modal-sheet[data-sheet="picker"] button[aria-label="关闭"]',
        matchSel: PICKER_PANEL,
        matchProp: 'transform',
        fraction,
        expectedMs: 300,
      })
      stills.push(shot)
      await page.until(`!document.querySelector('.modal-sheet[data-sheet="picker"]')`)
      await page.waitAnimationsIdle()
    }

    return { record, shots: [before, after, ...stills], checks }
  },
}
