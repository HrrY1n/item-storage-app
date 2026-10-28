import assert from 'node:assert/strict'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readFile,writeFile,stat} from 'node:fs/promises'
import {pathToFileURL,fileURLToPath} from 'node:url'
const root=process.cwd(),out=path.join(root,'deliverables/motion-integration-final')
process.env.MOTIONLAB_APP_ROOT=root
const tool=path.join(root,'.tmp/motionlab-runner/tools/motion-lab')
const {ensureEnvironment}=await import(pathToFileURL(path.join(tool,'src/env.mjs')))
const {openMotionPage}=await import(pathToFileURL(path.join(tool,'src/page.mjs')))
const result={filesHashed:0,localReferencesChecked:0,pages:[],errors:[]}
for(const side of ['before','after']){
 const base=path.join(out,'motionlab',side),manifest=JSON.parse(await readFile(path.join(base,'manifest.json'),'utf8'))
 for(const entry of manifest.integrity.files){const hash=createHash('sha256').update(await readFile(path.join(base,entry.file))).digest('hex');assert.equal(hash,entry.sha256,side+'/'+entry.file);result.filesHashed++}
}
for(const name of ['CHANGELOG.md','TEST_RESULTS.md','BEFORE_AFTER.md','IPHONE_ACCEPTANCE.md','INTEGRATION_RESULT.md','app-motion.patch'])assert((await stat(path.join(out,name))).size>0)
for(const name of ['index.html','motionlab/before/report.html','motionlab/after/report.html']){
 const file=path.join(out,name),html=await readFile(file,'utf8')
 for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
  const ref=match[1].replaceAll('&amp;','&')
  if(ref.startsWith('#')||/^(data:|blob:|https?:)/i.test(ref))continue
  const url=new URL(ref,pathToFileURL(file));url.hash='';url.search=''
  const target=fileURLToPath(url)
  assert(target.startsWith(out+path.sep),'Unexpected reference outside delivery: '+target)
  assert((await stat(target)).isFile(),'Missing local reference '+ref);result.localReferencesChecked++
 }
}
let env,page
try{
 env=await ensureEnvironment({port:9222,devPort:5173,log:console.log})
 page=await openMotionPage(env);await page.setViewport({width:1280,height:900,dpr:1,mobile:false})
 for(const name of ['index.html','motionlab/before/report.html','motionlab/after/report.html']){
  await page.goto('/deliverables/motion-integration-final/'+name,{waitSelector:'h1'});await page.waitAnimationsIdle()
  result.pages.push({name,title:await page.ev('document.title'),h1:await page.ev('document.querySelector("h1").textContent')})
  if(name==='index.html'){
   let shot=await page.screenshot('report-preview');await writeFile(path.join(out,'evidence/report-preview.png'),Buffer.from(shot.data,'base64'))
   await page.ev('document.querySelectorAll("section")[2].scrollIntoView({block:"start"});true')
   await page.until('[...document.querySelectorAll("section")[2].querySelectorAll("img")].every(img=>img.complete&&img.naturalWidth>0)')
   shot=await page.screenshot('report-chart-preview');await writeFile(path.join(out,'evidence/report-chart-preview.png'),Buffer.from(shot.data,'base64'))
  }
 }
 assert.equal(page.exceptions.length,0);assert.equal(page.blocked.length,0);assert.equal(page.session.errors.length,0)
}catch(error){result.errors.push(String(error.stack??error));console.error(error)}
finally{
 if(page)result.contextCleanup=await page.disposeContext()
 result.cleanup=env?await env.cleanup():[]
 result.status=result.errors.length===0&&result.contextCleanup?.status==='PASS'&&result.cleanup.every(c=>c.status==='PASS')?'PASS':'FAIL'
 await writeFile(path.join(out,'evidence/delivery-validation.json'),JSON.stringify(result,null,2))
 console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='PASS'?0:1
}
