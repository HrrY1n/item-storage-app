// 场景 5a：图标选择器打开（内层 picker 面板，transform 340ms）。
// 入口路径：物品列表 → 底栏新增（外层 detail 面板）→ 更换物品图标（内层 picker）。

import { LIST_READY, openItemList } from './lib.mjs'

const PICKER_PANEL = '.modal-sheet[data-sheet="picker"] .modal-sheet-panel'
const PICKER_BACKDROP = '.modal-sheet[data-sheet="picker"] .modal-sheet-backdrop'

export async function openItemForm(page) {
  await openItemList(page)
  await page.click('a[aria-label="新增物品"]')
  await page.until(`!!document.querySelector('.modal-sheet[data-state="open"][data-ready="true"]')`)
  await page.until(`!!document.querySelector('input[aria-label="物品名称"]')`)
  await page.waitAnimationsIdle()
}

export async function openIconPicker(page) {
  await page.click('button[aria-label="更换物品图标"]')
  await page.until(`!!document.querySelector('.modal-sheet[data-sheet="picker"][data-state="open"]')`)
  await page.waitAnimationsIdle()
}

export async function closeIconPicker(page) {
  await page.click('.modal-sheet[data-sheet="picker"] button[aria-label="关闭"]')
  await page.until(`!document.querySelector('.modal-sheet[data-sheet="picker"]')`)
  await page.waitAnimationsIdle()
}

export { PICKER_PANEL, PICKER_BACKDROP, LIST_READY }
