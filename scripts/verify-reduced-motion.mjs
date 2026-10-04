/**
 * 无障碍验证：在 prefers-reduced-motion: reduce 下，内容必须完整可见。
 *
 * 背景：入场动画曾用 opacity 起始态 + fill-mode: both，
 * 一旦动画未播放/被暂停，内容会停留在不可见状态。现已改为 transform-only。
 * 本脚本用 CDP 模拟系统「减少动效」偏好，断言关键内容仍在页面上。
 */
const CDP = 'http://127.0.0.1:9223'
const BASE = 'http://127.0.0.1:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main() {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  })
  // 解析到 result 层：CDP 响应形如 { id, result: { result: { value } } }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id
      pending.set(i, (m) => resolve(m.result))
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r?.result?.value
  }

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })

  // 准备数据
  await send('Page.navigate', { url: `${BASE}/settings` })
  await sleep(2500)
  await ev('window.__loadDemoData()')
  await sleep(1500)

  // 首页
  await send('Page.navigate', { url: `${BASE}/` })
  await sleep(2000)
  const homeLen = await ev('document.body.innerText.length')
  const homeHasCount = await ev('document.body.innerText.includes("件物品")')
  const homeCards = await ev('document.querySelectorAll(\'a[href^="/items/"]\').length')
  check('reduce-motion 下首页内容完整可见', homeLen > 150 && homeHasCount && homeCards > 0,
    `chars=${homeLen} cards=${homeCards}`)

  // 分类页
  await send('Page.navigate', { url: `${BASE}/categories` })
  await sleep(1500)
  const catLen = await ev('document.body.innerText.length')
  check('reduce-motion 下分类页内容完整可见', catLen > 100, `chars=${catLen}`)

  // 详情页（含购买信息与指标区）：先回首页拿真实物品链接
  await send('Page.navigate', { url: `${BASE}/` })
  await sleep(1500)
  const href = await ev('document.querySelector(\'a[href^="/items/"]\')?.getAttribute("href")')
  await send('Page.navigate', { url: `${BASE}${href}` })
  await sleep(1800)
  const detailLen = await ev('document.body.innerText.length')
  const detailText = String(await ev('document.body.innerText'))
  const hasName = href !== undefined && href !== null && detailText.length > 60
  const hasPurchase = detailText.includes('购买信息') || detailText.includes('备注')
  check('reduce-motion 下详情页内容完整可见（含购买信息区）', hasName && hasPurchase,
    `${href} chars=${detailLen} purchase=${hasPurchase}`)

  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
  ws.close()
  console.log(failures === 0 ? 'REDUCED-MOTION CHECK PASSED' : `${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(2)
})
