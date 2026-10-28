// Supplemental integration checks: actual App + synthetic data, with controlled late result and viewport sizes.
import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {writeFile} from 'node:fs/promises'
const root=process.cwd()
process.env.MOTIONLAB_APP_ROOT=root
const tool=path.join(root,'.tmp/motionlab-runner/tools/motion-lab')
const {ensureEnvironment}=await import(pathToFileURL(path.join(tool,'src/env.mjs')))
const {openMotionPage}=await import(pathToFileURL(path.join(tool,'src/page.mjs')))
const {openItemList}=await import(pathToFileURL(path.join(tool,'src/scenarios/lib.mjs')))
const checks=[]
let env,page
const check=(name,pass,evidence)=>{checks.push({name,pass:!!pass,evidence});console.log((pass?'PASS ':'FAIL ')+name)}
try {
  env=await ensureEnvironment({port:9223,devPort:5174,log:console.log})
  page=await openMotionPage(env)
  await page.setViewport({width:390,height:844,dpr:2})
  await page.setReducedMotion(false)
  await openItemList(page,{prefix:'集成边界合成样品'})
  const links=await page.ev('[...document.querySelectorAll("[data-item-card] a")].map(a=>({href:a.getAttribute("href"),name:a.querySelector("h2,h3")?.textContent??a.textContent}))')
  const [a,b]=links
  await page.ev(`(async()=>{
    const {itemRepository}=await import('/src/db/repositories/itemRepository.ts');
    const original=itemRepository.getActive.bind(itemRepository);window.lateResolves=[];
    itemRepository.getActive=(id)=>id===${JSON.stringify(a.href.split('/').at(-1))}
      ?new Promise((resolve,reject)=>{window.queryPending=true;window.lateResolves.push(()=>original(id).then(resolve,reject))})
      :original(id);
  })()`)
  await page.click('a[href="'+a.href+'"]')
  await page.until('window.queryPending===true && !!document.querySelector("dialog [role=status]")')
  await page.pressEscape()
  await page.until('!document.querySelector("dialog[open]")')
  check('close before data resolves releases the list and scroll lock',await page.ev('location.pathname==="/items" && document.body.style.overflow===""'))
  await page.click('a[href="'+b.href+'"]')
  await page.until('!!document.querySelector("dialog h1") && !document.querySelector("dialog [role=status]")')
  const currentTitle=await page.ev('document.querySelector("dialog h1").textContent')
  await page.ev('Promise.all(window.lateResolves.map(release=>release())).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))')
  check('late result for the first item cannot replace the second item',await page.ev('location.pathname==='+JSON.stringify(b.href)+' && document.querySelector("dialog h1").textContent==='+JSON.stringify(currentTitle)),{currentTitle,path:b.href})
  await page.ev(`import('/src/db/db.ts').then(({db})=>db.items.update(${JSON.stringify(b.href.split('/').at(-1))},{note:Array(120).fill('仅用于本轮验收的长内容').join(String.fromCharCode(10))}))`)
  await page.until('document.querySelector(".modal-sheet-panel").scrollHeight>document.querySelector(".modal-sheet-panel").clientHeight+100')
  for(const [width,height,label] of [[390,844,'portrait'],[320,568,'small'],[844,390,'landscape'],[390,650,'toolbar-size simulation'],[390,420,'available-height simulation'],[390,844,'restored portrait']]) {
    await page.setViewport({width,height,dpr:2})
    await page.waitAnimationsIdle()
    const proof=await page.ev(`(()=>{const p=document.querySelector('.modal-sheet-panel'),r=p.getBoundingClientRect();return {innerWidth,innerHeight,visualHeight:visualViewport.height,panel:r.toJSON(),client:p.clientHeight,scroll:p.scrollHeight,maxHeight:getComputedStyle(p).maxHeight,outerScroll:p.closest('dialog').scrollTop,ty:new DOMMatrixReadOnly(getComputedStyle(p).transform).m42}})()`)
    check(label+' stays within the current viewport',proof.panel.top>=-1&&proof.panel.bottom<=height+1&&proof.panel.left>=-1&&proof.panel.right<=width+1&&proof.outerScroll===0&&Math.abs(proof.ty)<1,proof)
  }
  await page.ev('document.querySelector(".modal-sheet-panel").scrollTop=240; true')
  check('long content scrolls inside the panel',await page.ev('document.querySelector(".modal-sheet-panel").scrollTop>=230 && document.querySelector("dialog").scrollTop===0'))
  await page.ev('document.querySelector(".modal-sheet-panel").scrollTop=0; true')
  await page.dispatchTouchDrag({from:[100,280],steps:[[140,20,70]],holdMs:120})
  await page.waitAnimationsIdle()
  check('diagonal horizontal gesture leaves the detail open at rest',await page.ev('!!document.querySelector("dialog[open]") && !document.querySelector("[data-dragging=true]") && Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".modal-sheet-panel")).transform).m42)<1'))
  const point=await page.prepareClick('.modal-sheet-grip')
  await page.session.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point})
  await page.session.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:point.x,y:point.y+90})
  const dragged=await page.ev('document.querySelector(".modal-sheet").dataset.dragging==="true"')
  await page.ev('document.querySelector(".modal-sheet-panel").dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:1,pointerType:"mouse"})); true')
  await page.session.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:point.x,y:point.y+90})
  await page.waitAnimationsIdle()
  check('pointercancel resets an active pointer drag without dismissing',dragged&&await page.ev('!!document.querySelector("dialog[open]") && !document.querySelector("[data-dragging=true]") && Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".modal-sheet-panel")).transform).m42)<1'),{cancelInput:'synthetic DOM PointerEvent following trusted CDP mouse drag'})
  await page.pressEscape()
  await page.until('!document.querySelector("dialog[open]")')
  await page.click('a.nav-add')
  await page.until('!!document.querySelector("dialog input[aria-label=物品名称]")')
  await page.typeText('dialog input[aria-label=物品名称]','合成键盘视口草稿')
  await page.setViewport({width:390,height:420,dpr:2})
  await page.waitAnimationsIdle()
  check('focused form survives a smaller available viewport',await page.ev('document.querySelector("dialog input[aria-label=物品名称]").value==="合成键盘视口草稿" && document.querySelector(".modal-sheet-panel").getBoundingClientRect().bottom<=innerHeight+1'))
  await page.setViewport({width:390,height:844,dpr:2})
  check('restoring viewport preserves the same draft',await page.ev('document.querySelector("dialog input[aria-label=物品名称]").value==="合成键盘视口草稿"'))
  check('no runtime, CDP or forbidden network errors',!page.exceptions.length&&!page.session.errors.length&&!page.blocked.length,{exceptions:page.exceptions,errors:page.session.errors,blocked:page.blocked})
} catch(error){checks.push({name:'harness',pass:false,error:String(error.stack??error)});console.error(error)}
finally {
  if(page)checks.push({name:'context cleanup',pass:(await page.disposeContext()).status==='PASS'})
  const cleanup=env?await env.cleanup():[]
  for(const c of cleanup)checks.push({name:'owned '+c.resource+' cleanup',pass:c.status==='PASS',evidence:c})
  await writeFile(path.join(root,'deliverables/motion-integration-final/evidence/app-edges.json'),JSON.stringify({status:checks.every(c=>c.pass)?'PASS':'FAIL',checks,environment:env?.metadata,limits:'Viewport changes simulate available space; this is not an iPhone Safari toolbar or real software-keyboard test.'},null,2))
  process.exitCode=checks.every(c=>c.pass)?0:1
}
