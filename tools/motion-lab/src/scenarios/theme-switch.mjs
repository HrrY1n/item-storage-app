export const themeSpec = { primary: { label: 'body', signal: 'lum', declaredMs: 220, eventProperty: 'background-color' }, secondary: [] }
const RADIOS = '[aria-label="外观模式"] [role="radio"]'
export async function runTheme(ctx, to) {
  const { page, runIndex } = ctx
  const fromText = to === 'dark' ? '浅色' : '深色', toText = to === 'dark' ? '深色' : '浅色'
  await page.goto('/settings', { waitSelector: '[aria-label="外观模式"]' })
  const normalize = async () => { await page.click(RADIOS, { text: fromText }); await page.waitAnimationsIdle() }
  await normalize()
  const before = await page.screenshot('before')
  const record = await page.capture({ click: RADIOS, clickOptions: { text: toText }, targets: [{ sel: 'body', label: 'body' }], settleMs: 460, maxMs: 3000 })
  await page.waitAnimationsIdle()
  const after = await page.screenshot('after')
  const checks = [{ name: 'App主题终态为' + to, pass: await page.ev('document.documentElement.dataset.theme===' + JSON.stringify(to)) },
    { name: '主题过渡窗口已结束', pass: await page.ev('!document.documentElement.classList.contains("theme-shift")') },
    { name: '背景亮度方向符合主题', pass: to === 'dark' ? record.frames[0].tg.body.lum > record.frames.at(-1).tg.body.lum :
      record.frames[0].tg.body.lum < record.frames.at(-1).tg.body.lum }]
  const stills = []
  if (runIndex === 1 && !page.skipStills) for (const fraction of [.25, .5, .75]) {
    await normalize()
    stills.push(await page.stillShot('mid-' + Math.round(fraction * 100), { click: RADIOS, clickOptions: { text: toText },
      matchSel: 'body', matchProp: 'background-color', fraction, expectedMs: 220 }))
  }
  return { record, shots: [before, after, ...stills], checks }
}
export default { id: 'theme-switch', title: '主题浅色→深色', description: '真实按压切换主题；系统配色与App主题分别记录。',
  viewport: { width: 390, height: 844, dpr: 2 }, media: { colorScheme: 'light' }, spec: themeSpec, run: ctx => runTheme(ctx, 'dark') }
