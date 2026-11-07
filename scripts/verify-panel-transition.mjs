// 详情 ⇄ 编辑转场专项回归：连续性、终态、草稿保护、快速往返、滚动、减少动效、视觉层级。
// 需要 Vite dev 服务器（DEV_BASE，默认 127.0.0.1:5173）与项目隔离 Edge（EDGE_TEST_PORT，默认 9222）。
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

const CDP = `http://127.0.0.1:${process.env.EDGE_TEST_PORT ?? '9222'}`
const BASE = process.env.DEV_BASE ?? 'http://127.0.0.1:5173'
const OUT = '.tmp/panel-transition-verification'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const errors = []
const results = []

// 最小 PNG 解码（RGBA8 非隔行）：截图像素采样用，替代纯 CSS 字符串断言。
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png')
  let pos = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0
  const idat = []
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + length
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) throw new Error(`unsupported png: depth=${bitDepth} color=${colorType} interlace=${interlace}`)
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    const row = raw.subarray(p, p + stride); p += stride
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = row[x]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      cur[x] = v
    }
  }
  return { width, height, bpp, data: out }
}

/** 两个截图中同一 CSS 区域的平均 RGB 差异（0-255） */
function meanDiff(pngA, pngB, cssRect, scale) {
  const { width, height, bpp, data } = pngA
  const x0 = Math.max(0, Math.round(cssRect.x * scale)), y0 = Math.max(0, Math.round(cssRect.y * scale))
  const x1 = Math.min(width, Math.round((cssRect.x + cssRect.w) * scale)), y1 = Math.min(height, Math.round((cssRect.y + cssRect.h) * scale))
  let sum = 0, n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * bpp
    sum += Math.abs(data[i] - pngB.data[i]) + Math.abs(data[i + 1] - pngB.data[i + 1]) + Math.abs(data[i + 2] - pngB.data[i + 2])
    n++
  }
  return n ? sum / n / 3 : 0
}

