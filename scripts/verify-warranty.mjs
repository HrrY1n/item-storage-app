/** Production :4173 + project-local Edge launcher; leaves test rows and IndexedDB intact. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { selectDate, setDateDraft } from './date-picker.mjs'

const BASE = 'http://127.0.0.1:4173'
const CDP = `http://127.0.0.1:${process.env.EDGE_TEST_PORT ?? '9222'}`
const OUT = '.tmp/browser-verification/warranty'
const expectedBundle = (await readFile('dist/index.html', 'utf8')).match(/src="([^" ]+\/index-[^" ]+\.js)"/)[1]
const results = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
let sequence = 0
const pending = new Map()
ws.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  pending.set(id, message => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result))
  ws.send(JSON.stringify({ id, method, params }))
})
const ev = async expression => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
  return response.result?.value
}
const session = { ev }
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); assert.ok(ok, name) }
const poll = async expression => {
  for (let i = 0; i < 150; i++) { if (await ev(expression)) return; await sleep(100) }
  throw new Error(`Timed out: ${expression}`)
}
const navigate = async path => {
  await send('Page.navigate', { url: BASE + path })
  await poll(`!!document.querySelector('main') && location.pathname === ${JSON.stringify(path)}`)
  await sleep(250)
}
const button = (text, scope = 'document') => ev(`(() => {
  const buttons = [...${scope}.querySelectorAll('button')];
  const target = ${JSON.stringify(text.replace(/\s+/g, ''))};
  const b = buttons.find(b => b.textContent.trim().replaceAll(' ', '') === target)
    ?? buttons.find(b => b.textContent.trim().replaceAll(' ', '').startsWith(target));
  if (!b) throw Error('Missing button: ' + ${JSON.stringify(text)});
  b.click();
})()`)
const pickerButton = async text => {
  await button(text, `document.querySelector('[data-date-picker]')`)
  await poll(`!document.querySelector('[data-date-picker]')`)
}
const dateValue = label => ev(`document.querySelector('[data-date-field=${JSON.stringify(label)}]').dataset.dateValue`)
const selected = months => ev(`!![...document.querySelectorAll('[aria-label="保修月数"] button[aria-pressed="true"]')].find(b=>b.textContent.trim().replaceAll(' ','')===${JSON.stringify(`${months}个月`)})`)
const setInput = (selector, value) => ev(`(() => {
  const e = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)});
  e.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
const records = () => ev(`new Promise((resolve,reject)=>{
  const r=indexedDB.open('PrivateItemLibraryDB');r.onerror=()=>reject(r.error);r.onsuccess=()=>{
    const d=r.result,q=d.transaction('items').objectStore('items').getAll();
    q.onsuccess=()=>{resolve(q.result);d.close()};q.onerror=()=>reject(q.error);
  }
})`)
const record = async id => (await records()).find(item => item.id === id)
const shot = async name => {
  await sleep(250)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
}
const scrollToWarranty = async () => {
  await ev(`document.querySelector('[data-warranty-toggle][aria-expanded="false"]')?.click()`)
  await sleep(260)
  await ev(`document.querySelector('[data-warranty-input]').scrollIntoView({ block: 'center' })`)
}
const save = async () => {
  await button('保存', `document.querySelector('header')`)
  await poll(`location.pathname.startsWith('/items/') && location.pathname.split('/').length===3 && !location.pathname.endsWith('/new')`)
  return ev(`location.pathname.split('/').pop()`)
}
const nameSelector = 'input[placeholder="比如：AirPods Pro"]'
const runName = `保修验收-${Date.now()}`

try {
  await mkdir(OUT, { recursive: true })
  await send('Page.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await navigate('/settings')
  await button('检查更新')
  await poll(`!!document.querySelector('script[src=${JSON.stringify(expectedBundle)}]')`)
  await ev(`localStorage.setItem('pil.theme','light')`)
  await navigate('/items/new')
  const countBefore = (await records()).length
  check('新增默认选择 12 个月，未填购买日时不虚构到期日', await selected(12) && await dateValue('保修到期日') === '')
  check('目标表单不再使用原生 date 输入框', await ev(`document.querySelectorAll('input[type="date"]').length === 0`))
  await scrollToWarranty()
  await selectDate(session, '购买日期', '2024-01-31')
  check('确认购买日后默认自动计算一年', await dateValue('保修到期日') === '2025-01-31')
  await button('3个月')
  check('3 个月按自然月计算并夹紧月末', await dateValue('保修到期日') === '2024-04-30')
  await button('6个月')
  check('6 个月计算正确', await dateValue('保修到期日') === '2024-07-31')
  await button('24个月')
  check('24 个月计算正确', await dateValue('保修到期日') === '2026-01-31')
  await button('自定义')
  await setInput('input[inputmode="numeric"]', '1')
  check('自定义整月支持闰年二月末', await dateValue('保修到期日') === '2024-02-29')

  await ev(`document.querySelector('[data-date-field="购买日期"]').click()`)
  check('打开日期弹层聚焦取消按钮，不主动弹键盘', await ev(`document.activeElement?.textContent === '取消'`))
  await setDateDraft(session, '2025-02-14')
  check('调整完整年月日后弹层仍打开，表单值与到期日均未提交', await ev(`!!document.querySelector('[data-date-picker]')`) && await dateValue('购买日期') === '2024-01-31' && await dateValue('保修到期日') === '2024-02-29')
  await shot('02-date-confirm-light')
  await pickerButton('取消')
  check('取消日期修改保留原值并恢复触发按钮焦点', await dateValue('购买日期') === '2024-01-31' && await ev(`document.activeElement?.dataset.dateField === '购买日期'`))
  await selectDate(session, '购买日期', '2024-02-29')
  check('点确定才联动重算保修到期日', await dateValue('保修到期日') === '2024-03-29')
  await ev(`document.querySelector('[data-date-field="保修到期日"]').click()`)
  await setDateDraft(session, '2024-01-29')
  check('早于购买日时不能确认到期日', await ev(`[...document.querySelectorAll('[data-date-picker] button')].find(b=>b.textContent==='确定').disabled && !!document.querySelector('[data-date-picker] [role="alert"]')`))
  await pickerButton('取消')
  check('所有选择只改待保存表单，不直接新增物品', (await records()).length === countBefore)

  await button('6个月')
  await setInput(nameSelector, runName)
  await button('生活与护理')
  await button('随身日用')
  await scrollToWarranty()
  await shot('01-months-light')
  const id = await save()
  check('保存后仍用现有 ISO 到期日字段，数据中不增加月数字段', (await record(id)).warrantyExpiresAt === '2024-08-29' && !Object.hasOwn(await record(id), 'warrantyMonths'))
  await navigate(`/items/${id}/edit`)
  check('编辑回显原来 6 个月的保修', await selected(6))
  await selectDate(session, '购买日期', '2024-03-31')
  check('修改购买日后按所选月数重算', await dateValue('保修到期日') === '2024-09-30')
  await save()
  check('修改保存到同一物品，不新增重复记录', (await records()).length === countBefore + 1 && (await record(id)).warrantyExpiresAt === '2024-09-30')

  await navigate(`/items/${id}/edit`)
  await selectDate(session, '保修到期日', '2027-02-03')
  await save()
  await navigate(`/items/${id}/edit`)
  check('历史不规则到期日按原值显示，不套用默认一年', await dateValue('保修到期日') === '2027-02-03' && await ev(`document.querySelector('[data-warranty-input]').textContent.includes('手动指定日期')`))
  await setInput(nameSelector, runName + '-保留旧日期')
  await save()
  check('只编辑名称不会改动历史到期日', (await record(id)).warrantyExpiresAt === '2027-02-03')
  await navigate(`/items/${id}/edit`)
  await button('不适用')
  await save()
  await navigate(`/items/${id}/edit`)
  check('历史未填写的到期日保持为空', await dateValue('保修到期日') === '' && await ev(`!![...document.querySelectorAll('[data-warranty-input] button[aria-pressed="true"]')].find(b=>b.textContent==='不适用')`))
  await scrollToWarranty()
  await button('自定义')
  await setInput('input[inputmode="numeric"]', '0')
  await button('保存', `document.querySelector('header')`)
  check('非法月数保存被阻止，原记录不变', await ev(`location.pathname.endsWith('/edit') && document.body.innerText.includes('保修月数请输入')`) && (await record(id)).warrantyExpiresAt === null)
  await setInput('input[inputmode="numeric"]', '18')
  await button('取消编辑')
  check('仅修改保修设置也有未保存提示', await ev(`document.body.innerText.includes('放弃此次修改？')`))
  await button('放弃修改')

  await navigate('/items/new')
  await button('心愿')
  await setInput(nameSelector, runName + '-心愿')
  await button('生活与护理')
  await button('随身日用')
  const wishlistId = await save()
  await button('转为持有')
  await poll(`!!document.querySelector('[aria-label="转为持有"]')`)
  check('心愿转持有也默认 12 个月并显示计算结果', await selected(12) && await dateValue('保修到期日') !== '')
  await ev(`document.querySelector('[data-date-field="购买日期"]').click()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await poll(`!document.querySelector('[data-date-picker]')`)
  check('关闭嵌套日期弹层不会同时取消转为持有', await ev(`!document.querySelector('[data-date-picker]') && !!document.querySelector('[aria-label="转为持有"]')`))
  await selectDate(session, '购买日期', '2024-01-31')
  await button('3个月')
  await shot('04-convert-light')
  await button('确认购入')
  await poll(`!document.querySelector('[aria-label="转为持有"]')`)
  check('确认购入按整月保存到同一物品', (await record(wishlistId)).status === 'owned' && (await record(wishlistId)).warrantyExpiresAt === '2024-04-30')

  await ev(`localStorage.setItem('pil.theme','dark')`)
  await navigate(`/items/${wishlistId}/edit`)
  await scrollToWarranty()
  check('深色主题和移动布局无横向溢出', await ev(`document.documentElement.dataset.theme==='dark' && document.documentElement.scrollWidth<=innerWidth`))
  await shot('03-months-dark')
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 568, deviceScaleFactor: 2, mobile: true })
  await ev(`document.querySelector('[data-date-field="购买日期"]').click()`)
  await ev(`Promise.all(document.querySelector('[data-date-picker]').closest('.modal-sheet-panel').getAnimations().map(animation=>animation.finished))`)
  check('短屏日期弹层的确定按钮可见且无溢出', await ev(`(() => { const b=[...document.querySelectorAll('[data-date-picker] button')].find(b=>b.textContent==='确定');const r=b.getBoundingClientRect();return r.bottom<=innerHeight && r.top>=0 && document.documentElement.scrollWidth<=innerWidth })()`))
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await ev(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  check('桌面日期弹层居中且不溢出', await ev(`(() => {const r=document.querySelector('[data-date-picker] h2').parentElement.getBoundingClientRect();return Math.abs(r.left-(innerWidth-r.width)/2)<2 && r.bottom<=innerHeight})()`))
  await pickerButton('取消')
  await poll(`!!navigator.serviceWorker.controller`)
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await navigate(`/items/${wishlistId}/edit`)
  await button('12个月')
  await save()
  await send('Page.reload')
  await poll(`document.body.innerText.includes('保修追踪')`)
  check('离线选择、保存和刷新后保修日期仍保留', (await record(wishlistId)).warrantyExpiresAt === '2025-01-31')
} catch (error) {
  console.error(error)
  process.exitCode = 1
  await shot('failure').catch(() => {})
} finally {
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {})
  await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2) + '\n')
  const closed = new Promise(resolve => ws.addEventListener('close', resolve, { once: true }))
  ws.close()
  await closed
  await fetch(`${CDP}/json/close/${target.id}`).catch(() => {})
}
