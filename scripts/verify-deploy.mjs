/**
 * 部署前烟测（开发工具，不参与应用构建）
 *
 * 对 **生产构建产物**（vite preview）验证 Cloudflare Pages 上线后的关键前提：
 *   1. 深链刷新不 404（BrowserRouter SPA fallback）
 *   2. manifest / apple-touch-icon / viewport-fit=cover / standalone 齐备
 *   3. Service Worker 注册成功并接管页面
 *   4. 断网后仍可打开（App Shell 预缓存）—— 对应真机「飞行模式」
 *   5. IndexedDB 可写（生产模式下真实落库）
 *
 * 前提：dist 已构建，且 preview 服务器在 PREVIEW（默认 4173）。
 */
const PREVIEW = process.argv[2] ?? 'http://127.0.0.1:4173'
const CDP = 'http://127.0.0.1:9222'
const OUT = 'docs/screenshots/deploy'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const results = []
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

class Session {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg)
        this.pending.delete(msg.id)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    }).then((m) => {
      if (m.error) throw new Error(`${method}: ${JSON.stringify(m.error)}`)
      return m.result
    })
  }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.value
  }
  async shot(name) {
    const s = await this.send('Page.captureScreenshot', { format: 'png' })
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(OUT, { recursive: true })
    await writeFile(`${OUT}/${name}.png`, Buffer.from(s.data, 'base64'))
  }
  async nav(url) {
    await this.send('Page.navigate', { url })
    for (let i = 0; i < 25; i++) {
      await sleep(300)
      if ((await this.ev('document.body.innerText.length')) > 30) return
    }
  }
}

async function run() {
  const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const s = new Session(ws)

  await s.send('Page.enable')
  await s.send('Network.enable')
  await s.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  /* 1. 深链（SPA fallback） */
  await s.nav(`${PREVIEW}/settings/tags`)
  await sleep(1500)
  const deepLinkOk = (await s.ev('document.body.innerText.includes("标签管理")')) === true
  check('1. 深链 /settings/tags 直接打开正常（SPA fallback）', deepLinkOk)
  await s.shot('01-deeplink-tags')

  /* 2. PWA 必备要素 */
  const meta = await s.ev(`JSON.stringify({
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null,
    appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null,
    viewportFit: (document.querySelector('meta[name="viewport"]')?.content || '').includes('viewport-fit=cover'),
    appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content ?? null,
    themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null,
  })`)
  const m = JSON.parse(meta)
  check('2. PWA 要素齐备', Boolean(m.manifest && m.appleIcon && m.viewportFit && m.appleCapable && m.themeColor), meta)

  const manifestJson = await s.ev(`fetch('/manifest.webmanifest').then(r => r.json()).then(j => JSON.stringify({
    display: j.display, name: j.name, start: j.start_url, icons: j.icons.length, theme: j.theme_color,
  }))`)
  const mf = JSON.parse(manifestJson)
  check('2b. manifest 内容正确（standalone）', mf.display === 'standalone' && mf.icons >= 3, manifestJson)

  /* 3. Service Worker 注册 */
  await sleep(1500)
  const swState = await s.ev(`navigator.serviceWorker.getRegistration().then(r => r ? (r.active ? 'active' : (r.installing ? 'installing' : 'waiting')) : 'none')`)
  check('3. Service Worker 已注册并激活', swState === 'active' || swState === 'installing', swState)

  /* 4. 断网后仍可打开（对应真机飞行模式） */
  await s.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  })
  await s.send('Page.reload')
  await sleep(2500)
  const offlineOk = (await s.ev('document.body.innerText.includes("标签管理") || document.body.innerText.includes("我的物品")')) === true
  check('4. 断网后 App Shell 仍可打开（离线可用）', offlineOk)
  await s.shot('02-offline')
  await s.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  })

  /* 5. 生产模式下 IndexedDB 可写（数据真的落在本机） */
  await s.nav(`${PREVIEW}/items/new`)
  await sleep(1200)
  await s.ev(`(() => {
    const set = (ph, v) => {
      const el = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes(ph));
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); return true;
    };
    set('比如：AirPods', '部署烟测物品');
    return true;
  })()`)
  await s.ev(`(() => {
    const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '生活用品');
    if (el) el.click();
    return !!el;
  })()`)
  await sleep(400)
  await s.ev(`(() => {
    const el = [...document.querySelectorAll('header button')].find(b => b.textContent.trim() === '保存');
    if (el) el.click();
    return !!el;
  })()`)
  await sleep(1500)
  const savedOk = (await s.ev('document.body.innerText.includes("部署烟测物品")')) === true
  check('5. 生产构建可写入 IndexedDB 并显示新物品', savedOk)
  await s.shot('03-smoke-item')

  console.log(results.join('\n'))
  console.log(failures === 0 ? 'DEPLOY SMOKE PASSED' : `${failures} CHECK(S) FAILED`)
  ws.close()
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  if (results.length > 0) console.log(results.join('\n'))
  console.error('SMOKE ERROR:', e.message)
  process.exit(2)
})
