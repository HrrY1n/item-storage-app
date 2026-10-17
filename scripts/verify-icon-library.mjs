/** Production preview on :4173; launch/stop Edge with the project-local :9222 launcher. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const BASE = 'http://127.0.0.1:4173'
const CDP = 'http://127.0.0.1:9222'
const OUT = 'docs/screenshots/icon-library-v2'
const { icons } = JSON.parse(await readFile('assets/item-icons/prompts.json', 'utf8'))
const expectedBundle = (await readFile('dist/index.html', 'utf8')).match(/src="([^" ]+\/index-[^" ]+\.js)"/)[1]
const precacheUrls = [...(await readFile('dist/sw.js', 'utf8')).matchAll(/\{url:"([^"]+)",revision:/g)].map(match => match[1])
assert.equal(new Set(precacheUrls).size, precacheUrls.length, 'Precache URLs must be unique')
assert.ok(icons.every(icon => precacheUrls.includes(`icons/items/${icon.key}.webp`)), 'Every registered WebP must be precached')
const digitalCount = icons.filter(i=>i.category === 'digital').length
const categoryLabels = { digital: '数码', office: '办公', apparel: '服饰', life: '生活', care: '护理', kitchen: '厨房', home: '家居', hobby: '兴趣', other: '其他' }
const results = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result))
  ws.send(JSON.stringify({ id, method, params }))
})
const ev = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result?.value
}
const check = (name, ok) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  assert.ok(ok, name)
}
const poll = async (expression) => {
  for (let i = 0; i < 100; i++) { if (await ev(expression)) return; await sleep(100) }
  throw new Error(`Timed out: ${expression}`)
}
const click = (selector) => ev(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw Error('Missing control'); e.click() })()`)
const textButton = (text) => ev(`(() => { const e=[...document.querySelectorAll('button')].find(e=>e.textContent.includes(${JSON.stringify(text)})); if(!e)throw Error('Missing button'); e.focus(); e.click() })()`)
const navigate = async (path) => {
  await send('Page.navigate', { url: BASE + path })
  await poll(`!!document.querySelector('main') && location.pathname === ${JSON.stringify(path)}`)
  await sleep(350)
}
const openPicker = async () => {
  await textButton('点击本行更换图标')
  await poll(`!!document.querySelector('[role="dialog"] [data-icon-browser]')`)
  await sleep(250)
}
const query = async (text) => {
  await ev(`(() => { const e=document.querySelector('input[aria-label="搜索全部图标"]'); e.focus(); e.select() })()`)
  await send('Input.insertText', { text })
  await sleep(150)
}
const shot = async (name) => {
  await ev(`Promise.all([...document.images].filter(i=>i.getBoundingClientRect().top<innerHeight).map(i=>i.decode().catch(()=>{})))`)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
}
const itemCount = () => ev(`new Promise((resolve,reject)=>{ const r=indexedDB.open('PrivateItemLibraryDB'); r.onsuccess=()=>{const db=r.result;const q=db.transaction('items').objectStore('items').count();q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error) })`)

try {
  await mkdir(OUT, { recursive: true })
  await send('Page.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  // Reused test profiles can have an older SW; establish the preview build outside the guarded form.
  await navigate('/settings')
  await textButton('检查更新')
  await sleep(1500)
  await navigate('/settings')
  await poll(`!!document.querySelector('script[src=${JSON.stringify(expectedBundle)}]')`)
  await ev(`localStorage.setItem('pil.theme','light')`)
  await navigate('/items/new')
  const beforeCount = await itemCount()
  await openPicker()
  check('打开弹层不聚焦搜索输入框', await ev(`document.activeElement?.getAttribute('aria-label') === '关闭'`))
  const counts = await ev(`[...document.querySelectorAll('[aria-label="图标分类"] button')].map(e=>e.getAttribute('aria-label'))`)
  check('九类卡片数量来自真实资源元数据', counts.length === 9 && Object.entries(categoryLabels).every(([key, label]) =>
    counts.includes(`${label}，${icons.filter(icon => icon.category === key).length} 个图标`),
  ))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 })
  check('反向 Tab 保持焦点在弹层内', await ev(`document.activeElement===[...document.querySelectorAll('[role="dialog"] button, [role="dialog"] input')].at(-1)`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  check('正向 Tab 回到关闭按钮', await ev(`document.activeElement?.getAttribute('aria-label')==='关闭'`))
  check('分类主页为三列', await ev(`getComputedStyle(document.querySelector('[aria-label="图标分类"]')).gridTemplateColumns.split(' ').length === 3`))
  await shot('01-home-light')
  await click('button[aria-label^="数码，"]')
  check('分类详情显示名称及动态数量', await ev(`document.querySelector('[data-icon-browser] h3')?.textContent === '数码' && document.querySelector('[data-icon-browser]').textContent.includes('${digitalCount} 个图标')`))
  check('移动分类图标为四列且有中文名称', await ev(`getComputedStyle(document.querySelector('[data-icon-scroll] .grid')).gridTemplateColumns.split(' ').length===4 && [...document.querySelectorAll('[data-icon-scroll] img')].every(i=>i.alt)`))
  await shot('02-digital-light')
  check('六种已移除附件不再作为独立图标', await ev(`![...document.querySelectorAll('[data-icon-scroll] img')].some(image => ['screenprotector', 'battery', 'hdddock', 'cableorganizer', 'powerstrip', 'wristrest'].some(key => image.getAttribute('src').endsWith('/'+key+'.webp')))`))
  const micHash = await ev(`(async()=>{const bytes=await(await fetch('/icons/items/microphone.webp')).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('')})()`)
  check('麦克风实际响应与新 Mic Mini 图像校验值一致', micHash === icons.find(icon=>icon.key === 'microphone').outputSha256)
  await ev(`document.querySelector('[data-icon-scroll]').scrollTop=480`)
  await sleep(150)
  const categoryScroll = await ev(`document.querySelector('[data-icon-scroll]').scrollTop`)
  await query('e')
  await ev(`document.querySelector('[data-icon-scroll]').scrollTop=480`)
  await sleep(150)
  assert.ok(await ev(`document.querySelector('[data-icon-scroll]').scrollTop>0`), 'Broad search must have scrollable results')
  await query('a')
  check('连续更换搜索词后结果回到顶部', await ev(`document.querySelector('[data-icon-scroll]').scrollTop===0`))
  await ev(`document.querySelector('[data-icon-scroll]').scrollTop=480`)
  await sleep(150)
  assert.ok(await ev(`document.querySelector('[data-icon-scroll]').scrollTop>0`), 'Second broad search must have scrollable results')
  await click('button[aria-label="清空搜索"]')
  await sleep(150)
  check('清空已滚动的搜索结果仍恢复分类位置', await ev(`Math.abs(document.querySelector('[data-icon-scroll]').scrollTop-${categoryScroll})<2`))
  await query('e')
  check('清空后重新搜索不会恢复旧结果滚动位置', await ev(`document.querySelector('[data-icon-scroll]').scrollTop===0`))
  await click('button[aria-label="清空搜索"]')
  await query('iPad')
  check('搜索隐藏分类并显示全局匹配数', await ev(`!document.querySelector('button[aria-label="返回图标分类"]') && !!document.querySelector('[role="status"]') && !!document.querySelector('img[alt="平板电脑"]')`))
  await shot('03-search-light')
  await click('button[aria-label="清空搜索"]')
  await sleep(150)
  check('清空搜索恢复原分类及滚动位置', await ev(`document.querySelector('[data-icon-browser] h3')?.textContent==='数码' && Math.abs(document.querySelector('[data-icon-scroll]').scrollTop-${categoryScroll})<2`))
  await click('button[aria-label="返回图标分类"]')
  await click('button[aria-label^="办公，"]')
  await query('laptop')
  check('分类详情搜索范围包含其他分类', await ev(`!!document.querySelector('img[alt="笔记本电脑"]')`))
  await ev(`document.querySelector('img[alt="笔记本电脑"]').closest('button').click()`)
  await poll(`!document.querySelector('[role="dialog"]')`)
  check('单击选择关闭弹层并更新表单预览', await ev(`!!document.querySelector('button img[src="/icons/items/laptop.webp"]')`))
  check('选择图标不会直接保存物品', await itemCount() === beforeCount)
  check('最近使用前置且不重复', await ev(`(() => {const r=JSON.parse(localStorage.getItem('pil.recentIcons'));return r[0]==='preset-laptop' && r.filter(id=>id==='preset-laptop').length===1 && r.length<=8})()`))
  await openPicker()
  check('最近使用展示选中状态', await ev(`!!document.querySelector('[aria-label="最近使用"] button[aria-pressed="true"] img[alt="笔记本电脑"]')`))
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 568, deviceScaleFactor: 2, mobile: true })
  await ev(`document.querySelector('[data-icon-scroll]').scrollTop=80`)
  await sleep(150)
  const homeScroll = await ev(`document.querySelector('[data-icon-scroll]').scrollTop`)
  await click('button[aria-label^="家居，"]')
  check('家居详情与分类主页使用独立滚动位置', homeScroll > 0 && await ev(`document.querySelector('[data-icon-scroll]').scrollTop===0`))
  await ev(`document.querySelector('[data-icon-scroll]').scrollTop=120`)
  await sleep(150)
  await click('button[aria-label="返回图标分类"]')
  await sleep(150)
  check('返回分类主页恢复滚动位置', await ev(`Math.abs(document.querySelector('[data-icon-scroll]').scrollTop-${homeScroll})<2`))
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await click('button[aria-label^="数码，"]')
  check('分类详情展示选中状态', await ev(`!!document.querySelector('button[aria-pressed="true"] img[alt="笔记本电脑"]')`))
  await shot('04-selected-light')
  await query('Mic Mini')
  await ev(`document.querySelector('img[alt="麦克风"]').closest('button').click()`)
  await poll(`!document.querySelector('[role="dialog"]')`)
  check('新麦克风单击后预览更新且仍未保存物品', await itemCount() === beforeCount && await ev(`!!document.querySelector('button img[src="/icons/items/microphone.webp"]')`))
  await openPicker()
  await query('领夹麦')
  check('新麦克风按别名搜索仍显示选中状态', await ev(`!!document.querySelector('button[aria-pressed="true"] img[alt="麦克风"]')`))
  await shot('10-new-icon-selected-light')
  await query('zzzz-not-an-icon')
  check('无匹配有简洁空状态和零匹配数', await ev(`document.querySelector('[data-icon-browser]').textContent.includes('没有找到') && document.querySelector('[role="status"]').textContent.includes('0')`))
  await shot('05-empty-light')
  await click('button[aria-label="关闭"]')
  check('关闭后焦点回到原图标按钮', await ev(`document.activeElement?.tagName==='BUTTON' && document.activeElement.textContent.includes('点击本行更换图标')`))
  await ev(`localStorage.setItem('pil.theme','dark')`)
  await navigate('/items/new')
  await openPicker()
  check('深色主题沿用现有 Token', await ev(`document.documentElement.dataset.theme==='dark'`))
  await shot('06-home-dark')
  await click('button[aria-label^="护理，"]')
  await shot('07-care-dark')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  check('Escape 关闭弹层', await ev(`!document.querySelector('[role="dialog"]')`))
  await navigate('/settings/icons')
  check('设置图标库复用九类浏览', await ev(`document.querySelectorAll('[aria-label="图标分类"] button').length===9`))
  await shot('08-library-dark')
  await query('DJI Mic Mini')
  check('设置页复用关键词搜索', await ev(`!!document.querySelector('img[alt="麦克风"]')`))
  await poll(`!!navigator.serviceWorker.controller`)
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  const assetErrors = await ev(`(async()=>{const errors=[];for(const key of ${JSON.stringify(icons.map((icon) => icon.key))}){try{const i=new Image();i.src='/icons/items/'+key+'.webp';await i.decode();if(i.naturalWidth!==768||i.naturalHeight!==768)errors.push(key+':size');const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.drawImage(i,0,0,1,1,0,0,1,1);if(x.getImageData(0,0,1,1).data[3]!==0)errors.push(key+':alpha')}catch{errors.push(key+':decode')}}return errors})()`)
  check('全部现有 WebP 离线可解码、768×768 且透明角落', assetErrors.length === 0)
  await send('Page.reload')
  await poll(`!!document.querySelector('[data-icon-browser]')`)
  check('图标库离线刷新可用', await ev(`document.querySelectorAll('[aria-label="图标分类"] button').length===9`))
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await navigate('/settings/icons')
  check('桌面无横向溢出', await ev(`document.documentElement.scrollWidth<=innerWidth`))
  await shot('09-desktop-dark')
} catch (error) {
  console.error(error)
  process.exitCode = 1
  await shot('failure').catch(() => {})
} finally {
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {})
  await writeFile(`${OUT}/results.json`, JSON.stringify(results, null, 2) + '\n')
  const closed = new Promise((resolve) => ws.addEventListener('close', resolve, { once: true }))
  ws.close()
  await closed
  await fetch(`${CDP}/json/close/${target.id}`).catch(() => {})
}
