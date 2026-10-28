import assert from 'node:assert/strict'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readFile,writeFile,stat,lstat,readdir,access} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
const root=process.cwd(),out=path.join(root,'deliverables/motion-integration-final/evidence')
const original=JSON.parse((await readFile(path.join(out,'protected-repositories-before.json'),'utf8')).replace(/^\uFEFF/,''))
const git=(dir,args)=>execFileSync('git',['--no-optional-locks',...args],{cwd:dir,encoding:'utf8',windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim()
const repositories=[]
for(const before of original) {
 const missing=[],changed=[]
 for(const file of before.files) {
  try {const hash=createHash('sha256').update(await readFile(path.join(before.root,file.path))).digest('hex').toUpperCase();if(hash!==file.sha256)changed.push(file.path)}
  catch(error){missing.push({path:file.path,error:String(error)})}
 }
 const head=git(before.root,['rev-parse','HEAD']),branch=git(before.root,['branch','--show-current'])
 const status=git(before.root,['status','--porcelain=v1','--untracked-files=all']).split(/\r?\n/).filter(Boolean)
 const same=JSON.stringify(status)===JSON.stringify(before.status)
 repositories.push({root:before.root,filesChecked:before.files.length,head,branch,headUnchanged:head===before.head,branchUnchanged:branch===before.branch,statusUnchanged:same,changed,missing})
}
const clones=[]
for(const dir of [root,path.join(root,'.tmp/before-app')]) {
 const common=path.resolve(dir,git(dir,['rev-parse','--git-common-dir']))
 const packRoot=path.join(dir,'.git/objects/pack'),packs=[]
 for(const name of await readdir(packRoot)){const s=await stat(path.join(packRoot,name));packs.push({name,links:s.nlink})}
 let alternates=false;try{await access(path.join(dir,'.git/objects/info/alternates'));alternates=true}catch{}
 const trackedNames=git(dir,['ls-files','-z']).split('\0').filter(Boolean)
 const hardlinkedFiles=[]
 for(const name of trackedNames){const s=await stat(path.join(dir,name));if(s.nlink!==1)hardlinkedFiles.push({name,links:s.nlink})}
 clones.push({root:dir,trackedFilesChecked:trackedNames.length,hardlinkedFiles,gitDirectory:(await lstat(path.join(dir,'.git'))).isDirectory(),common,commonIsLocal:common===path.join(dir,'.git'),alternates,packs})
}
const changedApp=git(root,['diff','--name-only','fa8fa77','HEAD','--','src','worker','scripts','package.json','package-lock.json']).split(/\r?\n/).filter(Boolean).sort()
const expected=['src/components/ItemPanel.tsx','src/components/ModalSheet.tsx','src/index.css','src/pages/ItemDetailPage.tsx','src/pages/ItemFormPage.tsx'].sort()
const passed=repositories.every(r=>r.headUnchanged&&r.branchUnchanged&&r.statusUnchanged&&!r.changed.length&&!r.missing.length)&&clones.every(c=>c.hardlinkedFiles.length===0&&c.gitDirectory&&c.commonIsLocal&&!c.alternates&&c.packs.every(p=>p.links===1))&&JSON.stringify(changedApp)===JSON.stringify(expected)
const result={status:passed?'PASS':'FAIL',checkedAt:new Date().toISOString(),filesChecked:repositories.reduce((n,r)=>n+r.filesChecked,0),repositories,clones,changedApp,scope:'Tracked and non-ignored untracked files plus HEAD/branch/status; no original ignored data directories were accessed or written by tests.'}
await writeFile(path.join(out,'protected-repositories-after.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({status:result.status,filesChecked:result.filesChecked,repositories:repositories.map(r=>({root:r.root,changed:r.changed.length,missing:r.missing.length,statusUnchanged:r.statusUnchanged})),changedApp},null,2))
assert(passed,'Original integrity or integration scope failed')
