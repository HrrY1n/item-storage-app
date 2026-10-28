// Copy only the standalone tool sources/tests into ignored local test storage; never mutate the source tool.
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir,cp,copyFile,readFile,writeFile,access} from 'node:fs/promises'
const root=path.resolve(import.meta.dirname,'../../..')
const source=path.resolve(process.argv[2]??'D:/Codex/item-storage-motion-optimization-v2','tools/motion-lab')
const target=path.join(root,'.tmp/motionlab-runner/tools/motion-lab')
let exists=false;try{await access(target);exists=true}catch{}
assert(!exists,'Runner already exists. Reuse it; this setup never overwrites an existing runner.')
await mkdir(target,{recursive:true})
for(const name of ['src','test','run.mjs','verify.mjs','README.md'])await cp(path.join(source,name),path.join(target,name),{recursive:true,errorOnExist:true,force:false})
let file=path.join(target,'src/env.mjs'),text=await readFile(file,'utf8')
text=text.replace("export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')","export const repoRoot = path.resolve(process.env.MOTIONLAB_APP_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'))")
text=text.replace("const script = path.join(repoRoot, 'tools/motion-lab/src/dev-server.mjs')","const script = fileURLToPath(new URL('./dev-server.mjs', import.meta.url))")
assert(text.includes('process.env.MOTIONLAB_APP_ROOT'))
await writeFile(file,text)
file=path.join(target,'run.mjs');text=await readFile(file,'utf8')
text=text.replace("await collect(path.join(repoRoot, 'tools/motion-lab/src'))","await collect(path.join(motionLabRoot, 'src'))")
text=text.replace("path.relative(repoRoot, file) + ':'","path.relative(motionLabRoot, file) + ':'")
assert(text.includes("await collect(path.join(motionLabRoot, 'src'))"))
await writeFile(file,text)
const fixture='artifacts/full-run-3x/raw/bottom-nav-switch-r1.json'
await mkdir(path.dirname(path.join(target,fixture)),{recursive:true})
await copyFile(path.join(source,fixture),path.join(target,fixture))
console.log('Prepared external runner: '+target)
