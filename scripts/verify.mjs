/**
 * Phase 2B 全流程浏览器验证（开发工具，不参与应用构建）
 *
 * 在真实无头浏览器里执行 PRD 要求的完整流程：
 *   1. 空数据库首次启动（Empty State）
 *   2. 新增 AirPods Pro 2（音频设备 + #Apple #常用）
 *   3. 刷新后仍存在
 *   4. 编辑：加 #白色 + 备注
 *   5. 搜索 apple 能找到
 *   6. 分类「数码与电子」里能看到
 *   7. 删除后从首页/分类/搜索全部消失
 *   8. 再刷新删除状态保持
 *
 * 前提：vite dev server 在 5173；无头浏览器 CDP 在 9222（全新 user-data-dir）。
 */
import { mkdir, writeFile } from 'node:fs/promises'

const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:5173'
const OUT = 'docs/screenshots/phase2b'

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
    await writeFile(`${OUT}/${name}.png`, Buffer.from(s.data, 'base64'))
  }
  async nav(url, waitText = null) {
    await this.send('Page.navigate', { url })
    for (let i = 0; i < 25; i++) {
      await sleep(300)
      const len = await this.ev('document.body.innerText.length')
      if (len > 30 && (!waitText || (await this.ev(`document.body.innerText.includes(${JSON.stringify(waitText)})`)))) return
    }
  }
  async reload(waitText = null) {
    await this.send('Page.reload')
    await sleep(800)
    for (let i = 0; i < 25; i++) {
      await sleep(300)
      const len = await this.ev('document.body.innerText.length')
      if (len > 30 && (!waitText || (await this.ev(`document.body.innerText.includes(${JSON.stringify(waitText)})`)))) return
    }
  }
  async clickText(selector, text) {
    return this.ev(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els.find(e => e.textContent.replace(/\\s+/g, '').includes(${JSON.stringify(text.replace(/\s+/g, ''))}));
      if (!el) return 'not-found';
      el.click();
      return 'clicked';
    })()`)
  }
  async focusByPlaceholder(ph) {
    return this.ev(`(() => {
      const el = [...document.querySelectorAll('input,textarea')].find(i => (i.placeholder || '').includes(${JSON.stringify(ph)}));
      if (!el) return 'not-found';
      el.focus();
      return 'ok';
    })()`)
  }
  async type(text) {
    await this.send('Input.insertText', { text })
  }
  has(text) {
    return this.ev(`document.body.innerText.includes(${JSON.stringify(text)})`)
  }
}

async function run() {
  await mkdir(OUT, { recursive: true })
  const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const s = new Session(ws)

  await s.send('Page.enable')
  await s.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  /* ---- 1. 空数据库首次启动 ---- */
  await s.nav(`${BASE}/`, '我的物品')
  const emptyState = await s.has('还没有物品')
  const emptyCount = await s.has('0 件物品')
  check('1. 空库首次启动显示 Empty State（还没有物品 / 0 件）', emptyState && emptyCount)
  await s.shot('01-empty-home')

  /* ---- 2. 新增 AirPods Pro 2 ---- */
  await s.nav(`${BASE}/items/new`, '新增物品')
  // 图标选耳机（preset 第 3 个）
  await s.ev(`(() => { const b = document.querySelectorAll('button[aria-pressed]')[2]; if (b) b.click(); return !!b })()`)
  await s.focusByPlaceholder('比如：AirPods')
  await s.type('AirPods Pro 2')
  await s.clickText('button', '数码与电子')
  await sleep(200)
  await s.clickText('button', '音频设备')
  // 新建标签 #Apple #常用（空库中没有现成标签）
  await s.focusByPlaceholder('新建标签')
  await s.type('Apple')
  await s.clickText('button', '添加')
  await sleep(300)
  await s.focusByPlaceholder('新建标签')
  await s.type('常用')
  await s.clickText('button', '添加')
  await sleep(300)
  await s.clickText('header button', '保存')
  await sleep(1200)
  const url1 = await s.ev('location.href')
  const createdOk = /\/items\/[^/]+$/.test(url1) && (await s.has('AirPods Pro 2'))
  check('2. 新增后进入详情页并显示物品', createdOk, url1.split('/').pop())
  const itemUrl = url1
  await s.shot('02-created-detail')

  /* ---- 3. 刷新后仍存在 ---- */
  await s.reload('AirPods Pro 2')
  check('3. 刷新后物品仍存在（详情页）', await s.has('AirPods Pro 2'))
  await s.nav(`${BASE}/`, '1 件物品')
  check('3b. 首页显示真实数量（1 件物品）与卡片', (await s.has('1 件物品')) && (await s.has('AirPods Pro 2')))
  await s.shot('03-home-after-create')

  /* ---- 4. 编辑：加 #白色 + 备注 ---- */
  await s.nav(`${itemUrl}/edit`, '编辑物品')
  await sleep(500)
  await s.focusByPlaceholder('新建标签')
  await s.type('白色')
  await s.clickText('button', '添加')
  await sleep(300)
  await s.focusByPlaceholder('可选')
  await s.type('通勤降噪用')
  await s.clickText('header button', '保存')
  await sleep(1200)
  const edited = (await s.has('白色')) && (await s.has('通勤降噪用'))
  check('4. 编辑后详情页显示 #白色 与备注', edited)
  await s.shot('04-edited-detail')

  /* ---- 5. 搜索 apple ---- */
  await s.nav(`${BASE}/search`)
  await sleep(500)
  await s.ev(`(() => { const el = document.querySelector('input[type="search"]'); if (el) el.focus(); return !!el })()`)
  await s.type('apple')
  await sleep(700)
  const found = await s.has('AirPods Pro 2')
  check('5. 搜索 apple 能找到该物品（经标签命中）', found)
  await s.shot('05-search-apple')

  /* ---- 6. 分类「数码与电子」里能看到 ---- */
  await s.nav(`${BASE}/categories`, '分类')
  await s.clickText('button', '数码与电子')
  await sleep(400)
  await s.clickText('a', '全部「数码与电子」')
  await sleep(800)
  const inCategory = await s.has('AirPods Pro 2')
  check('6. 分类详情页显示该物品', inCategory)
  await s.shot('06-category-digital')

  /* ---- 7. 删除：确认后从首页/分类/搜索全部消失 ---- */
  await s.nav(itemUrl, '删除物品')
  await s.clickText('button', '删除物品')
  await sleep(400)
  await s.shot('07-delete-confirm')
  // 点对话框里的确认按钮（对话框在 div.fixed 浮层内，避免误点页面上的「删除此物品」）
  await s.clickText('div.fixed button', '删除')
  await sleep(1000)
  await s.nav(`${BASE}/`, '我的物品')
  const goneHome = !(await s.has('AirPods Pro 2'))
  await s.nav(`${BASE}/categories`)
  const goneCategory = !(await s.has('AirPods Pro 2'))
  await s.nav(`${BASE}/search`)
  await sleep(400)
  await s.ev(`(() => { const el = document.querySelector('input[type="search"]'); if (el) el.focus(); return !!el })()`)
  await s.type('apple')
  await sleep(700)
  const goneSearch = await s.has('没有找到')
  check('7. 删除后从首页 / 分类 / 搜索全部消失', goneHome && goneCategory && goneSearch,
    `home=${goneHome} cat=${goneCategory} search=${goneSearch}`)
  await s.shot('08-after-delete-home')

  /* ---- 8. 刷新后删除状态保持 ---- */
  await s.nav(`${BASE}/`, '我的物品')
  await s.reload('我的物品')
  check('8. 刷新后删除状态保持（回到 Empty State）', await s.has('还没有物品'))

  console.log(results.join('\n'))
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
  ws.close()
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error('VERIFY SCRIPT ERROR:', e.message)
  process.exit(2)
})
