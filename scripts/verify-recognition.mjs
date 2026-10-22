// Vite :5173 + project-local Edge :9222. AI responses are intercepted; no model calls.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const CDP = 'http://127.0.0.1:9222'
const OUT = '.tmp/browser-verification/recognition'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = [], exceptions = [], requests = [], held = []
let replyMode = 'success'
class Session {
  id = 0
  pending = new Map()
  constructor(ws) {
    this.ws = ws
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      this.pending.get(message.id)?.(message)
      this.pending.delete(message.id)
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
      if (message.method === 'Fetch.requestPaused') {
        const { requestId, request } = message.params
        const input = JSON.parse(request.postData)
        requests.push(input)
        if (replyMode === 'hold') { held.push(requestId); return }
        const candidate = { name: 'AI 测试耳机', categoryName: input.categoryNames[0], note: '模型建议的备注', priceText: '199.90', purchaseDate: '2026-01-15', purchasePlatform: 'jd', warnings: ['模拟结果，仅用于验证交互'] }
        const body = replyMode === 'quota' ? { error: 'ai-quota-exhausted' } : { candidate }
        void this.fulfill(requestId, replyMode === 'quota' ? 429 : 200, body)
      }
    })
  }
  async send(method, params = {}) {
    const id = ++this.id
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15000)
      this.pending.set(id, message => { clearTimeout(timer); resolve(message) })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
    if (response.error) throw new Error(JSON.stringify(response.error))
    return response.result
  }
  fulfill(requestId, status, body) {
    return this.send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }).catch(() => {})
  }
  async ev(expression) {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails))
    return reply.result.value
  }
  async until(expression) {
    for (let i = 0; i < 80; i++) { if (await this.ev(expression)) return; await sleep(100) }
    throw new Error(`Timed out waiting for ${expression}`)
  }
  async click(selector, text = '') {
    const point = await this.ev(`(() => {
      const target=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(text)}));
      if(!target) throw Error('Missing ${selector}');
      target.scrollIntoView({block:'center'}); const r=target.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  async check(name, expression) {
    assert.equal(await this.ev(expression), true, name)
    results.push(name); console.log(`PASS ${name}`)
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  }
  async file() {
    await this.ev(`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;
      const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,640,400);
      c.fillStyle='#333';c.font='28px sans-serif';c.fillText('交互测试订单',30,70);c.fillText('耳机  ¥199.90',30,140);
      c.fillText('2026-01-15',30,210);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const files=new DataTransfer();files.items.add(new File([blob],'test-order.png',{type:'image/png'}));
      const input=document.querySelector('[data-ai-file="album"]');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`)
    await this.until(`!!document.querySelector('img[alt="待识别图片预览"]') && ![...document.querySelectorAll('[role="status"]')].some(e=>e.textContent.includes('准备图片'))`)
  }
}
async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  return new Session(ws)
}

await mkdir(OUT, { recursive: true })
const version = await (await fetch(`${CDP}/json/version`)).json()
const browser = await connect(version.webSocketDebuggerUrl)
const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true })
let page
try {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId })
  const target = (await (await fetch(`${CDP}/json/list`)).json()).find(target => target.id === targetId)
  page = await connect(target.webSocketDebuggerUrl)
  await page.send('Page.enable'); await page.send('Runtime.enable')
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*://127.0.0.1:5173/api/ai/recognize', requestStage: 'Request' }] })
  await page.send('Page.navigate', { url: 'http://127.0.0.1:5173/items/new' })
  await page.until(`!!document.querySelector('[data-ai-entry]')`)
  await page.click('input[placeholder="比如：AirPods Pro"]')
  await page.send('Input.insertText', { text: '手工填写的名称' })
  await page.click('textarea')
  await page.send('Input.insertText', { text: '手工保留的备注' })
  await page.click('[data-ai-entry]')
  await page.until(`!!document.querySelector('dialog[aria-label="AI 辅助录入"]')`)
  await sleep(400)
  await page.check('Opens a focused recognition sheet with camera capture', `document.activeElement.matches('[aria-label="关闭 AI 识别"]') && document.querySelector('[data-ai-file="camera"]').getAttribute('capture')==='environment'`)
  await page.file()
  await page.click('dialog button', '开始识别')
  await page.until(`document.querySelector('dialog [role="alert"]')?.textContent.includes('配对')`)
  assert.equal(requests.length, 0)
  results.push('Unpaired device sends no image')
  await page.ev(`(async()=>{
    const {syncRepository}=await import('/src/db/repositories/syncRepository.ts');
    await syncRepository.initCredentials('test-recognition-secret-test-recognition-secret','test-ai',{enabled:false});
  })()`)
  await page.click('dialog button', '订单截图')
  await page.click('dialog button', '开始识别')
  await page.until(`!!document.querySelector('section[aria-label="识别结果"]')`)
  assert.ok(requests[0].image.startsWith('data:image/jpeg;base64,/9j/'))
  assert.ok(Buffer.from(requests[0].image.split(',')[1], 'base64').length <= 400 * 1024)
  await page.check('Existing name and note stay unchecked; new purchase fields are selected', `(() => {
    const rows=[...document.querySelectorAll('section[aria-label="识别结果"] label')];
    return !rows.find(e=>e.textContent.includes('名称')).querySelector('input').checked
      && !rows.find(e=>e.textContent.includes('备注')).querySelector('input').checked
      && rows.find(e=>e.textContent.includes('购买价格')).querySelector('input').checked;
  })()`)
  await page.shot('01-candidate-selection')
  await page.click('dialog button', '填入表单')
  await page.until(`!document.querySelector('dialog[aria-label="AI 辅助录入"]')`)
  await page.check('Apply preserves existing fields and fills selected price/date', `document.querySelector('input[placeholder="比如：AirPods Pro"]').value==='手工填写的名称'
    && document.querySelector('textarea').value==='手工保留的备注'
    && document.querySelector('[data-date-field="购买日期"]').dataset.dateValue==='2026-01-15'
    && [...document.querySelectorAll('input[placeholder="0.00"]')].some(input=>input.value==='199.90')
    && document.activeElement.hasAttribute('data-ai-entry')`)
  await page.check('AI apply does not save any item', `(async()=>{const {db}=await import('/src/db/db.ts');return await db.items.count()===0})()`)
  await page.click('[data-ai-entry]'); await sleep(400); await page.file()
  replyMode = 'quota'
  await page.click('dialog button', '开始识别')
  await page.until(`document.querySelector('dialog [role="alert"]')?.textContent.includes('额度')`)
  await page.check('Quota failure retains preview and the existing form', `!!document.querySelector('img[alt="待识别图片预览"]') && document.querySelector('input[placeholder="比如：AirPods Pro"]').value==='手工填写的名称'`)
  replyMode = 'hold'
  await page.click('dialog button', '开始识别')
  await page.until(`document.querySelector('dialog [role="status"]')?.textContent.includes('识别')`)
  await page.click('dialog button', '取消识别')
  for (const requestId of held.splice(0)) await page.fulfill(requestId, 200, { candidate: { name: '迟来的结果', warnings: [] } })
  await sleep(250)
  await page.check('Cancelled request cannot insert a late result', `!document.querySelector('section[aria-label="识别结果"]') && !!document.querySelector('img[alt="待识别图片预览"]') && !document.querySelector('dialog [role="status"]')`)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 568, deviceScaleFactor: 1, mobile: true })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await page.ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await page.check('Recognition fits a short mobile viewport', `(()=>{const p=document.querySelector('dialog .modal-sheet-panel'),r=p.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&p.scrollWidth<=p.clientWidth})()`)
  await page.shot('02-short-screen-dark')
  await page.click('dialog button[aria-label="关闭 AI 识别"]')
  await page.until(`!document.querySelector('dialog[aria-label="AI 辅助录入"]')`)
  await page.click('header button', '保存')
  await page.until(`location.pathname.startsWith('/items/') && !location.pathname.endsWith('/new')`)
  await page.check('Only explicit Save persists the reviewed values', `(async()=>{
    const {db}=await import('/src/db/db.ts');const items=await db.items.toArray();
    return items.length===1&&items[0].name==='手工填写的名称'&&items[0].note==='手工保留的备注'&&items[0].purchasePriceCents===19990&&items[0].purchaseDate==='2026-01-15';
  })()`)
  assert.deepEqual(exceptions, [])
  console.log(`PASS ${results.length} recognition checks; no model calls, no runtime exceptions`)
} catch (error) {
  await page?.shot('failure').catch(() => {})
  throw error
} finally {
  await writeFile(`${OUT}/results.json`, JSON.stringify({ results, requests: requests.map(input => ({ mode: input.mode, imageLength: input.image.length, categories: input.categoryNames.length })), exceptions }, null, 2))
  await browser.send('Target.disposeBrowserContext', { browserContextId })
  page?.ws.close(); browser.ws.close()
}
