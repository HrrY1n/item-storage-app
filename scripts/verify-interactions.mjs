// Requires the project-local Edge launcher on 9222 and Vite on 5173.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:5173'
const OUT = '.tmp/browser-verification/interactions'
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
      const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 15000)
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
    for (let i = 0; i < 60; i++) {
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
let page
try {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId })
  const target = (await (await fetch(`${CDP}/json/list`)).json()).find(target => target.id === targetId)
  page = await connect(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source:`window.modalEvents=[];
    for (const name of ['cancel','close']) document.addEventListener(name,event=>{
      const entry={name,label:event.target.ariaLabel,open:event.target.open,time:performance.now()};
      modalEvents.push(entry);setTimeout(()=>entry.prevented=event.defaultPrevented,0);
    },true);`})
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.send('Page.navigate', { url: `${BASE}/items` })
  await page.until(`!!document.querySelector('input[aria-label="搜索物品"]')`)
  // Add fixtures only inside this disposable context; never clear an existing store/outbox.
  await page.ev(`(async () => {
    const {db} = await import('/src/db/db.ts');
    const {itemRepository} = await import('/src/db/repositories/itemRepository.ts');
    const categories = await db.categories.toArray();
    const category = categories.find(c => c.parentId && c.deletedAt === null);
    window.fixtureCategory = category.parentId;
    for (let i=0;i<18;i++) await itemRepository.create({
      name:'交互样品 '+String(i).padStart(2,'0'), categoryId:category.id, iconAssetId:'preset-other',
      note:'保留的原始备注', tagIds:[], status:'owned', purchaseDate:'2026-01-15',
      purchasePriceCents:19900, additionalCostCents:null, purchasePlatform:null,
      warrantyExpiresAt:'2027-01-15', disposedAt:null, disposalMethod:null, salePriceCents:null, disposalNote:null
    });
  })()`)
  await page.until(`document.querySelectorAll('[data-item-card]').length === 18`)
  await page.click('input[aria-label="搜索物品"]')
  await page.send('Input.insertText', { text: '交互样品' })
  await page.ev(`for (const [label,value] of [['分类筛选',window.fixtureCategory],['物品排序','name']]) {
    const select=document.querySelector('select[aria-label="'+label+'"]');
    select.value=value; select.dispatchEvent(new Event('change',{bubbles:true}));
  }`)
  await page.click('[data-item-card]:nth-child(5) button[aria-expanded]')
  await sleep(300)
  await page.ev(`window.listCard=document.querySelector('[data-item-card]:nth-child(5)');
    window.listLink=listCard.querySelector('a'); listLink.scrollIntoView({block:'center'});
    window.listInput=document.querySelector('input[aria-label="搜索物品"]'); window.listY=scrollY;
    window.itemPath=listLink.getAttribute('href'); window.listX=listLink.getBoundingClientRect().left;`)
  await page.click('[data-item-card]:nth-child(5) a')
  await page.until(`!!document.querySelector('[data-sheet="detail"][data-state="open"]')`)
  await page.check('Entry runs a transform transition', `document.querySelector('.modal-sheet-panel').getAnimations().some(animation=>animation.transitionProperty==='transform')`)
  await sleep(550)
  await page.check('Detail opens above the mounted, scrolled list with focus and scroll lock', `
    location.pathname===itemPath && document.querySelector('dialog:modal').contains(document.activeElement)
    && document.body.style.overflow==='hidden' && listCard.isConnected && listInput.value==='交互样品'
    && Math.abs(listLink.getBoundingClientRect().left-listX)<1`)
  await page.shot('01-detail-mobile')
  await page.click('dialog[open] button[aria-label="返回"]')
  await page.until(`!!document.querySelector('[data-sheet="detail"][data-state="closing"]')`)
  await page.check('Detail exit stays mounted and blocks repeated interaction', `!!document.querySelector('[data-sheet="detail"] .modal-sheet-panel[inert]')`)
  await page.check('Exit runs a transform transition', `document.querySelector('.modal-sheet-panel').getAnimations().some(animation=>animation.transitionProperty==='transform')`)
  await page.until(`!document.querySelector('dialog[open]')`)
  await page.check('Return restores scroll, filters, card disclosure and focus', `
    location.pathname==='/items' && Math.abs(scrollY-listY)<2 && document.activeElement===listLink
    && listInput===document.querySelector('input[aria-label="搜索物品"]') && listInput.value==='交互样品'
    && listCard.dataset.expanded==='true' && document.querySelector('select[aria-label="分类筛选"]').value===fixtureCategory
    && document.querySelector('select[aria-label="物品排序"]').value==='name' && document.body.style.overflow===''
    && document.body.style.paddingRight===''`)

  await page.click('[data-item-card]:nth-child(5) a')
  await sleep(550)
  await page.ev('history.back()')
  await page.until(`!!document.querySelector('[data-state="closing"]')`)
  await page.ev('history.forward()')
  await page.until(`!!document.querySelector('[data-sheet="detail"][data-state="open"]')`)
  await sleep(550)
  await page.check('Fast browser back/forward cancels pending removal', `!!document.querySelector('dialog:modal [data-state="open"]') && listCard.isConnected`)
  await page.click('dialog[open] button', '处置物品')
  await page.until(`document.querySelectorAll('dialog:modal').length===2`)
  await page.escape()
  await page.check('Disposal closes above detail without closing its parent', `document.querySelectorAll('dialog:modal').length===1 && !!document.querySelector('dialog[aria-label="物品详情"]')`)
  await page.click('dialog[open] button', '删除物品')
  await page.until(`document.querySelectorAll('dialog:modal').length===2`)
  await page.escape()
  await page.check('Delete confirmation cancels above detail', `document.querySelectorAll('dialog:modal').length===1 && listCard.isConnected`)
  await page.click('dialog[open] a[href$="/edit"]')
  await page.until(`!!document.querySelector('dialog input[placeholder="比如：AirPods Pro"]')`)
  await sleep(550)
  await page.click('dialog input[placeholder="比如：AirPods Pro"]')
  await page.send('Input.insertText', { text: ' 草稿' })
  await page.ev(`window.nameDraft=document.querySelector('dialog input[placeholder="比如：AirPods Pro"]').value`)
  await page.click('dialog button', '点击本行更换图标')
  await page.until(`document.querySelectorAll('dialog:modal').length===2`)
  await sleep(380)
  await page.check('Nested icon picker owns focus without opening the keyboard', `document.activeElement.matches('[aria-label="关闭"]')`)
  await page.shot('02-icon-picker')
  await page.escape()
  await page.until(`!!document.querySelector('[data-sheet="picker"][data-state="closing"]')`)
  await page.until(`!document.querySelector('[data-sheet="picker"]')`)
  await page.check('Escape closes only picker and restores the form draft/focus', `
    document.querySelectorAll('dialog:modal').length===1 && document.body.style.overflow==='hidden'
    && document.querySelector('dialog input[placeholder="比如：AirPods Pro"]').value===nameDraft
    && document.activeElement.textContent.includes('点击本行更换图标')`)
  await page.click('dialog [data-date-field="购买日期"]')
  await page.until(`!!document.querySelector('[data-date-picker]')`)
  await page.escape()
  await page.check('Nested date cancel preserves the date and restores its trigger', `
    !document.querySelector('[data-date-picker]') && document.querySelectorAll('dialog:modal').length===1
    && document.activeElement.dataset.dateField==='购买日期' && document.activeElement.dataset.dateValue==='2026-01-15'`)
  await page.click('dialog [data-warranty-input] button', '自定义')
  await page.click('dialog input[placeholder="例如 18"]')
  await page.send('Input.insertText', { text: '18' })
  await page.click('dialog [data-warranty-toggle]')
  await sleep(260)
  await page.check('Collapsed warranty controls remain mounted and inert', `
    document.querySelector('dialog .warranty-disclosure').inert && document.querySelector('dialog input[placeholder="例如 18"]').value==='18'`)
  await page.click('dialog [data-warranty-toggle]')
  await sleep(260)
  await page.check('Warranty reopening preserves custom months and calculated expiry', `
    document.querySelector('dialog [data-warranty-toggle]').getAttribute('aria-expanded')==='true'
    && document.querySelector('dialog input[placeholder="例如 18"]').value==='18'
    && document.querySelector('dialog [data-date-field="保修到期日"]').dataset.dateValue==='2027-07-15'`)
  await page.check('Scrolled edit panel stays within its modal viewport', `(() => {
    const p=document.querySelector('[data-sheet="detail"] .modal-sheet-panel'),r=p.getBoundingClientRect();
    return r.top>=0 && r.bottom<=innerHeight+1 && p.scrollWidth<=p.clientWidth+1;
  })()`)
  await page.shot('03-warranty-expanded')
  await page.escape()
  await page.until(`document.querySelectorAll('dialog:modal').length===2`)
  await page.escape()
  await page.check('Escape dismisses dirty confirmation only', `
    document.querySelectorAll('dialog:modal').length===1 && location.pathname.endsWith('/edit')
    && document.querySelector('dialog input[placeholder="比如：AirPods Pro"]').value===nameDraft`)
  await page.escape()
  await page.until(`document.querySelectorAll('dialog:modal').length===2`)
  await page.click('dialog[aria-label="放弃此次修改？"] button', '放弃修改')
  await page.until(`!!document.querySelector('dialog[aria-label="物品详情"]')`)
  await sleep(550)
  await page.escape()
  await page.until(`!document.querySelector('dialog[open]')`)
  await page.check('Discard returns through detail to the original list and releases all locks', `listCard.isConnected && document.body.style.overflow===''`)

  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await page.click('[data-item-card]:nth-child(5) a')
  await page.until(`!!document.querySelector('dialog:modal')`)
  await page.escape()
  await page.until(`!document.querySelector('dialog[open]')`)
  await page.check('Reduced motion still completes close and focus restoration', `document.body.style.overflow==='' && document.activeElement===listLink`)
  await page.send('Emulation.setEmulatedMedia', { features: [] })
  await page.click('[data-item-card]:nth-child(5) a')
  await sleep(550)
  for (const width of [375, 430, 768, 1280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 640 })
    await page.ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await page.check(`Sheet fits viewport ${width}`, `(() => {
      const p=document.querySelector('.modal-sheet-panel'),r=p.getBoundingClientRect();
      return r.left>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 && p.scrollWidth<=p.clientWidth+1;
    })()`)
  }
  await page.shot('04-detail-desktop')
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await page.shot('05-detail-dark')
  const path = await page.ev('itemPath')
  await page.send('Page.navigate', { url: BASE + '/items' })
  await page.until(`!!document.querySelector('input[aria-label="搜索物品"]') && !document.querySelector('dialog')`)
  await page.send('Page.navigate', { url: BASE + path })
  await page.until(`document.body.innerText.includes('交互样品')`)
  await page.check('Direct detail URL remains a normal page', `!document.querySelector('dialog') && !!document.querySelector('header button[aria-label="返回"]')`)
  assert.deepEqual(errors, [], 'No runtime exceptions')
  console.log(`PASS ${results.length} interaction checks; no runtime exceptions`)
} catch (error) {
  console.log('Failure state:', await page?.ev(`({path:location.pathname,y:scrollY,expectedY:window.listY,
    focus:document.activeElement?.outerHTML.slice(0,300),sameFocus:document.activeElement===window.listLink,
    sameInput:window.listInput===document.querySelector('input[aria-label="搜索物品"]'),
    query:window.listInput?.value,expanded:window.listCard?.dataset.expanded,
    category:document.querySelector('select[aria-label="分类筛选"]')?.value,expectedCategory:window.fixtureCategory,
    sort:document.querySelector('select[aria-label="物品排序"]')?.value,overflow:document.body.style.overflow,
    viewport:[innerWidth,innerHeight],panel:document.querySelector('.modal-sheet-panel')?.getBoundingClientRect().toJSON(),
    events:window.modalEvents, dialogs:[...document.querySelectorAll('dialog')].map(d=>({label:d.ariaLabel,open:d.open}))})`).catch(() => null))
  await page?.shot('failure').catch(() => {})
  throw error
} finally {
  await writeFile(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2))
  await browser.send('Target.disposeBrowserContext', { browserContextId })
  page?.ws.close()
  browser.ws.close()
}
