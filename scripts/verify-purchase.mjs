/**
 * Phase 2E 手动验证（开发工具，不参与应用构建）
 *
 * 流程：
 *   1. 新增 AirPods Pro 2（音频设备 + #Apple + 2026-01-01 + ¥1499 + 京东）
 *   2. 详情页核对购买信息与日均成本（期望值在脚本内按日历日独立计算）
 *   3. 刷新 → 仍在
 *   4. 编辑价格 → 日均成本立即变化
 *   5. 导出备份 → 清空数据 → 恢复 → 购买字段全部还原
 *
 * 前提：vite dev server 在 5173；无头浏览器 CDP 在 9222（全新 user-data-dir）。
 */
import { mkdir, writeFile } from 'node:fs/promises'

const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:5173'
const OUT = 'docs/screenshots/phase2e'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const results = []
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/* 与 domain/purchase.ts 相同的日历日算法（独立复算，交叉验证） */
function dayNumber(s) {
  const [y, m, d] = s.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}
function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const DAYS = dayNumber(todayStr()) - dayNumber('2026-01-01') + 1
const fmt = (cents) => `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const EXPECT_DAILY_1499 = fmt(149900 / DAYS)
const EXPECT_DAILY_999 = fmt(99900 / DAYS)

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
    if (r.exceptionDetails) throw new Error(`eval failed: ${expression.slice(0, 80)}`)
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
    await sleep(900)
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
  /** 对受控 input（如 date）赋值：原生 setter + input 事件 */
  async setValue(selector, value) {
    return this.ev(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not-found';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
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

  /* ---- 1. 新增带购买信息的物品 ---- */
  await s.nav(`${BASE}/items/new`, '新增物品')
  await s.ev(`(() => { const b = document.querySelectorAll('button[aria-pressed]')[2]; if (b) b.click(); return !!b })()`)
  await s.focusByPlaceholder('比如：AirPods')
  await s.type('AirPods Pro 2')
  await s.clickText('button', '数码与电子')
  await sleep(200)
  await s.clickText('button', '音频设备')
  await s.focusByPlaceholder('新建标签')
  await s.type('Apple')
  await s.clickText('button', '添加')
  await sleep(300)
  // 购买信息
  const dateSet = await s.setValue('input[type="date"]', '2026-01-01')
  await s.focusByPlaceholder('0.00')
  await s.type('1499')
  await s.clickText('button', '京东')
  await sleep(400)
  const previewOk = (await s.has(`已持有 ${DAYS} 天`)) && (await s.has(`${EXPECT_DAILY_1499} / 天`))
  check('1. 表单实时预览：已持有天数 + 日均成本', previewOk && dateSet === '2026-01-01',
    `期望 ${DAYS} 天 / ${EXPECT_DAILY_1499}`)
  await s.shot('01-form-preview')
  await s.clickText('header button', '保存')
  await sleep(1200)
  const itemUrl = await s.ev('location.href')

  /* ---- 2. 详情页核对 ---- */
  const detailOk =
    (await s.has('¥1,499.00')) &&
    (await s.has('京东 · 2026年1月1日')) &&
    (await s.has(`已持有 ${DAYS} 天`)) &&
    (await s.has(`${EXPECT_DAILY_1499} / 天`))
  check('2. 详情页：价格 / 平台·日期 / 持有天数 / 日均成本', detailOk)
  await s.shot('02-detail')

  /* ---- 3. 刷新后仍在 ---- */
  await s.reload('AirPods Pro 2')
  check('3. 刷新后购买信息仍在', (await s.has('¥1,499.00')) && (await s.has('京东')))

  /* ---- 4. 编辑价格 → 日均成本立即变化 ---- */
  await s.nav(`${itemUrl}/edit`, '编辑物品')
  await sleep(600)
  await s.focusByPlaceholder('0.00')
  // 清空旧值再输入
  await s.setValue('input[inputmode="decimal"]', '')
  await s.focusByPlaceholder('0.00')
  await s.type('999')
  await sleep(400)
  const preview2 = await s.has(`${EXPECT_DAILY_999} / 天`)
  check('4. 编辑价格后预览日均成本立即变化', preview2, `期望 ${EXPECT_DAILY_999}`)
  await s.clickText('header button', '保存')
  await sleep(1200)
  check('4b. 保存后详情页日均成本更新', (await s.has('¥999.00')) && (await s.has(`${EXPECT_DAILY_999} / 天`)))
  await s.shot('03-after-price-edit')

  /* ---- 5. 导出 → 清空 → 恢复 ---- */
  const fileName = await s.ev('window.__backup.export()')
  check('5. 导出备份生成成功', typeof fileName === 'string' && fileName.endsWith('.zip'), String(fileName))

  // 把导出的 ZIP 以 base64 取回 Node 侧（页面导航会销毁 window 上下文，Blob 不能跨页保留）
  const b64 = await s.ev(`(async () => {
    const b = window.__exportedBackupBlob;
    const u = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  })()`)

  await s.ev('window.__backup.wipe()')
  await s.nav(`${BASE}/`, '我的物品')
  check('5b. 清空后回到 Empty State', await s.has('还没有物品'))

  // 恢复前把 ZIP 重新注入当前页面上下文
  await s.ev(`window.__exportedBackupBlob = new Blob(
    [Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0))],
    { type: 'application/zip' },
  )`)
  await s.ev('window.__backup.restore()')
  await sleep(800)
  await s.nav(itemUrl, 'AirPods Pro 2')
  const restored =
    (await s.has('京东 · 2026年1月1日')) &&
    (await s.has('¥999.00')) &&
    (await s.has(`${EXPECT_DAILY_999} / 天`)) &&
    (await s.has('#Apple'))
  check('5c. 恢复后购买日期 / 价格 / 平台 / 标签全部还原', restored)
  await s.shot('04-after-restore')

  console.log(results.join('\n'))
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
  ws.close()
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  if (results.length > 0) console.log(results.join('\n'))
  console.error('VERIFY SCRIPT ERROR:', e.message)
  process.exit(2)
})
