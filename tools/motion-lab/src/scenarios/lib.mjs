// 场景公共步骤：每个场景使用独立的一次性浏览器上下文 + 合成物品。

export const LIST_READY = 'input[aria-label="搜索物品"]'
export const CARD_LINK = '[data-item-card]:nth-child(5) a'

export async function openItemList(page, { count = 12, prefix = '动效样品' } = {}) {
  await page.goto('/items', { waitSelector: LIST_READY })
  await page.seedItems(count, { prefix })
  await page.until(`document.querySelectorAll('[data-item-card]').length === ${count}`)
  await page.waitAnimationsIdle()
}

export async function openDetail(page, { settle = true } = {}) {
  await page.click(CARD_LINK)
  await page.until(`!!document.querySelector('.modal-sheet[data-state="open"][data-ready="true"]')`)
  if (settle) await page.waitAnimationsIdle()
}

export async function closeDetail(page) {
  await page.click('button[aria-label="返回"]')
  await page.until(`!document.querySelector('dialog[open]')`)
  await page.waitAnimationsIdle()
}

export function panelTargets() {
  return [
    { sel: '.modal-sheet-panel', label: 'panel' },
    { sel: '.modal-sheet-backdrop', label: 'backdrop' },
    { sel: '[data-item-card]:nth-child(5)', label: 'listCard' },
  ]
}
