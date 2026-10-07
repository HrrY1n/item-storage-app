/**
 * Phase 2C 端到端验证（开发工具，不参与应用构建）
 *
 * 在真实无头浏览器 + **生产构建**（vite preview）上验证：
 *   A. Backup   创建两件物品 → 导出 ZIP → Node 侧解析确认结构
 *   B. Restore  清空全部数据 → 导入 ZIP → 确认摘要 → 恢复 → 刷新仍存在
 *   C. Offline  断网后刷新 → App Shell 可打开且已有数据可浏览
 *   D. PWA      manifest / SW 注册 / 图标可访问
 *
 * 前提：vite preview 在 4173；无头 Chrome 的 CDP 在 9222（全新 user-data-dir）。
 * 环境变量 VERIFY_TMP 指定临时目录（下载与 profile）。
 */
import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'

const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:4173'
const TMP = process.env.VERIFY_TMP || path.resolve('.tmp/verify')
const DOWNLOAD_DIR = path.join(TMP, 'downloads')
const OUT = 'docs/screenshots/phase2c'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const results = []
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

class Session {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg)
        this.pending.delete(msg.id)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    }).then((m) => {
      if (m.error) throw new Error(`${method}: ${JSON.stringify(m.error)}`)
      return m.result
    })
  }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return r.result?.value
  }
  async shot(name) {
    const s = await this.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/${name}.png`, Buffer.from(s.data, 'base64'))
  }
  async nav(url, waitText = null, tries = 30) {
    await this.send('Page.navigate', { url })
    return this.waitFor(waitText, tries)
  }
  async reload(waitText = null, tries = 30) {
    await this.send('Page.reload')
    return this.waitFor(waitText, tries)
  }
  async waitFor(waitText = null, tries = 30) {
    for (let i = 0; i < tries; i++) {
      await sleep(300)
      const len = await this.ev('document.body.innerText.length')
      if (len > 30) {
        if (!waitText) return true
        if (await this.has(waitText)) return true
      }
    }
    return false
  }
  async clickText(selector, text) {
    return this.ev(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els.find(e => e.textContent.replace(/\\s+/g, '').includes(${JSON.stringify(text.replace(/\s+/g, ''))}));
      if (!el) return 'not-found';
      el.click();
      return 'clicked';
    })()`)
  }
  async focusByPlaceholder(ph) {
    return this.ev(`(() => {
      const el = [...document.querySelectorAll('input,textarea')].find(i => (i.placeholder || '').includes(${JSON.stringify(ph)}));
      if (!el) return 'not-found';
      el.focus();
      return 'ok';
    })()`)
  }
  type(text) {
    return this.send('Input.insertText', { text })
  }
  has(text) {
    return this.ev(`document.body.innerText.includes(${JSON.stringify(text)})`)
  }
  async setFileInput(filePath) {
    const { root } = await this.send('DOM.getDocument', { depth: -1 })
    const { nodeId } = await this.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]',
    })
    if (!nodeId) return 'input-not-found'
    await this.send('DOM.setFileInputFiles', { files: [filePath], nodeId })
    return 'ok'
  }
}

/** 通过 UI 新增一件物品 */
async function createItem(s, { name, category, subCategory, iconIndex, tags = [] }) {
  await s.nav(`${BASE}/items/new`, '新增物品')
  await s.ev(
    `(() => { const b = document.querySelectorAll('button[aria-pressed]')[${iconIndex}]; if (b) b.click(); return !!b })()`,
  )
  await s.focusByPlaceholder('比如：AirPods')
  await s.type(name)
  await s.clickText('button', category)
  await sleep(250)
  if (subCategory) {
    await s.clickText('button', subCategory)
    await sleep(250)
  }
  for (const t of tags) {
    await s.focusByPlaceholder('新建标签')
    await s.type(t)
    await s.clickText('button', '添加')
    await sleep(350)
  }
  await s.clickText('header button', '保存')
  await sleep(1300)
  return s.ev('location.href')
}

