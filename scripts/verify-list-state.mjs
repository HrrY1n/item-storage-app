// 列表会话状态验证:同一会话内底栏切页返回/刷新恢复,新会话回默认,损坏与非法值安全回退。
// 与其它 verify 脚本一致:Vite dev(DEV_BASE,默认 127.0.0.1:5173) + 项目隔离 Edge(EDGE_TEST_PORT,默认 9222),一次性浏览器上下文,合成数据。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const BASE = process.env.DEV_BASE ?? 'http://127.0.0.1:5173'
const CDP = `http://127.0.0.1:${process.env.EDGE_TEST_PORT ?? '9222'}`
const OUT = '.tmp/list-state-verification'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = []
const errors = []

class Session {
  id = 0; pending = new Map()
  constructor(ws) {
    this.ws = ws
    ws.addEventListener('message', event => {
      const data = JSON.parse(event.data)
      if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text)
      const item = this.pending.get(data.id)
      if (item) { this.pending.delete(data.id); item(data) }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
      this.pending.set(id, result => { clearTimeout(timer); result.error ? reject(new Error(`${method}: ${JSON.stringify(result.error)}`)) : resolve(result.result) })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.ok(!r.exceptionDetails, r.exceptionDetails?.exception?.description ?? 'page exception')
    return r.result?.value
  }
  async until(expression, timeout = 8000) {
    for (let i = 0; i < timeout / 100; i++) {
      if (await this.ev(expression)) return
      await sleep(100)
    }
    throw new Error(`Timed out waiting for ${expression}`)
  }
  async click(selector, text) {
    const point = await this.ev(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find(element => ${text === undefined ? 'true' : `element.textContent.includes(${JSON.stringify(text)})`});
      if (!element) throw new Error('Missing click target: ' + ${JSON.stringify(selector)});
      element.scrollIntoView({block:'center'});
      const r = element.getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  async escape() {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  }
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function newPage(browser, viewport = { width: 390, height: 844 }) {
  const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true })
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId })
  const target = (await (await fetch(`${CDP}/json/list`)).json()).find(t => t.id === targetId)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  const page = new Session(ws)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 2, mobile: true })
  return { page, ws }
}

const savedState = page => page.ev(`JSON.parse(sessionStorage.getItem('pil.listState') ?? 'null')`)
const activeTab = page => page.ev(`document.querySelector('[role="radio"][aria-checked="true"]')?.textContent.trim() ?? ''`)
const queryValue = page => page.ev(`document.querySelector('input[aria-label="搜索物品"]')?.value ?? ''`)
const sortValue = page => page.ev(`document.querySelector('select[aria-label="物品排序"]')?.value ?? ''`)
const viewIsList = page => page.ev(`!!document.querySelector('[data-layout-view="list"]')`)
const activeCategoryChip = page => page.ev(`document.querySelector('[aria-pressed="true"][data-category-value]')?.dataset.categoryValue ?? ''`)

