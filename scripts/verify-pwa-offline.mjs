/**
 * PWA 离线冷启动回归验证（开发工具，不参与应用构建）
 *
 * 为什么需要这个脚本：`scripts/verify-deploy.mjs` 的离线检查只做了一件
 * `Page.reload` —— 页面还开着、Service Worker 早就接管了，这覆盖不了真机上
 * "从主屏图标冷启动" 的路径。真机故障（见 docs/audit/ios-pwa-offline-coldstart.md）
 * 恰恰只发生在**进程被完全终止后的顶层导航**上。
 *
 * 本脚本用真实的 `vite build` 产物 + 一个**复刻 Cloudflare Workers Static Assets 行为**
 * 的静态服务器（不是 vite preview），在桌面 Chromium(Edge) 上跑六个场景：
 *
 *   A  首次安装（在线）：SW 激活 / controller 存在 / App Shell + JS + CSS 全部落缓存
 *   B  完全离线冷启动：杀进程 → 断网 → 重启 → 导航 `/` → 应用渲染
 *   C  服务器黑洞冷启动：网络在线但服务器永不响应 → 杀进程 → 重启 → 导航 `/`
 *   D  离线深链：`/`、`/items`、`/categories`、`/settings` 都返回应用页面
 *   E  版本更替：旧配置 A（navigateFallback=/index.html）→ 新配置 B（`/`）
 *      · B 必须完整安装
 *      · B 安装后必须仍可离线冷启动
 *      · B 安装失败时不得破坏已可用的 A
 *   F  重定向对照：`/index.html` 在线上会 307 → `/`，旧配置会把 App Shell 存成
 *      `Response.url === ""` 的合成响应；新配置必须存成 url 正常的响应
 *
 * 硬约束：本脚本**从不**调用 `caches.delete` / `indexedDB.deleteDatabase` /
 * `registration.unregister`。每个场景换一个新的浏览器 profile，用完即弃（只删
 * `.tmp/` 下的测试 profile，不动用户数据）。
 *
 * 用法：npm run build && node scripts/verify-pwa-offline.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import fsSync from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(root, '.tmp', 'pwa-offline')

const SERVER_PORT = Number(process.env.PWA_TEST_PORT ?? 4290)
const CDP_PORT = Number(process.env.PWA_TEST_CDP ?? 9333)
const ORIGIN = `http://127.0.0.1:${SERVER_PORT}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const lines = []
function check(name, ok, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`
  lines.push(line)
  console.log(line) // 实时输出，长时间运行时能看到进度
  if (!ok) failures++
}
function note(text) {
  lines.push(`      ${text}`)
  console.log(`      ${text}`)
}

/* ------------------------------------------------------------------ 静态服务器 */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

/**
 * 复刻 Cloudflare Workers Static Assets：
 *   /index.html       -> 307 Location: /   （线上实测行为，只在 mode=normal 下）
 *   /                 -> index.html 200
 *   无后缀的未知路径    -> index.html 200  （not_found_handling: single-page-application）
 *   带后缀的缺失资源    -> 404
 *   mode=blackhole    -> 接受连接但永不响应（模拟"服务器已停止响应"）
 */
function createServer() {
  const state = {
    rootDir: path.join(root, 'dist'),
    mode: 'normal',
    /** 非 null 时 `/sw.js` 返回这段内容（用来在不复制文件的前提下"部署"另一个 SW 版本） */
    swOverride: null,
    /** 非 null 时该路径强制 404（用来制造"预缓存安装失败"的新版本） */
    brokenPath: null,
  }
  const server = http.createServer((req, res) => {
    if (state.mode === 'blackhole') return // 挂住，客户端最终超时
    const url = new URL(req.url, 'http://x')
    let p = decodeURIComponent(url.pathname)

    if (p === '/sw.js' && state.swOverride !== null) {
      res.writeHead(200, {
        'Content-Type': 'text/javascript',
        'Cache-Control': 'public, max-age=0, must-revalidate',
      })
      return res.end(state.swOverride)
    }
    if (state.brokenPath !== null && p === state.brokenPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
      return
    }

    if (p === '/index.html' && state.mode === 'normal') {
      res.writeHead(307, { Location: '/', 'Cache-Control': 'public, max-age=0, must-revalidate' })
      return res.end()
    }
    if (p === '/') p = '/index.html'
    const file = path.join(state.rootDir, p)
    if (!file.startsWith(state.rootDir)) {
      res.writeHead(403).end('forbidden')
      return
    }
    let stat = null
    try {
      stat = fsSync.statSync(file)
    } catch {
      stat = null
    }
    if (!stat || !stat.isFile()) {
      if (!path.extname(p)) {
        // SPA fallback（not_found_handling: single-page-application）
        let body = null
        try {
          body = fsSync.readFileSync(path.join(state.rootDir, 'index.html'))
        } catch {
          body = null
        }
        if (body === null) return res.writeHead(404).end('no index.html')
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=0, must-revalidate',
        })
        return res.end(body)
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
      return
    }
    const ext = path.extname(file)
    const immutable = /-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(path.basename(file))
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
    })
    fsSync.createReadStream(file).pipe(res)
  })
  return { server, state }
}

