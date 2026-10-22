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
  async touchStart(selector) {
    const point = await this.ev(`(() => {
      const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`)
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...point }] })
    return point
  }
  async touchMove(point, distance, duration = 300) {
    for (let i=1;i<=6;i++) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: point.x, y: point.y + distance*i/6 }] })
      await sleep(duration/6)
    }
  }
  async touchEnd(cancel = false) {
    await this.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
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
  await page.check('Search focus reveals a cancel action without replacing the input', `document.querySelector('.search-control').dataset.focused==='true' && !document.querySelector('.search-cancel').inert`)
  await page.click('.search-cancel button')
  await page.check('Cancel leaves the query intact and releases input focus', `document.querySelector('input[aria-label="搜索物品"]').value==='交互样品' && document.activeElement!==document.querySelector('input[aria-label="搜索物品"]')`)
  await page.click('input[aria-label="搜索物品"]')
  await page.click('button[aria-label="清空"]')
  await page.check('Clear preserves keyboard focus and empties the query', `document.activeElement===document.querySelector('input[aria-label="搜索物品"]') && document.activeElement.value===''`)
  await page.send('Input.insertText', { text: '交互样品' })
  await page.click('.search-cancel button')
  await page.click('button[aria-label="分类筛选"]')
  await page.check('Category filter expands a persistent accessible chip strip', `document.querySelector('button[aria-label="分类筛选"]').getAttribute('aria-expanded')==='true' && !document.querySelector('#item-category-filters').inert`)
  await page.until(`document.querySelector('#item-category-filters').clientHeight>35 && document.querySelector('#item-category-filters').getAnimations().length===0 && document.querySelector('.search-cancel').getAnimations().length===0`)
  const fixtureCategory = await page.ev('window.fixtureCategory')
  await page.click(`button[data-category-value="${fixtureCategory}"]`)
  await page.until(`document.querySelector('button[aria-label="分类筛选"]').value===${JSON.stringify(fixtureCategory)}`)
  await page.ev(`for (const [label,value] of [['物品排序','name']]) {
    const select=document.querySelector('select[aria-label="'+label+'"]');
    select.value=value; select.dispatchEvent(new Event('change',{bubbles:true}));
  }`)
  await page.until(`[...document.querySelectorAll('[data-layout-id]')].every(node=>node.getAnimations().length===0)`)
  await page.ev(`document.querySelectorAll('.item-card-toggle[aria-expanded="true"]').forEach(button=>button.click());document.querySelector('[data-item-card]:nth-child(5) button[aria-expanded]').scrollIntoView({block:'center'})`)
  await sleep(300)
  await page.ev(`document.documentElement.classList.add('theme-shift')`)
  await page.check('Theme color changes preserve disclosure layout transitions', `getComputedStyle(document.querySelector('[data-item-card]:nth-child(5) .item-card-details')).transitionProperty.includes('grid-template-rows')`)
  const disclosureSamples = await page.ev(`new Promise(resolve=>{
    const sibling=document.querySelector('[data-item-card]:nth-child(7)');
    const samples=[sibling.getBoundingClientRect().top+scrollY];const start=performance.now();
    document.querySelector('[data-item-card]:nth-child(5) button[aria-expanded]').click();
    const sample=()=>{samples.push(sibling.getBoundingClientRect().top+scrollY);if(performance.now()-start>400)resolve(samples);else requestAnimationFrame(sample)};
    requestAnimationFrame(sample);
  })`)
  await writeFile(`${OUT}/10-disclosure-layout-samples.json`, JSON.stringify(disclosureSamples))
  assert.ok(disclosureSamples.at(-1)>disclosureSamples[0]+5 && new Set(disclosureSamples.map(value=>Math.round(value))).size>2, 'Disclosure moves following rows continuously: '+JSON.stringify({first:disclosureSamples[0],last:disclosureSamples.at(-1),positions:new Set(disclosureSamples.map(value=>Math.round(value))).size}))
  results.push('Disclosure moves following rows continuously using existing CSS layout')
  console.log('PASS Disclosure moves following rows continuously using existing CSS layout')
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
  await page.check('Initial panel focus does not outline the back button', `document.activeElement===document.querySelector('.item-panel-content') && !document.querySelector('dialog button[aria-label="返回"]').matches(':focus-visible')`)
  await page.shot('01-detail-mobile')
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await page.check('Keyboard Tab still visibly focuses the back button', `document.activeElement===document.querySelector('dialog button[aria-label="返回"]') && document.activeElement.matches(':focus-visible') && parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`)
  const largeTitleVisible = await page.ev(`document.querySelector('dialog header h1').getAttribute('aria-hidden')==='true'`)
  await page.ev(`document.querySelector('.modal-sheet-panel').scrollTop=200`)
  await page.until(`document.querySelector('dialog header h1').getAttribute('aria-hidden')==='false'`)
  await page.ev(`document.querySelector('.modal-sheet-panel').scrollTop=0`)
  await page.until(`document.querySelector('dialog header h1').getAttribute('aria-hidden')==='true'`)
  await page.check('Compact detail title follows sheet scroll and expands again', `${largeTitleVisible} && document.querySelector('.modal-sheet-panel').scrollTop===0`)
  await page.click('dialog[open] button[aria-label="返回"]')
  await page.until(`!!document.querySelector('[data-sheet="detail"][data-state="closing"]')`)
  await page.check('Detail exit stays mounted and blocks repeated interaction', `!!document.querySelector('[data-sheet="detail"] .modal-sheet-panel[inert]')`)
  await page.check('Exit runs a transform transition', `document.querySelector('.modal-sheet-panel').getAnimations().some(animation=>animation.transitionProperty==='transform')`)
  await page.until(`!document.querySelector('dialog[open]')`)
  await page.check('Return restores scroll, filters, card disclosure and focus', `
    location.pathname==='/items' && Math.abs(scrollY-listY)<2 && document.activeElement===listLink
    && listInput===document.querySelector('input[aria-label="搜索物品"]') && listInput.value==='交互样品'
    && listCard.dataset.expanded==='true' && document.querySelector('button[aria-label="分类筛选"]').value===fixtureCategory
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
  await page.ev(`window.detailFrame=document.querySelector('.modal-sheet-panel');detailFrame.scrollTop=180`)
  await sleep(80)
  await page.ev(`window.detailY=detailFrame.scrollTop;document.querySelector('dialog[open] a[href$="/edit"]').click()`)
  await page.until(`!!document.querySelector('dialog input[placeholder="比如：AirPods Pro"]')`)
  await sleep(550)
  await page.check('Detail to edit reuses the same settled sheet instead of reopening', `detailFrame===document.querySelector('.modal-sheet-panel') && document.querySelectorAll('dialog:modal').length===1 && Math.abs(new DOMMatrixReadOnly(getComputedStyle(detailFrame).transform).m42)<1 && detailFrame.scrollTop===0`)
  await page.shot('09-edit-shared-panel')
  await page.click('dialog input[placeholder="比如：AirPods Pro"]')
  await page.send('Input.insertText', { text: ' 草稿' })
  await page.ev(`window.nameDraft=document.querySelector('dialog input[placeholder="比如：AirPods Pro"]').value`)
  await page.click('button[aria-label="选择分类"]')
  await page.until(`document.querySelectorAll('dialog:modal').length===2`)
  await page.check('Category chooser keeps the draft inside a nested sheet', `!!document.querySelector('dialog[aria-label="分类"] button[aria-pressed="true"]') && document.querySelector('input[placeholder="比如：AirPods Pro"]').value===nameDraft`)
  await page.escape()
  await page.until(`!document.querySelector('dialog[aria-label="分类"]')`)
  await page.click('button[aria-label="选择购买来源"]')
  await page.until(`!!document.querySelector('dialog[aria-label="购买来源"]')`)
  await sleep(380)
  await page.check('Source chooser fits its short content instead of filling the screen', `document.querySelector('dialog[aria-label="购买来源"] .modal-sheet-panel').clientHeight<innerHeight*.7 && document.querySelectorAll('dialog:modal').length===2`)
  await page.shot('11-source-compact')
  await page.click('dialog[aria-label="购买来源"] button', '京东')
  await page.escape()
  await page.until(`!document.querySelector('dialog[aria-label="购买来源"]')`)
  await page.check('Source selection returns to the unchanged name draft', `document.querySelector('button[aria-label="选择购买来源"]').textContent.includes('京东') && document.querySelector('input[placeholder="比如：AirPods Pro"]').value===nameDraft`)
  await page.click('button[aria-label="选择购买来源"]')
  await page.until(`!!document.querySelector('dialog[aria-label="购买来源"]')`)
  await sleep(380)
  await page.click('dialog[aria-label="购买来源"] button', '未填写')
  await page.escape()
  await page.until(`!document.querySelector('dialog[aria-label="购买来源"]')`)
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
  await page.check('Date close remains mounted and inert through its exit', `!!document.querySelector('[data-size="compact"][data-state="closing"] .modal-sheet-panel[inert]') && document.body.style.overflow==='hidden'`)
  await page.until(`!document.querySelector('[data-date-picker]')`)
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
  await page.check('Edit cancel restores detail scroll inside the same sheet', `detailFrame===document.querySelector('.modal-sheet-panel') && Math.abs(detailFrame.scrollTop-detailY)<2`)
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
  await page.until(`!!document.querySelector('.modal-sheet-panel') && Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.modal-sheet-panel')).transform).m42)<1`)
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

  await page.send('Emulation.setEmulatedMedia', { features: [] })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  await page.send('Page.navigate', { url: BASE + '/items' })
  await page.until(`document.querySelectorAll('[data-item-card]').length===18`)
  await page.ev(`window.creationList=document.querySelector('[data-item-card]');window.creationSearch=document.querySelector('input[aria-label="搜索物品"]');void 0`)
  await page.click('a[aria-label="新增物品"]')
  await page.until(`!!document.querySelector('dialog[aria-label="新增物品"] input[placeholder="比如：AirPods Pro"]')`)
  await sleep(550)
  await page.check('Creation is a sheet above the same list', `location.pathname==='/items/new' && creationList.isConnected && creationSearch===document.querySelector('input[aria-label="搜索物品"]')`)
  const creationTitle = 'dialog[aria-label="新增物品"] header h1'
  let touch = await page.touchStart(creationTitle)
  await page.touchMove(touch, 75)
  await page.check('Touch drag moves the sheet with the finger', `document.querySelector('[data-sheet="detail"]').dataset.dragging==='true' && new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.modal-sheet-panel')).transform).m42>=70`)
  await page.shot('06-creation-follow-finger')
  await sleep(150)
  await page.touchEnd()
  await sleep(550)
  await page.check('Short slow pull rebounds without closing or changing the draft', `location.pathname==='/items/new' && Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.modal-sheet-panel')).transform).m42)<1 && document.querySelector('dialog input[placeholder="比如：AirPods Pro"]').value===''`)
  touch = await page.touchStart(creationTitle)
  await page.touchMove(touch, 100)
  await sleep(150)
  await page.touchEnd()
  await sleep(25)
  touch = await page.touchStart(creationTitle)
  await sleep(60)
  await page.ev(`(async()=>{const panel=document.querySelector('.modal-sheet-panel'),animations=panel.getAnimations();animations.forEach(animation=>animation.pause());await Promise.all(animations.map(animation=>animation.ready));window.regrabY=new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42})()`)
  await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: touch.x, y: touch.y + 20 }] })
  await page.check('Re-grabbing a rebound takes over its current visual position', `Math.abs(parseFloat(document.querySelector('[data-sheet="detail"]').style.getPropertyValue('--sheet-drag-y'))-(regrabY+20))<2`)
  await page.touchEnd(true)
  await sleep(350)
  touch = await page.touchStart(creationTitle)
  await page.touchMove(touch, 100)
  await page.touchEnd(true)
  await sleep(550)
  await page.check('Cancelled touch rebounds and keeps the sheet usable', `location.pathname==='/items/new' && !document.querySelector('[data-dragging="true"]') && Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.modal-sheet-panel')).transform).m42)<1`)

  await page.ev(`const h=[...document.querySelectorAll('dialog p')].find(e=>e.textContent==='购买信息');h.scrollIntoView({block:'center'});window.scrollTestTarget=h;window.beforeSheetScroll=document.querySelector('.modal-sheet-panel').scrollTop`)
  const scrollPoint = await page.ev(`(()=>{const r=scrollTestTarget.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...scrollPoint }] })
  await page.touchMove(scrollPoint, 150)
  await page.touchEnd()
  await sleep(150)
  await page.check('A gesture starting in scrolled content stays native', `beforeSheetScroll>100 && document.querySelector('.modal-sheet-panel').scrollTop<beforeSheetScroll-20 && !document.querySelector('[data-dragging="true"]') && location.pathname==='/items/new'`)
  await page.ev(`document.querySelector('.modal-sheet-panel').scrollTop=0`)
  touch = await page.touchStart(creationTitle)
  await page.touchMove(touch, 220)
  await page.touchEnd()
  await page.check('Dismissal continues from the released drag position', `(()=>{const panel=document.querySelector('.modal-sheet-panel');return !panel || (panel.closest('.modal-sheet').dataset.state==='closing' && new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42>=215)})()`)
  await page.until(`!document.querySelector('dialog[open]')`)
  await page.check('Long pull dismisses pristine creation and restores the list/focus', `location.pathname==='/items' && creationList.isConnected && document.activeElement.matches('a[aria-label="新增物品"]') && document.body.style.overflow===''`)

  await page.click('a[aria-label="新增物品"]')
  await page.until(`!!document.querySelector('dialog input[placeholder="比如：AirPods Pro"]')`)
  await sleep(550)
  await page.click('dialog input[placeholder="比如：AirPods Pro"]')
  await page.send('Input.insertText', { text: '需要保留的下拉草稿' })
  touch = await page.touchStart(creationTitle)
  await page.touchMove(touch, 220)
  await page.touchEnd()
  await page.until(`!!document.querySelector('dialog[aria-label="放弃此次修改？"]')`)
  await page.escape()
  await sleep(550)
  await page.check('Dirty swipe requests confirmation and cancelling preserves input', `location.pathname==='/items/new' && document.querySelector('dialog input[placeholder="比如：AirPods Pro"]').value==='需要保留的下拉草稿' && Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.modal-sheet-panel')).transform).m42)<1`)
  await page.click('dialog button', '点击本行更换图标')
  await page.until(`document.querySelectorAll('dialog:modal').length===2`)
  await sleep(380)
  touch = await page.touchStart('dialog[aria-label="选择物品图标"] header h2')
  await page.touchMove(touch, 200)
  await page.check('Nested drag leaves the parent sheet stationary', `new DOMMatrixReadOnly(getComputedStyle(document.querySelector('dialog[aria-label="新增物品"] .modal-sheet-panel')).transform).m42===0 && document.querySelectorAll('dialog:modal').length===2`)
  await page.shot('07-nested-picker-drag')
  await page.touchEnd()
  await page.until(`document.querySelectorAll('dialog:modal').length===1`)
  await page.check('Nested drag closes only the picker and keeps the draft/scroll lock', `location.pathname==='/items/new' && document.querySelector('dialog input[placeholder="比如：AirPods Pro"]').value==='需要保留的下拉草稿' && document.body.style.overflow==='hidden'`)
  await page.escape()
  await page.until(`!!document.querySelector('dialog[aria-label="放弃此次修改？"]')`)
  await page.click('dialog[aria-label="放弃此次修改？"] button', '放弃修改')
  await page.until(`!document.querySelector('dialog[open]')`)
  await page.check('Discard after gestures writes no business records and releases locks', `creationList.isConnected && document.querySelectorAll('[data-item-card]').length===18 && document.body.style.overflow===''`)
  await page.ev(`window.layoutIds=[...document.querySelectorAll('[data-layout-id]')].map(node=>node.dataset.layoutId);document.querySelector('button[aria-label="切换为列表视图"]').click()`)
  await page.until(`document.querySelector('[data-layout-view]')?.dataset.layoutView==='list'`)
  await page.check('View switch animates stable visible item identities', `JSON.stringify(layoutIds)===JSON.stringify([...document.querySelectorAll('[data-layout-id]')].map(node=>node.dataset.layoutId)) && [...document.querySelectorAll('[data-layout-id]')].some(node=>node.getAnimations().length>0)`)
  await page.click('button[aria-label="切换为网格视图"]')
  await sleep(300)
  await page.check('Interrupted layout motion settles without stale transforms or ghosts', `document.querySelectorAll('[data-item-card]').length===18 && [...document.querySelectorAll('[data-layout-id]')].every(node=>node.getAnimations().length===0)`)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await page.click('button[aria-label="切换为列表视图"]')
  await sleep(80)
  await page.check('Reduced motion skips layout animation and retains all results', `document.querySelectorAll('[data-layout-id]').length===18 && [...document.querySelectorAll('[data-layout-id]')].every(node=>node.getAnimations().length===0)`)
  await page.send('Emulation.setEmulatedMedia', { features: [] })
  await page.click('button[aria-label="切换为网格视图"]')
  await sleep(300)
  await page.click('[role="radiogroup"][aria-label="物品状态"] button', '心愿')
  await sleep(220)
  await page.check('Segment indicator aligns with the selected accessible radio', `(()=>{const selected=document.querySelector('[role="radiogroup"][aria-label="物品状态"] [aria-checked="true"]'),indicator=selected.parentElement.querySelector('.segmented-indicator');return selected.textContent.includes('心愿')&&Math.abs(selected.getBoundingClientRect().left-indicator.getBoundingClientRect().left)<2})()`)
  await page.click('[role="radiogroup"][aria-label="物品状态"] button', '收纳')
  await page.until(`document.querySelectorAll('[data-item-card]').length===18`)
  await page.click('button[aria-label="分类筛选"]')
  await page.click('input[aria-label="搜索物品"]')
  await sleep(260)
  await page.shot('08-search-filter-motion')
  assert.deepEqual(errors, [], 'No runtime exceptions')
  console.log(`PASS ${results.length} interaction checks; no runtime exceptions`)
} catch (error) {
  console.log('Failure state:', await page?.ev(`({path:location.pathname,y:scrollY,expectedY:window.listY,
    focus:document.activeElement?.outerHTML.slice(0,300),sameFocus:document.activeElement===window.listLink,
    sameInput:window.listInput===document.querySelector('input[aria-label="搜索物品"]'),
    query:window.listInput?.value,expanded:window.listCard?.dataset.expanded,
    category:document.querySelector('button[aria-label="分类筛选"]')?.value,expectedCategory:window.fixtureCategory,
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
