import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { ensureEnvironment, processIdentity } from '../src/env.mjs'
import { openMotionPage } from '../src/page.mjs'
import { newRunId, writeNewJson } from '../src/store.mjs'
import { runLab, parseArgs } from '../run.mjs'
import { scenarios } from '../src/scenarios/index.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const DETAIL = '.modal-sheet[data-sheet="detail"] .modal-sheet-panel'
const BACKDROP = '.modal-sheet[data-sheet="detail"] .modal-sheet-backdrop'

async function injectStyle(page, id, css, selector, predicate) {
  const proof = await page.ev('(()=>{const style=document.createElement("style");style.dataset.auditFault=' + JSON.stringify(id) +
    ';style.textContent=' + JSON.stringify(css) + ';document.head.append(style);' +
    'let el=document.querySelector(' + JSON.stringify(selector) + '),probe;' +
    'if(!el){probe=document.createElement("div");probe.className="modal-sheet";probe.dataset.sheet="detail";probe.dataset.state="open";el=document.createElement("section");el.className=' +
    JSON.stringify(selector.endsWith('backdrop') ? 'modal-sheet-backdrop' : 'modal-sheet-panel') + ';probe.append(el);document.body.append(probe)}' +
    'const s=getComputedStyle(el);const result={id:' + JSON.stringify(id) + ',stage:"before-input",duration:s.transitionDuration,easing:s.transitionTimingFunction,' +
    'reduce:matchMedia("(prefers-reduced-motion: reduce)").matches};probe?.remove();return result})()')
  proof.confirmed = predicate(proof)
  page.faultEvidence ??= []
  page.faultEvidence.push(proof)
  if (!proof.confirmed) throw new Error('Fault injection not confirmed: ' + id)
}
function fixtureScenario(mode) {
  return { id: 'fixture-' + mode, title: 'Controlled browser fixture: ' + mode,
    description: 'Browser-executed WAAPI fixture, explicitly synthetic; no prebuilt sampling data.',
    viewport: { width: 390, height: 844, dpr: 2 },
    spec: { primary: { label: 'a', signal: 'tx', declaredMs: 320, ...(mode === 'delay-cancel' ? { eventProperty: 'transform' } : {}) }, secondary: [{ label: 'b', signal: 'tx', declaredMs: null }] },
    async run({ page }) {
      await page.goto('/tools/motion-lab/test/browser-fixture.html?mode=' + mode, { waitSelector: '#go' })
      await page.waitAnimationsIdle()
      const before = await page.screenshot('before')
      const record = await page.capture({ click: '#go', targets: [{ sel: '#a', label: 'a' }, { sel: '#b', label: 'b' }], maxMs: 2500 })
      record.meta.controlledFixture = mode
      const after = await page.screenshot('after')
      return { record, shots: [before, after], checks: [{ name: 'Real CDP input started fixture', pass: await page.ev('window.fixtureStarted===true') }] }
    } }
}
async function unknownService() {
  let requests = 0
  const server = createServer((req, res) => { requests++; res.setHeader('Content-Type', 'application/json'); res.end('{"Browser":"untrusted"}') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port, requests: () => requests, close: () => new Promise(resolve => server.close(resolve)) }
}

export async function validateBrowser(logDir) {
  const logLines = [], checks = [], suites = []
  const log = message => { logLines.push(new Date().toISOString() + ' ' + message); console.log(message) }
  const devConflict = await unknownService(), cdpConflict = await unknownService()
  let env, cleanup = [], status = 'FAIL', startupError
  const options = (prefix, repeat = 1) => ({ ...parseArgs([]), runId: newRunId(prefix), repeat })
  const readRaw = async result => {
    const summary = result.run.scenarios[0]?.runs[0]
    if (!summary?.rawFile) return null
    return JSON.parse(await readFile(path.join(result.store.root, summary.rawFile), 'utf8'))
  }
  try {
    env = await ensureEnvironment({ port: cdpConflict.port, devPort: devConflict.port, log })
    assert.notEqual(env.port, cdpConflict.port)
    assert.notEqual(Number(new URL(env.baseUrl).port), devConflict.port)
    assert.equal(devConflict.requests() + cdpConflict.requests(), 0)
    checks.push({ id: 'service-ownership', status: 'PASS', proof: env.metadata, conflictingServicesNotContacted: true })

    // Exercise the Fetch gate against a controlled other-local-port server before App/data navigation.
    const policyPage = await openMotionPage(env)
    try {
      await policyPage.session.send('Page.navigate', { url: 'http://127.0.0.1:' + devConflict.port + '/forbidden' })
      await sleep(150)
      assert.ok(policyPage.blocked.length > 0)
      assert.equal(devConflict.requests(), 0)
      checks.push({ id: 'network-before-send', status: 'PASS', blocked: policyPage.blocked })
    } finally { checks.push({ id: 'network-context-cleanup', ...await policyPage.disposeContext() }) }

    const positive = await runLab({ ...options('positive'), saveBaseline: true }, { environment: env, log })
    suites.push({ kind: 'positive', runId: positive.run.runId, status: positive.run.status, root: positive.store.root })
    if (positive.run.status !== 'PASS') throw new Error('Normal suite did not pass; inspect raw evidence before dependent tests')
    const baselineId = positive.run.runId
    const scene = id => scenarios.find(s => s.id === id)
    const negative = async (id, sceneObject, configurePage, prove, expectedCodes, compare = false) => {
      const config = { ...options(id.toLowerCase()), ...(compare ? { compare: true, baselineId } : {}) }
      const result = await runLab(config, { environment: env, scenarioList: [sceneObject], configurePage, log })
      suites.push({ kind: id, runId: result.run.runId, status: result.run.status, root: result.store.root })
      const raw = await readRaw(result)
      const proof = raw ? prove(raw, result.run) : false
      const detected = raw && (expectedCodes.some(code => raw.summary.anomalies?.some(a => a.code === code)) ||
        expectedCodes.includes('baseline-change') && result.run.comparison?.scenarios.some(s => s.entries.some(e => e.status === 'FAIL')))
      const pass = Boolean(proof && detected && result.run.status !== 'PASS' && result.run.exitCode !== 0)
      checks.push({ id, status: pass ? 'PASS' : 'FAIL', injectionConfirmed: Boolean(proof), detected: Boolean(detected),
        actualSuiteStatus: result.run.status, runId: result.run.runId, rawFile: raw?.summary.rawFile })
      log(id + ' injection=' + Boolean(proof) + ' detected=' + Boolean(detected) + ' verification=' + (pass ? 'PASS' : 'FAIL'))
    }
    const configure = hook => async page => { page.skipStills = true; page.faultEvidence = []; page.beforeCapture = config => hook(page, config) }
    const proofFor = (raw, id) => raw.faultInjection?.some(p => p.id === id && p.confirmed)
    await negative('B01', scene('item-detail-open'), configure(page => injectStyle(page, 'B01',
      DETAIL + '{transition:none!important}', DETAIL, p => p.duration.split(',').every(v => parseFloat(v) === 0))),
      raw => proofFor(raw, 'B01') && raw.summary.checks.every(c => c.pass), ['no-motion', 'no-target-animation'])
    await negative('B02', scene('reduced-motion-detail-open'), configure(page => injectStyle(page, 'B02',
      DETAIL + '{transition:transform 480ms linear!important;transition-duration:480ms!important}',
      DETAIL, p => p.reduce && parseFloat(p.duration) >= .48)),
      raw => proofFor(raw, 'B02') && raw.record.meta.reducedMotion && raw.summary.primary.actualDeclaredMs.some(v => v > 50), ['reduced-motion-violation'])
    await negative('B03', scene('item-detail-open'), configure(page => injectStyle(page, 'B03',
      DETAIL + '{transition-timing-function:linear!important}', DETAIL, p => p.easing === 'linear')),
      raw => proofFor(raw, 'B03') && raw.summary.primary.actualDeclaredMs.includes(480) && Math.abs(raw.summary.primary.interval.to) < 1,
      ['baseline-change'], true)
    await negative('B04', scene('item-detail-open'), configure(page => injectStyle(page, 'B04',
      BACKDROP + '{transition:none!important}', BACKDROP, p => p.duration.split(',').every(v => parseFloat(v) === 0))),
      raw => proofFor(raw, 'B04') && raw.summary.primary.eventDuration?.outcome === 'ended',
      ['no-motion', 'no-target-animation'])
    await negative('B05', fixtureScenario('parallel'), async page => { page.skipStills = true },
      raw => raw.record.events.some(e => e.type === 'waapicancel' && e.target === 'a') &&
        new Set(raw.record.animations.flatMap(s => s.list).map(a => a.id)).size >= 3 &&
        raw.record.animations.some(s => s.list.some(a => a.target === 'b')),
      ['animation-cancelled'])
    await negative('B06', scene('item-detail-open'), configure(page => injectStyle(page, 'B06',
      DETAIL + '{transition-duration:6000ms!important}', DETAIL, p => parseFloat(p.duration) >= 6)),
      raw => proofFor(raw, 'B06') && ['maxMs', 'watchdog'].includes(raw.record.settledBy) && raw.summary.primary.actualDeclaredMs.includes(6000),
      ['capture-incomplete', 'animation-unfinished'])
    await negative('B05-delay', fixtureScenario('delay-cancel'), async page => { page.skipStills = true },
      raw => raw.record.events.some(e => e.type === 'transitioncancel' && e.target === 'a' && e.instanceId) &&
        raw.summary.primary.eventDuration?.segments.some(s => s.outcome === 'cancelled' && s.start === null),
      ['animation-cancelled'])
    await negative('B07', fixtureScenario('remount'), async page => { page.skipStills = true },
      raw => raw.summary.primary.interval.internalGaps > 0 && raw.summary.primary.interval.instances.length >= 2,
      ['target-replaced', 'animation-cancelled'])
    const roundTrip = await runLab(options('roundtrip'), { environment: env, scenarioList: [fixtureScenario('return')], log })
    const roundTripRaw = await readRaw(roundTrip)
    checks.push({ id: 'B07-roundtrip-positive', status: roundTrip.run.status === 'PASS' && roundTripRaw.summary.primary.interval.moved &&
      roundTripRaw.summary.primary.interval.amplitude > 40 && Math.abs(roundTripRaw.summary.primary.interval.net) < 1 ? 'PASS' : 'FAIL', runId: roundTrip.run.runId })
    suites.push({ kind: 'roundtrip-positive', runId: roundTrip.run.runId, status: roundTrip.run.status, root: roundTrip.store.root })
    await negative('B08', scene('cost-disclosure-expand'), configure(async page => {
      const proof = await page.ev('(()=>{const button=document.querySelector(\'[data-item-card]:nth-child(5) .item-card-toggle\'),card=document.querySelector(\'[data-item-card]:nth-child(6)\');button.addEventListener("click",()=>card.animate([{transform:"translateY(0px)"},{transform:"translateY(30px)"},{transform:"translateY(0px)"}],{duration:300,easing:"linear"}),{once:true});return {id:"B08",confirmed:!!button&&!!card,stage:"before-input"}})()')
      page.faultEvidence.push(proof)
      if (!proof.confirmed) throw new Error('B08 not armed')
    }), raw => proofFor(raw, 'B08') && raw.summary.secondary.beside.interval.amplitude > 20,
    ['unstable-target', 'check-failed'])
    await negative('B09', scene('icon-picker-close'), configure(async page => {
      const proof = await page.ev('(()=>{const el=document.querySelector(\'input[aria-label="物品名称"]\');el.disabled=true;return{id:"B09",confirmed:el.disabled,stage:"before-input"}})()')
      page.faultEvidence.push(proof)
      if (!proof.confirmed) throw new Error('B09 not armed')
    }), raw => proofFor(raw, 'B09') && raw.summary.crashed?.includes('not actionable') && raw.record.frames.length > 5,
    ['scenario-crashed'])
    // B10 依赖关键帧冻结复演；item-detail-open 的内容并行填充与冻结互斥（该场景已 skipStills），
    // 改用 item-detail-close：其复演对象是内容已稳定的关闭过渡，语义不变（复演失败必须如实上报）。
    await negative('B10', scene('item-detail-close'), async page => {
      page.faultEvidence = []
      page.beforeStill = async config => {
        config.timeoutMs = 150
        await injectStyle(page, 'B10', DETAIL + '{transition:none!important}', DETAIL, p => parseFloat(p.duration) === 0)
      }
    }, raw => proofFor(raw, 'B10') && raw.summary.shots.some(s => s.still?.status === 'INCONCLUSIVE' && s.still.paused === 0) &&
      raw.summary.primary.eventDuration?.outcome === 'ended', ['still-failed'])

    // Real page-target disconnection; only our isolated context is closed.
    const disconnected = await openMotionPage(env)
    await disconnected.setViewport({ width: 390, height: 844, dpr: 2 })
    await disconnected.goto('/tools/motion-lab/test/browser-fixture.html', { waitSelector: '#go' })
    await disconnected.session.send('Page.close')
    await sleep(100)
    let rejected = false
    try { await disconnected.ev('1') } catch { rejected = true }
    const disconnectedCleanup = await disconnected.disposeContext()
    checks.push({ id: 'F16-page-disconnect', status: rejected && disconnectedCleanup.status === 'PASS' ? 'PASS' : 'FAIL', cleanup: disconnectedCleanup })

    for (const [batch, order] of [[1, scenarios], [2, scenarios.toReversed()]]) {
      const repeated = await runLab({ ...options('repeat' + batch, 3), compare: true, baselineId }, { environment: env, scenarioList: order, log })
      suites.push({ kind: 'repeat-' + batch, runId: repeated.run.runId, status: repeated.run.status, root: repeated.store.root })
      checks.push({ id: 'repeat-' + batch, status: repeated.run.status === 'PASS' ? 'PASS' : 'FAIL',
        runId: repeated.run.runId, runs: repeated.run.scenarios.reduce((n,s) => n + s.runs.length, 0), comparison: repeated.run.comparison?.status })
    }

    // Render the actual report in the same protected origin, in a new isolated context.
    const reportPage = await openMotionPage(env)
    try {
      const relative = '/tools/motion-lab/artifacts/' + positive.run.runId + '/report.html'
      await reportPage.goto(relative, { waitSelector: 'script[data-portable]' })
      await reportPage.until('document.readyState==="complete" && document.querySelectorAll("script[data-portable]").length===' + scenarios.length)
      const reportProof = await reportPage.ev('({title:document.title,sections:document.querySelectorAll("section[id]").length,curves:document.querySelectorAll("polyline").length,' +
        'badViewport:document.body.textContent.includes("—×—"),portable:[...document.querySelectorAll("script[data-portable]")].map(s=>{const d=JSON.parse(s.textContent);return d.runs.every(r=>!!r.raw?.record?.events)})})')
      assert.equal(reportProof.sections, scenarios.length)
      assert.equal(reportProof.badViewport, false)
      assert.ok(reportProof.curves > 0 && reportProof.portable.every(Boolean))
      checks.push({ id: 'HTML-report-browser', status: 'PASS', proof: reportProof })
      const shot = await reportPage.screenshot('report')
      await writeFile(path.join(logDir, 'report-browser.png'), Buffer.from(shot.data, 'base64'), { flag: 'wx' })
    } finally { checks.push({ id: 'report-context-cleanup', ...await reportPage.disposeContext() }) }
    assert.equal(devConflict.requests() + cdpConflict.requests(), 0)
    assert.equal(devConflict.server.listening && cdpConflict.server.listening, true)
    checks.push({ id: 'unknown-services-preserved', status: 'PASS', requests: 0 })
    status = checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL'
  } catch (error) {
    startupError = String(error.stack ?? error)
    log(startupError)
    if (startupError.includes('BLOCKED')) status = 'BLOCKED'
  } finally {
    if (env) cleanup = await env.cleanup()
    await devConflict.close()
    await cdpConflict.close()
    if (cleanup.some(r => r.status !== 'PASS')) status = 'FAIL'
    const remaining = env ? await Promise.all([env.metadata.dev.pid, env.metadata.browser.pid].map(async pid => ({ pid, identity: await processIdentity(pid) }))) : []
    if (remaining.some(p => p.identity)) status = 'FAIL'
    await writeNewJson(path.join(logDir, 'browser-results.json'), { status, checks, suites, cleanup, remaining, startupError })
    await writeFile(path.join(logDir, 'browser.log'), logLines.join('\n'), { flag: 'wx' })
  }
  return { name: 'browser', status, exitCode: status === 'PASS' ? 0 : 1, evidence: path.join(logDir, 'browser-results.json') }
}