/* ------------------------------------------------------------------ 浏览器 */

async function exists(file) {
  try {
    await access(file, fsSync.constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env['ProgramFiles(x86)'] &&
      path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'msedge.exe',
  ].filter(Boolean)
  for (const c of candidates) {
    if (c === 'msedge.exe' || (await exists(c))) return c
  }
  throw new Error('找不到 Microsoft Edge，请设置 EDGE_PATH')
}

async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) return r.json()
    } catch {
      /* retry */
    }
    await sleep(250)
  }
  throw new Error(`CDP 在 ${port} 上未就绪`)
}

/** 启动 Edge（非 detached，父进程持有句柄，可真实杀进程） */
async function launchEdge(profileDir) {
  const executable = await findEdge()
  const proc = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${CDP_PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      '--profile-directory=Default',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--password-store=basic',
      'about:blank',
    ],
    { cwd: root, stdio: 'ignore', windowsHide: true },
  )
  await waitForCdp(CDP_PORT)
  return proc
}

async function killEdge(proc) {
  if (!proc || proc.exitCode !== null) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch {
      /* ignore */
    }
  } else {
    proc.kill('SIGKILL')
  }
  await sleep(1200)
}

/* ------------------------------------------------------------------ CDP session */

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
  /** 收集本次会话的控制台报错（Log / 未捕获异常），用于"生产控制台无新增报错"断言 */
  attachErrorCollector() {
    this.errors = []
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params?.entry?.level)) {
        this.errors.push(`[${msg.params.entry.level}] ${msg.params.entry.text}`)
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(`[exception] ${msg.params?.exceptionDetails?.text ?? ''} ${msg.params?.exceptionDetails?.exception?.description ?? ''}`)
      }
    })
  }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      throw new Error(`eval: ${r.exceptionDetails.text ?? ''} ${r.exceptionDetails.exception?.description ?? ''}`)
    }
    return r.result?.value
  }
}

async function openSession() {
  const target = await (
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
  ).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const s = new Session(ws)
  await s.send('Page.enable')
  await s.send('Network.enable')
  await s.send('Runtime.enable')
  await s.send('Log.enable')
  s.attachErrorCollector()
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  })
  return s
}

async function setOffline(s, offline) {
  await s.send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: offline ? 0 : -1,
    uploadThroughput: offline ? 0 : -1,
  })
}

/* ------------------------------------------------------------------ 页面探针 */

const APP_RENDERED = `(() => {
  const r = document.getElementById('root')
  return Boolean(r && r.children.length > 0)
})()`

const SW_STATE = `(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  const out = {
    hasReg: Boolean(reg),
    active: reg?.active?.state ?? null,
    installing: Boolean(reg?.installing),
    waiting: Boolean(reg?.waiting),
    controller: Boolean(navigator.serviceWorker.controller),
    scriptURL: reg?.active?.scriptURL ?? null,
  }
  return JSON.stringify(out)
})()`