async function seedItems(page) {
  await page.until(`!!document.querySelector('input[aria-label="搜索物品"]')`)
  await page.ev(`(async () => {
    const {db} = await import('/src/db/db.ts');
    const {itemRepository} = await import('/src/db/repositories/itemRepository.ts');
    const categories = await db.categories.toArray();
    const category = categories.find(c => c.parentId && c.deletedAt === null);
    for (let i=0;i<3;i++) await itemRepository.create({
      name:'会话样品 '+String(i+1), categoryId:category.id, iconAssetId:'preset-other',
      note:'', tagIds:[], status:'owned', purchaseDate:'2026-01-15',
      purchasePriceCents:19900, additionalCostCents:null, purchasePlatform:null,
      warrantyExpiresAt:'2027-01-15', disposedAt:null, disposalMethod:null, salePriceCents:null, disposalNote:null
    });
  })()`)
  await page.until(`document.querySelectorAll('[data-item-card]').length === 3`)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const version = await (await fetch(`${CDP}/json/version`)).json()
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let browserSeq = 0
  const browserPending = new Map()
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); const p = browserPending.get(m.id); if (p) { browserPending.delete(m.id); p(m) } })
  const browser = { send: (method, params = {}) => new Promise((res, rej) => { const id = ++browserSeq; browserPending.set(id, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id, method, params })) }) }

  // ============ 场景 1:设置状态 → 底栏切页 → 返回恢复 ============
  {
    const { page, ws: pws } = await newPage(browser)
    await page.send('Page.navigate', { url: `${BASE}/items` })
    await seedItems(page)
    // 注意顺序:搜索框聚焦时工具按钮折叠(max-width:0),必须先操作视图/排序再输入搜索词
    await page.click('button[aria-label="切换为列表视图"]')
    await page.until(`!!document.querySelector('[data-layout-view="list"]')`)
    await page.ev(`(() => { const select=document.querySelector('select[aria-label="物品排序"]'); select.value='name'; select.dispatchEvent(new Event('change',{bubbles:true})) })()`)
    await page.click('input[aria-label="搜索物品"]')
    await page.send('Input.insertText', { text: '会话样品' })
    await page.until(`document.body.textContent.includes('找到')`)
    const stored1 = await savedState(page)
    check('状态变化写入 pil.listState', stored1?.query === '会话样品' && stored1?.sort === 'name' && stored1?.view === 'list', JSON.stringify(stored1))
    // 底栏切到概览再回列表
    await page.click(".nav-links a", "概览")
    await page.until(`!!document.querySelector('input[aria-label*="概览"], main h1')`)
    await page.click(".nav-links a", "列表")
    await page.until(`!!document.querySelector('input[aria-label="搜索物品"]')`)
    await sleep(300)
    check('底栏返回后恢复搜索词', await queryValue(page) === '会话样品')
    check('底栏返回后恢复排序', await sortValue(page) === 'name')
    check('底栏返回后恢复列表视图', await viewIsList(page))
    await page.shot('1-tab-switch-restored')
    pws.close()
  }

  // ============ 场景 2:刷新恢复 + 面板兼容 + 重置语义 ============
  {
    const { page, ws: pws } = await newPage(browser)
    await page.send('Page.navigate', { url: `${BASE}/items` })
    await seedItems(page)
    await page.ev(`(() => { const select=document.querySelector('select[aria-label="物品排序"]'); select.value='name'; select.dispatchEvent(new Event('change',{bubbles:true})) })()`)
    await page.click('input[aria-label="搜索物品"]')
    await page.send('Input.insertText', { text: '会话样品' })
    await page.until(`document.body.textContent.includes('找到')`)
    // 详情面板打开再关闭:既有机制不应被会话状态破坏
    await page.click('[data-item-card] a')
    await page.until(`!!document.querySelector('dialog[aria-label="物品详情"]')`)
    await page.escape()
    await page.until(`!document.querySelector('dialog[open]')`)
    check('面板往返后搜索词保留', await queryValue(page) === '会话样品')
    // 刷新(同一会话)
    await page.send('Page.navigate', { url: `${BASE}/items` })
    await page.until(`!!document.querySelector('input[aria-label="搜索物品"]') && document.querySelectorAll('[data-item-card]').length >= 1`)
    check('刷新后搜索词恢复', await queryValue(page) === '会话样品')
    check('刷新后排序恢复', await sortValue(page) === 'name')
    await page.shot('2-reload-restored')
    // 重置筛选:清除搜索,保留 tab/排序/视图(现有产品语义),并写回存储
    await page.click('button', '重置筛选')
    await page.until(`document.querySelector('input[aria-label="搜索物品"]').value === ''`)
    const stored2 = await savedState(page)
    check('重置清除搜索且保留排序', stored2?.query === '' && stored2?.sort === 'name', JSON.stringify(stored2))
    pws.close()
  }

  // ============ 场景 3:损坏 JSON / 非法枚举 / 已删除分类 ============
  {
    const { page, ws: pws } = await newPage(browser)
    await page.send('Page.navigate', { url: `${BASE}/items` })
    await seedItems(page)
    // 损坏 JSON
    await page.ev(`sessionStorage.setItem('pil.listState', '{broken json')`)
    await page.send('Page.navigate', { url: `${BASE}/items` })
    await page.until(`!!document.querySelector('input[aria-label="搜索物品"]') && document.querySelectorAll('[data-item-card]').length >= 1`)
    check('损坏 JSON 回落默认且无崩溃', await queryValue(page) === '' && await sortValue(page) === 'recent' && await viewIsList(page) === false)
    check('损坏 JSON 无页面异常', errors.length === 0, errors.slice(0, 2).join('; '))
    // 非法枚举
    await page.ev(`sessionStorage.setItem('pil.listState', JSON.stringify({status:'bogus', sort:123, view:'table', disposition:'nope', query:{}, categoryId:9}))`)
    await page.send('Page.navigate', { url: `${BASE}/items` })
    await page.until(`!!document.querySelector('input[aria-label="搜索物品"]')`)
    await sleep(300)
    check('非法枚举逐项回落默认', await activeTab(page).then(t => t.includes('收纳')) && await sortValue(page) === 'recent' && await viewIsList(page) === false)
    // 已删除/不存在的分类 ID
    await page.ev(`sessionStorage.setItem('pil.listState', JSON.stringify({status:'owned', query:'', categoryId:'cat-deleted-xyz', sort:'recent', view:'grid', disposition:'all'}))`)
    await page.send('Page.navigate', { url: `${BASE}/items` })
    await page.until(`!!document.querySelector('input[aria-label="搜索物品"]') && document.querySelectorAll('[data-item-card]').length >= 1`)
    await sleep(400)
    check('不存在的分类回落全部分类且列表正常', await activeCategoryChip(page) === '' && await queryValue(page) === '')
    const stored3 = await savedState(page)
    check('失效分类写回为 null', stored3?.categoryId === null, JSON.stringify(stored3))
    await page.shot('3-invalid-state-recovered')
    pws.close()
  }

  // ============ 场景 4:新会话(新上下文)从默认开始 + 状态 tab 恢复 ============
  {
    const { page, ws: pws } = await newPage(browser)
    await page.send('Page.navigate', { url: `${BASE}/items` })
    await seedItems(page)
    const inherited = await savedState(page)
    check('新会话从默认开始且无跨上下文继承', await queryValue(page) === '' && await sortValue(page) === 'recent' && (inherited === null || (inherited.query === '' && inherited.sort === 'recent' && inherited.status === 'owned')), JSON.stringify(inherited))
    // 状态 tab(处置)持久化
    await page.ev(`(async () => {
      const {itemRepository} = await import('/src/db/repositories/itemRepository.ts');
      const {db} = await import('/src/db/db.ts');
      const categories = await db.categories.toArray();
      const category = categories.find(c => c.parentId && c.deletedAt === null);
      await itemRepository.update((await db.items.toArray()).find(i => i.deletedAt === null).id, {
        name:'会话样品 1', categoryId:category.id, iconAssetId:'preset-other', note:'', tagIds:[],
        status:'disposed', purchaseDate:null, purchasePriceCents:null, additionalCostCents:null, purchasePlatform:null,
        warrantyExpiresAt:null, disposedAt:'2026-05-01', disposalMethod:'discarded', salePriceCents:null, disposalNote:null })
    })()`)
    await page.click('[role="radio"]', '处置')
    await page.until(`!!document.querySelector('[role="radio"][aria-checked="true"][aria-label*="处置"], [role="radio"][aria-checked="true"]')`)
    await page.send('Page.navigate', { url: `${BASE}/items` })
    await page.until(`!!document.querySelector('input[aria-label="搜索物品"]')`)
    await sleep(300)
    check('状态 tab(处置)刷新后恢复', await activeTab(page).then(t => t.includes('处置')))
    await page.shot('4-status-tab-restored')
    pws.close()
  }

  ws.close()
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}`)
  await writeFile(`${OUT}/results.json`, JSON.stringify({ results, exceptions: errors.slice(0, 10) }, null, 2))
  if (failed.length || errors.length) process.exit(1)
}

main().catch(error => { console.error('FATAL', error); process.exit(1) })