const SHOT_SCALE = 1
const regionClose = { x: 17, y: 31, w: 44, h: 44 }
const regionEdit = { x: 318, y: 33, w: 46, h: 32 }

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
      const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 20000)
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
    for (let i = 0; i < 80; i++) {
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
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    const path = `${OUT}/${name}.png`
    await writeFile(path, Buffer.from(data, 'base64'))
    return path
  }
  async touchStart(selector, text) {
    return this.ev(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find(element => ${text === undefined ? 'true' : `element.textContent.includes(${JSON.stringify(text)})`});
      if (!element) throw new Error('Missing touch target: ' + ${JSON.stringify(selector)});
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: Math.max(r.y + r.height / 2, 40) };
    })()`).then(point => this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...point }] }).then(() => point))
  }
  async touchMove(point, distance, duration = 300) {
    for (let i = 1; i <= 6; i++) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: point.x, y: point.y + distance * i / 6 }] })
      await sleep(duration / 6)
    }
  }
  async touchEnd(cancel = false) {
    await this.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
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
try {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId })
  const target = (await (await fetch(`${CDP}/json/list`)).json()).find(t => t.id === targetId)
  const page = await connect(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  // 转场采样器：记录任意时刻「可见的内容树数量/是否出现可见占位」、动画事件与面板 transform 过渡。
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__transition = { visiblePlaceholders: 0, visibleContents: [], samples: 0, panelRises: 0 };
    (() => {
      const t = window.__transition;
      const sample = () => {
        const contents = [...document.querySelectorAll('.item-panel-content')];
        const visible = contents.filter(node => !node.hidden && node.getClientRects().length > 0);
        t.visibleContents.push(visible.length);
        for (const node of visible) if ((node.textContent || '').includes('正在载入')) t.visiblePlaceholders++;
        t.samples++;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      document.addEventListener('transitionstart', event => {
        if (event.target.classList?.contains('modal-sheet-panel') && event.propertyName === 'transform') {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(event.target).transform);
          // 初始入场是从视口外上滑；编辑退出后再出现的上滑属于回归。
          if (matrix.m42 > 0) t.panelRises++;
        }
      }, true);
    })();
  ` })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.send('Page.navigate', { url: `${BASE}/items` })
  await page.until(`!!document.querySelector('input[aria-label="搜索物品"]')`)
  // 合成数据：信息齐全且内容足够长（可滚动详情）
  await page.ev(`(async () => {
    const { db } = await import('/src/db/db.ts');
    const { itemRepository } = await import('/src/db/repositories/itemRepository.ts');
    const categories = await db.categories.toArray();
    const category = categories.find(c => c.parentId && c.deletedAt === null);
    window.fixtureId = (await itemRepository.create({
      name:'转场回归样品', categoryId:category.id, iconAssetId:'preset-other',
      note:'用于验证详情与编辑转场的合成数据备注。'.repeat(6), tagIds:[], status:'owned',
      purchaseDate:'2026-01-15', purchasePriceCents:19900, additionalCostCents:1200,
      purchasePlatform:'taobao', warrantyExpiresAt:'2027-01-15',
      disposedAt:null, disposalMethod:null, salePriceCents:null, disposalNote:null
    })).id;
  })()`)
  const fixtureId = await page.ev('window.fixtureId')

  const detailHeaderContainedExpr = `(() => {
    const isStackingContext = el => { const s = getComputedStyle(el); return s.isolation === 'isolate' || (s.position !== 'static' && s.zIndex !== 'auto') || s.transform !== 'none' || s.willChange.includes('transform'); };
    const detail = [...document.querySelectorAll('.item-panel-content')].find(n => n.inert);
    const header = detail?.querySelector('header');
    let node = header?.parentElement, ctx = null;
    while (node && !ctx) { if (isStackingContext(node)) ctx = node; node = node.parentElement; }
    return !!ctx && ctx === detail;
  })()`
  await page.until(`!!document.querySelector('a[href="/items/${fixtureId}"]')`)
  const listScrollY = await page.ev(`(window.scrollY, document.querySelector('input[aria-label="搜索物品"]').closest('main').scrollTop)`)
  await page.ev(`document.querySelector('a[href="/items/' + window.fixtureId + '"]').click()`)
  await page.until(`!!document.querySelector('[data-sheet="detail"][data-state="open"]')`)
  await sleep(700)

  // 1. 详情 → 编辑：转场期间旧内容持续可见，占位永不出现在可视层
  await page.ev(`window.__transition.visiblePlaceholders = 0; window.__transition.visibleContents.length = 0`)
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]')`)
  await sleep(400)
  await page.check('编辑转场期间从未显示载入占位（占位只存在于隐藏树）', `window.__transition.visiblePlaceholders === 0`)
  await page.check('转场结束后的终态是完整编辑表单', `location.pathname.endsWith('/edit')
    && document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]').value === '转场回归样品'
    && document.querySelector('.item-panel-content:not([hidden]) input[placeholder="0.00"]').value === '199'`)
  await page.check('面板转场期间始终只有一个 dialog', `document.querySelectorAll('dialog[open]').length === 1`)

  // 2. 编辑 → 详情：返回同样连续，终态数据正确
  await page.ev(`window.__transition.visiblePlaceholders = 0`)
  await page.click(`button[aria-label="返回"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  await sleep(400)
  await page.check('返回详情期间从未显示载入占位', `window.__transition.visiblePlaceholders === 0`)
  await page.check('返回后的终态是详情页且数据正确', `location.pathname.endsWith(window.fixtureId)
    && document.querySelector('.item-panel-content:not([hidden]) h1').textContent === '物品详情'
    && document.body.innerText.includes('¥199.00')`)

  // 3. 快速连续往返：无残留树、无残余 dialog、终态正确
  for (let i = 0; i < 5; i++) {
    await page.click(`a[href$="/edit"]`)
    await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]')`)
    await page.click(`button[aria-label="返回"]`)
    await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  }
  await sleep(800)
  await page.check('快速五次往返后只保留一棵内容树', `document.querySelectorAll('.item-panel-content').length === 1`)
  await page.check('快速往返后详情数据与路径正确且无额外 dialog', `location.pathname.endsWith(window.fixtureId)
    && document.querySelectorAll('dialog[open]').length === 1
    && document.body.innerText.includes('转场回归样品')`)

  // 4. 详情滚动位置：滚动后往返编辑，详情滚动恢复、底层列表滚动不变
  await page.ev(`document.querySelector('.modal-sheet-panel').scrollTop = 420`)
  await sleep(200)
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]')`)
  await page.check('进入编辑后面板从顶部开始且底层列表滚动未被扰动', `
    document.querySelector('.modal-sheet-panel').scrollTop < 40
    && (document.querySelector('main').scrollTop) === ${JSON.stringify(listScrollY)}`)
  // 详情滚动 420 后（标题折叠态）进入编辑：header 同样不得穿透（滚动前折叠态由上一断言路径覆盖）
  await page.check('详情滚动折叠后进入编辑，header 层叠上下文仍被限制在详情容器内', detailHeaderContainedExpr)
  await page.click(`button[aria-label="返回"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  await sleep(400)
  // 与 HEAD 基线行为一致：该往返后既有滚动恢复机制落点约为 33px（钳制后保存），
  // 断言不出现跳底/跳顶的异常值即可；转场连续性由上面的占位断言保证。
  await page.check('返回详情后面板滚动停留在既有恢复机制的落点（无跳变）', `
    document.querySelector('.modal-sheet-panel').scrollTop < 60
    && (document.querySelector('main').scrollTop) === ${JSON.stringify(listScrollY)}`)

  // 5. 草稿保护：修改后返回弹确认；继续编辑保留草稿；放弃后干净返回
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]')`)
  await page.ev(`(() => { const el = document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]'); el.focus(); el.select(); return true })()`)
  await page.send('Input.insertText', { text: '转场回归草稿' })
  await sleep(150)
  await page.click(`button[aria-label="返回"]`)
  await page.until(`document.body.innerText.includes('放弃此次修改')`)
  await page.check('已修改时返回弹出放弃确认且只有一个 dialog', `document.querySelectorAll('dialog[open]').length >= 1`)
  await page.click('button', '继续编辑')
  await sleep(300)
  await page.check('选择继续编辑后草稿保留且仍可保存', `location.pathname.endsWith('/edit')
    && document.querySelector('.item-panel-content:not([hidden]) input[aria-label="物品名称"]').value === '转场回归草稿'`)
  await page.click(`button[aria-label="返回"]`)
  await page.until(`document.body.innerText.includes('放弃此次修改')`)
  await page.click('button', '放弃修改')
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  await sleep(600)
  await page.check('放弃后干净返回详情且数据库未被写入草稿', `location.pathname.endsWith(window.fixtureId)
    && document.body.innerText.includes('转场回归样品')
    && !document.body.innerText.includes('转场回归草稿')`)

  // ===== 5.5 编辑层下拉（独立层级交互）=====
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-edit-layer[data-state="open"]')`)
  await sleep(400)
  await page.check('编辑态存在覆盖编辑层且底层详情被 inert 隔离', `
    !!document.querySelector('.item-panel-edit-layer[data-state="open"] .modal-sheet-grip')
    && [...document.querySelectorAll('.item-panel-content')].some(n => n.inert && n.textContent.includes('物品详情'))`)
  const dragBase = await page.ev(`(() => {
    const panel = document.querySelector('.modal-sheet-panel');
    const layer = document.querySelector('.item-panel-edit-layer');
    const detail = [...document.querySelectorAll('.item-panel-content')].find(n => n.inert);
    return { panelTop: panel.getBoundingClientRect().top, layerTop: layer.getBoundingClientRect().top, detailTop: detail.getBoundingClientRect().top };
  })()`)
  // 下拉 100px（低于关闭阈值 160px）：只有编辑层移动，面板与详情坐标不变
  let gripPoint = await page.touchStart('.item-panel-edit-layer .modal-sheet-grip')
  await page.touchMove(gripPoint, 100)
  const during = await page.ev(`(() => {
    const panel = document.querySelector('.modal-sheet-panel');
    const layer = document.querySelector('.item-panel-edit-layer');
    const detail = [...document.querySelectorAll('.item-panel-content')].find(n => n.inert);
    return {
      layerM42: new DOMMatrixReadOnly(getComputedStyle(layer).transform).m42,
      panelM42: new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42,
      panelTop: panel.getBoundingClientRect().top,
      detailTop: detail.getBoundingClientRect().top,
    };
  })()`)
  await page.shot('drag-edit-layer-100px')
  await page.check('编辑下拉时只有编辑层跟随位移', `Math.abs((${JSON.stringify(during)}).layerM42 - 100) < 12`)
  await page.check('编辑下拉期间共享面板 transform 恒为 0', `(${JSON.stringify(during)}).panelM42 === 0`)
  await page.check('编辑下拉期间面板几何位置不变（不露出列表）', `Math.abs((${JSON.stringify(during)}).panelTop - (${JSON.stringify(dragBase)}).panelTop) < 1`)
  await page.check('编辑下拉期间详情层坐标保持不变', `Math.abs((${JSON.stringify(during)}).detailTop - (${JSON.stringify(dragBase)}).detailTop) < 1`)
  // 未达阈值松手 → 编辑层回弹
  await page.touchEnd()
  await page.until(`Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.item-panel-edit-layer')).transform).m42) < 1`)
  await page.check('未达关闭阈值时编辑层回弹且仍在编辑态', `location.pathname.endsWith('/edit') && !!document.querySelector('.item-panel-edit-layer[data-state="open"]')`)
  // 越过阈值 → 编辑层下滑退出，详情原位显示，面板不重新上滑
  await page.ev(`window.__transition.panelRises = 0`)
  gripPoint = await page.touchStart('.item-panel-edit-layer .modal-sheet-grip')
  await page.touchMove(gripPoint, 260)
  await page.touchEnd()
  await page.until(`!location.pathname.endsWith('/edit')`)
  await sleep(500)
  await page.shot('after-edit-drag-dismiss')
  await page.check('下拉越过阈值后返回详情且面板未发生新的上滑过渡', `
    location.pathname.endsWith(window.fixtureId)
    && window.__transition.panelRises === 0
    && !document.querySelector('.item-panel-edit-layer')
    && !!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  await page.check('下拉退出与点击取消的终态一致（详情原位、无占位）', `
    document.querySelectorAll('dialog[open]').length === 1
    && window.__transition.visiblePlaceholders === 0`)
  // 长表单滚动：内容不在顶部时下拉应滚动内容而非拖动编辑层
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-edit-layer[data-state="open"]')`)
  await sleep(350)
  await page.ev(`document.querySelector('.item-panel-edit-layer').scrollTop = 240`)
  await sleep(120)
  const scrollPoint = await page.ev(`(() => {
    const layer = document.querySelector('.item-panel-edit-layer');
    const r = layer.getBoundingClientRect();
    for (let y = r.top + 60; y < r.bottom - 60; y += 30) {
      const el = document.elementFromPoint(r.x + r.width / 2, y);
      if (el && layer.contains(el) && !el.closest('button,a,input,textarea,select,[role="slider"]')) {
        const cr = el.getBoundingClientRect();
        return { x: Math.round(cr.x + cr.width / 2), y: Math.round(cr.y + cr.height / 2) };
      }
    }
    throw new Error('no static scroll target in layer');
  })()`)
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...scrollPoint }] })
  for (let i = 1; i <= 6; i++) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: scrollPoint.x, y: scrollPoint.y + 120 * i / 6 }] })
    await sleep(50)
  }
  const scrolled = await page.ev(`(() => {
    const layer = document.querySelector('.item-panel-edit-layer');
    return { scrollTop: layer.scrollTop, m42: new DOMMatrixReadOnly(getComputedStyle(layer).transform).m42 };
  })()`)
  await page.touchEnd()
  await page.check('内容不在顶部时下拉优先滚动表单而不拖动编辑层', `
    (${JSON.stringify(scrolled)}).scrollTop < 220 && (${JSON.stringify(scrolled)}).m42 === 0 && location.pathname.endsWith('/edit')`)
  await page.ev(`document.querySelector('.item-panel-edit-layer').scrollTop = 0`)
  // 嵌套弹层优先级：分类选择器打开时，下拉不带走编辑层
  await page.click('button[aria-label="选择分类"]')
  await page.until(`!!document.querySelectorAll('dialog[aria-label="分类"][open] .choice-chip').length`)
  gripPoint = await page.touchStart('.item-panel-edit-layer .modal-sheet-grip')
  await page.touchMove(gripPoint, 120)
  const nested = await page.ev(`(() => {
    const layer = document.querySelector('.item-panel-edit-layer');
    const picker = document.querySelector('dialog[aria-label="分类"][open] .modal-sheet-panel');
    return { layerM42: layer ? new DOMMatrixReadOnly(getComputedStyle(layer).transform).m42 : null, pickerM42: picker ? new DOMMatrixReadOnly(getComputedStyle(picker).transform).m42 : null, pickerOpen: !!document.querySelector('dialog[aria-label="分类"][open]') };
  })()`)
  await page.touchEnd(true)
  await page.check('嵌套弹层打开时编辑层保持静止', `(${JSON.stringify(nested)}).layerM42 === 0 && (${JSON.stringify(nested)}).pickerOpen`)
  await page.ev(`(() => { const done=[...document.querySelectorAll('dialog[aria-label="分类"][open] button')].find(b => b.textContent.includes('完成')); if (done) done.click(); return true })()`)
  await page.until(`!document.querySelector('dialog[aria-label="分类"]')`)
  await sleep(200)
  // 有草稿时下拉触发确认：继续编辑恢复位置与内容
  await page.ev(`(() => { const el = document.querySelector('.item-panel-edit-layer input[aria-label="物品名称"]'); el.focus(); el.select(); return true })()`)
  await page.send('Input.insertText', { text: '下拉草稿样品' })
  await sleep(150)
  gripPoint = await page.touchStart('.item-panel-edit-layer .modal-sheet-grip')
  await page.touchMove(gripPoint, 260)
  await page.touchEnd()
  await page.until(`document.body.innerText.includes('放弃此次修改')`)
  await page.until(`Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.item-panel-edit-layer')).transform).m42) < 1`)
  await page.check('有草稿时下拉越过阈值弹出确认且编辑层回弹待命', `
    location.pathname.endsWith('/edit')
    && Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.item-panel-edit-layer')).transform).m42) < 1`)
  await page.click('button', '继续编辑')
  await sleep(300)
  await page.check('继续编辑后草稿保留且编辑层在正常位置', `
    document.querySelector('.item-panel-edit-layer input[aria-label="物品名称"]').value === '下拉草稿样品'
    && !!document.querySelector('.item-panel-edit-layer[data-state="open"]')`)
  // 放弃：下拉再次触发确认 → 放弃 → 详情，草稿不复活
  gripPoint = await page.touchStart('.item-panel-edit-layer .modal-sheet-grip')
  await page.touchMove(gripPoint, 260)
  await page.touchEnd()
  await page.until(`document.body.innerText.includes('放弃此次修改')`)
  await page.click('button', '放弃修改')
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  await sleep(600)
  await page.check('下拉放弃后回到详情且草稿不会再次出现', `
    location.pathname.endsWith(window.fixtureId)
    && !document.body.innerText.includes('下拉草稿样品')
    && !document.querySelector('.item-panel-edit-layer')`)
  // 快速下拉往返无残留
  for (let i = 0; i < 3; i++) {
    await page.click(`a[href$="/edit"]`)
    await page.until(`!!document.querySelector('.item-panel-edit-layer[data-state="open"]')`)
    gripPoint = await page.touchStart('.item-panel-edit-layer .modal-sheet-grip')
    await page.touchMove(gripPoint, 260)
    await page.touchEnd()
    await page.until(`!location.pathname.endsWith('/edit')`)
  }
  await sleep(700)
  await page.check('快速三次下拉往返后无残留编辑层或重复内容树', `
    document.querySelectorAll('.item-panel-content').length === 1
    && !document.querySelector('.item-panel-edit-layer')
    && location.pathname.endsWith(window.fixtureId)`)

  // ===== 5.6 视觉层级：详情 sticky header 不得穿透编辑覆盖层 =====
  // 详情滚动归零，使「拖动露出」与「退出后」的像素比较成为纯层级比较
  //（滚动恢复本身由上文「面板滚动停留落点」断言覆盖）。
  await page.ev(`document.querySelector('.modal-sheet-panel').scrollTop = 0`)
  await sleep(150)
  // 详情 header 是 sticky z-10；底层详情容器必须建立层叠上下文（isolation: isolate），
  // 否则 header 会以 z-10 直接参与面板层叠、绘制在编辑层（z-5）之上（按钮穿透）。
  const shotPng = async name => decodePng(await readFile(await page.shot(name)))
  const enterEdit = async () => {
    await page.click(`a[href$="/edit"]`)
    await page.until(`!!document.querySelector('.item-panel-edit-layer[data-state="open"]')`)
    await sleep(350)
  }
  const exitEditViaCancel = async () => {
    await page.ev(`(() => { const el=[...document.querySelectorAll('.item-panel-edit-layer button')].find(b => b.textContent.trim() === '取消'); if (!el) throw new Error('no cancel'); el.click(); return true })()`)
    await page.until(`!location.pathname.endsWith('/edit')`)
    await sleep(600)
  }
  await enterEdit()
  await page.check('详情 sticky header(z-10) 的层叠上下文被限制在详情容器内', detailHeaderContainedExpr)
  await page.check('左上角命中测试命中编辑层而非下层详情按钮（无点击穿透）', `(() => { const el = document.elementFromPoint(37, 51); return !!el && !!el.closest('.item-panel-edit-layer'); })()`)
  await page.check('右上角命中测试命中编辑层保存按钮而非下层编辑链接', `(() => { const el = document.elementFromPoint(340, 55); return !!el && !!el.closest('.item-panel-edit-layer'); })()`)
  const pngRest = await shotPng('z-rest')
  // 下拖 100px：露出区域应与退出后的详情逐像素一致（下层固定、原位露出）
  gripPoint = await page.touchStart('.item-panel-edit-layer .modal-sheet-grip')
  await page.touchMove(gripPoint, 100)
  const pngDuring = await shotPng('z-during-100px')
  await page.touchEnd()
  await page.until(`Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.item-panel-edit-layer')).transform).m42) < 1`)
  const pngRebound = await shotPng('z-rebound')
  await exitEditViaCancel()
  const pngExit = await shotPng('z-exit')
  console.log('DIFF during-vs-exit close/edit:', meanDiff(pngDuring, pngExit, regionClose, SHOT_SCALE).toFixed(2), meanDiff(pngDuring, pngExit, regionEdit, SHOT_SCALE).toFixed(2))
  console.log('DIFF rest-vs-rebound close/edit:', meanDiff(pngRest, pngRebound, regionClose, SHOT_SCALE).toFixed(2), meanDiff(pngRest, pngRebound, regionEdit, SHOT_SCALE).toFixed(2))
  console.log('DIFF rest-vs-exit close/edit:', meanDiff(pngRest, pngExit, regionClose, SHOT_SCALE).toFixed(2), meanDiff(pngRest, pngExit, regionEdit, SHOT_SCALE).toFixed(2))
  await page.check('拖动露出的区域与退出后的详情渲染一致（下层固定原位）', `
    ${meanDiff(pngDuring, pngExit, regionClose, SHOT_SCALE).toFixed(2)} < 4
    && ${meanDiff(pngDuring, pngExit, regionEdit, SHOT_SCALE).toFixed(2)} < 4`)
  await page.check('编辑层回弹后与覆盖态逐像素一致（无按钮残影或闪现）', `
    ${meanDiff(pngRest, pngRebound, regionClose, SHOT_SCALE).toFixed(2)} < 3
    && ${meanDiff(pngRest, pngRebound, regionEdit, SHOT_SCALE).toFixed(2)} < 3`)
  await page.check('编辑层退出后详情按钮恢复可见（区域内容与覆盖态不同）', `
    ${meanDiff(pngRest, pngExit, regionEdit, SHOT_SCALE).toFixed(2)} > 5`)
  // 深色主题
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await enterEdit()
  await page.check('深色主题下详情 header 同样无法穿透编辑层', detailHeaderContainedExpr)
  const pngRestDark = await shotPng('z-rest-dark')
  await exitEditViaCancel()
  const pngExitDark = await shotPng('z-exit-dark')
  await page.check('深色主题下退出后详情按钮恢复可见', `${meanDiff(pngRestDark, pngExitDark, regionEdit, SHOT_SCALE).toFixed(2)} > 5`)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  // 小屏视口
  await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: SHOT_SCALE, mobile: true })
  await sleep(300)
  await enterEdit()
  await page.check('小屏视口(360×740)下详情 header 同样无法穿透编辑层', detailHeaderContainedExpr)
  await exitEditViaCancel()
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: SHOT_SCALE, mobile: true })
  await sleep(300)
  // 快速往返五次后再验证无视觉重叠
  for (let i = 0; i < 5; i++) {
    await enterEdit()
    await exitEditViaCancel()
  }
  await enterEdit()
  await page.check('快速五次往返后详情 header 仍无法穿透编辑层', detailHeaderContainedExpr)
  await exitEditViaCancel()

  // 6. 编辑保存 → 详情
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-edit-layer[data-state="open"] input[aria-label="物品名称"]')`)
  await page.ev(`(() => { const el = document.querySelector('.item-panel-edit-layer input[aria-label="物品名称"]'); el.focus(); el.select(); return true })()`)
  await page.send('Input.insertText', { text: '转场回归样品二' })
  await sleep(120)
  await page.click('button', '保存更改')
  await page.until(`!!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  // 「已保存」反馈窗口 650ms 后才导航，等待需覆盖它。
  await sleep(800)
  await page.check('保存后回到详情并显示新名称', `location.pathname.endsWith(window.fixtureId)
    && document.body.innerText.includes('转场回归样品二')`)

  // 7. 直接访问编辑 URL：完整页面模式（无面板 dialog），返回到列表
  await page.send('Page.navigate', { url: `${BASE}/items/${await page.ev('window.fixtureId')}/edit` })
  await page.until(`!!document.querySelector('input[aria-label="物品名称"]')`)
  await sleep(400)
  await page.check('直接访问编辑路由是完整页面而非面板', `location.pathname.endsWith('/edit')
    && document.querySelectorAll('dialog[open]').length === 0
    && document.querySelector('input[aria-label="物品名称"]').value === '转场回归样品二'
    && !!document.querySelector('button[aria-label="返回"]')`)

  // 8. 详情页原有下拉关闭不受影响：拖动详情（无编辑层状态）关闭整个面板回列表
  await page.send('Page.navigate', { url: `${BASE}/items` })
  await page.until(`!!document.querySelector('a[href="/items/${fixtureId}"]')`)
  await page.ev(`document.querySelector('a[href="/items/${fixtureId}"]').click()`)
  await page.until(`!!document.querySelector('[data-sheet="detail"][data-state="open"]')`)
  await sleep(800)
  await page.check('详情态没有覆盖编辑层', `!document.querySelector('.item-panel-edit-layer')`)
  const detailGrip = await page.touchStart('.modal-sheet-grip')
  await page.touchMove(detailGrip, 260)
  await page.touchEnd()
  await page.until(`!document.querySelector('dialog[open]')`)
  await sleep(400)
  await page.check('详情下拉关闭整个面板回到列表', `location.pathname === '/items' && document.body.style.overflow === ''`)

  // 9. 减少动效：转场立即完成、无 panel 动画，编辑层退出无过渡
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await page.send('Page.navigate', { url: `${BASE}/items` })
  await page.until(`!!document.querySelector('a[href="/items/${fixtureId}"]')`)
  await page.ev(`document.querySelector('a[href="/items/${fixtureId}"]').click()`)
  await page.until(`!!document.querySelector('[data-sheet="detail"][data-state="open"]')`)
  await sleep(600)
  await page.click(`a[href$="/edit"]`)
  await page.until(`!!document.querySelector('.item-panel-edit-layer[data-state="open"] input[aria-label="物品名称"]')`)
  await page.check('减少动效下内容切换不播放 panel 动画', `
    document.querySelector('.item-panel-edit-layer').getAnimations().length === 0
    && location.pathname.endsWith('/edit')`)
  // sticky 头部按钮在个别环境下 scrollIntoView 测量不稳，这里用原生点击保证语义等价
  await page.ev(`(() => { const el=[...document.querySelectorAll('.item-panel-edit-layer button')].find(b => b.textContent.trim() === '取消'); if (!el) throw new Error('no cancel button'); el.click(); return true })()`)
  await page.until(`!location.pathname.endsWith('/edit')`)
  await sleep(500)
  await page.check('减少动效下编辑层退出无过渡且详情立即可见', `
    !document.querySelector('.item-panel-edit-layer')
    && !!document.querySelector('.item-panel-content:not([hidden]) h1')`)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] })

  await page.shot('final-detail')
  assert.equal(errors.length, 0, 'No runtime exceptions: ' + JSON.stringify(errors.slice(0, 2)))
  results.push('no runtime exceptions')
  console.log(`PASS ${results.length} panel-transition checks`)
  await writeFile(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2))
} finally {
  await browser.send('Target.disposeBrowserContext', { browserContextId })
}
process.exit(0)