const SHELL_PROBE = `(async (appShellUrl) => {
  const names = await caches.keys()
  const name = names.find((n) => n.includes('precache')) ?? names[0] ?? null
  if (!name) return JSON.stringify({ cacheName: null, count: 0 })
  const cache = await caches.open(name)
  const keys = await cache.keys()
  const norm = (u) => {
    const x = new URL(u, location.origin)
    x.searchParams.delete('__WB_REVISION__')
    return x.href
  }
  const paths = new Set(keys.map((k) => norm(k.url)))
  let shellKey = null
  for (const k of keys) if (norm(k.url) === new URL(appShellUrl, location.origin).href) shellKey = k
  let shell = null
  if (shellKey) {
    const res = await cache.match(shellKey)
    const text = res ? await res.clone().text() : ''
    shell = {
      url: res?.url ?? null,
      type: res?.type ?? null,
      status: res?.status ?? null,
      redirected: res?.redirected ?? null,
      hasRoot: text.includes('id="root"'),
      bytes: text.length,
    }
  }
  return JSON.stringify({
    cacheName: name,
    count: keys.length,
    paths: [...paths],
    hasIndexHtml: paths.has(new URL('/index.html', location.origin).href),
    hasRoot: paths.has(new URL('/', location.origin).href),
    shell,
  })
})`

async function probeShell(s, appShellUrl) {
  const raw = await s.ev(`(${SHELL_PROBE})(${JSON.stringify(appShellUrl)})`)
  return JSON.parse(raw)
}

/** 轮询缓存探针直到谓词成立（用于等待"新版本真的完成安装 + activate"） */
async function waitForProbe(s, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let snap = null
  while (Date.now() < deadline) {
    snap = await probeShell(s, predicate.url)
    if (predicate.ok(snap)) return snap
    await sleep(700)
  }
  return snap
}

async function waitFor(s, expr, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await s.ev(expr)
    if (last === true || (typeof last === 'string' && last === 'true')) return true
    await sleep(400)
  }
  throw new Error(`等待超时：${label}（最后值 ${last}）`)
}

/* ------------------------------------------------------------------ 清单解析 */

function parseSwManifest(swText) {
  const start = swText.indexOf('precacheAndRoute')
  const open = swText.indexOf('[', start)
  let depth = 0
  let end = -1
  for (let i = open; i < swText.length; i++) {
    if (swText[i] === '[') depth++
    else if (swText[i] === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const arr = swText.slice(open + 1, end)
  const re = /\{url:"([^"]*)",revision:("[^"]*"|null)\}/g
  const entries = []
  let m
  while ((m = re.exec(arr))) {
    entries.push({ url: m[1], revision: m[2] === 'null' ? null : m[2].slice(1, -1) })
  }
  const navigateFallback = swText.match(/createHandlerBoundToURL\("([^"]*)"\)/)?.[1] ?? null
  return { entries, navigateFallback, count: entries.length }
}

/* ------------------------------------------------------------------ 场景 */

/**
 * 每次运行用**新的** profile 目录，而不是清空旧目录：
 * 递归删除上百个文件会触发本地安全删除护栏，而 profile 本来就是一次性的。
 */
const RUN_ID = `${Date.now()}`
async function freshProfile(name) {
  const dir = path.join(TMP, `profile-${RUN_ID}-${name}`)
  await mkdir(dir, { recursive: true })
  return dir
}

/** 在线首次安装：返回 SW 状态与缓存快照 */
async function installOnline(profile, timeoutMs = 60000) {
  const proc = await launchEdge(profile)
  try {
    const s = await openSession()
    await s.send('Page.navigate', { url: `${ORIGIN}/` })
    await waitFor(s, APP_RENDERED, 30000, '在线首屏渲染')
    await waitFor(
      s,
      `(async () => { const r = await navigator.serviceWorker.getRegistration(); return Boolean(r && r.active && r.active.state === 'activated' && navigator.serviceWorker.controller) })()`,
      30000,
      'SW 激活并接管',
    )
    // 等预缓存稳定：数量不再增长
    let prev = -1
    const deadline = Date.now() + timeoutMs
    let snap = null
    while (Date.now() < deadline) {
      snap = await probeShell(s, '/')
      if (snap.count === prev && snap.count > 0) break
      prev = snap.count
      await sleep(800)
    }
    const sw = JSON.parse(await s.ev(SW_STATE))
    return { sw, snap, errors: s.errors ?? [] }
  } finally {
    await killEdge(proc)
  }
}

