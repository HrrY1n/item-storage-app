/** Run after browser:start against the Vite server; all writes use a disposable browser context. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:5173'
const OUT = '.tmp/design-optimization/verified'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const checks = []
const errors = []

class Session {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
      const entry = this.pending.get(message.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(message.id)
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert(!response.exceptionDetails, response.exceptionDetails?.exception?.description)
    return response.result?.value
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

function check(label, condition) {
  assert(condition, label)
  checks.push(label)
}

const version = await (await fetch(`${CDP}/json/version`)).json()
const browser = await connect(version.webSocketDebuggerUrl)
let page
try {
  const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true })
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId })
  const target = (await (await fetch(`${CDP}/json/list`)).json()).find(entry => entry.id === targetId)
  assert(target, 'Disposable browser target must exist')
  page = await connect(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const evaluate = expression => page.evaluate(expression)
  const viewport = async (width, height = 844) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
  }
  const nav = async route => {
    await page.send('Page.navigate', { url: BASE + route })
    let ready = false
    for (let i = 0; i < 60; i++) {
      await pause(100)
      ready = await evaluate(`!!document.querySelector('main') && document.querySelector('main').innerText.length > 20`)
      if (ready) break
    }
    assert(ready, `Page did not render: ${route}`)
    await evaluate(`Promise.all([document.fonts.ready, ...[...document.images].filter(image => image.loading !== 'lazy').map(image => image.decode().catch(() => {}))]).then(() => true)`)
    await pause(360)
  }
  const click = async (selector, text) => {
    check(`Action exists: ${text}`, await evaluate(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.includes(${JSON.stringify(text)}));
      if (!element) return false; element.click(); return true;
    })()`))
    await pause(350)
  }
  const key = async (name, code, physicalCode = name) => {
    const text = name === 'Enter' ? '\r' : name === ' ' ? ' ' : undefined
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: physicalCode, windowsVirtualKeyCode: code, text, unmodifiedText: text })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: physicalCode, windowsVirtualKeyCode: code })
    await pause(100)
  }
  const shot = async name => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  }
  await mkdir(OUT, { recursive: true })
  await viewport(390)
  await nav('/')
  check('Fresh context shows an empty library', await evaluate(`document.body.innerText.includes('还没有物品')`))
  await shot('mobile-empty')
  const seeded = await evaluate('window.__loadDemoData()')
  check('Demo data loaded only into disposable context', seeded === 18)
  await nav('/')
  check('Recent items appear in the mobile first screen', await evaluate(`document.getElementById('recent-items-title').getBoundingClientRect().top < 600`))
  check('Objects appear in the mobile first screen', await evaluate(`document.querySelector('main .item-card img').getBoundingClientRect().top < 700`))
  check('Overview previews avoid repeating the detailed metrics', await evaluate(`[...document.querySelectorAll('.item-card')].every(card => !card.innerText.includes('日均成本'))`))

  await nav('/items')
  check('All fourteen owned items are visible', await evaluate(`document.querySelectorAll('main .item-card').length === 14`))
  check('Glass navigation preserves 44px targets and non-interactive highlights', await evaluate(`
    [...document.querySelectorAll('.nav-link, .nav-add')].every(link => {
      const box = link.getBoundingClientRect(); return box.width >= 44 && box.height >= 44;
    }) && getComputedStyle(document.querySelector('.nav-links'), '::before').pointerEvents === 'none'
  `))
  check('Compact mobile bar uses smaller labels without shrinking icons or touch targets', await evaluate(`
    document.querySelector('.nav-links').getBoundingClientRect().height <= 52
      && document.querySelector('.nav-add').getBoundingClientRect().height === 52
      && [...document.querySelectorAll('.nav-label')].every(label => getComputedStyle(label).fontSize === '10px')
      && [...document.querySelectorAll('.nav-link-inner > svg')].every(icon => icon.getBoundingClientRect().height === 22)
  `))
  const pressNavigation = async () => {
    const point = await evaluate(`(() => { const box = document.querySelector('.nav-link[aria-current="page"]').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`)
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await pause(160)
    return point
  }
  const navPoint = await pressNavigation()
  check('Pressing a glass tab deforms its contents without moving its hit target', await evaluate(`
    new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.nav-link[aria-current="page"] .nav-link-inner')).transform).a < 1 && document.querySelector('.nav-link[aria-current="page"]').getBoundingClientRect().height >= 44
  `))
  await shot('mobile-glass-pressed')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...navPoint })
  await pause(350)
  check('Releasing a glass tab restores its shape and keeps the selected route', await evaluate(`location.pathname === '/items' && getComputedStyle(document.querySelector('.nav-link[aria-current="page"] .nav-link-inner')).transform === 'none'`))
  await evaluate(`document.querySelector('.nav-link[href="/categories"]').focus()`)
  await key('Tab', 9)
  check('Glass tabs retain a visible keyboard focus indicator', await evaluate(`document.activeElement.matches('.nav-link[href="/search"]:focus-visible') && getComputedStyle(document.activeElement).outlineStyle !== 'none'`))
  await key('Enter', 13)
  await pause(300)
  check('Keyboard activation updates the selected glass tab', await evaluate(`location.pathname === '/search' && document.querySelector('.nav-link[href="/search"]').getAttribute('aria-current') === 'page'`))
  await nav('/items')
  check('Detailed cards initially show metrics with an independent accessible collapse control', await evaluate(`
    [...document.querySelectorAll('[data-item-card]')].every(card => {
      const button = card.querySelector('.item-card-toggle');
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      return button.getAttribute('aria-expanded') === 'true' && !button.closest('a') && panel.getAttribute('aria-hidden') === 'false' && panel.getBoundingClientRect().height > 0;
    })
  `))
  check('List header and capsule toolbar stay compact on mobile', await evaluate(`document.querySelector('[data-item-card]').getBoundingClientRect().top < 180 && document.querySelector('.collection-toolbar .search-tools').contains(document.querySelector('select[aria-label="物品排序"]'))`))
  await shot('mobile-cards-native-density')
  await evaluate(`document.querySelectorAll('.item-card-toggle').forEach(button=>button.click())`)
  await pause(300)
  check('Every visible warranty keeps twelve dots and a real remaining percentage', await evaluate(`
    [...document.querySelectorAll('[data-warranty-strip]')].length > 0 && [...document.querySelectorAll('[data-warranty-strip]')].every(strip =>
      strip.querySelectorAll('[data-warranty-dot]').length === 12 && strip.getBoundingClientRect().height > 30 && Number.isFinite(Number(strip.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'))))
  `))
  await shot('mobile-cards-collapsed')
  const collapsedHeights = await evaluate(`[...document.querySelectorAll('[data-item-card]')].map(card => card.getBoundingClientRect().height)`)
  const disclosure = await evaluate(`(() => { const r = document.querySelector('.item-card-toggle').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height}; })()`)
  check('Disclosure meets a 44px touch target', disclosure.width >= 44 && disclosure.height >= 44)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: disclosure.x, y: disclosure.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: disclosure.x, y: disclosure.y })
  await pause(300)
  check('Touching disclosure opens only that card without navigating', await evaluate(`location.pathname === '/items' && document.querySelectorAll('[data-item-card][data-expanded="true"]').length === 1 && document.querySelector('.item-card-toggle').getAttribute('aria-expanded') === 'true'`))
  check('Opening one card leaves neighbouring card heights unchanged', await evaluate(`JSON.stringify([...document.querySelectorAll('[data-item-card]')].slice(1).map(card => card.getBoundingClientRect().height)) === ${JSON.stringify(JSON.stringify(collapsedHeights.slice(1)))}`))
  check('Expanded financial labels and values remain readable in narrow cards', await evaluate(`(() => {
    const card = document.querySelector('[data-item-card][data-expanded="true"]');
    const labels = [...card.querySelectorAll('p')].filter(p => ['持有天数','总投入','日均成本'].includes(p.textContent));
    return labels.length === 3 && labels.every(label => label.getBoundingClientRect().height > 0 && label.scrollWidth <= label.clientWidth + 1 && label.nextElementSibling.scrollWidth <= label.nextElementSibling.clientWidth + 1);
  })()`))
  check('Warranty remains visible below the expanded metrics', await evaluate(`(() => { const card = document.querySelector('[data-item-card]'); return card.querySelector('[data-warranty-strip]').getBoundingClientRect().top >= card.querySelector('.item-card-details').getBoundingClientRect().bottom; })()`))
  await shot('mobile-cards-expanded')
  await evaluate(`document.querySelector('.item-card-toggle').focus()`)
  await key('Enter', 13)
  await pause(250)
  check('Enter collapses the card and preserves focus', await evaluate(`document.activeElement === document.querySelector('.item-card-toggle') && document.activeElement.getAttribute('aria-expanded') === 'false' && document.querySelector('.item-card-details').getBoundingClientRect().height === 0`))
  await key(' ', 32, 'Space')
  await pause(250)
  check('Space expands the same card and exposes its panel to assistive technology', await evaluate(`document.activeElement.getAttribute('aria-expanded') === 'true' && document.getElementById(document.activeElement.getAttribute('aria-controls')).getAttribute('aria-hidden') === 'false'`))
  await nav('/items')
  await evaluate(`document.querySelector('[aria-label="物品状态"] [role="radio"]').focus()`)
  await key('End', 35)
  check('Keyboard End selects disposed items', await evaluate(`document.querySelector('main h1').textContent === '已处置物品'`))
  await evaluate(`[...document.querySelectorAll('[data-item-card]')].find(card => card.textContent.includes('AirPods Max')).querySelector('.item-card-toggle').click()`)
  await pause(300)
  check('Expanded sold results keep loss direction and compact amounts without a warranty strip', await evaluate(`[...document.querySelectorAll('[data-item-card]')].some(card => card.innerText.includes('AirPods Max') && card.innerText.includes('亏损 ¥1.6k') && !card.querySelector('[data-warranty-strip]'))`))
  await evaluate(`document.querySelector('[aria-label="处置方式"] [role="radio"]').focus()`)
  await key('End', 35)
  check('Keyboard skips empty disabled disposal options', await evaluate(`document.activeElement.textContent.includes('已丢弃') && document.activeElement.getAttribute('aria-checked') === 'true'`))
  await evaluate(`document.querySelector('[aria-label="物品状态"] [aria-checked="true"]').focus()`)
  await key('Home', 36)
  await key('ArrowRight', 39)
  check('Keyboard arrows select wishlist and move focus', await evaluate(`document.querySelector('main h1').textContent === '心愿物品' && document.activeElement.getAttribute('aria-checked') === 'true'`))
  await key('Home', 36)
  await evaluate(`document.querySelector('button[aria-label="分类筛选"]').click()`)
  await evaluate(`[...document.querySelectorAll('button[data-category-value]')].find(button=>button.textContent==='数码与电子').click()`)
  await pause(200)
  check('Category filtering narrows the collection', await evaluate(`document.querySelectorAll('.item-card').length > 0 && document.querySelectorAll('.item-card').length < 14`))
  await evaluate(`document.querySelector('input[type="search"]').focus()`)
  await page.send('Input.insertText', { text: 'no-match-visual-check' })
  await pause(200)
  check('No-result feedback describes the active filter', await evaluate(`document.body.innerText.includes('没有匹配的物品')`))
  await click('button', '重置筛选')
  check('Reset restores all owned items', await evaluate(`document.querySelectorAll('.item-card').length === 14 && document.querySelector('input[type="search"]').value === ''`))
  await evaluate(`(() => { const select = document.querySelector('[aria-label="物品排序"]'); select.value = 'daily'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await pause(150)
  await evaluate(`document.querySelector('[aria-label="切换为列表视图"]').click()`)
  await pause(200)
  check('List view keeps all fourteen items', await evaluate(`!document.querySelector('.item-card') && document.querySelectorAll('main a[href^="/items/"]').length === 14`))
  await evaluate(`document.querySelector('[aria-label="切换为网格视图"]').click()`)
  await pause(200)
  check('Grid view restores shared cards', await evaluate(`document.querySelectorAll('.item-card').length === 14`))
  check('Modified clicks preserve the browser default', await evaluate(`(() => {
    const anchor = document.querySelector('.item-card'); let prevented;
    document.addEventListener('click', event => { prevented = event.defaultPrevented; event.preventDefault() }, { once: true });
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
    return prevented === false && location.pathname === '/items';
  })()`))
  const detail = await evaluate(`document.querySelector('.item-card').getAttribute('href')`)
  await evaluate(`document.querySelector('.item-card').click()`)
  await pause(700)
  check('Shared card transition reaches item details', await evaluate(`location.pathname === ${JSON.stringify(detail)} && document.body.innerText.includes('物品详情')`))
  await click('button', '处置物品')
  check('Modal overlay covers the bottom navigation', await evaluate(`!document.elementFromPoint(40, innerHeight - 20)?.closest('nav')`))
  await key('Escape', 27)

  await nav('/items/new')
  check('Task form hides main navigation', await evaluate(`!document.querySelector('nav[aria-label="主导航"]')`))
  await click('button', '点击本行更换图标')
  check('Icon picker is an accessible modal', await evaluate(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`))
  await shot('mobile-icon-picker')
  await key('Escape', 27)
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate(`!document.querySelector('[role="dialog"]')`)) break
    await pause(20)
  }
  check('Escape closes the picker', await evaluate(`!document.querySelector('[role="dialog"]')`))

  const captures = []
  for (const theme of ['light', 'dark']) {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
    for (const [width, height, device] of [[390, 844, 'mobile'], [1440, 1000, 'desktop']]) {
      await viewport(width, height)
      for (const [route, label] of [['/', 'home'], ['/items', 'items'], [detail, 'detail'], ['/categories', 'categories'], ['/items/new', 'form']]) {
        await nav(route)
        if (route === '/items') {
          await evaluate(`const button=document.querySelector('.item-card-toggle');if(button.getAttribute('aria-expanded')==='false')button.click()`)
          await pause(250)
          if (device === 'mobile') {
            check(`${theme} mobile glass has live blur and themed highlights`, await evaluate(`
              [...document.querySelectorAll('.nav-links, .nav-add')].every(element => {
                const style = getComputedStyle(element);
                return style.backdropFilter.includes('blur(') && style.backgroundImage.includes('gradient') && getComputedStyle(element, '::before').content !== 'none';
              })
            `))
          }
        }
        await shot(`${device}-${label}-${theme}`)
        captures.push({ width, theme, route })
        check(`${width}px ${theme} ${label} has no horizontal overflow`, await evaluate('document.documentElement.scrollWidth <= innerWidth'))
      }
      console.log(`Captured ${device} ${theme}`)
    }
  }
  await viewport(1440, 1000)
  await nav('/items')
  check('Desktop uses a sidebar and a wide collection', await evaluate(`document.querySelector('main').getBoundingClientRect().width > 900 && document.querySelector('nav').getBoundingClientRect().width < 240 && getComputedStyle(document.querySelector('nav')).position === 'sticky'`))
  await evaluate('window.scrollTo(0, 600)')
  check('Desktop uses document scrolling with reachable navigation', await evaluate(`scrollY > 0 && document.querySelector('nav').getBoundingClientRect().top >= 0`))
  await nav(detail)
  check('Desktop separates identity and records into columns', await evaluate(`document.querySelector('.detail-identity').getBoundingClientRect().right < document.querySelector('.detail-record').getBoundingClientRect().left`))
  const typography = await evaluate(`({ heading: getComputedStyle(document.querySelector('main h1:not([aria-hidden])')).fontSize, body: getComputedStyle(document.body).fontFamily })`)
  console.log(JSON.stringify({ typography }))
  check('Desktop heading typography scales with viewport', parseFloat(typography.heading) >= 32)

  for (const width of [320, 375, 430, 768, 1024]) {
    await viewport(width)
    for (const route of ['/', '/items', '/categories', detail, '/items/new', '/settings', '/search', '/settings/icons']) {
      await nav(route)
      if (route === '/items') {
        await evaluate(`const button=document.querySelector('.item-card-toggle');if(button.getAttribute('aria-expanded')==='false')button.click()`)
        await pause(250)
        check(`${width}px expanded metrics remain readable`, await evaluate(`
          [...document.querySelector('.item-card-details').querySelectorAll('p')].every(p => p.getBoundingClientRect().height > 0 && p.scrollWidth <= p.clientWidth + 1)
        `))
        check(`${width}px navigation stays compact and leaves the last card reachable`, await evaluate(`(() => {
          const main = document.querySelector('main'), bar = document.querySelector('.nav-links'), add = document.querySelector('.nav-add');
          if (innerWidth >= 1024) return getComputedStyle(document.querySelector('.nav-label')).fontSize === '14px' && add.getBoundingClientRect().height === 46;
          const buttons = [...document.querySelectorAll('.nav-link, .nav-add')];
          const targetsFit = buttons.every(button => { const r = button.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth; });
          const compact = bar.getBoundingClientRect().height <= 52 && add.getBoundingClientRect().height === 52;
          const indicator = document.querySelector('.nav-indicator').getBoundingClientRect(), active = document.querySelector('.nav-link[aria-current="page"]').getBoundingClientRect();
          const aligned = Math.abs(indicator.x + indicator.width / 2 - active.x - active.width / 2) < 1 && indicator.height <= 44;
          const reserved = parseFloat(getComputedStyle(main).paddingBottom) - document.querySelector('.app-nav').getBoundingClientRect().height >= 20;
          window.scrollTo(0, document.documentElement.scrollHeight);
          const lastCard = Math.max(...[...document.querySelectorAll('[data-item-card]')].map(card => card.getBoundingClientRect().bottom));
          const reachable = lastCard < bar.getBoundingClientRect().top;
          window.scrollTo(0, 0);
          return targetsFit && compact && aligned && reserved && reachable;
        })()`))
      }
      check(`${width}px ${route} has no horizontal overflow`, await evaluate('document.documentElement.scrollWidth <= innerWidth'))
    }
  }
  await viewport(390)
  for (const [name, value] of [['prefers-reduced-transparency', 'reduce'], ['prefers-contrast', 'more'], ['forced-colors', 'active']]) {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name, value }] })
    await nav('/items')
    check(`${name} replaces glass with an opaque surface and keeps navigation visible`, await evaluate(`
      [...document.querySelectorAll('.nav-links, .nav-add')].every(element => {
        const style = getComputedStyle(element);
        return style.backdropFilter === 'none' && style.backgroundImage === 'none' && getComputedStyle(element, '::before').display === 'none' && element.getBoundingClientRect().height >= 44;
      }) && getComputedStyle(document.querySelector('.nav-indicator')).opacity === '1'
    `))
  }
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await nav('/items')
  const reducedPoint = await pressNavigation()
  check('Reduced motion disables glass deformation while keeping tab activation', await evaluate(`getComputedStyle(document.querySelector('.nav-link[aria-current="page"] .nav-link-inner')).transform === 'none' && getComputedStyle(document.querySelector('.nav-indicator')).scale === 'none'`))
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...reducedPoint })
  check('Reduced-motion keeps cards visible without animations', await evaluate(`document.getAnimations().length === 0 && document.querySelectorAll('.item-card').length === 14`))
  await evaluate(`document.querySelector('.item-card-toggle').click()`)
  await pause(100)
  check('Reduced-motion disclosure collapses without running animations', await evaluate(`document.querySelector('.item-card-toggle').getAttribute('aria-expanded') === 'false' && document.querySelector('.item-card-details').getBoundingClientRect().height === 0 && document.getAnimations().length === 0`))
  const categoryId = await evaluate(`import('/src/db/db.ts').then(async ({db}) => (await db.items.toArray()).find(item => item.status === 'owned').categoryId)`)
  await nav('/categories/' + categoryId)
  await evaluate(`document.querySelectorAll('.item-card-toggle[aria-expanded="true"]').forEach(button=>button.click())`)
  await evaluate(`document.querySelector('.item-card-toggle').click()`)
  await pause(100)
  check('Category detail shares the same independent disclosure', await evaluate(`document.querySelectorAll('[data-item-card][data-expanded="true"]').length === 1 && document.querySelector('.item-card-details').getBoundingClientRect().height > 0`))
  const remaining = await evaluate(`import('/src/db/db.ts').then(({ db }) => db.items.count())`)
  check('Verification leaves all eighteen demo records intact', remaining === seeded)
  check('No uncaught browser runtime errors', errors.length === 0)
  await writeFile(`${OUT}/results.json`, JSON.stringify({ capturedAt: new Date().toISOString(), checks, captures, typography, errors }, null, 2))
  console.log(`PASS: ${checks.length} design and interaction checks; screenshots: ${OUT}`)
} finally {
  page?.ws.close()
  browser.ws.close()
}
