import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
const git=args=>execFileSync('git',['--no-optional-locks',...args],{encoding:'utf8',windowsHide:true})
const algorithm=git(['rev-parse','--show-object-format']).trim()
const entries=git(['ls-files','--stage','-z','--','deliverables/motion-integration-final']).split('\0').filter(Boolean)
let checked=0
const mismatches=[]
for(const entry of entries){
 const match=entry.match(/^\d+ ([a-f0-9]+) 0\t([\s\S]+)$/);assert(match,'Expected an unconflicted stage-zero entry')
 const bytes=await readFile(match[2])
 const actual=createHash(algorithm).update('blob '+bytes.length+'\0').update(bytes).digest('hex')
 if(actual!==match[1])mismatches.push(match[2]);checked++
}
const result={status:mismatches.length?'FAIL':'PASS',checked,algorithm,mismatches,note:'Every staged delivery file equals its current original bytes. This generated result is added after verification.'}
await writeFile('deliverables/motion-integration-final/evidence/git-artifact-bytes.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result));assert.equal(mismatches.length,0,'Staged evidence was transformed')
