import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {spawn} from 'node:child_process'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
const integrationRoot=path.resolve(import.meta.dirname,'../../..')
const root=path.resolve(process.env.APP_TEST_ROOT??integrationRoot)
process.env.MOTIONLAB_APP_ROOT=root
const tool=path.join(integrationRoot,'tools/motion-lab')
const {ensureEnvironment}=await import(pathToFileURL(path.join(tool,'src/env.mjs')))
const out=path.join(root,'deliverables/motion-integration-final/evidence')
const checks=[]
await mkdir(out,{recursive:true})
let env
async function run(label,file) {
  await env.verifyOwnership()
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[file],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']})
    let output=''
    for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data;process.stdout.write(data)})
    child.on('error',error=>{output+=String(error)})
    child.on('close',async code=>{await writeFile(path.join(out,label+'.txt'),output);checks.push({label,code,pass:code===0});resolve(code)})
  })
}
try {
  env=await ensureEnvironment({port:9222,devPort:5173,log:console.log})
  const commands=process.argv.includes('--interactions-only') ? [[process.argv.includes('--adapted')?'interactions-adapted':'interactions-original',process.argv.includes('--adapted')?path.join(integrationRoot,'.tmp/current-interactions.mjs'):'scripts/verify-interactions.mjs']] : [['crud','scripts/verify.mjs'],['form-state','scripts/verify-form-state.mjs'],[process.argv.includes('--adapted')?'interactions-adapted':'interactions-original',process.argv.includes('--adapted')?path.join(integrationRoot,'.tmp/current-interactions.mjs'):'scripts/verify-interactions.mjs']]
  for(const [label,file] of commands) {
    if(await run(label,file)!==0)break
  }
} finally {
  const cleanup=env?await env.cleanup():[]
  await mkdir(out,{recursive:true})
  await writeFile(path.join(out,process.argv.includes('--adapted')?'business-browser-adapted.json':'business-browser.json'),JSON.stringify({checks,cleanup,environment:env?.metadata},null,2))
  process.exitCode=checks.length>0&&checks.every(c=>c.pass)&&cleanup.every(c=>c.status==='PASS')?0:1
}
