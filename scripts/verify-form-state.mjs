// Project-local Edge :9222 and Vite :5173. Disposable fixtures only; all API requests are intercepted.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const BASE = 'http://127.0.0.1:5173', CDP = 'http://127.0.0.1:9222'
const OUT = '.tmp/form-state-verification'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const observations = [], exceptions = [], requests = []
class Session {
  id = 0; pending = new Map()
  dialogs = []; acceptDialog = true
  constructor(ws) {
    this.ws = ws
    ws.addEventListener('message', event => {
      const data = JSON.parse(event.data)
      if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.text)
      if (data.method === 'Page.javascriptDialogOpening') {
        this.dialogs.push(data.params.type)
        void this.send('Page.handleJavaScriptDialog', { accept: this.acceptDialog })
      }
      if (data.method === 'Fetch.requestPaused') {
        requests.push(new URL(data.params.request.url).pathname)
        void this.send('Fetch.fulfillRequest', { requestId: data.params.requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"error":"audit-local-only"}').toString('base64') })
      }
      const item = this.pending.get(data.id)
      if (!item) return
      clearTimeout(item.timer); this.pending.delete(data.id)
      data.error ? item.reject(new Error(JSON.stringify(data.error))) : item.resolve(data.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 15000)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async ev(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description)
    return result.result?.value
  }
  async wait(expression, label) {
    for (let i = 0; i < 80; i++) { if (await this.ev(expression)) return; await pause(50) }
    throw new Error('Not ready: ' + label)
  }
  async nav(route) {
    await this.send('Page.navigate', { url: BASE + route })
    await this.wait(`!!document.querySelector('main')`, route)
    await pause(500)
  }
  async click(text, selector = 'button') {
    assert(await this.ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el || el.disabled) return false; el.click(); return true; })()`), 'Action missing: ' + text)
    await pause(150)
  }
  async fill(selector, text) {
    assert(await this.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.select(); return true; })()`))
    await this.send('Input.insertText', { text })
    await pause(100)
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  }
}
async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  return new Session(ws)
}
const version = await (await fetch(CDP + '/json/version')).json()
const browser = await connect(version.webSocketDebuggerUrl)
async function test(label, fn) {
  const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true })
  let page
  try {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId })
    const target = (await (await fetch(CDP + '/json/list')).json()).find(target => target.id === targetId)
    page = await connect(target.webSocketDebuggerUrl)
    await page.send('Page.enable'); await page.send('Runtime.enable')
    await page.send('Fetch.enable', { patterns: [{ urlPattern: BASE + '/api/*' }] })
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    const result = await fn(page)
    observations.push({ label, ...result })
    await writeFile(OUT + '/results-progress.json', JSON.stringify({observations, exceptions, interceptedApiPaths:requests}, null, 2))
    console.log(JSON.stringify({ label, ...result }))
  } catch (error) {
    await page?.shot('failure').catch(() => {})
    throw error
  } finally {
    page?.ws.close()
    await browser.send('Target.disposeBrowserContext', { browserContextId })
  }
}
const seed = page => page.ev(`(async () => {
  const { db } = await import('/src/db/db.ts');
  const { itemRepository } = await import('/src/db/repositories/itemRepository.ts');
  const category = (await db.categories.toArray()).find(category => category.parentId && !category.deletedAt);
  const item = await itemRepository.create({ name: '审计夹具', categoryId: category.id, iconAssetId: 'preset-other', note: '', tagIds: [], status: 'owned', purchaseDate: '2026-10-20', purchasePriceCents: 12345, additionalCostCents: null, purchasePlatform: null, warrantyExpiresAt: null, disposedAt: null, disposalMethod: null, salePriceCents: null, disposalNote: null });
  return item.id;
})()`)
const item = (page, id) => page.ev(`import('/src/db/db.ts').then(({db}) => db.items.get(${JSON.stringify(id)}))`)
await mkdir(OUT, { recursive: true })
const field = 'input[aria-label="物品名称"]'
const amount = 'input[placeholder^="0.00"]'
const state = page => page.ev(`import('/src/db/repositories/syncRepository.ts').then(async ({syncRepository}) => {const s = await syncRepository.getState(); return {enabled:s.enabled, credentialsCleared:s.secret === null && s.keyId === null};})`)
const enable = page => page.ev(`import('/src/db/repositories/syncRepository.ts').then(({syncRepository}) => syncRepository.initCredentials('synthetic-audit-secret-000000000000000000', 'audit-key', {enabled:true}))`)
try {
  await test('missing detail/edit finish loading and can return', async page => {
    for (const suffix of ['', '/edit']) {
      await page.nav('/items/audit-missing' + suffix)
      await page.wait(`document.body.innerText.includes('物品不存在')`, 'not found')
      assert(!await page.ev(`document.body.innerText.includes('正在载入')`))
      await page.ev(`document.querySelector('header button[aria-label="返回"]').click()`)
      await page.wait(`location.pathname === '/items'`, 'fallback list')
    }
    const id = await seed(page)
    for (const suffix of ['', '/edit']) {
      await page.ev(`import('/src/db/db.ts').then(({db}) => db.items.update(${JSON.stringify(id)}, {deletedAt:null}))`)
      await page.nav('/items/' + id + suffix)
      await page.wait(`document.body.innerText.includes('审计夹具') || !!document.querySelector(${JSON.stringify(field)})`, 'existing item')
      await page.ev(`import('/src/db/repositories/itemRepository.ts').then(({itemRepository}) => itemRepository.softDelete(${JSON.stringify(id)}))`)
      await page.wait(`document.body.innerText.includes('物品不存在')`, 'deleted while viewing')
    }
    await page.shot('01-not-found')
    return { directDetail:true, directEdit:true, returnToList:true, deleteWhileViewing:true, deleteWhileEditing:true }
  })
  await test('edit rejects invalid price and extra cost without changing stored amounts', async page => {
    await page.nav('/settings'); const id = await seed(page)
    await page.nav('/items/' + id + '/edit')
    await page.wait(`document.querySelector(${JSON.stringify(field)})?.value === '审计夹具'`, 'edit item')
    for (const raw of ['.5', '12.', '.']) {
      await page.fill(amount, raw)
      await page.click('保存', 'header button')
      await page.wait(`document.body.innerText.includes('购买价格格式不正确')`, 'price error')
      assert((await item(page, id)).purchasePriceCents === 12345)
      assert(await page.ev(`location.pathname.endsWith('/edit') && document.querySelector(${JSON.stringify(amount)}).value === ${JSON.stringify(raw)}`))
    }
    await page.fill(amount, '0.50')
    await page.ev(`document.querySelectorAll(${JSON.stringify(amount)})[1].setAttribute('data-test-extra', '')`)
    await page.fill('[data-test-extra]', '12.')
    await page.click('保存', 'header button')
    await page.wait(`document.body.innerText.includes('附加花费格式不正确')`, 'extra error')
    assert((await item(page, id)).purchasePriceCents === 12345)
    await page.fill('[data-test-extra]', '0')
    await page.click('保存', 'header button')
    await page.wait(`!location.pathname.endsWith('/edit')`, 'valid save')
    const saved = await item(page, id)
    assert.equal(saved.purchasePriceCents, 50); assert.equal(saved.additionalCostCents, 0)
    return { invalidPriceBlocked:3, invalidExtraBlocked:true, savedPriceCents:50, savedExtraCents:0 }
  })
  await test('conversion validates both prices and accepts zero', async page => {
    await page.nav('/settings'); const id = await seed(page)
    await page.ev(`import('/src/db/db.ts').then(({db}) => db.items.update(${JSON.stringify(id)}, {status:'wishlist', purchasePriceCents:null, purchaseDate:null}))`)
    await page.nav('/items/' + id)
    await page.click('转为持有')
    await page.fill(amount, '.5')
    await page.click('确认购入')
    await page.wait(`document.body.innerText.includes('购买价格格式不正确')`, 'conversion price error')
    assert.equal((await item(page, id)).status, 'wishlist')
    await page.fill(amount, '0')
    await page.ev(`document.querySelectorAll(${JSON.stringify(amount)})[1].setAttribute('data-test-extra', '')`)
    await page.fill('[data-test-extra]', '12.')
    await page.click('确认购入')
    await page.wait(`document.body.innerText.includes('附加花费格式不正确')`, 'conversion extra error')
    assert.equal((await item(page, id)).status, 'wishlist')
    await page.fill('[data-test-extra]', '')
    await page.click('确认购入')
    await page.wait(`!document.querySelector('[role="dialog"][aria-label="转为持有"]')`, 'conversion closes')
    const saved = await item(page, id)
    assert.equal(saved.status, 'owned'); assert.equal(saved.purchasePriceCents, 0); assert.equal(saved.additionalCostCents, null)
    return { invalidPriceBlocked:true, invalidExtraBlocked:true, zeroSaved:true, optionalExtraRemainsNull:true }
  })
  await test('sale validates amount and discarded ignores unused sale input', async page => {
    await page.nav('/settings'); const id = await seed(page)
    await page.nav('/items/' + id); await page.click('处置物品')
    await page.fill(amount, '12.'); await page.click('确认处置')
    await page.wait(`document.body.innerText.includes('出售金额格式不正确')`, 'sale error')
    assert.equal((await item(page, id)).status, 'owned')
    await page.fill(amount, '0.50'); await page.click('确认处置')
    await page.wait(`document.body.innerText.includes('恢复为持有')`, 'sold')
    assert.equal((await item(page, id)).salePriceCents, 50)
    const otherId = await seed(page)
    await page.nav('/items/' + otherId); await page.click('处置物品')
    await page.fill(amount, '.5'); await page.click('丢弃'); await page.click('确认处置')
    await page.wait(`document.body.innerText.includes('恢复为持有')`, 'discarded')
    const saved = await item(page, otherId)
    assert.equal(saved.disposalMethod, 'discarded'); assert.equal(saved.salePriceCents, null)
    return { invalidSaleBlocked:true, validSaleCents:50, discardedIgnoresSale:true }
  })
  await test('sync session UI reacts to disable and backup restore without reload', async page => {
    await page.nav('/settings'); const id = await seed(page)
    const queued = await page.ev(`import('/src/db/db.ts').then(({db}) => db.syncQueue.count())`)
    await enable(page)
    await page.wait(`[...document.querySelectorAll('button')].some(el => el.textContent.includes('关闭同步'))`, 'enabled settings without reload')
    await page.click('关闭同步')
    await page.wait(`!!document.querySelector('input[placeholder="粘贴恢复码"]') && !document.body.innerText.includes('关闭同步')`, 'disabled settings without reload')
    assert.deepEqual(await state(page), {enabled:false, credentialsCleared:true})
    assert.equal(await page.ev(`import('/src/db/db.ts').then(({db}) => db.syncQueue.count())`), queued)
    await enable(page)
    await page.wait(`document.body.innerText.includes('关闭同步')`, 'reenabled settings')
    await page.ev(`(async () => {
      const {exportBackup} = await import('/src/services/backupService.ts');
      const {blob,fileName} = await exportBackup();
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], fileName, {type:'application/zip'}));
      const input = document.querySelector('input[type="file"]'); input.files = transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`)
    await page.wait(`document.body.innerText.includes('恢复后将替换当前数据')`, 'restore confirmation')
    await page.click('恢复', 'dialog button')
    await page.wait(`document.body.innerText.includes('已从备份恢复全部数据')`, 'restore success')
    await page.wait(`!!document.querySelector('input[placeholder="粘贴恢复码"]') && !document.body.innerText.includes('关闭同步')`, 'restored disabled UI')
    assert.deepEqual(await state(page), {enabled:false, credentialsCleared:true})
    assert.equal((await item(page, id)).name, '审计夹具')
    await page.shot('02-disabled-sync')
    return { immediateDisableUi:true, credentialsCleared:true, disableKeepsOutbox:true, backupRestoreUi:true, restoredItemPreserved:true }
  })
  for (const panel of [false, true]) await test(`unsaved history and in-app navigation are guarded (${panel ? 'panel' : 'page'})`, async page => {
    await page.nav('/settings'); const id = await seed(page)
    if (panel) {
      await page.nav('/items')
      assert(await page.ev(`(() => { const a = document.querySelector('a[href="/items/${id}"]'); if (!a) return false; a.click(); return true; })()`))
      await page.wait(`!!document.querySelector('dialog[aria-label="物品详情"]')`, 'detail panel')
    }
    else await page.nav('/items/' + id)
    await page.wait(`[...document.querySelectorAll('a')].some(a => a.textContent.trim() === '编辑')`, 'edit action')
    await page.click('编辑', 'a')
    await page.wait(`!!document.querySelector(${JSON.stringify(field)})`, 'edit route')
    await page.fill(field, '尚未保存的草稿')
    for (const back of ['history.back()', `document.querySelector('header button[aria-label="返回"]').click()`]) {
      await page.ev(back)
      await page.wait(`document.body.innerText.includes('放弃此次修改')`, 'back confirmation')
      await page.click('继续编辑')
      assert(await page.ev(`location.pathname.endsWith('/edit') && document.querySelector(${JSON.stringify(field)}).value === '尚未保存的草稿'`))
    }
    await page.ev('history.back()')
    await page.wait(`document.body.innerText.includes('放弃此次修改')`, 'discard confirmation')
    await page.shot('03-unsaved-' + (panel ? 'panel' : 'page'))
    await page.click('放弃修改')
    await page.wait(`!location.pathname.endsWith('/edit')`, 'discard returns')
    assert.equal((await item(page, id)).name, '审计夹具')
    await page.ev('history.forward()')
    await page.wait(`document.querySelector(${JSON.stringify(field)})?.value === '审计夹具'`, 'forward after explicit discard')
    await page.fill(field, '确认保存的物品')
    await page.click('保存', 'header button')
    await page.wait(`!location.pathname.endsWith('/edit')`, 'save bypasses blocker')
    assert.equal((await item(page, id)).name, '确认保存的物品')
    return { nativeBackGuard:true, inAppBackGuard:true, continuePreservesDraft:true, explicitDiscard:true, forwardStartsClean:true, saveCompletes:true }
  })
  await test('invalid amount alone is dirty and direct new form has a safe return', async page => {
    await page.nav('/items/new')
    await page.fill(amount, '.5')
    await page.ev(`document.querySelector('header button[aria-label="返回"]').click()`)
    await page.wait(`document.body.innerText.includes('放弃此次修改')`, 'invalid amount dirty')
    await page.click('继续编辑')
    assert.equal(await page.ev(`document.querySelector(${JSON.stringify(amount)}).value`), '.5')
    await page.ev(`document.querySelector('header button[aria-label="返回"]').click()`)
    await page.wait(`document.body.innerText.includes('放弃此次修改')`, 'discard new confirmation')
    await page.click('放弃修改')
    await page.wait(`location.pathname === '/items'`, 'direct new fallback')
    return { invalidAmountCountsAsDraft:true, continuePreservesAmount:true, directNewReturnsToList:true }
  })
  await test('whole-document reload and back ask before losing a draft', async page => {
    await page.nav('/settings'); await page.nav('/items/new')
    await page.fill(field, '整页离开前的草稿')
    page.acceptDialog = false
    await page.send('Page.reload')
    for (let i = 0; i < 80 && page.dialogs.length < 1; i++) await pause(50)
    await page.wait(`document.querySelector(${JSON.stringify(field)})?.value === '整页离开前的草稿'`, 'reload cancelled')
    assert.deepEqual(page.dialogs, ['beforeunload'])
    await page.ev('history.back()')
    for (let i = 0; i < 80 && page.dialogs.length < 2; i++) await pause(50)
    assert.deepEqual(page.dialogs, ['beforeunload', 'beforeunload'])
    assert.equal(await page.ev(`document.querySelector(${JSON.stringify(field)})?.value`), '整页离开前的草稿')
    page.acceptDialog = true
    await page.send('Page.reload')
    await page.wait(`document.querySelector(${JSON.stringify(field)})?.value === ''`, 'explicit reload accepted')
    assert.equal(page.dialogs.length, 3)
    return { cancelledReloadKeepsDraft:true, cancelledDocumentBackKeepsDraft:true, explicitLeaveAllowed:true }
  })
  assert.equal(exceptions.length, 0)
  await writeFile(OUT + '/results.json', JSON.stringify({observedAt:new Date().toISOString(), observations, exceptions, interceptedApiPaths: requests, realModelCalls:0, productionDataAccess:false}, null, 2))
} finally { browser.ws.close() }
