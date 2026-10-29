import { openItemList } from './lib.mjs'
import { motionInterval } from '../metrics.mjs'
const DETAILS = '[data-item-card]:nth-child(5) .item-card-details'
const TOGGLE = '[data-item-card]:nth-child(5) .item-card-toggle'
export const costSpec = {
  primary: { label: 'details', signal: 'h', declaredMs: 220, eventProperty: 'grid-template-rows' },
  secondary: [{ label: 'card', signal: 'h', declaredMs: 220, requireMotion: false },
    { label: 'beside', signal: 'y', stable: true }, { label: 'below', signal: 'y', stable: true }],
}
export async function runCost(ctx, expand) {
  const { page, runIndex } = ctx
  await openItemList(page)
  const normalize = async () => {
    const value = await page.ev('document.querySelector(' + JSON.stringify(TOGGLE) + ').getAttribute("aria-expanded")')
    if ((value === 'true') === expand) await page.click(TOGGLE)
    await page.waitAnimationsIdle()
    await page.prepareClick(TOGGLE)
  }
  await normalize()
  const before = await page.screenshot('before')
  const record = await page.capture({ click: TOGGLE, targets: [{ sel: DETAILS, label: 'details' },
    { sel: '[data-item-card]:nth-child(5)', label: 'card' }, { sel: '[data-item-card]:nth-child(6)', label: 'beside' },
    { sel: '[data-item-card]:nth-child(7)', label: 'below' }], settleMs: 420, maxMs: 3000 })
  await page.waitAnimationsIdle()
  const after = await page.screenshot('after')
  const checks = [
    { name: 'aria-expanded终态正确', pass: await page.ev('document.querySelector(' + JSON.stringify(TOGGLE) + ').getAttribute("aria-expanded")===' + JSON.stringify(String(expand))) },
    { name: '明细data-expanded及高度终态正确', pass: await page.ev('(()=>{const d=document.querySelector(' + JSON.stringify(DETAILS) + ');return d.dataset.expanded===' +
      JSON.stringify(String(expand)) + '&&' + (expand ? 'd.getBoundingClientRect().height>40' : 'd.getBoundingClientRect().height<1') + '})()') },
    ...['beside', 'below'].map(label => ({ name: label + '在全采样过程中保持位置', pass: (motionInterval(record, label, 'y')?.amplitude ?? Infinity) < 1 })),
  ]
  const stills = []
  if (runIndex === 1 && !page.skipStills) for (const fraction of [.25, .5, .75]) {
    await normalize()
    stills.push(await page.stillShot('mid-' + Math.round(fraction * 100),
      { click: TOGGLE, matchSel: DETAILS, matchProp: 'grid-template-rows', fraction, expectedMs: 220 }))
  }
  return { record, shots: [before, after, ...stills], checks }
}
export default { id: 'cost-disclosure-expand', title: '卡片成本明细展开', viewport: { width: 390, height: 844, dpr: 2 },
  description: '真实按压展开成本明细，并逐帧验证相邻卡与后续行位置。', spec: costSpec, run: ctx => runCost(ctx, true) }