/** 进程级冷启动：杀掉 → 重启 → 设置网络条件 → 导航 */
async function coldStart(profile, url, offline, timeoutMs = 30000) {
  const proc = await launchEdge(profile)
  try {
    const s = await openSession()
    await setOffline(s, offline)
    await s.send('Page.navigate', { url })
    let ok = true
    try {
      await waitFor(s, APP_RENDERED, timeoutMs, `冷启动渲染 ${url}`)
    } catch {
      ok = false
    }
    const text = ok ? await s.ev('document.body.innerText.slice(0, 120)') : ''
    const sw = JSON.parse(await s.ev(SW_STATE))
    return { ok, sw, text }
  } finally {
    await killEdge(proc)
  }
}

/* ------------------------------------------------------------------ main */

async function main() {
  await mkdir(TMP, { recursive: true })

  const dist = path.join(root, 'dist')
  if (!(await exists(path.join(dist, 'sw.js')))) {
    throw new Error('dist/sw.js 不存在，请先 npm run build')
  }
  const swText = await readFile(path.join(dist, 'sw.js'), 'utf8')
  const manifest = parseSwManifest(swText)
  const expected = [...new Set(manifest.entries.map((e) => e.url))]
  const shellEntry = manifest.entries.find((e) => e.url === '/' || e.url === 'index.html')

  console.log(
    `[config] navigateFallback=${manifest.navigateFallback} 条目=${manifest.count} 唯一=${expected.length} AppShell=${shellEntry?.url} rev=${shellEntry?.revision}`,
  )

  /* 构造"旧配置版本 A"：只把 App Shell 入口改回 index.html + navigateFallback 改回 /index.html，
     其余逐字节不变 —— 等价于旧 vite.config 的产物，用来做版本更替与重定向对照。
     不走文件复制：直接让服务器用这段内容响应 `/sw.js`。 */
  const swOld = (() => {
    const rev = shellEntry?.revision ?? ''
    let a = swText
      .replace('createHandlerBoundToURL("/")', 'createHandlerBoundToURL("/index.html")')
      .replace(`{url:"/",revision:"${rev}"}`, `{url:"index.html",revision:"${rev}"}`)
    if (a === swText) throw new Error('构造旧配置版本 A 失败：sw.js 未发生变化')
    return a
  })()
  const parsedOld = parseSwManifest(swOld)
  console.log(
    `[config] 旧配置 A: navigateFallback=${parsedOld.navigateFallback} AppShell=${parsedOld.entries.find((e) => e.url === 'index.html')?.url}`,
  )

  /* 构造"安装必然失败的 B'"。
     ⚠️ 不能只是让某个资源 404：预缓存缓存名跨版本恒定，新版本安装时会先 `cacheMatch`，
        已经在缓存里的资源**根本不会重新发请求**（实测：把一个 preset 图标强制 404，
        B 照样安装成功）。所以必须让该资源在 B' 里的 **revision 与 A 不同** ——
        缓存键因此变化，`cacheMatch` 落空 → 真的去 fetch → 404 → install 抛错。 */
  const brokenVictimEntry = manifest.entries.find(
    (e) => e.url.startsWith('assets/') && e.url.endsWith('.js') && e.url.includes('index-'),
  )
  if (!brokenVictimEntry) throw new Error('找不到主 JS 资源')
  const brokenVictim = `/${brokenVictimEntry.url}`
  const swBroken = swText.replace(
    `{url:"${brokenVictimEntry.url}",revision:${brokenVictimEntry.revision === null ? 'null' : `"${brokenVictimEntry.revision}"`}}`,
    `{url:"${brokenVictimEntry.url}",revision:"installfail"}`,
  )
  if (swBroken === swText) throw new Error('构造故障版本 B\' 失败：sw.js 未发生变化')
  const parsedBroken = parseSwManifest(swBroken)
  console.log(
    `[config] 故障版本 B': ${brokenVictim} 强制 404 且 revision 改为 installfail（verify=${parsedBroken.entries.find((e) => e.url === brokenVictimEntry.url)?.revision}）`,
  )

  const { server, state } = createServer()
  await new Promise((r) => server.listen(SERVER_PORT, '127.0.0.1', r))
  console.log(`[server] ${ORIGIN} root=${state.rootDir} mode=${state.mode}`)

  try {
    /* ---------------- A 首次安装（在线） ---------------- */
    state.rootDir = dist
    state.mode = 'normal'
    state.swOverride = null
    state.brokenPath = null
    const profileA = await freshProfile('a')
    const a = await installOnline(profileA)
    check('A1. 在线首次安装：SW 已激活且 controller 存在', a.sw.active === 'activated' && a.sw.controller, JSON.stringify(a.sw))
    check(
      'A2. App Shell 入口是 `/`（不是 /index.html）',
      manifest.navigateFallback === '/' && shellEntry?.url === '/',
      `navigateFallback=${manifest.navigateFallback} entry=${shellEntry?.url}`,
    )
    check(
      'A3. 预缓存完整（无缺失）',
      a.snap.count >= expected.length,
      `缓存 ${a.snap.count} 条 / 清单唯一 ${expected.length} 条`,
    )
    const missing = expected.filter((u) => {
      const abs = new URL(u, ORIGIN).href
      return !a.snap.paths.includes(abs)
    })
    check('A4. 清单里的每个唯一 URL 都在 Cache Storage 中', missing.length === 0, missing.slice(0, 5).join(', '))
    check('A5. 缓存里不再有 index.html 这份 App Shell 副本', a.snap.hasIndexHtml === false)
    check('A6. 缓存里存在 `/`', a.snap.hasRoot === true)
    check(
      'A7. `/` 缓存响应内容正确（含 id="root"）',
      a.snap.shell?.hasRoot === true && a.snap.shell?.status === 200,
      JSON.stringify(a.snap.shell),
    )
    check(
      'A8. 在线首次安装期间生产控制台无报错',
      a.errors.length === 0,
      a.errors.slice(0, 3).join(' | '),
    )

    /* ---------------- B 完全离线冷启动（杀进程） ---------------- */
    const b1 = await coldStart(profileA, `${ORIGIN}/`, true, 30000)
    check('B1. 杀进程 → 断网 → 冷启动 `/` 成功', b1.ok, b1.text || JSON.stringify(b1.sw))
    check('B2. 冷启动时 SW 仍接管页面', b1.sw.controller === true, JSON.stringify(b1.sw))

    /* ---------------- C 服务器黑洞冷启动 ---------------- */
    const profileC = await freshProfile('c')
    await installOnline(profileC)
    state.mode = 'blackhole'
    const t0 = Date.now()
    const c1 = await coldStart(profileC, `${ORIGIN}/`, false, 20000)
    const elapsed = Date.now() - t0
    check('C1. 网络在线但服务器永不响应 → 冷启动 `/` 成功', c1.ok, c1.text || JSON.stringify(c1.sw))
    check('C2. 黑洞场景不等待网络超时（20s 内完成）', c1.ok && elapsed < 20000, `${elapsed}ms`)
    state.mode = 'normal'

    /* ---------------- D 离线深链 ---------------- */
    {
      const proc = await launchEdge(profileA)
      try {
        const s = await openSession()
        await setOffline(s, true)
        for (const route of ['/', '/items', '/categories', '/settings']) {
          await s.send('Page.navigate', { url: `${ORIGIN}${route}` })
          let ok = true
          try {
            await waitFor(s, APP_RENDERED, 15000, `离线深链 ${route}`)
          } catch {
            ok = false
          }
          const text = await s.ev('document.body.innerText.slice(0, 60)')
          check(`D. 离线深链 ${route} 返回应用页面`, ok, text)
        }
      } finally {
        await killEdge(proc)
      }
    }

    /* ---------------- E+F 版本更替 & 重定向对照 ---------------- */
    {
      const profileE = await freshProfile('e')
      // 1) 部署旧配置 A（/sw.js 返回旧版本，其余资源与 B 完全相同）
      state.swOverride = swOld
      await installOnline(profileE)
      const shellA = await (async () => {
        const proc = await launchEdge(profileE)
        try {
          const s = await openSession()
          await s.send('Page.navigate', { url: `${ORIGIN}/` })
          await waitFor(s, APP_RENDERED, 20000, 'A 首屏')
          await sleep(1500)
          return probeShell(s, '/index.html')
        } finally {
          await killEdge(proc)
        }
      })()
      check(
        'F1. 旧配置：App Shell 仍被存成 url 为空的重定向响应（对照成立）',
        shellA.shell?.url === '' && shellA.hasIndexHtml === true,
        JSON.stringify(shellA.shell),
      )
      const eaOffline = await coldStart(profileE, `${ORIGIN}/`, true, 30000)
      check('E0. 旧配置 A 本身可离线冷启动（基线）', eaOffline.ok, eaOffline.text)

      // 2) 部署新配置 B（/sw.js 恢复为真实产物）
      state.swOverride = null
      const proc = await launchEdge(profileE)
      let ebSnap = null
      try {
        const s = await openSession()
        await s.send('Page.navigate', { url: `${ORIGIN}/` })
        await waitFor(s, APP_RENDERED, 30000, 'B 首屏')
        await waitFor(
          s,
          `(async () => { const r = await navigator.serviceWorker.getRegistration(); return Boolean(r && r.active && r.active.state === 'activated' && navigator.serviceWorker.controller) })()`,
          30000,
          'B SW 激活',
        )
        // 等到"新版本的 App Shell 真的进了缓存"为止 —— 只看数量稳定会误判，
        // 因为旧版本 A 与新版本 B 的条目数都是 167。
        ebSnap = await waitForProbe(
          s,
          { url: '/', ok: (snap) => snap.hasRoot === true && snap.hasIndexHtml === false },
          60000,
          'B 完成安装并清理旧条目',
        )
        const swB = JSON.parse(await s.ev(SW_STATE))
        check('E1. 新版本 B 的 SW 已激活并接管', swB.active === 'activated' && swB.controller, JSON.stringify(swB))
      } finally {
        await killEdge(proc)
      }
      check('E2. B 安装后预缓存完整', ebSnap && ebSnap.count >= expected.length, `缓存 ${ebSnap?.count} 条`)
      check('E3. B 安装后旧的 index.html 条目已被清理', ebSnap?.hasIndexHtml === false)
      check(
        'F2. 新配置：App Shell 缓存响应 url 正常（不再是被重定向的合成响应）',
        ebSnap?.shell?.url && ebSnap.shell.url !== '' && ebSnap.shell.type === 'basic',
        JSON.stringify(ebSnap?.shell),
      )
      const ebOffline = await coldStart(profileE, `${ORIGIN}/`, true, 30000)
      check('E4. A → B 更替后仍可离线冷启动', ebOffline.ok, ebOffline.text)
    }

    /* ---------------- E5 B 安装失败不得破坏 A ---------------- */
    {
      const profileF = await freshProfile('f')
      state.swOverride = swOld
      await installOnline(profileF)
      // 部署"新版本 B'"，它的主 JS 必然 404 -> precache 安装失败
      state.swOverride = swBroken
      state.brokenPath = brokenVictim
      const proc = await launchEdge(profileF)
      try {
        const s = await openSession()
        await s.send('Page.navigate', { url: `${ORIGIN}/` })
        await sleep(12000)
        const snap = await probeShell(s, '/index.html')
        note(
          `E5 观察：缓存 ${snap.count} 条 hasIndexHtml=${snap.hasIndexHtml} hasRoot=${snap.hasRoot}` +
            `（hasRoot=true 是 B' 安装中断前已写入的孤儿条目；旧版本一条都没被删）`,
        )
        check('E5a. B 安装失败后，A 的 App Shell 条目仍在', snap.hasIndexHtml === true)
        check(
          'E5b. B 安装失败后，旧版本缓存一条都没被删除',
          snap.count >= expected.length,
          `缓存 ${snap.count} 条 ≥ A 的 ${expected.length} 条`,
        )
        check('E5b2. B 安装失败后，页面仍由 SW 接管', JSON.parse(await s.ev(SW_STATE)).controller === true)
      } finally {
        await killEdge(proc)
      }
      const fOffline = await coldStart(profileF, `${ORIGIN}/`, true, 30000)
      check('E5c. B 安装失败后 A 仍可离线冷启动', fOffline.ok, fOffline.text)
      state.brokenPath = null
    }
  } finally {
    server.close()
  }

  console.log('\n' + lines.join('\n'))
  console.log(failures === 0 ? '\nPWA OFFLINE COLDSTART = PASS' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  if (lines.length) console.log('\n' + lines.join('\n'))
  console.error('\nVERIFY ERROR:', e.stack ?? e.message)
  process.exit(2)
})
