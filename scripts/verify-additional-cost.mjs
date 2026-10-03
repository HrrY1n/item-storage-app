/**
 * Phase 2E 附加花费（additionalCostCents）手动验证（开发工具，不参与应用构建）
 *
 * 流程：
 *   1. 表单含「附加花费」输入框（位于购买价格与购买平台之间）+ 辅助文字
 *   2. 实时预览：总投入 = 价格 + 附加花费；日均成本基于总投入
 *   3. 只有附加花费（无购买价格）也能算总投入与日均
 *   4. 详情页：购买价格 / 附加花费 / 总投入 / 平台·日期 / 持有天数 / 日均
 *   5. dirty：改附加花费后返回弹出「放弃此次修改？」
 *   6. 输入约束：负数与三位小数被拒
 *
 * 前提：vite preview 在 4173；无头浏览器 CDP 在 9222（全新 user-data-dir）。
 */
import { mkdir, writeFile } from 'node:fs/promises'

const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:4173'
const OUT = 'docs/screenshots/phase2e-additional-cost'

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
const fmt = (cents) =>
  `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const EXPECT_TOTAL_1699 = fmt(169900)
const EXPECT_DAILY_1699 = fmt(169900 / DAYS)
const EXPECT_DAILY_299 = fmt(29900 / DAYS)

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
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(`eval failed: ${expression.slice(0, 80)}`)
    return r.result?.value
  }
  async shot(name) {
    const s = await this.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/${name}.png`, Buffer.from(s.data, 'base64'))
  }
  async nav(url, waitText = null) {
    await this.send('Page.navigate', { url })
    for (let i = 0; i < 30; i++) {
      await sleep(300)
      const len = await this.ev('document.body.innerText.length')
      if (
        len > 30 &&
        (!waitText || (await this.ev(`document.body.innerText.includes(${JSON.stringify(waitText)})`)))
      )
        return
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
  /** 聚焦第 n 个（0-based）带指定 placeholder 的输入框 */
  async focusNth(ph, n) {
    return this.ev(`(() => {
      const el = [...document.querySelectorAll('input,textarea')].filter(i => (i.placeholder || '').includes(${JSON.stringify(ph)}))[${n}];
      if (!el) return 'not-found';
      el.focus();
      return 'ok';
    })()`)
  }
  async clearNthDecimal(n) {
    return this.ev(`(() => {
      const el = [...document.querySelectorAll('input[inputmode="decimal"]')][${n}];
      if (!el) return 'not-found';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value;
    })()`)
  }
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
  async decimals() {
    return this.ev(
      `[...document.querySelectorAll('input[inputmode="decimal"]')].map(i => i.value)`,
    )
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

  const status = await fetch(BASE).then((r) => r.status).catch(() => 0)
  if (status !== 200) {
    console.error(`FATAL: ${BASE} 不可达（status=${status}）`)
    process.exit(3)
  }

  const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const s = new Session(ws)

  await s.send('Page.enable')
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  })
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  /* ---- 0. 清库，保证从零开始 ---- */
  await s.nav(`${BASE}/`, null)
  await s.ev(`new Promise(r => { const q = indexedDB.deleteDatabase('PrivateItemLibraryDB'); q.onsuccess = q.onerror = q.onblocked = () => r(true) })`)
  await s.nav(`${BASE}/items/new`, '新增物品')
  await sleep(500)

  /* ---- 1. 表单结构与字段顺序 ---- */
  const order = await s.ev(`(() => {
    const t = document.body.innerText;
    const at = (s) => t.indexOf(s);
    return {
      date: at('购买日期'),
      price: at('购买价格'),
      additional: at('附加花费'),
      platform: at('购买平台'),
      hint: t.includes('配件、维修、升级等额外支出'),
    };
  })()`)
  check(
    '1. 字段顺序：购买日期 < 购买价格 < 附加花费 < 购买平台',
    order.date > -1 && order.date < order.price && order.price < order.additional && order.additional < order.platform,
    JSON.stringify(order),
  )
  check('1b. 辅助文字「配件、维修、升级等额外支出」存在', order.hint === true)

  /* ---- 2. 输入约束：逐字符输入（insertText 一次整串会被整体拒绝） ---- */
  await s.focusNth('0.00', 1)
  const step2 = []
  for (const ch of ['1', '2', '-', '.', '9', '9', '9']) {
    await s.type(ch)
    await sleep(60)
    step2.push(await s.ev(`[...document.querySelectorAll('input[inputmode="decimal"]')][1].value`))
  }
  check('2. 逐字符输入 1 2 - . 9 9 9', true, step2.join(' → '))
  check('2a. 附加花费拒绝负号', step2[2] === '12', `实际 "${step2[2]}"`)
  check('2b. 附加花费最多两位小数（第三位被拒）', step2[5] === '12.99' && step2[6] === '12.99', `实际 "${step2[6]}"`)
  await s.clearNthDecimal(1)

  /* ---- 3. 实时预览（价格 + 附加花费） ---- */
  await s.focusNth('比如：', 0)
  await s.type('MacBook Pro 14')
  await s.clickText('button', '数码与电子')
  await sleep(200)
  await s.clickText('button', '电脑设备')
  await sleep(200)
  const dateSet = await s.setValue('input[type="date"]', '2026-01-01')
  await s.focusNth('0.00', 0)
  await s.type('1499')
  await s.focusNth('0.00', 1)
  await s.type('200')
  await s.clickText('button', '京东')
  await sleep(500)

  const previewOk =
    dateSet === '2026-01-01' &&
    (await s.has('总投入')) &&
    (await s.has(EXPECT_TOTAL_1699)) &&
    (await s.has(`已持有 ${DAYS} 天`)) &&
    (await s.has(`${EXPECT_DAILY_1699} / 天`))
  check(
    '3. 实时预览：总投入 ¥1,699.00 + 已持有天数 + 日均',
    previewOk,
    `期望 ${EXPECT_TOTAL_1699} / ${EXPECT_DAILY_1699}`,
  )
  await s.shot('01-form-preview')

  /* ---- 4. dirty：改附加花费后返回应拦截（返回按钮是 svg，按 aria-label 定位） ---- */
  const backClicked = await s.ev(`(() => {
    const b = document.querySelector('header button[aria-label="返回"]');
    if (!b) return 'not-found';
    b.click();
    return 'clicked';
  })()`)
  await sleep(400)
  check('4. 改过附加花费后返回弹出放弃确认', backClicked === 'clicked' && (await s.has('放弃此次修改？')))
  await s.clickText('button', '继续编辑')
  await sleep(300)

  /* ---- 5. 保存 → 详情页 ---- */
  await s.clickText('header button', '保存')
  await sleep(1400)
  const itemUrl = await s.ev('location.href')
  const detailOk =
    (await s.has('¥1,499.00')) &&
    (await s.has('附加花费 ¥200.00')) &&
    (await s.has(`总投入 ${EXPECT_TOTAL_1699}`)) &&
    (await s.has('京东 · 2026年1月1日')) &&
    (await s.has(`已持有 ${DAYS} 天`)) &&
    (await s.has(`${EXPECT_DAILY_1699} / 天`))
  check('5. 详情页：购买价格 / 附加花费 / 总投入 / 平台·日期 / 天数 / 日均', detailOk)
  await s.shot('02-detail')

  /* ---- 6. 只有附加花费（无购买价格）也能算 ---- */
  await s.nav(`${BASE}/items/new`, '新增物品')
  await sleep(500)
  await s.focusNth('比如：', 0)
  await s.type('AirPods 换电池')
  await s.clickText('button', '数码与电子')
  await sleep(200)
  await s.clickText('button', '音频设备')
  await sleep(200)
  await s.setValue('input[type="date"]', '2026-01-01')
  await s.focusNth('0.00', 1)
  await s.type('299')
  await sleep(500)
  const onlyAdditional =
    (await s.has('总投入')) &&
    (await s.has(fmt(29900))) &&
    (await s.has(`${EXPECT_DAILY_299} / 天`))
  check('6. 只有附加花费也能显示总投入与日均', onlyAdditional, `期望 ${fmt(29900)} / ${EXPECT_DAILY_299}`)
  await s.shot('03-only-additional')
  await s.clickText('header button', '保存')
  await sleep(1400)
  const detail2 =
    (await s.has('附加花费 ¥299.00')) &&
    (await s.has(`总投入 ${fmt(29900)}`)) &&
    (await s.has(`${EXPECT_DAILY_299} / 天`))
  check('6b. 详情页无购买价格时仍显示附加花费与日均', detail2)
  await s.shot('04-detail-only-additional')

  /* ---- 7. 无购买日期时只显示总投入，不显示日均 ---- */
  await s.nav(`${BASE}/items/new`, '新增物品')
  await sleep(500)
  await s.focusNth('0.00', 0)
  await s.type('500')
  await sleep(400)
  const noDate = (await s.has('总投入')) && (await s.has(fmt(50000))) && !(await s.has('/ 天'))
  check('7. 缺购买日期：只显示总投入，不显示日均', noDate)
  await s.shot('05-no-date')

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
