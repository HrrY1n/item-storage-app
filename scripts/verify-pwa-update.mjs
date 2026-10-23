/**
 * PWA 更新端到端回归（生产构建，同源替换图片内容）
 *
 * 关键设计：切换服务端内容后**绝不做整页导航** —— 否则浏览器会直接拉到新 HTML，
 * 绕过 Service Worker，测的就不是 SW 更新了。改由「已加载 bundle 的 hash」判定
 * 当前页面跑的是哪一套构建（无需为测试给应用加任何钩子）。
 *
 * 验证项：启动检查 / 节流 / 前台恢复自动升级 / IndexedDB 数据保留 /
 * 表单编辑绝不 reload / 离开编辑态自动应用 / 设置页手动检查（最新 + 离线）。
 *
 * 用法（只连接项目启动器创建的隔离 Edge Profile）：
 *   npm run browser:start -- --port=9223
 *   npm run verify:pwa-update
 *   npm run browser:stop -- --port=9223
 *   npm run build  # 恢复正式版本 dist；源码和原图已在 finally 中恢复
 */

import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, extname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const ROOT = resolve('.')
const SWAP = resolve('.tmp/icon-v2-pwa-swap-' + Date.now())
const PORT = 4190
const BASE = `http://127.0.0.1:${PORT}`
const CDP = 'http://127.0.0.1:9223'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const activeDir = async () => join(SWAP, (await readFile(join(SWAP, 'active'), 'utf8')).trim())
const setActive = (v) => writeFile(join(SWAP, 'active'), v)

/** 静态服务 + SPA fallback；sw.js 不缓存（对齐 Cloudflare 的 must-revalidate） */
let failSwCheck = false
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE)
    if (failSwCheck && url.pathname === '/sw.js') {
      res.writeHead(503, { 'Cache-Control': 'no-store' }).end('test update check failure')
      return
    }
    const dir = await activeDir()
    let filePath = join(dir, decodeURIComponent(url.pathname))
    if (!existsSync(filePath) || url.pathname === '/' || !extname(url.pathname)) {
      filePath = join(dir, 'index.html')
    }
    const body = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': url.pathname === '/sw.js' ? 'no-store' : 'public, max-age=0, must-revalidate',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) => {
  const i = ++id
  return new Promise((res) => {
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  }).then((m) => {
    if (m.error) throw new Error(method + ': ' + JSON.stringify(m.error))
    return m.result
  })
}
const ev = (expr) =>
  send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(
    (r) => r?.result?.value,
  )
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__pwaFrames = [];
  let until = 0;
  let frameId = 0;
  function sample() {
    const c = document.getElementById('pwa-update-cover');
    const phase = c && !c.hidden ? c.dataset.phase : 'none';
    const last = window.__pwaFrames.at(-1);
    if (!last || last.phase !== phase) window.__pwaFrames.push({phase, at:performance.now(), empty:!document.getElementById('root')?.childElementCount, background:c?getComputedStyle(c).backgroundColor:null, animation:c?getComputedStyle(c.querySelector('span')).animationName:null});
    if (performance.now() < until) frameId = requestAnimationFrame(sample);
  }
  window.__startPwaFrames = () => { cancelAnimationFrame(frameId); window.__pwaFrames=[]; until=performance.now()+30000; frameId=requestAnimationFrame(sample); };
  window.__startPwaFrames();
  addEventListener('beforeunload', () => sessionStorage.setItem('pwa.test.previous-frames', JSON.stringify({leftAt:performance.now(),frames:window.__pwaFrames})));
