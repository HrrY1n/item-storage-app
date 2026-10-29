import { createIsolatedPage } from './cdp.mjs'
import { captureCall, releaseCall, samplerSource, stillsCall } from './sampler.mjs'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export class MotionPage {
  constructor(context, baseUrl) {
    this.browser = context.browser
    this.session = context.page
    this.disposeContext = context.dispose
    this.requests = context.requests
    this.blocked = context.blocked
    this.policy = context.policy
    this.baseUrl = baseUrl
    this.media = { reduced: false, color: 'light' }
  }
  get exceptions() { return this.session.exceptions }
  ev(expression, options) { return this.session.ev(expression, options) }
  until(expression, options) { return this.session.until(expression, options) }
  async setViewport({ width = 390, height = 844, dpr = 2, mobile = true }) {
    await this.session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile })
    this.viewport = { width, height, dpr, mobile }
  }
  async applyMedia() {
    await this.session.send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-reduced-motion', value: this.media.reduced ? 'reduce' : 'no-preference' },
      { name: 'prefers-color-scheme', value: this.media.color },
    ] })
  }
  async setReducedMotion(enabled) { this.media.reduced = enabled; await this.applyMedia() }
  async setColorScheme(color) { this.media.color = color; await this.applyMedia() }
  async goto(pathName, { waitSelector, timeoutMs = 30000 } = {}) {
    const url = new URL(pathName, this.baseUrl)
    if (url.origin !== this.baseUrl) throw new Error('Refusing navigation outside owned origin')
    await this.session.send('Page.navigate', { url: url.href })
    if (waitSelector) await this.until('!!document.querySelector(' + JSON.stringify(waitSelector) + ')', { timeoutMs })
    if (this.blocked.length) throw new Error('Network policy rejected a request')
  }
  async seedItems(count, { prefix = '动效样品', warranty = false } = {}) {
    return this.ev(`(async () => {
      const {db} = await import('/src/db/db.ts');
      const {itemRepository} = await import('/src/db/repositories/itemRepository.ts');
      const categories = await db.categories.toArray();
      const category = categories.find(c => c.parentId && c.deletedAt === null);
      if (!category) throw new Error('no leaf category available for seeding');
      const ids = [];
      for (let i = 0; i < ${count}; i++) {
        const created = await itemRepository.create({
          name: ${JSON.stringify(prefix)} + ' ' + String(i + 1).padStart(2, '0'),
          categoryId: category.id,
          iconAssetId: 'preset-other',
          note: 'MotionLab 合成数据，无真实物品',
          tagIds: [],
          status: 'owned',
          purchaseDate: '2026-01-15',
          purchasePriceCents: 19900 + i * 100,
          additionalCostCents: i % 3 === 0 ? 2500 : null,
          purchasePlatform: '官方商城',
          ${warranty ? "warrantyExpiresAt: '2027-01-15'," : 'warrantyExpiresAt: null,'}
          disposedAt: null, disposalMethod: null, salePriceCents: null, disposalNote: null,
        });
        ids.push(created.id);
      }
      return ids;
    })()`)
  }


  async prepareClick(selector, { nth = 0, text } = {}) {
    const selection = '([...document.querySelectorAll(' + JSON.stringify(selector) + ')]' +
      (text ? '.filter(el => el.textContent.trim() === ' + JSON.stringify(text) + ')' : '') + ')[' + nth + ']'
    await this.ev('(() => {const el=' + selection + ';if(!el)throw new Error("Missing click target");el.scrollIntoView({block:"center",behavior:"instant"});return true})()')
    await this.waitAnimationsIdle()
    return this.ev('(async()=>{const el=' + selection + ';if(!el||!el.isConnected||el.disabled||el.closest("[inert]"))throw new Error("Target not actionable");' +
      'await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));' +
      'const a=el.getBoundingClientRect();await new Promise(requestAnimationFrame);const b=el.getBoundingClientRect();' +
      'if(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)>0.5)throw new Error("Target moving");' +
      'const l=Math.max(0,b.left),r=Math.min(innerWidth,b.right),t=Math.max(0,b.top),d=Math.min(innerHeight,b.bottom);' +
      'for(const fy of [.5,.2,.8])for(const fx of [.5,.2,.8]){const x=l+(r-l)*fx,y=t+(d-t)*fy,hit=document.elementFromPoint(x,y);if(r>l&&d>t&&hit&&(hit===el||el.contains(hit)))return {x,y}}' +
      'throw new Error("Target blocked or outside viewport")})()')
  }
  async dispatchClick(point) {
    await this.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await this.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await sleep(40) // A real press phase lets :active participate in the sampled interaction.
    await this.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  async click(selector, options) { await this.dispatchClick(await this.prepareClick(selector, options)) }
  /** 合成真实触摸拖动：touchStart → 分步 touchMove（可带步间延时）→ touchEnd。 */
  async dispatchTouchDrag({ from, steps, holdMs = 0 }) {
    const [x, y] = from
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await sleep(30)
    for (const [dx, dy, ms] of steps) {
      await this.session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] })
      if (ms) await sleep(ms)
    }
    if (holdMs) await sleep(holdMs)
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  /** 合成触摸拖动中途取消（pointercancel/touchcancel 路径）。 */
  async dispatchTouchCancel({ from, steps }) {
    const [x, y] = from
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await sleep(30)
    for (const [dx, dy, ms] of steps) {
      await this.session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] })
      if (ms) await sleep(ms)
    }
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  }
  /** 手势场景专用采集：armed → trigger → 真实 CDP 触摸拖动 → 采样收尾。 */
  async captureGesture({ drag, ...config }) {
    await this.beforeCapture?.(config, this)
    await this.ev(captureCall(config))
    await this.until('window.__ml.armed')
    await this.ev('window.__ml.trigger()')
    const sentAt = { epochMs: Date.now(), perfMs: Math.round(performance.now()) }
    try {
      await this.dispatchTouchDrag(drag)
      const record = await this.ev('window.__ml.result()')
      record.input = { type: 'CDP touch drag', sentAt, ...drag }
      this.lastRecord = record
      if (this.blocked.length || this.session.errors.length) throw new Error('Capture network/CDP policy error')
      return record
    } catch (error) {
      try { await this.ev('window.__ml.cancel()'); this.lastRecord = await this.ev('window.__ml.partial()') } catch {}
      throw error
    }
  }
  /** 多击序列采集：armed → trigger → 按延时依次真实 CDP 点击 → 采样收尾。 */
  async captureSequence({ clicks, ...config }) {
    if (!clicks?.length) throw new Error('captureSequence requires prepared click points')
    await this.beforeCapture?.(config, this)
    await this.ev(captureCall(config))
    await this.until('window.__ml.armed')
    await this.ev('window.__ml.trigger()')
    const sentAt = { epochMs: Date.now(), perfMs: Math.round(performance.now()) }
    try {
      for (const { point, afterMs = 0 } of clicks) {
        if (afterMs) await sleep(afterMs)
        await this.dispatchClick(point)
      }
      const record = await this.ev('window.__ml.result()')
      record.input = { type: 'CDP mouse sequence', sentAt, clickCount: clicks.length }
      this.lastRecord = record
      if (this.blocked.length || this.session.errors.length) throw new Error('Capture network/CDP policy error')
      return record
    } catch (error) {
      try { await this.ev('window.__ml.cancel()'); this.lastRecord = await this.ev('window.__ml.partial()') } catch {}
      throw error
    }
  }
  async typeText(selector, text) {
    await this.click(selector)
    const before = await this.ev('document.querySelector(' + JSON.stringify(selector) + ').value')
    for (const type of ['keyDown', 'keyUp']) await this.session.send('Input.dispatchKeyEvent',
      { type, key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    await this.session.send('Input.insertText', { text })
    const value = await this.ev('document.querySelector(' + JSON.stringify(selector) + ').value')
    if (value !== before + text) throw new Error('Input did not accept appended text')
    return value
  }
  async pressEscape() {
    for (const type of ['keyDown', 'keyUp']) await this.session.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }
  async screenshot(name) {
    const { data } = await this.session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, optimizeForSpeed: true })
    return { name, data }
  }
  async waitAnimationsIdle({ timeoutMs = 6000, targets } = {}) {
    await this.ev('document.fonts.ready.then(()=>true)')
    await this.ev('Promise.all([...document.images].filter(img=>{const r=img.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.width>0}).map(img=>img.decode())).then(()=>true)')
    const selector = targets?.length ? targets.map(t => t.sel).join(',') : null
    const expression = selector ?
      '[...document.querySelectorAll(' + JSON.stringify(selector) + ')].flatMap(el=>el.getAnimations({subtree:true}))' : 'document.getAnimations()'
    try {
      await this.until('(' + expression + ').every(a=>!a.pending&&a.playState!=="running")', { timeoutMs })
    } catch (error) {
      this.waitFailure = await this.ev('({themeShift:document.documentElement.classList.contains("theme-shift"),animations:document.getAnimations().map(a=>({state:a.playState,pending:a.pending,property:a.transitionProperty||a.animationName,duration:a.effect?.getComputedTiming().duration}))})')
      throw error
    }
    return true
  }
  async capture({ click, clickOptions, ...config }) {
    if (!click || config.trigger) throw new Error('Capture requires a real CDP click selector')
    await this.beforeCapture?.(config, this)
    const point = await this.prepareClick(click, clickOptions)
    await this.ev(captureCall(config))
    await this.until('window.__ml.armed')
    await this.ev('window.__ml.trigger()')
    const sentAt = { epochMs: Date.now(), perfMs: Math.round(performance.now()) }
    try {
      await this.dispatchClick(point)
      const record = await this.ev('window.__ml.result()')
      record.input = { type: 'CDP mouse', pressMs: 40, point, sentAt }
      this.lastRecord = record
      if (this.blocked.length || this.session.errors.length) throw new Error('Capture network/CDP policy error')
      return record
    } catch (error) {
      try { await this.ev('window.__ml.cancel()'); this.lastRecord = await this.ev('window.__ml.partial()') } catch {}
      throw error
    }
  }
  async stillShot(name, { click, clickOptions, ...config }) {
    if (!click || config.trigger) throw new Error('Still requires a real CDP click selector')
    await this.beforeStill?.(config, this)
    const point = await this.prepareClick(click, clickOptions)
    await this.ev('window.__mlStill = ' + stillsCall(config) + '; true')
    await this.dispatchClick(point)
    const still = await this.ev('window.__mlStill')
    try {
      const screenshotStart = performance.now()
      const shot = await this.screenshot(name)
      still.screenshotWallMs = Math.round(performance.now() - screenshotStart)
      if (still.status === 'PASS') {
        const now = await this.ev('window.__ml.describe(' + JSON.stringify(config.matchSel) + ')')
        still.afterScreenshot = now
        if (!now || now.id !== still.elementId || ['tx','ty','w','h','o','lum'].some(key =>
          Number.isFinite(now[key]) && Number.isFinite(still.frozen[key]) &&
          Math.abs(now[key] - still.frozen[key]) > (['o','lum'].includes(key) ? .02 : .5))) {
          still.status = 'INCONCLUSIVE'
          still.note = 'frozen-target-changed-before-screenshot'
        }
      }
      return { ...shot, still }
    } finally { await this.ev(releaseCall()); await this.waitAnimationsIdle() }
  }
}
export async function openMotionPage({ cdpBase, baseUrl, verifyOwnership }) {
  const context = await createIsolatedPage(cdpBase, { baseUrl, verifyOwnership })
  try {
    const page = new MotionPage(context, baseUrl)
    await page.session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.session.send('Page.addScriptToEvaluateOnNewDocument', { source: samplerSource })
    return page
  } catch (error) { await context.dispose(); throw error }
}
export { sleep }
