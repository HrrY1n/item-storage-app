/**
 * 移动端截图脚本（开发工具，不参与应用构建）
 *
 * 通过 CDP 直连无头 Edge，精确设置移动端视口后逐页截图，
 * 并在截图前校验页面已渲染（避免白屏截图）。
 *
 * 用法：
 *   1. 启动 dev server: npm run dev
 *   2. 启动 CDP 浏览器:
 *      msedge --headless=new --disable-gpu --hide-scrollbars \
 *             --remote-debugging-port=9222 --user-data-dir=<tmp> about:blank
 *   3. node scripts/shoot.mjs [width] [height]
 */
import { writeFile, mkdir } from 'node:fs/promises'

const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:5173'
const OUT_DIR = 'docs/screenshots'

const width = Number(process.argv[2] ?? 390)
const height = Number(process.argv[3] ?? 844)
/** --check：只校验渲染与横向溢出，不写文件（用于 375 / 430 验证） */
const checkOnly = process.argv.includes('--check')

const pages = [
  { url: '/', out: '01-home.png' },
  { url: '/categories', out: '02-categories.png' },
  { url: '/categories/c-digital', out: '03-category-detail.png' },
  { url: '/search', out: '04-search.png' },
  { url: '/search', out: '05-search-results.png', type: 'apple' },
  { url: '/items/new', out: '06-item-new.png' },
  { url: '/items/i-airpods', out: '07-item-detail.png' },
  { url: '/settings', out: '08-settings.png' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Session {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true })
    return r.result?.value
  }
}

async function newTarget() {
  const res = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })
  return res.json()
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true })
  const target = await newTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const s = new Session(ws)

  await s.send('Page.enable')
  await s.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  })
  // headless 下必须开启焦点模拟，Input.insertText 才会触发 React onChange
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  const report = []
  for (const p of pages) {
    await s.send('Page.navigate', { url: BASE + p.url })
    // 等待 SPA 渲染出可见内容
    let textLen = 0
    for (let i = 0; i < 20; i++) {
      await sleep(300)
      textLen = await s.evaluate('document.body.innerText.length')
      if (textLen > 120) break
    }

    if (p.type) {
      await sleep(300)
      await s.evaluate(
        '(() => { const el = document.querySelector(\'input[type="search"]\'); if (el) el.focus(); })()',
      )
      await s.send('Input.insertText', { text: p.type })
      await sleep(600)
      const typed = await s.evaluate(
        '(() => { const el = document.querySelector(\'input[type="search"]\'); return el ? el.value : "no-input"; })()',
      )
      console.log(`  typed -> "${typed}"`)
    }

    const overflow = await s.evaluate(
      'document.documentElement.scrollWidth - window.innerWidth',
    )
    if (checkOnly) {
      report.push(`${p.out} text=${textLen} overflowX=${overflow}`)
      continue
    }
    const shot = await s.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT_DIR}/${p.out}`, Buffer.from(shot.data, 'base64'))
    report.push(`${p.out} text=${textLen} overflowX=${overflow}`)
  }

  console.log(`viewport ${width}x${height}`)
  console.log(report.join('\n'))
  ws.close()
  await fetch(`${CDP}/json/close/${target.id}`)
}

run().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
