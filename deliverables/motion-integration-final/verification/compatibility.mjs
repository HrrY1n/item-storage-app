import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
const appRoot = process.cwd()
const toolRoot = process.env.MOTIONLAB_TOOL_ROOT ?? path.join(appRoot, '.tmp/motionlab-runner/tools/motion-lab')
process.env.MOTIONLAB_APP_ROOT = appRoot
const { ensureEnvironment } = await import(pathToFileURL(path.join(toolRoot, 'src/env.mjs')))
const { openMotionPage } = await import(pathToFileURL(path.join(toolRoot, 'src/page.mjs')))
const output = path.resolve(process.argv[2] ?? 'deliverables/motion-integration-final/evidence/compatibility.json')
const fixture = '/deliverables/motion-integration-final/verification/compatibility-fixture.html'
const checks = []
let env, page
const check = (name, pass, evidence) => { checks.push({name, pass: Boolean(pass), evidence}); console.log((pass ? 'PASS ' : 'FAIL ') + name) }
async function fresh(controlled = false) {
  if (page) { const cleanup = await page.disposeContext(); assert.equal(cleanup.status, 'PASS') }
  page = await openMotionPage(env)
  await page.setViewport({width:390,height:844,dpr:2})
  await page.setReducedMotion(false)
  await page.goto(fixture + (controlled ? '?controlled=1' : ''), {waitSelector:'#fixture'})
  await page.until('typeof window.fixture?.mount === typeof (() => {})')
}
const state = () => page.ev('window.fixture.snapshot()')
try {
  env = await ensureEnvironment({port:9222,devPort:5173,log:console.log})
  for (const completedFrames of [1, 2]) {
    await fresh(true)
    await page.ev('window.fixture.mount(); true')
    for (let frame = 0; frame < completedFrames; frame++) await page.ev('window.fixture.step(); true')
    await page.ev('window.fixture.unmount(); true')
    const result = await state()
    check(`entry unmount after frame ${completedFrames} cancels the next frame`, result.pendingFrames === 0 && !result.dialog && result.overflow === '', result)
  }
  await fresh(true)
  await page.ev('window.fixture.mount(); true')
  const pending = await state()
  check('entry renders a loading status before deferred content', !pending.content && await page.ev('!!document.querySelector("[role=status]")'), pending)
  for (let frame=0; frame<3; frame++) await page.ev('window.fixture.step(); true')
  await page.until('!!document.querySelector("[data-content]")')
  check('third frame releases content with no fixed delay', (await state()).content === '/items/synthetic-a', await state())
  await fresh()
  await page.setReducedMotion(true)
  await page.ev('window.fixture.mount(); true')
  await page.until('!!document.querySelector("[data-content]")')
  const reduceProof=await page.ev('({matches:matchMedia("(prefers-reduced-motion: reduce)").matches,animations:document.getAnimations().map(a=>({property:a.transitionProperty,name:a.animationName,state:a.playState,duration:a.effect?.getComputedTiming().duration,target:a.effect?.target?.className}))})')
  console.log('REDUCE_PROOF '+JSON.stringify(reduceProof))
  const panelAnimations=await page.ev('[...document.querySelectorAll(".modal-sheet-panel,.modal-sheet-backdrop")].flatMap(el=>el.getAnimations()).map(a=>({duration:a.effect?.getComputedTiming().duration,property:a.transitionProperty}))')
  check('reduced motion releases panel content immediately', reduceProof.matches && panelAnimations.every(a=>Number(a.duration)<=50), {...await state(),...reduceProof,panelAnimations})
  await page.ev('window.fixture.patch({open:false}); true')
  await page.until('!document.querySelector("dialog[open]")')
  check('reduced motion releases scroll lock and exits once', (await state()).exits === 1 && (await state()).overflow === '', await state())
  await fresh()
  await page.ev('window.fixture.mount("sheet"); true')
  await page.waitAnimationsIdle()
  const frozen = await page.ev(`(() => {
    window.fixture.patch({open:false});
    const panel=document.querySelector('.modal-sheet-panel'); getComputedStyle(panel).transform;
    window.exitAnimation=panel.getAnimations().find(a=>a.transitionProperty==='transform');
    window.exitAnimation?.pause(); return !!window.exitAnimation;
  })()`)
  assert(frozen, 'A real exit transform transition must exist')
  // Explicitly exceed the 460ms watchdog to test a paused transition, not to hide a rendering race.
  await page.ev('new Promise(resolve=>setTimeout(resolve,650))')
  check('paused exit survives the normal fallback deadline', (await state()).dialog && (await state()).exits===0, await state())
  await page.ev('window.exitAnimation.play(); true')
  await page.until('!document.querySelector("dialog[open]")')
  check('resuming paused exit unloads and unlocks once', (await state()).exits===1 && (await state()).overflow==='', await state())
  await fresh()
  await page.ev('window.fixture.mount("sheet"); true')
  await page.waitAnimationsIdle()
  await page.ev(`(() => {window.fixture.patch({open:false});const panel=document.querySelector('.modal-sheet-panel');getComputedStyle(panel).transform;panel.getAnimations().forEach(a=>a.cancel());return true})()`)
  await page.until('!document.querySelector("dialog[open]")')
  check('cancelled exit still unloads via fallback', (await state()).exits===1 && (await state()).overflow==='', await state())
  await fresh()
  await page.ev('window.fixture.mount("sheet"); true')
  await page.waitAnimationsIdle()
  await page.ev(`(() => {
    const panel=document.querySelector('.modal-sheet-panel');window.unrelated=panel.animate([{opacity:1},{opacity:1}],{duration:5000});window.unrelated.pause();
    window.fixture.patch({open:false});getComputedStyle(panel).transform;
    panel.getAnimations().filter(a=>a.transitionProperty==='transform').forEach(a=>a.cancel());return true;
  })()`)
  let exited = true
  try { await page.until('!document.querySelector("dialog[open]")', {timeoutMs:1200}) } catch { exited=false }
  check('an unrelated paused animation cannot retain a cancelled exit', exited && (await state()).exits===1 && (await state()).overflow==='', await state())
  await fresh()
  await page.ev('window.fixture.mount("sheet"); true')
  await page.waitAnimationsIdle()
  await page.ev(`(() => {window.fixture.patch({open:false});getComputedStyle(document.querySelector('.modal-sheet-panel')).transform;window.fixture.patch({open:true});return true})()`)
  await page.waitAnimationsIdle()
  check('reopening during exit keeps the current sheet and callback state', (await state()).dialog && (await state()).exits===0, await state())
  await page.ev('window.fixture.patch({open:false}); true')
  await page.until('!document.querySelector("dialog[open]")')
  check('final close after interruption unloads exactly once', (await state()).exits===1 && (await state()).overflow==='', await state())
  check('fixture has no runtime or network errors', !page.exceptions.length && !page.blocked.length, {exceptions:page.exceptions,blocked:page.blocked})
} catch(error) { checks.push({name:'harness',pass:false,error:String(error.stack??error)}); console.error(error) }
finally {
  if(page) checks.push({name:'context cleanup',pass:(await page.disposeContext()).status==='PASS'})
  const cleanup = env ? await env.cleanup() : []
  for(const result of cleanup) checks.push({name:'owned '+result.resource+' cleanup',pass:result.status==='PASS',evidence:result})
  await mkdir(path.dirname(output),{recursive:true})
  await writeFile(output,JSON.stringify({checks,status:checks.every(c=>c.pass)?'PASS':'FAIL',environment:env?.metadata},null,2))
  process.exitCode=checks.every(c=>c.pass)?0:1
}
