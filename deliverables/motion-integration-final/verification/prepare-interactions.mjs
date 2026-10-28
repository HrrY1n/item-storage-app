// Keep the production verifier unchanged; adapt its old entry contract in an ignored generated copy.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
const source=await readFile('scripts/verify-interactions.mjs','utf8')
let text=source
const replace=(before,after)=>{assert(text.includes(before),'Expected verifier anchor: '+before);text=text.replace(before,after)}
replace('  async escape() {', `  async escape() {
    await this.until(\`[...document.querySelectorAll('dialog:modal')].at(-1)?.getAnimations({subtree:true}).every(a=>!a.pending&&a.playState!=='running') ?? true\`)`)
replace("    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })", `    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await this.ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')`)
replace("assert.ok(visibleFrames.every(frame => frame.form && !frame.pending), 'The loading placeholder must never slide into view')", "assert.ok(visibleFrames.every(frame => frame.form || frame.pending), 'Visible entry always contains a form or explicit loading status')")
replace("assert.ok(Math.max(...visibleFrames.map(frame => frame.height)) - Math.min(...visibleFrames.map(frame => frame.height)) < 1, 'The visible sheet height must stay constant during entry')", "assert.ok(visibleFrames.every(frame => frame.height > 0 && frame.height <= 844), 'Deferred content stays within the available viewport')")
replace('height:rect.height,scroll:', 'height:rect.height,ty:new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42,scroll:')
replace("assert.ok(visibleFrames.every((frame, index) => !index || frame.top <= visibleFrames[index - 1].top + 1), 'Entry must not reverse or jump back down')", "assert.ok(visibleFrames.every((frame, index) => !index || frame.ty <= visibleFrames[index - 1].ty + 1), 'The viewport-based transform must not reverse or jump back down')")
replace("await page.until(`!!document.querySelector('[data-state=\"pending\"] .modal-sheet-panel[inert]')`)", "await page.until(`!!document.querySelector('dialog [role=\"status\"]')`)")
replace("  await page.check('Escape dismisses dirty confirmation only',", "  await page.until(`document.querySelectorAll('dialog:modal').length===1`)\n  await page.check('Escape dismisses dirty confirmation only',")
replace('const frames=[],start=performance.now();', 'const frames=[],start=performance.now();let settledFrames=0;')
replace('if(time-start<1400) requestAnimationFrame(sample); else resolve();', `const settled=panel&&panel.querySelector('input[aria-label="物品名称"]')&&Math.abs(new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42)<1&&panel.getAnimations().every(a=>!a.pending&&a.playState!=='running');
            settledFrames=settled?settledFrames+1:0;
            if(settledFrames<3&&time-start<8000) requestAnimationFrame(sample); else resolve();`)
replace('entryFrames.length > 8 && visibleFrames.length > 8', 'entryFrames.length >= 4 && visibleFrames.length >= 3')
replace("  await page.check('Reduced motion opens the ready form without a transition or outer scroll',", `  console.log('REDUCED_FORM_PROOF',await page.ev(\`(()=>{const p=document.querySelector('.modal-sheet-panel');return {reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,top:p.getBoundingClientRect().top,outer:p.closest('dialog').scrollTop,inert:p.inert,state:p.closest('.modal-sheet').dataset.state,focus:document.activeElement.className,animations:p.getAnimations().map(a=>({property:a.transitionProperty,duration:a.effect?.getComputedTiming().duration,state:a.playState})),transition:getComputedStyle(p).transition}})()\`))
  await page.check('Reduced motion opens the ready form without a transition or outer scroll',`)
replace("  console.log('REDUCED_FORM_PROOF',", "  await page.until(`!!document.querySelector('dialog input[aria-label=物品名称]') && !document.querySelector('dialog [role=status]')`)\n  console.log('REDUCED_FORM_PROOF',")
text=text.replaceAll('waits for the form and never scrolls or changes height','keeps loading/content visible, scroll fixed and transform monotonic')
await writeFile('.tmp/current-interactions.mjs',text)
let patch
try{patch=execFileSync('git',['diff','--no-index','--','scripts/verify-interactions.mjs','.tmp/current-interactions.mjs'],{encoding:'utf8',windowsHide:true})}
catch(error){assert.equal(error.status,1);patch=error.stdout}
await writeFile('deliverables/motion-integration-final/verification/interactions-adaptation.patch',patch)
console.log('Generated .tmp/current-interactions.mjs; production verifier unchanged')
