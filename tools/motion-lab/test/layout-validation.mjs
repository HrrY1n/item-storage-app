// Additional B08: real layout margin changes, independently from the transform perturbation.
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import { ensureEnvironment, processIdentity, repoRoot } from '../src/env.mjs'
import { newRunId, writeNewJson } from '../src/store.mjs'
import { parseArgs, runLab } from '../run.mjs'
import cost from '../src/scenarios/cost-disclosure.mjs'

const logDir = path.join(repoRoot, 'tools/motion-lab/artifacts', newRunId('layout-validation'))
await mkdir(logDir, { recursive: true })
let env, result, proof, cleanup = [], remaining = [], error
try {
  env = await ensureEnvironment({ log: console.log })
  const wrapped = { ...cost, async run(ctx) {
    const answer = await cost.run(ctx)
    proof = await ctx.page.ev('window.auditLayoutProof')
    ctx.page.faultEvidence[0].observed = proof
    return answer
  } }
  result = await runLab({ ...parseArgs([]), runId: newRunId('b08-layout') }, {
    environment: env, scenarioList: [wrapped], log: console.log,
    configurePage: async page => {
      page.skipStills = true
      page.faultEvidence = [{ id: 'B08-layout', technique: 'WAAPI margin-top; changes layout flow', armed: false }]
      page.beforeCapture = async () => {
        const armed = await page.ev(`(() => {
          const button=document.querySelector('[data-item-card]:nth-child(5) .item-card-toggle');
          const card=document.querySelector('[data-item-card]:nth-child(6)');
          if(!button||!card)return false;
          window.auditLayoutProof={maxMargin:0,minY:card.getBoundingClientRect().y,maxY:card.getBoundingClientRect().y};
          button.addEventListener('click',()=>{
            const animation=card.animate([{marginTop:'0px'},{marginTop:'30px'},{marginTop:'0px'}],{duration:300,easing:'linear'});
            const sample=()=>{
              const p=window.auditLayoutProof,y=card.getBoundingClientRect().y;
              p.maxMargin=Math.max(p.maxMargin,parseFloat(getComputedStyle(card).marginTop));
              p.minY=Math.min(p.minY,y);p.maxY=Math.max(p.maxY,y);
              if(animation.playState!=='finished')requestAnimationFrame(sample);
            };requestAnimationFrame(sample);
          },{once:true});return true;
        })()`)
        page.faultEvidence[0].armed = armed
        assert.equal(armed, true)
      }
    }
  })
  const summary = result.run.scenarios[0].runs[0]
  assert.ok(proof.maxMargin > 20 && proof.maxY - proof.minY > 20)
  assert.ok(summary.secondary.beside.interval.amplitude > 20)
  assert.ok(summary.anomalies.some(a => a.code === 'unstable-target'))
  assert.equal(result.run.status, 'FAIL')
  assert.equal(result.run.exitCode, 1)
} catch (caught) { error = String(caught.stack ?? caught) }
finally {
  if (env) {
    cleanup = await env.cleanup()
    remaining = await Promise.all([env.metadata.dev.pid,env.metadata.browser.pid].map(async pid=>({pid,identity:await processIdentity(pid)})))
  }
}
const passed = !error && result?.run.status === 'FAIL' && cleanup.every(c=>c.status==='PASS') && remaining.every(p=>p.identity===null)
const raw = result ? JSON.parse(await readFile(path.join(result.store.root,result.run.scenarios[0].runs[0].rawFile),'utf8')) : null
await writeNewJson(path.join(logDir,'results.json'),{status:passed?'PASS':'FAIL',runId:result?.run.runId,root:result?.store.root,proof,rawProof:raw?.faultInjection,cleanup,remaining,error})
console.log('Layout fault validation '+(passed?'PASS':'FAIL')+' evidence='+logDir)
process.exitCode = passed ? 0 : 1