` })
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
})

/** 当前页面实际加载的 main bundle（hash 随构建内容变化 → 判定"跑的是哪一套"） */
const bundle = () =>
  ev(`(() => {
    const e = performance.getEntriesByType('resource').map(r => r.name).filter(n => n.includes('/assets/index-') && n.endsWith('.js'))
    return e.length ? e[0].split('/').pop() : null
  })()`)

const versionShown = () =>
  ev(`(() => {
    const el = [...document.querySelectorAll('span,p,div')].find(e => /v0\\.\\d+\\.\\d+/.test(e.textContent))
    return el ? el.textContent.match(/v0\\.\\d+\\.\\d+/)[0] : null
  })()`)

const swState = () =>
  ev(`(async () => {
    if (!navigator.serviceWorker) return null
    const r = await navigator.serviceWorker.getRegistration()
    return r ? {
      installing: !!r.installing, waiting: !!r.waiting, active: !!r.active,
      controller: !!navigator.serviceWorker.controller, script: r.active && r.active.scriptURL,
    } : null
  })()`)

async function pollGlobal(varName, timeoutMs = 6000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const v = await ev(`window.${varName} === undefined ? null : window.${varName}`)
    if (v !== null) return v
    await sleep(300)
  }
  return null
}

/** 读 IndexedDB：结果写进全局变量再轮询（CDP 的 awaitPromise 对 IDB 回调解析不稳定） */
async function readDb() {
  await ev(`(() => {
    window.__dbProbe = null
    const req = indexedDB.open('PrivateItemLibraryDB')
    req.onsuccess = () => {
      const db = req.result
      const names = ['items', 'categories', 'tags', 'assets', 'syncQueue']
      const tx = db.transaction(names, 'readonly')
      const out = {}
      let left = names.length
      for (const n of names) {
        const r = tx.objectStore(n).getAll()
        r.onsuccess = () => { out[n] = r.result || []; if (--left === 0) window.__dbProbe = JSON.stringify(out) }
        r.onerror = () => { out[n] = []; if (--left === 0) window.__dbProbe = JSON.stringify(out) }
      }
    }
    req.onerror = () => { window.__dbProbe = JSON.stringify({}) }
  })()`)
  const raw = await pollGlobal('__dbProbe')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

async function go(path) {
  await send('Page.navigate', { url: BASE + path })
  await sleep(2400)
}

// ============================================================ 构建两套产物
// Unique project-local directory; do not delete previous test state.
await mkdir(join(SWAP, 'a'), { recursive: true })
await mkdir(join(SWAP, 'b'), { recursive: true })

function buildAs(version) {
  execFileSync(
    process.execPath,
    [
      '-e',
      `const fs=require('fs');const p='src/appInfo.ts';let s=fs.readFileSync(p,'utf8');s=s.replace(/APP_VERSION = '[0-9.]+'/, "APP_VERSION = '${version}'");fs.writeFileSync(p,s);`,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'error'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
}

const appInfoPath=join(ROOT,'src/appInfo.ts')
const phonePath=join(ROOT,'public/icons/items/phone.webp')
const originalInfo=await readFile(appInfoPath)
const originalPhone=await readFile(phonePath)
const oldPhone=await readFile(join(ROOT,'public/icons/items/tablet.webp'))
const expectedPhoneA=createHash('sha256').update(oldPhone).digest('hex')
const expectedPhoneB=createHash('sha256').update(originalPhone).digest('hex')
try {
  await writeFile(phonePath,oldPhone)
  buildAs('0.6.0')
  await cp(join(ROOT,'dist'),join(SWAP,'a'),{recursive:true})
  await writeFile(phonePath,originalPhone)
  buildAs('0.6.1')
  await cp(join(ROOT,'dist'),join(SWAP,'b'),{recursive:true})
} finally {
  await writeFile(appInfoPath,originalInfo)
  await writeFile(phonePath,originalPhone)
}
await setActive('a')
const assetHash=()=>ev("(async()=>{const bytes=await(await fetch('/icons/items/phone.webp')).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('')})()")
const decodedAssetHash=()=>ev("(async()=>{const i=new Image();i.src='/icons/items/phone.webp';await i.decode();const c=document.createElement('canvas');c.width=c.height=40;const x=c.getContext('2d');x.drawImage(i,0,0,40,40);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',x.getImageData(0,0,40,40).data))].map(b=>b.toString(16).padStart(2,'0')).join('')})()")
// ============================================================ 1. Build A 冷启动
await go('/')
for(let i=0;i<600;i++){const status=await swState();if(status?.controller&&status?.active)break;await sleep(100)}
const sw1 = await swState()
check('Build A：SW 已注册并接管', sw1?.controller === true && sw1?.active === true, JSON.stringify(sw1))
check(
  'Build A：Service Worker 只注册一次',
  (await ev(`(async () => (await navigator.serviceWorker.getRegistrations()).length)()`)) === 1,
)
const bundleA = await bundle()
check('Build A：相同 URL 的旧 WebP 内容',await assetHash()===expectedPhoneA)
const pixelsA=await decodedAssetHash()
check('Build A：浏览器解码旧 WebP 为实际 40px 像素',typeof pixelsA==='string'&&pixelsA.length===64)
check('Build A：取到当前 bundle 指纹', Boolean(bundleA), String(bundleA))

await go('/settings')
check('Build A：显示版本 v0.6.0', (await versionShown()) === 'v0.6.0', String(await versionShown()))
await go('/')
check('Build A：回到概览后仍是同一套 bundle', (await bundle()) === bundleA)

// ============================================================ 2. 写入"更新前"的持久数据
const TAG_NAME = '更新测试标签-' + Date.now()
await ev(`(() => {
  const __TAG = ${JSON.stringify(TAG_NAME)}
  window.__seed = null
  const req = indexedDB.open('PrivateItemLibraryDB')
  req.onsuccess = () => {
    const db = req.result
    const now = new Date().toISOString()
    const tx = db.transaction(['categories', 'items', 'tags', 'assets', 'syncQueue'], 'readwrite')
    const catReq = tx.objectStore('categories').getAll()
    catReq.onsuccess = () => {
      const first = (catReq.result || [])[0]
      // 先删后写：测试 profile 复用会残留上一轮数据，撞上唯一索引会让整个事务回滚
      tx.objectStore('items').delete('update-test-item')
      tx.objectStore('categories').delete('user-cat-test')
      tx.objectStore('tags').delete('update-test-tag')
      tx.objectStore('categories').put({
        id: 'user-cat-test', name: '用户自建分类', parentId: null, sortOrder: 999,
        iconKey: null, deletedAt: null, createdAt: now, updatedAt: now,
      })
      tx.objectStore('items').put({
        id: 'update-test-item', name: '更新测试物品', categoryId: first ? first.id : 'cat-1',
        note: '', iconAssetId: 'preset-phone', sourceType: 'preset', status: 'owned',
        purchaseDate: '2026-01-01', purchasePriceCents: 12345, additionalCostCents: null,
        purchasePlatform: 'jd', warrantyExpiresAt: null, disposedAt: null, disposalMethod: null,
        salePriceCents: null, disposalNote: null, createdAt: now, updatedAt: now, deletedAt: null,
      })
      tx.objectStore('assets').put({ id:'preset-phone', kind:'preset', path:'/icons/items/phone.svg', mime:'image/svg+xml', width:48, height:48, blob:null, styleVersion:null, promptVersion:null, sourceAssetId:null, createdAt:'2020-01-01T00:00:00.000Z' })
      tx.objectStore('syncQueue').put({ id:'icon-v2-pending', entity:'item', entityId:'update-test-item', op:'upsert', createdAt:now })
      tx.objectStore('tags').put({
        id: 'update-test-tag', name: __TAG, nameNormalized: __TAG, createdAt: now,
      })
    }
    tx.oncomplete = () => { window.__seed = 'ok' }
    tx.onerror = () => { window.__seed = 'err:' + String(tx.error) }
    tx.onabort = () => { window.__seed = 'abort:' + String(tx.error) }
  }
  req.onerror = () => { window.__seed = 'open-error' }
})()`)
const seeded = await pollGlobal('__seed', 8000)
check('更新前：测试数据写入 IndexedDB', seeded === 'ok', String(seeded))
const before = await readDb()
check('更新前：Item 已落库', Boolean(before?.items?.find((i) => i.name === '更新测试物品')))
check('更新前：用户自建分类已落库', Boolean(before?.categories?.find((c) => c.name === '用户自建分类')))
check('更新前：Tag 已落库', Boolean(before?.tags?.find((t) => t.name === TAG_NAME)), TAG_NAME)

// ============================================================ 3. 切到 Build B（不导航）
await setActive('b')
await ev(`document.dispatchEvent(new Event('visibilitychange'))`)
await sleep(2000)
check('节流：刚检查过就恢复前台 → 不重复检查（bundle 未变）', (await bundle()) === bundleA, String(await bundle()))

console.log('   …等待节流窗口（61s）')
await sleep(61_000)
await ev(`document.dispatchEvent(new Event('visibilitychange'))`)
await sleep(4000)
const bundleAfter = await bundle()
check('前台恢复：主动发现新版本并切换到 Build B', bundleAfter !== bundleA, `${bundleA} → ${bundleAfter}`)
check('Build B：相同 URL 的 WebP 字节已替换',await assetHash()===expectedPhoneB)
const pixelsB=await decodedAssetHash()
check('Build B：相同 URL 的浏览器解码像素已替换',typeof pixelsB==='string'&&pixelsB.length===64&&pixelsB!==pixelsA)
const sw2 = await swState()
check('SW 状态：更新后 active 存在且 controller 接管', sw2?.active === true && sw2?.controller === true, JSON.stringify(sw2))

await go('/settings')
check('升级后：设置页显示 v0.6.1', (await versionShown()) === 'v0.6.1', String(await versionShown()))

// ============================================================ 4. IndexedDB 保留
const after = await readDb()
check('旧 SVG 元数据原位升级且保留创建时间',after?.assets?.some(a=>a.id==='preset-phone'&&a.path==='/icons/items/phone.webp'&&a.mime==='image/webp'&&a.width===768&&a.createdAt==='2020-01-01T00:00:00.000Z'))
check('preset 资产没有重复',new Set(after.assets.map(a=>a.id)).size===after.assets.length)
check('同步 outbox 原有条目未丢失',after?.syncQueue?.some(q=>q.id==='icon-v2-pending'))
check('已有 Item.iconAssetId 保持原值',after?.items?.some(i=>i.id==='update-test-item'&&i.iconAssetId==='preset-phone'))
check('更新后：Item 仍然存在', Boolean(after?.items?.find((i) => i.name === '更新测试物品')))
check('更新后：用户自建分类仍然存在、名称未被覆盖', Boolean(after?.categories?.find((c) => c.name === '用户自建分类')))
check('更新后：Tag 仍然存在', Boolean(after?.tags?.find((t) => t.name === TAG_NAME)), TAG_NAME)
await go('/items')
check('更新后：应用仍能读到该物品（UI 渲染）', (await ev(`document.body.textContent.includes('更新测试物品')`)) === true)
check('更新后：旧物品卡片使用 WebP 路径',await ev(`!!document.querySelector('img[src="/icons/items/phone.webp"]')`))

// 实际 SW 更新的跨文档视觉恢复：保留编辑/数据用例，并覆盖窄屏与桌面减少动效。
async function untilPage(expression, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await ev(expression)) return
    await sleep(40)
  }
  throw new Error('Timed out: ' + expression)
}
async function transitionTo(target, label, width, dark, reduced) {
  await send('Emulation.setDeviceMetricsOverride', { width, height:844, deviceScaleFactor:1, mobile:width<640 })
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]})
  await send('Emulation.setCPUThrottlingRate', {rate:reduced?4:1})
  await ev(`localStorage.setItem('pil.theme',${JSON.stringify(dark?'dark':'light')});document.documentElement.dataset.theme=${JSON.stringify(dark?'dark':'light')};window.scrollTo(0,550);window.__startPwaFrames()`)
  const y = await ev('window.scrollY')
  const previous = await bundle()
  await setActive(target)
  await ev(`document.querySelectorAll('button').forEach(b=>{if(b.textContent.includes('检查更新'))b.click()})`)
  await untilPage(`!!document.querySelector('#pwa-update-cover[data-phase="updating"]:not([hidden])')`)
  check(label+'：刷新前可见更新提示且阻止背景误触', await ev(`document.getElementById('root').inert && document.getElementById('pwa-update-title').textContent==='发现新版本'`))
  const {data}=await send('Page.captureScreenshot',{format:'png'})
  await writeFile(join(SWAP,label+'-updating.png'),Buffer.from(data,'base64'))
  await untilPage(`document.body.textContent.includes('已更新到最新版本') && !document.getElementById('root').inert`,10000)
  check(label+'：新 bundle 已启用且仍在原设置页面', await bundle()!==previous && await ev(`location.pathname==='/settings'`))
  check(label+'：恢复原滚动位置', await ev(`Math.abs(window.scrollY-${y})<=2`),String(await ev('window.scrollY')))
  const trace = await ev(`({before:JSON.parse(sessionStorage.getItem('pwa.test.previous-frames')),after:window.__pwaFrames})`)
  const discovery=trace.before.frames.find(f=>f.phase==='updating')
  check(label+'：提示至少保留半秒再刷新',!!discovery && trace.before.leftAt-discovery.at>=500,JSON.stringify(trace.before))
  check(label+'：新文档首帧遮住空 root 且主题一致',trace.after.some(f=>f.phase==='restoring'&&f.empty&&f.background===(dark?'rgb(16, 16, 19)':'rgb(238, 237, 245)')),JSON.stringify(trace.after))
  if(reduced) check(label+'：减少动效时没有旋转动画',trace.after.some(f=>f.phase==='restoring'&&f.animation==='none'))
  check(label+'：恢复记录已消费',await ev(`sessionStorage.getItem('pil.pwa.update-resume')===null`))
  await sleep(220)
  check(label+'：遮层已退出且主内容获得焦点',await ev(`document.getElementById('pwa-update-cover').hidden&&document.activeElement?.id==='main-content'`))
  const shot=await send('Page.captureScreenshot',{format:'png'})
  await writeFile(join(SWAP,label+'-complete.png'),Buffer.from(shot.data,'base64'))
  await writeFile(join(SWAP,label+'-frames.json'),JSON.stringify(trace,null,2))
  await send('Page.reload')
  await sleep(1800)
  check(label+'：再次打开不重复提示更新完成',await ev(`!document.body.textContent.includes('已更新到最新版本')&&document.getElementById('pwa-update-cover').hidden`))
}
await go('/settings')
await transitionTo('a','mobile-light',390,false,false)
await transitionTo('b','desktop-dark-reduced',1280,true,true)
const afterTransitions=await readDb()
check('过渡更新不改变已有物品和 outbox',JSON.stringify(afterTransitions.items)===JSON.stringify(after.items)&&JSON.stringify(afterTransitions.syncQueue)===JSON.stringify(after.syncQueue))
await send('Emulation.setCPUThrottlingRate',{rate:1})
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true})
await ev(`localStorage.setItem('pil.theme','light');document.documentElement.dataset.theme='light'`)

// ============================================================ 5. 表单保护
await setActive('a')
await go('/items/new')
await sleep(1200)
const bundleOnForm = await bundle()
await ev(`(() => {
  const input = document.querySelector('input[placeholder^="比如"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set
  setter.call(input, '未保存输入')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
console.log('   …等待节流窗口（61s）后恢复前台')
await sleep(61_000)
await ev(`document.dispatchEvent(new Event('visibilitychange'))`)
await sleep(3000)

const typed = await ev(`(() => { const i = document.querySelector('input[placeholder^="比如"]'); return i ? i.value : null })()`)
check('表单保护：输入内容未丢失', typed === '未保存输入', String(typed))
check('表单保护：编辑中不 reload（bundle 未变）', (await bundle()) === bundleOnForm, String(await bundle()))
const banner = await ev(`(() => { const b = document.querySelector('[data-update-banner]'); return b ? b.getAttribute('data-update-banner') : null })()`)
check('表单保护：显示「新版本已就绪」提示', banner === 'blocked', String(banner))

await ev(`history.back()`)
await sleep(4000)
const bundleAfterLeave = await bundle()
check('离开编辑态后自动应用更新（切到 Build A）', bundleAfterLeave !== bundleOnForm, `${bundleOnForm} → ${bundleAfterLeave}`)

// ============================================================ 6. 手动检查
await go('/settings')
async function clickCheckUpdate() {
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('检查更新')); if(b) b.click() })()`)
}
async function waitToast(re, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const hit = await ev(`(() => { const m = document.body.textContent.match(${re}); return m ? m[0] : null })()`)
    if (hit) return hit
    await sleep(300)
  }
  return null
}
await clickCheckUpdate()
check('手动检查：无新版本时提示「当前已是线上最新版本」', (await waitToast('/当前已是线上最新版本|发现新版本|新版本已就绪|当前离线/')) === '当前已是线上最新版本')

// Fail the SW script fetch while navigator.onLine stays true; never claim latest on a failed check.
failSwCheck = true
await sleep(3500)
await clickCheckUpdate()
check('手动检查：在线请求失败时明确提示未能完成检查', (await waitToast('/未能完成线上版本检查|当前已是线上最新版本/')) === '未能完成线上版本检查')
failSwCheck = false

await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
await clickCheckUpdate()
check('手动检查：离线不报错并提示离线', (await waitToast('/当前离线|当前已是线上最新版本|检查更新失败/')) === '当前离线')
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })

await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
check('离线仍能读取已替换的 WebP',await assetHash()===expectedPhoneA)
check('离线浏览器解码像素也已切回 Build A',await decodedAssetHash()===pixelsA)
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
console.log('\n================ PWA Update 汇总 ================')
const failed = results.filter((r) => !r.ok)
console.log(`通过 ${results.length - failed.length}/${results.length}`)
for (const f of failed) console.log(`  - ${f.name} ${f.detail ?? ''}`)
await mkdir('docs/screenshots/icon-library-v2',{recursive:true})
await writeFile('docs/screenshots/icon-library-v2/pwa-results.json',JSON.stringify(results,null,2)+'\n')
const closed = new Promise(resolve=>ws.addEventListener('close',resolve,{once:true}))
ws.close()
await closed
await new Promise(resolve=>server.close(resolve))
process.exitCode=failed.length ? 1 : 0
