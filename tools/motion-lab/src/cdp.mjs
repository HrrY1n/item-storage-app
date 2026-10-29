const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export class Session {
  id = 0
  pending = new Map()
  exceptions = []
  listeners = new Map()
  errors = []
  closed = false
  constructor(ws, label = 'cdp') {
    this.ws = ws
    this.label = label
    ws.addEventListener('message', event => {
      let message
      try { message = JSON.parse(event.data) } catch (error) { this.errors.push(String(error)); return }
      if (message.id) { this.pending.get(message.id)?.(message); this.pending.delete(message.id) }
      if (message.method === 'Runtime.exceptionThrown') this.exceptions.push(message.params.exceptionDetails)
      if (message.method === 'Inspector.targetCrashed' || message.method === 'Inspector.detached') this.errors.push(message.method)
      for (const listener of this.listeners.get(message.method) ?? [])
        Promise.resolve().then(() => listener(message.params)).catch(error => this.errors.push(String(error)))
    })
    const close = () => {
      this.closed = true
      for (const resolve of this.pending.values()) resolve({ error: { message: label + ': disconnected' } })
      this.pending.clear()
    }
    ws.addEventListener('close', close)
    ws.addEventListener('error', close)
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set())
    this.listeners.get(method).add(listener)
    return () => this.listeners.get(method)?.delete(listener)
  }
  async send(method, params = {}, timeoutMs = 15000) {
    if (this.closed) throw new Error(this.label + ': disconnected')
    const id = ++this.id
    const reply = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timeout')) }, timeoutMs)
      this.pending.set(id, message => { clearTimeout(timeout); resolve(message) })
      try { this.ws.send(JSON.stringify({ id, method, params })) }
      catch (error) { clearTimeout(timeout); this.pending.delete(id); reject(error) }
    })
    if (reply.error) throw new Error(method + ': ' + JSON.stringify(reply.error))
    return reply.result
  }
  async ev(expression, { awaitPromise = true } = {}) {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, 20000)
    if (reply.exceptionDetails) throw new Error('evaluate failed: ' + (reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text))
    return reply.result?.value
  }
  async until(expression, { timeoutMs = 15000, intervalMs = 40 } = {}) {
    const deadline = Date.now() + timeoutMs
    do {
      if (this.errors.length) throw new Error(this.errors.join('; '))
      if (await this.ev(expression)) return
      await sleep(intervalMs)
    } while (Date.now() < deadline)
    throw new Error('Timed out waiting for ' + expression.slice(0, 160))
  }
}
export async function connect(url, label) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1') throw new Error('Refusing non-loopback CDP')
  const ws = new WebSocket(url)
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('CDP connection timeout')) }, 5000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection error')) }, { once: true })
    })
    return new Session(ws, label)
  } catch (error) { ws.close(); throw error }
}
export function allowedRequest(url, baseUrl) {
  try {
    const parsed = new URL(url)
    if (url === 'about:blank' || parsed.protocol === 'data:') return true
    if (parsed.protocol === 'blob:') return parsed.origin === baseUrl
    return parsed.protocol === 'http:' && parsed.origin === baseUrl && !parsed.pathname.startsWith('/api/')
  } catch { return false }
}
export async function createIsolatedPage(cdpBase, { baseUrl, verifyOwnership } = {}) {
  if (!verifyOwnership || !baseUrl) throw new Error('BLOCKED: verified ownership and local origin are required')
  await verifyOwnership()
  const endpoint = new URL(cdpBase)
  if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'http:') throw new Error('Invalid local CDP endpoint')
  const version = await (await fetch(cdpBase + '/json/version', { redirect: 'error', signal: AbortSignal.timeout(3000) })).json()
  const socketUrl = new URL(version.webSocketDebuggerUrl)
  if (socketUrl.host !== endpoint.host) throw new Error('Unexpected CDP socket identity')
  const browser = await connect(socketUrl.href, 'browser')
  let contextId, page
  const requests = [], blocked = []
  const dispose = async () => {
    const results = []
    if (contextId) {
      try { await browser.send('Target.disposeBrowserContext', { browserContextId: contextId }); results.push('context disposed') }
      catch (error) { results.push('context disposal failed: ' + String(error)) }
    }
    page?.ws.close()
    browser.ws.close()
    return { status: results.some(value => value.includes('failed')) ? 'INCONCLUSIVE' : 'PASS', results }
  }
  try {
    const context = await browser.send('Target.createBrowserContext', { disposeOnDetach: true })
    contextId = context.browserContextId
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: contextId })
    const targets = await (await fetch(cdpBase + '/json/list', { redirect: 'error', signal: AbortSignal.timeout(3000) })).json()
    const target = targets.find(entry => entry.id === targetId)
    if (!target) throw new Error('Created target missing')
    const pageSocket = new URL(target.webSocketDebuggerUrl)
    if (pageSocket.host !== endpoint.host) throw new Error('Unexpected page socket identity')
    page = await connect(pageSocket.href, 'page')
    page.on('Fetch.requestPaused', async event => {
      const allowed = allowedRequest(event.request.url, baseUrl)
      const entry = { url: event.request.url, method: event.request.method, type: event.resourceType, blocked: !allowed }
      requests.push(entry)
      if (!allowed) blocked.push(entry)
      await page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        allowed ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: 'BlockedByClient' })
    })
    await page.send('Network.enable')
    await page.send('Network.setBypassServiceWorker', { bypass: true })
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    return { browser, page, contextId, requests, blocked, policy: 'Fetch Request interception + owned-server CSP; only local origin; no workers/frames/external connections', dispose }
  } catch (error) { error.cleanup = await dispose(); throw error }
}
