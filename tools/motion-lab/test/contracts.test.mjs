import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { motionInterval, eventDuration, summarize, finalizeSummary } from '../src/metrics.mjs'
import { _internal, validBaselineRun, saveRunBaseline } from '../src/baseline.mjs'
import { renderReport, svgCurve } from '../src/report.mjs'
import { parseArgs, exitCodeFor } from '../run.mjs'
import { newRunId } from '../src/store.mjs'
import { MotionPage } from '../src/page.mjs'
import { runInNewContext } from 'node:vm'
import { samplerSource } from '../src/sampler.mjs'

const spec = { primary: { label: 'panel', signal: 'ty', declaredMs: 200, eventProperty: 'transform' }, secondary: [] }
function record({ reduce = false, moved = true, finish = true } = {}) {
  return { meta: { sampler: '2', reducedMotion: reduce, colorScheme: 'light', appThemeBefore: 'light', appThemeAfter: 'light', viewport: { w: 390, h: 844, dpr: 2 } },
    frames: [[0,100],[20,100],[50,60],[100,20],[200,0],[500,0]].map(([t,v]) => ({ t, tg: { panel: { id: 'el-1', ty: moved ? v : 0 } }, running: 0 })),
    animations: moved ? [{ t:20, list:[{ id:'anim-1', elementId:'el-1',target:'panel',k:'transition',p:'transform',d:200,e:200,g:'linear',s:'running' }] }] : [],
    events: moved ? [{t:20,type:'transitionstart',p:'transform',target:'panel',elementId:'el-1',instanceId:'i-1',animationId:'anim-1'},
      ...(finish ? [{t:220,type:'transitionend',p:'transform',target:'panel',elementId:'el-1',instanceId:'i-1',animationId:'anim-1'}] : [])] : [],
    triggerAt: 20, totalMs: 500, settledBy:'stable', truncated:{}, visibility:[] }
}
const good = () => finalizeSummary(summarize(record(),spec), {checks:[{name:'終態',pass:true}]})
test('U01 F04 existing bottom-nav 0→6→0 is motion with nonzero amplitude', async () => {
  const raw=JSON.parse(await readFile(new URL('./fixtures/bottom-nav-switch-r1.json',import.meta.url),'utf8'))
  const interval=motionInterval(raw.record,'route','tx')
  assert.equal(interval.moved,true)
  assert.equal(interval.from,0)
  assert.equal(interval.to,0)
  assert.equal(interval.amplitude,6)
  assert.ok(interval.changes>=2)
})
test('U02 F04 internal null and instance replacement break plotted curves', () => {
  const source={frames:[{t:0,tg:{panel:{id:'a',ty:1}}},{t:10,tg:{panel:{id:'a',ty:2}}},
    {t:20,tg:{panel:null}},{t:30,tg:{panel:{id:'b',ty:3}}},{t:40,tg:{panel:{id:'b',ty:4}}}]}
  const interval=motionInterval(source,'panel','ty')
  assert.equal(interval.internalGaps,1)
  assert.deepEqual(interval.instances,['a','b'])
  const svg=svgCurve([{name:'gap',points:[[0,1],[10,2],[20,null],[30,3],[40,4]]}])
  assert.equal((svg.match(/<polyline/g)??[]).length,2)
})
test('U03 F03 parallel identities and cancel→restart do not cross-pair', () => {
  const make=(t,type,instanceId,elementId)=>({t,type,p:'transform',target:'panel',instanceId,elementId})
  const sample={events:[make(0,'transitionstart','a','el-a'),make(10,'transitionstart','b','el-b'),
    make(40,'transitioncancel','a','el-a'),make(50,'transitionstart','c','el-a'),
    make(210,'transitionend','b','el-b'),make(250,'transitionend','c','el-a')]}
  const event=eventDuration(sample,'panel','transform')
  assert.equal(event.outcome,'cancelled')
  assert.deepEqual(event.segments.map(s=>[s.id,s.durationMs,s.outcome]),[['a',40,'cancelled'],['b',200,'ended'],['c',200,'ended']])
})
test('U04 F05 zero baseline changing to 400 cannot be OK', () => {
  const entry=_internal.durationEntry('observed',{median:0,min:0,max:0},400)
  assert.equal(entry.status,'FAIL')
  assert.equal(entry.class,'error')
})
test('U05 F06 every failed/crashed/cancelled run blocks baseline saving', async () => {
  const pass=good(), fail={...good(),status:'FAIL',checks:[{name:'終態',pass:false}]}
  const crash={status:'INCONCLUSIVE',crashed:'expected'}, cancelled=good()
  cancelled.primary.eventDuration.outcome='cancelled'
  const mixed=[pass,fail,crash,cancelled]
  assert.equal(validBaselineRun(pass),true)
  assert.equal(validBaselineRun(cancelled),false)
  const metrics=_internal.collectMetrics(mixed)
  assert.equal(metrics.runs,1)
  assert.equal(metrics.rejectedRuns,3)
  assert.equal(metrics.checks.failedRuns,2)
  assert.equal(metrics.checks.crashedRuns,1)
  await assert.rejects(()=>saveRunBaseline({runId:newRunId('invalid'),scenarios:[{id:'sample',runs:mixed}]}),/Refusing baseline/)
})
test('U06 F01/F02 positive passes; missing normal motion and restored reduce motion fail', () => {
  assert.equal(good().status,'PASS')
  const absent=summarize(record({moved:false}),spec)
  assert.equal(absent.status,'FAIL')
  assert.ok(absent.anomalies.some(a=>a.code==='no-motion'))
  const reduced=summarize(record({reduce:true}),{...spec,reducedMotion:true,maxReducedMs:50})
  assert.equal(reduced.status,'FAIL')
  assert.ok(reduced.anomalies.some(a=>a.code==='reduced-motion-violation'))
  assert.equal(summarize(record({reduce:true,moved:false}),{...spec,reducedMotion:true}).status,'PASS')
})
test('U07 F12 truncation, hidden page, unfinished animation are not PASS', () => {
  const limited=record();limited.settledBy='maxMs'
  assert.equal(summarize(limited,spec).status,'INCONCLUSIVE')
  const capped=record();capped.truncated.events=1
  assert.equal(summarize(capped,spec).status,'INCONCLUSIVE')
  const hidden=record();hidden.hidden=true
  assert.equal(summarize(hidden,spec).status,'INCONCLUSIVE')
  assert.equal(summarize(record({finish:false}),spec).status,'INCONCLUSIVE')
})
function fixture() {
  const first={...good(),runIndex:1,rawFile:'raw/sample-r1.json'}
  const second={...good(),status:'FAIL',runIndex:2,checks:[{name:'second round unique failure',pass:false}],rawFile:'raw/sample-r2.json'}
  const run={runId:'unit',status:'FAIL',env:{browser:{browser:'Edge/unit'},node:process.version},source:{appFingerprint:'unit'},
    options:{repeat:2},scenarios:[{id:'sample',title:'sample',spec,runs:[first,second]}]}
  const records=new Map([['sample-r1',{record:record()}],['sample-r2',{record:record()}]])
  return {run,records}
}
test('U08 F09 actual w/h viewport and distinct App/system themes are displayed', () => {
  const {run,records}=fixture()
  run.scenarios[0].runs[0].appThemeAfter='dark'
  const html=renderReport(run,null,{records})
  assert.ok(html.includes('390×844'))
  assert.ok(!html.includes('—×—'))
  assert.ok(html.includes('App light→dark'))
  assert.ok(html.includes('Edge/unit'))
})
test('U09 F15 later failed rounds and INCONCLUSIVE never disappear behind a PASS', () => {
  const {run,records}=fixture()
  run.scenarios[0].runs[0].status='INCONCLUSIVE'
  const html=renderReport(run,null,{records})
  assert.ok(html.includes('second round unique failure'))
  assert.ok(html.includes('第2轮'))
  assert.ok(html.includes('INCONCLUSIVE'))
  assert.equal(exitCodeFor('INCONCLUSIVE',true),2)
  assert.equal(exitCodeFor('FAIL',true),1)
  assert.equal(exitCodeFor('PASS',true),0)
  assert.throws(()=>parseArgs(['--out=../unsafe']))
  assert.throws(()=>parseArgs(['--repeat=Infinity']))
})
test('U10 F15 portable JSON contains complete raw with events and identity', () => {
  const {run,records}=fixture()
  const html=renderReport(run,null,{records})
  const match=html.match(/<script type="application\/json" data-portable="sample">([\s\S]*?)<\/script>/)
  const portable=JSON.parse(match[1])
  assert.equal(portable.runs.length,2)
  assert.equal(portable.runs[0].raw.record.events[0].instanceId,'i-1')
  assert.equal(portable.runs[0].raw.record.frames.length,6)
})
test('F10 failed replay is explicitly inconclusive, not a successful 50% keyframe', () => {
  const s=finalizeSummary(good(),{checks:[{pass:true}],shots:[{name:'mid-50',file:'shots/x.png',still:{status:'INCONCLUSIVE',fraction:.5,note:'no-matching-animation-start'}}]})
  assert.equal(s.status,'INCONCLUSIVE')
  const {run}=fixture();run.scenarios[0].runs=[s]
  assert.ok(renderReport(run).includes('独立复演取证失败'))
})
test('F05 geometry, easing and secondary regression features are compared', () => {
  const baseline=_internal.collectMetrics([good()])
  const changed=good();changed.primary.easing=['ease-in']
  const after=_internal.collectMetrics([changed])
  assert.ok(_internal.compareMetrics(baseline,after).some(e=>e.status==='FAIL'&&e.metric.endsWith('easing')))
})
test('F13 appending input uses a real End key and rejects lost draft content', async () => {
  const events = [], values = ['draft', 'draft retained']
  const page = Object.create(MotionPage.prototype)
  page.click = async () => {}
  page.ev = async () => values.shift()
  page.session = { send: async (method, params) => { events.push({ method, params }) } }
  assert.equal(await page.typeText('input', ' retained'), 'draft retained')
  assert.deepEqual(events.map(e => [e.method,e.params.key ?? e.params.text]),
    [['Input.dispatchKeyEvent','End'],['Input.dispatchKeyEvent','End'],['Input.insertText',' retained']])
  values.push('draft', ' retained')
  await assert.rejects(() => page.typeText('input', ' retained'), /did not accept/)
})
test('F03 delayed transition cancellation before start retains its run instance', () => {
  const listeners = new Map()
  let now = 0
  const document = { visibilityState: 'visible', documentElement: { dataset: { theme: 'light' } },
    addEventListener: (type, handler) => listeners.set(type, handler), removeEventListener() {}, getAnimations: () => [] }
  const context = { window: {}, document, performance: { now: () => now }, location: { href: 'http://local/' },
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {} }
  runInNewContext(samplerSource, context)
  context.window.__ml.begin({ targets: [{ sel: '#a', label: 'panel' }] })
  const target = { matches: () => true, closest: () => true, isConnected: true }
  for (const [t,type] of [[0,'transitionrun'],[70,'transitioncancel'],[80,'transitionrun'],[90,'transitionstart'],[310,'transitionend']]) {
    now = t
    listeners.get(type)({ type, target, propertyName: 'transform', elapsedTime: 0, timeStamp: t })
  }
  const raw = context.window.__ml.partial()
  assert.equal(raw.events[1].instanceId, raw.events[0].instanceId)
  assert.notEqual(raw.events[2].instanceId, raw.events[0].instanceId)
  const paired = eventDuration(raw, 'panel', 'transform')
  assert.equal(paired.outcome, 'cancelled')
  assert.deepEqual(paired.segments.map(s => s.outcome), ['cancelled','ended'])
  context.window.__ml.cancel()
})
test('F05 a geometry regression in one of three valid rounds is not hidden by its median', () => {
  const before = _internal.collectMetrics([good()])
  const changed = good()
  changed.primary.interval.amplitude = 800
  const after = _internal.collectMetrics([good(),changed,good()])
  assert.ok(_internal.compareMetrics(before,after).some(e => e.metric==='panel.ty.amplitude' && e.status==='FAIL'))
})
