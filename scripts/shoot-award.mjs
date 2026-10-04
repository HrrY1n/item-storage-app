/**
 * 视觉自检截图（开发工具，不参与应用构建）
 *
 * 在真实无头浏览器里：灌入演示数据 → 给一件物品补齐购买信息 →
 * 逐页截图（移动端 390 + 桌面 1280），并对 375/390/430 做横向溢出检查。
 */
import { mkdir, writeFile } from 'node:fs/promises'

const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:5173'
const OUT = 'docs/screenshots/award'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Session {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && this.pending.has(m.id)) this.pending.get(m.id)(m)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    }).then((m) => (m.error ? Promise.reject(new Error(JSON.stringify(m.error))) : m.result))
  }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.value
  }
  async nav(url, waitText) {
    await this.send('Page.navigate', { url })
    for (let i = 0; i < 30; i++) {
      await sleep(300)
      const ok = (await this.ev('document.body.innerText.length')) > 30
      if (ok && (!waitText || (await this.ev(`document.body.innerText.includes(${JSON.stringify(waitText)})`)))) return
    }
  }
  async shot(name) {
    const s = await this.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/${name}.png`, Buffer.from(s.data, 'base64'))
  }
  async viewport(w, h) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 500 })
    await sleep(500)
  }
  async clickText(sel, text) {
    return this.ev(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})];
      const el=els.find(e=>e.textContent.replace(/\\s+/g,'').includes(${JSON.stringify(text.replace(/\s+/g, ''))}));
      if(!el) return 'not-found'; el.click(); return 'clicked' })()`)
  }
  async focusByPlaceholder(ph) {
    return this.ev(`(() => { const el=[...document.querySelectorAll('input,textarea')].find(i=>(i.placeholder||'').includes(${JSON.stringify(ph)}));
      if(!el) return 'not-found'; el.focus(); return 'ok' })()`)
  }
  async setValue(sel, v) {
    return this.ev(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return 'no';
      const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      s.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input',{bubbles:true})); return el.value })()`)
  }
  async type(t) { await this.send('Input.insertText', { text: t }) }
}

async function run() {
  await mkdir(OUT, { recursive: true })
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const s = new Session(ws)

  await s.send('Page.enable')
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await s.viewport(390, 844)

  // 空库状态（首次打开的第一印象）
  await s.nav(`${BASE}/`, '还没有物品')
  await sleep(900)
  await s.shot('00-empty-home')

  // 灌入演示数据
  await s.nav(`${BASE}/settings`, '设置')
  await s.ev('window.__loadDemoData()')
  await sleep(1200)

  // 取一件物品的 id，补齐购买信息（价格 1499 / 附加 199 / 2026-01-01 / 京东）
  await s.nav(`${BASE}/`, '我的物品')
  const href = await s.ev(`document.querySelector('a[href^="/items/"]')?.getAttribute('href')`)
  const itemId = String(href).split('/').pop()
  console.log('demo items loaded, target item:', itemId)

  await s.nav(`${BASE}/items/${itemId}/edit`, '编辑物品')
  await sleep(700)
  await s.setValue('input[type="date"]', '2026-01-01')
  await s.focusByPlaceholder('0.00')
  await s.type('1499')
  const extra = await s.ev(`(() => { const els=[...document.querySelectorAll('input')].filter(i=>(i.placeholder||'').includes('0.00'));
    if (els.length < 2) return 'no'; els[1].focus(); return 'ok' })()`)
  if (extra === 'ok') await s.type('199')
  await s.clickText('button', '京东')
  await sleep(500)
  await s.shot('05-form-filled')
  await s.clickText('header button', '保存')
  await sleep(1400)

  // 移动端截图
  await s.nav(`${BASE}/`, '我的物品')
  await sleep(1200)
  await s.shot('01-home')

  await s.nav(`${BASE}/categories`, '分类')
  await sleep(900)
  await s.shot('02-categories')

  await s.nav(`${BASE}/search`)
  await sleep(600)
  await s.ev(`(() => { const el=document.querySelector('input[type="search"]'); if(el) el.focus(); return !!el })()`)
  await s.type('apple')
  await sleep(900)
  await s.shot('03-search-results')

  await s.nav(`${BASE}/items/${itemId}`, '编辑')
  await sleep(900)
  await s.shot('04-item-detail')

  await s.nav(`${BASE}/items/new`, '新增物品')
  await sleep(900)
  await s.shot('06-item-new')

  await s.nav(`${BASE}/settings`, '设置')
  await sleep(700)
  await s.shot('07-settings')

  await s.nav(`${BASE}/settings/tags`, '标签管理')
  await sleep(800)
  await s.shot('10-tag-manage')

  await s.nav(`${BASE}/settings/categories`, '分类管理')
  await sleep(800)
  await s.shot('11-category-manage')

  // 分类详情：从分类页真实进入（分类 id 为 ULID，不能硬编码）
  await s.nav(`${BASE}/categories`, '分类')
  await sleep(600)
  await s.clickText('button', '数码与电子')
  await sleep(500)
  await s.clickText('a', '全部「数码与电子」')
  await sleep(1000)
  await s.shot('12-category-detail')

  // 桌面端取景
  await s.viewport(1280, 900)
  await s.nav(`${BASE}/`, '我的物品')
  await sleep(1200)
  await s.shot('08-desktop-home')
  await s.nav(`${BASE}/items/${itemId}`, '编辑')
  await sleep(900)
  await s.shot('09-desktop-detail')

  // 溢出检查
  const report = []
  for (const w of [375, 390, 430]) {
    await s.viewport(w, 812)
    for (const [path, label] of [['/', 'home'], ['/categories', 'cat'], ['/search', 'search'], [`/items/${itemId}`, 'detail'], ['/settings', 'set']]) {
      await s.nav(`${BASE}${path}`)
      await sleep(600)
      const of = await s.ev('document.documentElement.scrollWidth - window.innerWidth')
      if (of > 0) report.push(`${w}px ${label} overflowX=${of}`)
    }
  }
  console.log(report.length === 0 ? 'OVERFLOW CHECK: all clean (375/390/430)' : report.join('\n'))
  ws.close()
}

run().catch((e) => {
  console.error('SHOT ERROR:', e.message)
  process.exit(1)
})
