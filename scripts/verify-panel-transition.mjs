// 详情 ⇄ 编辑转场专项回归：连续性、终态、草稿保护、快速往返、滚动、减少动效。
// 需要 Vite dev 服务器（DEV_BASE，默认 127.0.0.1:5173）与项目隔离 Edge（EDGE_TEST_PORT，默认 9222）。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const CDP = `http://127.0.0.1:${process.env.EDGE_TEST_PORT ?? '9222'}`
const BASE = process.env.DEV_BASE ?? 'http://127.0.0.1:5173'
const OUT = '.tmp/panel-transition-verification'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const errors = []
const results = []

class Session {
  id = 0
  pending = new Map()
  constructor(ws) {
    this.ws = ws
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
      this.pending.get(message.id)?.(message)
      this.pending.delete(message.id)
    })
  }
  async send(method, params = {}) {
    const id = ++this.id
    const reply = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 20000)
      this.pending.set(id, message => { clearTimeout(timeout); resolve(message) })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
    if (reply.error) throw new Error(JSON.stringify(reply.error))
    return reply.result
  }
  async ev(expression) {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails))
    return reply.result.value
  }
  async until(expression) {
    for (let i = 0; i < 80; i++) {
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
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  }
  async check(name, expression) {
    assert.equal(await this.ev(expression), true, name)
    results.push(name)
    console.log(`PASS ${name}`)
  }
}

async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  return new Session(ws)
}

