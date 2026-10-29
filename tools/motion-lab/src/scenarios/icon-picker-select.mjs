import { openItemForm, openIconPicker, PICKER_PANEL, PICKER_BACKDROP } from './iconPickerLib.mjs'
export default {
  id: 'icon-picker-select', title: '图标搜索与选择', description: '真实输入搜索，按压结果选择图标，采集picker退出并核对表单草稿和预览。',
  viewport: { width: 390, height: 844, dpr: 2 },
  spec: { primary: { label: 'picker', signal: 'ty', declaredMs: 300, eventProperty: 'transform' },
    secondary: [{ label: 'pickerBackdrop', signal: 'o', declaredMs: 300, eventProperty: 'opacity' }] },
  async run({ page }) {
    await openItemForm(page)
    await page.typeText('input[aria-label="物品名称"]', 'MotionLab draft')
    const oldIcon = await page.ev('document.querySelector(\'button[aria-label="更换物品图标"] img\').getAttribute("src")')
    await openIconPicker(page)
    await page.typeText('input[aria-label="搜索全部图标"]', '电脑')
    await page.until('document.querySelectorAll(\'[data-icon-browser] button[aria-pressed]\').length>0')
    await page.waitAnimationsIdle()
    const target = '[data-icon-browser] button[aria-pressed]'
    const expectedIcon = await page.ev('document.querySelector(' + JSON.stringify(target) + ').querySelector("img").getAttribute("src")')
    const before = await page.screenshot('before')
    const record = await page.capture({ click: target, targets: [{ sel: PICKER_PANEL, label: 'picker' }, { sel: PICKER_BACKDROP, label: 'pickerBackdrop' }], maxMs: 3000 })
    await page.waitAnimationsIdle()
    const after = await page.screenshot('after')
    return { record, shots: [before, after], checks: [
      { name: '搜索结果选择后picker关闭', pass: await page.ev('!document.querySelector(\'.modal-sheet[data-sheet="picker"]\')') },
      { name: '表单预览变为所选图标', pass: expectedIcon !== oldIcon && await page.ev('document.querySelector(\'button[aria-label="更换物品图标"] img\').getAttribute("src")===' + JSON.stringify(expectedIcon)) },
      { name: '草稿输入仍保留', pass: await page.ev('document.querySelector(\'input[aria-label="物品名称"]\').value==="MotionLab draft"') },
    ] }
  },
}
