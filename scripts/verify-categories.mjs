/** Requires dev :5173, preview :4173 and a fresh project-local Edge profile; never clears storage. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const port = process.env.EDGE_TEST_PORT ?? '9222'
const CDP = 'http://127.0.0.1:' + port
const DEV = 'http://127.0.0.1:5173'
const PROD = 'http://127.0.0.1:4173'
const OUT = 'docs/screenshots/categories'
const record = JSON.parse(await readFile('.tmp/edge-test-' + port + '.pid.json', 'utf8'))
const relativeProfile = path.relative(path.resolve('.tmp'), path.resolve(record.profile))
assert(relativeProfile && !relativeProfile.startsWith('..') && !path.isAbsolute(relativeProfile), 'Use the project-local Edge launcher')
const results = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const target = await (await fetch(CDP + '/json/new?about:blank', {method:'PUT'})).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve, {once:true}))
let id = 0
const pending = new Map()
ws.addEventListener('message', ({data}) => {
  const message = JSON.parse(data)
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const seq = ++id
  pending.set(seq, message => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result))
  ws.send(JSON.stringify({id:seq,method,params}))
})
const ev = async (fn, arg = null) => {
  const expression = '(' + fn.toString() + ')(' + JSON.stringify(arg) + ')'
  const result = await send('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true})
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result?.value
}
const poll = async (fn, arg) => {
  for (let n = 0; n < 200; n++) { if (await ev(fn,arg)) return; await pause(100) }
  throw new Error('Timed out: ' + fn.toString())
}
const check = (name, ok) => {
  results.push({name,ok})
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
  assert.ok(ok,name)
}
const navigate = async (base, route) => {
  await send('Page.navigate', {url:base + route})
  await poll(route => location.pathname === route && !!document.querySelector('main h1'), route)
}
const button = text => ev(text => {
  const node = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text)
  if (!node) throw new Error('Missing button: ' + text)
  node.click()
}, text)
const shot = async name => {
  await ev(async () => Promise.all([...document.images].map(image => image.decode().catch(() => {}))))
  const {data} = await send('Page.captureScreenshot', {format:'png'})
  await writeFile(OUT + '/' + name + '.png', Buffer.from(data,'base64'))
}
const readDev = () => ev(async () => {
  const {db} = await import('/src/db/db.ts')
  return {categories:await db.categories.toArray(),items:await db.items.toArray(),queue:await db.syncQueue.toArray()}
})

try {
  await mkdir(OUT,{recursive:true})
  await send('Page.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true})
  // A same-origin SVG gives the test access to IndexedDB before any App/Boot code runs.
  await send('Page.navigate',{url:DEV + '/icons/items/other.svg'})
  await poll(() => location.pathname.endsWith('/other.svg'))
  const before = await ev(async () => {
    const {db} = await import('/src/db/db.ts')
    const {buildPresetAssets} = await import('/src/db/seed.ts')
    const {itemRepository} = await import('/src/db/repositories/itemRepository.ts')
    if (await db.categories.count()) throw new Error('This test needs a fresh project-local profile; choose another port. Storage is never cleared.')
    // Frozen v1 defaults, independent of the new taxonomy.
    const roots = [
      ['数码与电子','laptop',['电脑设备','手机与平板','音频设备','存储设备','配件与线材']],
      ['学习与办公','book',['书籍','笔记本与纸品','文具','文件资料']],
      ['衣物与穿搭','tshirt',['上衣','裤装','外套','鞋履','包袋','配饰']],
      ['生活用品','bottle',[]],['收藏与纪念','backpack',[]],['其他','other',[]],
    ]
    const then = '2026-01-01T00:00:00.000Z'
    const categories = []
    roots.forEach(([name,iconKey,children],index) => {
      const id = 'v1-root-' + index
      categories.push({id,parentId:null,name,iconKey,sortOrder:index+1,createdAt:then,updatedAt:then,deletedAt:null})
      children.forEach((name,childIndex) => categories.push({
        id:id + '-child-' + childIndex,parentId:id,name,sortOrder:childIndex+1,
        createdAt:then,updatedAt:then,deletedAt:null,
      }))
    })
    await db.categories.bulkAdd(categories)
    await db.assets.bulkAdd(buildPresetAssets(then))
    await db.appMeta.bulkPut([{key:'seeded',value:'1'},{key:'schemaVersion',value:'3'}])
    for (const [name,categoryId,iconAssetId] of [
      ['分类验收 · 旧 Pocket','v1-root-0','preset-djipocket'],
      ['分类验收 · 旧耳机','v1-root-0-child-2','preset-earbuds'],
      ['分类验收 · 旧保温杯','v1-root-3','preset-thermos'],
    ]) await itemRepository.create({
      name,categoryId,iconAssetId,note:'分类升级前的验收数据',tagIds:[],status:'owned',
      purchaseDate:null,purchasePriceCents:null,additionalCostCents:null,purchasePlatform:null,
      warrantyExpiresAt:null,disposedAt:null,disposalMethod:null,salePriceCents:null,disposalNote:null,
    })
    return {categories,items:await db.items.toArray(),queue:await db.syncQueue.toArray()}
  })
  check('独立旧版夹具为 6 个一级、15 个二级', before.categories.length === 21)
  await navigate(DEV,'/categories')
  await poll(() => document.querySelectorAll('main section').length === 7)
  const upgraded = await readDev()
  check('旧库启动后补齐 7 个一级、49 个二级', upgraded.categories.length === 56 && upgraded.categories.filter(c => c.parentId === null).length === 7)
  assert.deepEqual(upgraded.items,before.items)
  check('既有物品内容及分类归属完全保留', true)
  check('既有待同步条目逐项保留', before.queue.every(row => upgraded.queue.some(current => JSON.stringify(current) === JSON.stringify(row))))
  check('旧分类 ID、父子关系与创建时间保留', before.categories.every(row => upgraded.categories.some(current => current.id === row.id && current.parentId === row.parentId && current.createdAt === row.createdAt)))
  check('分类页默认展示全部 49 个二级入口', await ev(() => document.querySelectorAll('[id^="category-children-"] .grid a').length === 49))
  check('分类页显示真实层级总数与物品数', await ev(() => document.querySelector('main header').textContent.includes('7 个一级') && document.querySelector('main header').textContent.includes('49 个子分类') && document.querySelector('main header').textContent.includes('3 件物品')))
  check('父级计入子级，直接归入一级的旧物品有说明', await ev(() => {
    const section = document.querySelector('main section')
    return section.querySelector('button').textContent.includes('2 件') && section.textContent.includes('另有 1 件物品直接归入此大类')
  }))
  await ev(() => document.querySelector('main section button').click())
  await poll(() => document.querySelector('main section button').getAttribute('aria-expanded') === 'false')
  check('折叠移除子分类入口，键盘不会进入隐藏内容', await ev(() => document.querySelector('main section button').getAttribute('aria-expanded') === 'false' && !document.querySelector('main section').querySelector('.grid')))
  await ev(() => document.querySelector('main section button').click())
  await poll(() => document.querySelector('main section').querySelector('.grid')?.children.length === 10)
  check('再次展开恢复全部十个数码二级入口', await ev(() => document.querySelector('main section').querySelector('.grid').children.length === 10))
  await ev(() => [...document.querySelectorAll('a')].find(a => a.textContent.includes('音频设备')).click())
  await poll(() => document.querySelector('main h1')?.textContent === '音频设备')
  check('二级分类跳转显示该类实际物品', await ev(() => document.body.textContent.includes('分类验收 · 旧耳机')))
  await navigate(DEV,'/categories')
  await ev(() => [...document.querySelectorAll('a')].find(a => a.textContent.includes('全部「数码与电子」')).click())
  await poll(() => document.querySelector('main h1')?.textContent === '数码与电子')
  check('大类全部入口同时包含直接归入和二级物品', await ev(() => document.body.textContent.includes('分类验收 · 旧 Pocket') && document.body.textContent.includes('分类验收 · 旧耳机')))
  await navigate(DEV,'/items/new')
  await button('数码与电子')
  await poll(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '摄影摄像'))
  check('新增表单与分类页共享新增二级分类', await ev(() => ['摄影摄像','键鼠与输入设备','游戏设备','网络与智能设备','智能穿戴'].every(name => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === name))))
  await button('摄影摄像')
  await poll(() => [...document.querySelectorAll('button[aria-pressed="true"]')].some(button => button.textContent.trim() === '摄影摄像'))
  await ev(() => document.querySelector('input[placeholder="比如：AirPods Pro"]').focus())
  await send('Input.insertText',{text:'分类验收 · 新摄影设备'})
  await poll(() => [...document.querySelectorAll('header button')].some(button => button.textContent.trim() === '保存' && !button.disabled))
  await button('保存')
  await poll(() => /^\/items\/[^/]+$/.test(location.pathname))
  const created = await readDev()
  const photo = created.categories.find(c => c.name === '摄影摄像')
  check('新二级分类可正常保存并显示物品', created.items.some(item => item.name === '分类验收 · 新摄影设备' && item.categoryId === photo.id))
  await navigate(DEV,'/categories')
  check('保存后分类页件数实时更新', await ev(() => document.querySelector('main section button').textContent.includes('3 件') && [...document.querySelectorAll('main .grid a')].find(a => a.textContent.includes('摄影摄像')).textContent.includes('1 件')))
  await shot('01-categories-light')
  await ev(() => localStorage.setItem('pil.theme','dark'))
  await navigate(DEV,'/categories')
  await shot('02-categories-dark')
  check('深色使用现有主题且图标完整加载', await ev(() => document.documentElement.dataset.theme === 'dark' && [...document.querySelectorAll('main section img')].every(image => image.complete && image.naturalWidth === 768)))
  await ev(() => localStorage.setItem('pil.theme','light'))
  await navigate(DEV,'/categories')
  await ev(() => [...document.querySelectorAll('main section')].find(section => section.textContent.includes('家居与厨房')).scrollIntoView())
  await shot('03-home-kitchen-light')
  await send('Emulation.setDeviceMetricsOverride',{width:375,height:568,deviceScaleFactor:2,mobile:true})
  check('375px 短屏无横向溢出', await ev(() => document.documentElement.scrollWidth <= innerWidth))
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
  check('桌面视口无横向溢出', await ev(() => document.documentElement.scrollWidth <= innerWidth))
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true})
  await navigate(PROD,'/categories')
  await poll(() => document.querySelectorAll('main section').length === 7)
  const fresh = await ev(() => new Promise((resolve,reject) => {
    const request=indexedDB.open('PrivateItemLibraryDB')
    request.onerror=()=>reject(request.error)
    request.onsuccess=()=>{const db=request.result;const tx=db.transaction(['categories','items','appMeta'])
      const categories=tx.objectStore('categories').getAll(),items=tx.objectStore('items').count(),version=tx.objectStore('appMeta').get('defaultCategoriesVersion')
      tx.oncomplete=()=>{resolve({categories:categories.result.length,items:items.result,version:version.result?.value});db.close()}
    }
  }))
  check('生产构建首次安装直接获得完整分类', fresh.categories === 56 && fresh.items === 0 && fresh.version === '2')
  await poll(() => !!navigator.serviceWorker.controller)
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0})
  await send('Page.reload')
  await poll(() => document.querySelectorAll('main section').length === 7)
  check('生产分类页离线刷新保留全部二级入口', await ev(() => document.querySelectorAll('[id^="category-children-"] .grid a').length === 49))
  const broken = await ev(async () => {
    await Promise.all([...document.querySelectorAll('main section img')].map(image => image.decode().catch(() => {})))
    return [...document.querySelectorAll('main section img')].some(image => image.naturalWidth !== 768)
  })
  check('所有分类封面离线可解码', !broken)
} catch(error) {
  console.error(error)
  process.exitCode=1
  await shot('failure').catch(()=>{})
} finally {
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}).catch(()=>{})
  await writeFile(OUT + '/results.json',JSON.stringify(results,null,2)+'\n')
  ws.close()
  await fetch(CDP + '/json/close/' + target.id).catch(()=>{})
}