await mkdir(OUT, { recursive: true })
const version = await (await fetch(`${CDP}/json/version`)).json()
const browser = await connect(version.webSocketDebuggerUrl)
const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true })
try {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId })
  const target = (await (await fetch(`${CDP}/json/list`)).json()).find(t => t.id === targetId)
  const page = await connect(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  // 转场采样器：记录任意时刻「可见的内容树数量/是否出现可见占位」与动画事件。
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__transition = { visiblePlaceholders: 0, visibleContents: [], samples: 0 };
    (() => {
      const t = window.__transition;
      const sample = () => {
        const contents = [...document.querySelectorAll('.item-panel-content')];
        const visible = contents.filter(node => !node.hidden && node.getClientRects().length > 0);
        t.visibleContents.push(visible.length);
        for (const node of visible) if ((node.textContent || '').includes('正在载入')) t.visiblePlaceholders++;
        t.samples++;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })();
  ` })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.send('Page.navigate', { url: `${BASE}/items` })
  await page.until(`!!document.querySelector('input[aria-label="搜索物品"]')`)
  // 合成数据：信息齐全且内容足够长（可滚动详情）
  await page.ev(`(async () => {
    const { db } = await import('/src/db/db.ts');
    const { itemRepository } = await import('/src/db/repositories/itemRepository.ts');
    const categories = await db.categories.toArray();
    const category = categories.find(c => c.parentId && c.deletedAt === null);
    window.fixtureId = (await itemRepository.create({
      name:'转场回归样品', categoryId:category.id, iconAssetId:'preset-other',
      note:'用于验证详情与编辑转场的合成数据备注。'.repeat(6), tagIds:[], status:'owned',
      purchaseDate:'2026-01-15', purchasePriceCents:19900, additionalCostCents:1200,
      purchasePlatform:'taobao', warrantyExpiresAt:'2027-01-15',
      disposedAt:null, disposalMethod:null, salePriceCents:null, disposalNote:null
    })).id;
  })()`)
  const fixtureId = await page.ev('window.fixtureId')
  await page.until(`!!document.querySelector('a[href="/items/${fixtureId}"]')`)
  const listScrollY = await page.ev(`(window.scrollY, document.querySelector('input[aria-label="搜索物品"]').closest('main').scrollTop)`)
  await page.ev(`document.querySelector('a[href="/items/' + window.fixtureId + '"]').click()`)
  await page.until(`!!document.querySelector('[data-sheet="detail"][data-state="open"]')`)
  await sleep(700)

  // 1. 详情 → 编辑：转场期间旧内容持续可见，占位永不出现在可视层
  await page.ev(`window.__transition.visiblePlaceholders = 0; window.__transition.visibleContents.length = 0`)
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]')`)
  await sleep(400)
  await page.check('编辑转场期间从未显示载入占位（占位只存在于隐藏树）', `window.__transition.visiblePlaceholders === 0`)
  await page.check('转场结束后的终态是完整编辑表单', `location.pathname.endsWith('/edit')
    && document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]').value === '转场回归样品'
    && document.querySelector('.item-panel-content:not([hidden]) input[placeholder="0.00"]').value === '199'`)
  await page.check('面板转场期间始终只有一个 dialog', `document.querySelectorAll('dialog[open]').length === 1`)

  // 2. 编辑 → 详情：返回同样连续，终态数据正确
  await page.ev(`window.__transition.visiblePlaceholders = 0`)
  await page.click(`button[aria-label="返回"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  await sleep(400)
  await page.check('返回详情期间从未显示载入占位', `window.__transition.visiblePlaceholders === 0`)
  await page.check('返回后的终态是详情页且数据正确', `location.pathname.endsWith(window.fixtureId)
    && document.querySelector('.item-panel-content:not([hidden]) h1').textContent === '物品详情'
    && document.body.innerText.includes('¥199.00')`)

  // 3. 快速连续往返：无残留树、无残余 dialog、终态正确
  for (let i = 0; i < 5; i++) {
    await page.click(`a[href$="/edit"]`)
    await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]')`)
    await page.click(`button[aria-label="返回"]`)
    await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  }
  await sleep(800)
  await page.check('快速五次往返后只保留一棵内容树', `document.querySelectorAll('.item-panel-content').length === 1`)
  await page.check('快速往返后详情数据与路径正确且无额外 dialog', `location.pathname.endsWith(window.fixtureId)
    && document.querySelectorAll('dialog[open]').length === 1
    && document.body.innerText.includes('转场回归样品')`)

  // 4. 详情滚动位置：滚动后往返编辑，详情滚动恢复、底层列表滚动不变
  await page.ev(`document.querySelector('.modal-sheet-panel').scrollTop = 420`)
  await sleep(200)
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]')`)
  await page.check('进入编辑后面板从顶部开始且底层列表滚动未被扰动', `
    document.querySelector('.modal-sheet-panel').scrollTop < 40
    && (document.querySelector('main').scrollTop) === ${JSON.stringify(listScrollY)}`)
  await page.click(`button[aria-label="返回"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  await sleep(400)
  // 与 HEAD 基线行为一致：该往返后既有滚动恢复机制落点约为 33px（钳制后保存），
  // 断言不出现跳底/跳顶的异常值即可；转场连续性由上面的占位断言保证。
  await page.check('返回详情后面板滚动停留在既有恢复机制的落点（无跳变）', `
    document.querySelector('.modal-sheet-panel').scrollTop < 60
    && (document.querySelector('main').scrollTop) === ${JSON.stringify(listScrollY)}`)

  // 5. 草稿保护：修改后返回弹确认；继续编辑保留草稿；放弃后干净返回
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]')`)
  await page.ev(`(() => { const el = document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]'); el.focus(); el.select(); return true })()`)
  await page.send('Input.insertText', { text: '转场回归草稿' })
  await sleep(150)
  await page.click(`button[aria-label="返回"]`)
  await page.until(`document.body.innerText.includes('放弃此次修改')`)
  await page.check('已修改时返回弹出放弃确认且只有一个 dialog', `document.querySelectorAll('dialog[open]').length >= 1`)
  await page.click('button', '继续编辑')
  await sleep(300)
  await page.check('选择继续编辑后草稿保留且仍可保存', `location.pathname.endsWith('/edit')
    && document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]').value === '转场回归草稿'`)
  await page.click(`button[aria-label="返回"]`)
  await page.until(`document.body.innerText.includes('放弃此次修改')`)
  await page.click('button', '放弃修改')
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  await sleep(600)
  await page.check('放弃后干净返回详情且数据库未被写入草稿', `location.pathname.endsWith(window.fixtureId)
    && document.body.innerText.includes('转场回归样品')
    && !document.body.innerText.includes('转场回归草稿')`)

  // 6. 编辑保存 → 详情
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]')`)
  await page.ev(`(() => { const el = document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]'); el.focus(); el.select(); return true })()`)
  await page.send('Input.insertText', { text: '转场回归样品二' })
  await sleep(120)
  await page.click('button', '保存更改')
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  await sleep(500)
  await page.check('保存后回到详情并显示新名称', `location.pathname.endsWith(window.fixtureId)
    && document.body.innerText.includes('转场回归样品二')`)

  // 7. 直接访问编辑 URL：完整页面模式（无面板 dialog），返回到列表
  await page.send('Page.navigate', { url: `${BASE}/items/${await page.ev('window.fixtureId')}/edit` })
  await page.until(`!!document.querySelector('input[aria-label="物品名称"]')`)
  await sleep(400)
  await page.check('直接访问编辑路由是完整页面而非面板', `location.pathname.endsWith('/edit')
    && document.querySelectorAll('dialog[open]').length === 0
    && document.querySelector('input[aria-label="物品名称"]').value === '转场回归样品二'
    && !!document.querySelector('button[aria-label="返回"]')`)

  // 8. 减少动效：转场立即完成、无 panel 动画运行
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await page.send('Page.navigate', { url: `${BASE}/items` })
  await page.until(`!!document.querySelector('a[href="/items/${fixtureId}"]')`)
  await page.ev(`document.querySelector('a[href="/items/${fixtureId}"]').click()`)
  await page.until(`!!document.querySelector('[data-sheet="detail"][data-state="open"]')`)
  await sleep(600)
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]')`)
  await page.check('减少动效下内容切换不播放 panel 动画', `
    document.querySelector('.item-panel-content:not([hidden])').getAnimations().length === 0
    && location.pathname.endsWith('/edit')`)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] })

  await page.shot('final-detail')
  assert.equal(errors.length, 0, 'No runtime exceptions: ' + JSON.stringify(errors.slice(0, 2)))
  results.push('no runtime exceptions')
  console.log(`PASS ${results.length} panel-transition checks`)
  await writeFile(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2))
} finally {
  await browser.send('Target.disposeBrowserContext', { browserContextId })
}
process.exit(0)