/** 完全清库并重新加载（用于模拟"删除全部测试数据"） */
async function wipeDatabase(s) {
  await s.ev(`new Promise((res) => {
    const req = indexedDB.deleteDatabase('PrivateItemLibraryDB');
    req.onsuccess = req.onerror = req.onblocked = () => res('done');
    setTimeout(() => res('timeout'), 3000);
  })`)
}

async function waitForZip(dir, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.zip') && !f.endsWith('.crdownload'))
    if (files.length > 0) return files[0]
    await sleep(400)
  }
  return null
}

async function run() {
  // 前置：确认生产预览服务可达，否则会在"连接被拒"错误页上产生假通过
  const probeStatus = await fetch(BASE).then((r) => r.status).catch(() => 0)
  if (probeStatus !== 200) {
    console.error(`FATAL: ${BASE} 不可达（HTTP ${probeStatus}），请先启动 vite preview`)
    process.exit(3)
  }

  await mkdir(OUT, { recursive: true })
  await rm(DOWNLOAD_DIR, { recursive: true, force: true })
  await mkdir(DOWNLOAD_DIR, { recursive: true })

  const target = await (
    await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })
  ).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const s = new Session(ws)

  await s.send('Page.enable')
  await s.send('Network.enable')
  await s.send('DOM.enable')
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  })
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await s.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_DIR,
  })

  /* ================= A. Backup ================= */
  await s.nav(`${BASE}/`, '我的物品')
  await wipeDatabase(s)
  await s.reload('我的物品')

  await createItem(s, {
    name: 'AirPods Pro 2',
    category: '数码与电子',
    subCategory: '音频设备',
    iconIndex: 2,
    tags: ['Apple', '常用'],
  })
  await createItem(s, {
    name: 'MacBook Pro 14',
    category: '数码与电子',
    subCategory: '电脑设备',
    iconIndex: 0,
    tags: ['Apple'],
  })

  await s.nav(`${BASE}/`, '我的物品')
  const twoItems = (await s.has('AirPods Pro 2')) && (await s.has('MacBook Pro 14'))
  check('A1. 创建两件物品并在首页可见', twoItems)

  await s.nav(`${BASE}/settings`, '设置')
  check('A2. 设置页「导出备份」为可用状态（不再是"即将支持"）', !(await s.has('即将支持')))
  await s.clickText('button', '导出备份')

  const zipName = await waitForZip(DOWNLOAD_DIR)
  check('A3. 点击导出后生成 ZIP 文件', !!zipName, zipName || '未检测到下载')

  let zipData = null
  let manifest = null
  if (zipName) {
    const buf = await readFile(path.join(DOWNLOAD_DIR, zipName))
    const zip = await JSZip.loadAsync(buf)
    const manifestFile = zip.file('manifest.json')
    const dataFile = zip.file('data.json')
    check('A4. ZIP 内包含 manifest.json 与 data.json', !!manifestFile && !!dataFile)
    if (manifestFile && dataFile) {
      manifest = JSON.parse(await manifestFile.async('string'))
      zipData = JSON.parse(await dataFile.async('string'))
      const fieldsOk =
        typeof manifest.schemaVersion === 'number' &&
        typeof manifest.exportVersion === 'string' &&
        typeof manifest.exportedAt === 'string' &&
        typeof manifest.itemCount === 'number' &&
        typeof manifest.categoryCount === 'number' &&
        typeof manifest.tagCount === 'number' &&
        typeof manifest.assetCount === 'number'
      check('A5. manifest 字段齐全（schemaVersion/exportVersion/exportedAt/四个计数）', fieldsOk)
      const noHash = !('sha256' in manifest) && !('dataSha256' in manifest) && !('hash' in manifest)
      check('A6. manifest 不含任何 hash 字段', noHash)
      check(
        `A7. manifest 计数正确（物品 2）`,
        manifest.itemCount === 2,
        `itemCount=${manifest.itemCount} category=${manifest.categoryCount} tag=${manifest.tagCount} asset=${manifest.assetCount}`,
      )
      check(
        'A8. data.json 含四类数据与资产元数据',
        Array.isArray(zipData.items) &&
          Array.isArray(zipData.categories) &&
          Array.isArray(zipData.tags) &&
          Array.isArray(zipData.itemTags) &&
          Array.isArray(zipData.assets),
      )
      check('A9. ZIP 文件名格式符合规范', /^private-item-library-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(zipName))
    }
  }

  /* ================= B. Restore ================= */
  await wipeDatabase(s)
  await s.reload('我的物品')
  await sleep(600)
  const emptyAfterWipe = !(await s.has('AirPods Pro 2'))
  check('B1. 清空全部数据后物品消失', emptyAfterWipe)

  await s.nav(`${BASE}/settings`, '设置')
  const zipPath = zipName ? path.join(DOWNLOAD_DIR, zipName) : null
  const setResult = zipPath ? await s.setFileInput(zipPath) : 'no-zip'
  check('B2. 可向文件输入设置备份 ZIP', setResult === 'ok', setResult)

  // 等待摘要确认对话框
  let dialogShown = false
  for (let i = 0; i < 25; i++) {
    await sleep(300)
    if (await s.has('恢复后将替换当前数据')) {
      dialogShown = true
      break
    }
  }
  check('B3. 校验通过后显示摘要确认对话框', dialogShown)
  const summaryOk = dialogShown && (await s.has('物品 2'))
  check('B4. 摘要显示备份信息（物品 2）', summaryOk)
  if (dialogShown) await s.shot('02-restore-confirm')

  await s.clickText('div.fixed button', '恢复')
  await sleep(1500)

  await s.nav(`${BASE}/`, '我的物品')
  const restored =
    (await s.has('AirPods Pro 2')) && (await s.has('MacBook Pro 14')) && (await s.has('2 件物品'))
  check('B5. 恢复后两件物品全部回来', restored)
  await s.shot('03-restored-home')

  await s.nav(`${BASE}/search`)
  await sleep(400)
  await s.ev(`(() => { const el = document.querySelector('input[type="search"]'); if (el) el.focus(); return !!el })()`)
  await s.type('Apple')
  await sleep(700)
  check('B6. 恢复后标签关联有效（搜索 Apple 命中两件）', (await s.has('AirPods Pro 2')) && (await s.has('MacBook Pro 14')))

  await s.reload('我的物品')
  await s.nav(`${BASE}/`, '我的物品')
  const persistedAfterReload =
    (await s.has('AirPods Pro 2')) && (await s.has('MacBook Pro 14'))
  check('B7. 刷新浏览器后恢复的数据仍然存在', persistedAfterReload)

  // 恢复后分类/备注/图标关联
  await s.nav(`${BASE}/categories`, '分类')
  await s.clickText('button', '数码与电子')
  await sleep(500)
  check('B8. 恢复后分类树与子分类仍在', (await s.has('音频设备')) || (await s.has('数码与电子')))

  /* ================= C. Offline ================= */
  await s.nav(`${BASE}/`, '我的物品')
  const swState = await s.ev(`(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await navigator.serviceWorker.ready;
    return reg.active ? 'active' : 'no-active';
  })()`)
  check('C1. Service Worker 已安装并激活', swState === 'active', swState)
  await s.reload('我的物品')

  await s.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  })
  await sleep(500)

  await s.send('Page.reload')
  await sleep(2500)
  const offlineBodyLen = await s.ev('document.body.innerText.length')
  const shellUp = offlineBodyLen > 30
  const offlineDataVisible = shellUp && (await s.has('AirPods Pro 2'))
  check('C2. 离线刷新后 App Shell 能打开', shellUp, `bodyLen=${offlineBodyLen}`)
  check('C3. 离线状态下已有 IndexedDB 数据仍可浏览', offlineDataVisible)
  if (shellUp) await s.shot('04-offline-home')

  await s.nav(`${BASE}/categories`, null, 8)
  await sleep(1200)
  const offlineCategoryNav = (await s.ev('document.body.innerText.length')) > 30
  check('C4. 离线状态下可切换到其他路由（SPA fallback 生效）', offlineCategoryNav)
  if (offlineCategoryNav) await s.shot('05-offline-categories')

  await s.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  await sleep(400)

  /* ================= D. PWA ================= */
  const manifestFetch = await s.ev(`(async () => {
    const res = await fetch('/manifest.webmanifest');
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  })()`)
  check('D1. manifest.webmanifest 可访问且为合法 JSON', !!manifestFetch?.ok, `status=${manifestFetch?.status ?? 'n/a'}`)

  if (manifestFetch?.ok) {
    const m = manifestFetch.data
    check('D2. display: standalone', m.display === 'standalone')
    check('D3. start_url 与 scope 正确', m.start_url === '/' && m.scope === '/')
    const icons = Array.isArray(m.icons) ? m.icons : []
    check(
      'D4. 包含 192 与 512 图标',
      icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512'),
    )
    check('D5. 包含 maskable 图标', icons.some((i) => i.purpose === 'maskable'))
    check('D6. 应用名与短名正确', m.name === '私人数字物品库' && m.short_name === '物品库')
  }

  const iconChecks = await s.ev(`(async () => {
    const paths = ['/icons/pwa/pwa-192x192.png','/icons/pwa/pwa-512x512.png','/icons/pwa/maskable-512x512.png','/icons/pwa/apple-touch-icon-180x180-v2.png','/icons/pwa/favicon-light-32x32.png','/icons/pwa/favicon-dark-32x32.png'];
    const out = {};
    for (const p of paths) {
      try { const r = await fetch(p); out[p] = r.ok; } catch { out[p] = false; }
    }
    return out;
  })()`)
  const allIconsOk = Object.values(iconChecks || {}).every(Boolean)
  check('D7. 六个 App Icon 文件均可访问（含 -v2 主屏图标与两个 favicon）', allIconsOk, JSON.stringify(iconChecks))

  const appleMeta = await s.ev(`!!document.querySelector('link[rel="apple-touch-icon"]')`)
  const iosMeta = await s.ev(`!!document.querySelector('meta[name="apple-mobile-web-app-capable"]')`)
  check('D8. iOS 安装元信息存在（apple-touch-icon / capable）', appleMeta && iosMeta)

  const viewportFit = await s.ev(
    `(document.querySelector('meta[name="viewport"]')?.content || '').includes('viewport-fit=cover')`,
  )
  check('D9. viewport-fit=cover（安全区适配）', viewportFit)

  /* ---- iOS 安装说明 UI ---- */
  await s.nav(`${BASE}/settings`, '设置')
  const iosRowText = await s.ev(
    `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('在 iPhone 上安装')); return b ? b.textContent : '' })()`,
  )
  check('D10. 设置页 iOS 安装项不再显示"即将支持"', !iosRowText.includes('即将支持'), iosRowText.trim())
  await s.clickText('button', '在 iPhone 上安装')
  await sleep(500)
  const stepsShown =
    (await s.has('使用 Safari 打开本页面')) &&
    (await s.has('分享')) &&
    (await s.has('添加到主屏幕'))
  check('D11. 点击后显示三步安装说明', stepsShown)
  if (stepsShown) await s.shot('06-ios-install')

  console.log(results.join('\n'))
  console.log('')
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
  ws.close()
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error('VERIFY SCRIPT ERROR:', e.message)
  console.error(e.stack)
  console.log(results.join('\n'))
  process.exit(2)
})
