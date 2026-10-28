// Additional acceptance scenarios use the unchanged MotionLab sampler/report and actual local App.
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const integrationRoot = path.resolve(import.meta.dirname, '../../..')
const toolRoot = process.env.MOTIONLAB_TOOL_ROOT ?? path.join(integrationRoot, '.tmp/motionlab-runner/tools/motion-lab')
process.env.MOTIONLAB_APP_ROOT ??= integrationRoot
const {parseArgs, runLab} = await import(pathToFileURL(path.join(toolRoot,'run.mjs')))
const {scenarios} = await import(pathToFileURL(path.join(toolRoot,'src/scenarios/index.mjs')))
const {openItemList,CARD_LINK,panelTargets} = await import(pathToFileURL(path.join(toolRoot,'src/scenarios/lib.mjs')))
const detail = scenarios.find(s=>s.id==='item-detail-open')
const form = {
  ...detail,id:'item-form-open',title:'新增表单入场',description:'从同一合成物品列表点击新增入口，采集实际表单入场。',
  async run({page}) {
    page.skipStills=true
    await openItemList(page)
    const before=await page.screenshot('before')
    const record=await page.capture({targets:panelTargets(),click:'a.nav-add',settleMs:420,maxMs:3200})
    await page.until('!!document.querySelector("dialog input[aria-label=物品名称]")')
    await page.waitAnimationsIdle()
    const after=await page.screenshot('after')
    return {record,shots:[before,after],checks:[
      {name:'真实新增表单可编辑',pass:await page.ev('location.pathname==="/items/new" && !document.querySelector(".modal-sheet-panel").inert && document.querySelector("input[aria-label=物品名称]").value===""')},
      {name:'表单焦点不滚动外层dialog',pass:await page.ev('document.querySelector("dialog").scrollTop===0')}
    ]}
  }
}
const delayed = {
  ...detail,id:'item-detail-open-delayed',title:'异步查询延迟时的详情入场',
  description:'getActive 的结果由显式测试门控制：查询开始后等待8个真实rAF再释放；记录释放前的面板状态和运动，不通过固定sleep掩盖竞争。',
  async run({page}) {
    page.skipStills=true
    await openItemList(page)
    await page.ev(`(async()=>{
      const {itemRepository}=await import('/src/db/repositories/itemRepository.ts');
      const original=itemRepository.getActive.bind(itemRepository);
      itemRepository.getActive=(...args)=>new Promise((resolve,reject)=>{
        window.pendingItemQuery=true;
        window.releaseItemQuery=async()=>{window.queryReleasedAt=performance.now();try{resolve(await original(...args))}catch(e){reject(e)}};
      });return true;
    })()`)
    const before=await page.screenshot('before')
    const capturing=page.capture({targets:panelTargets(),click:CARD_LINK,settleMs:420,maxMs:4000})
    let pending, releaseAt
    try {
      await page.until('window.pendingItemQuery===true')
      await page.ev('new Promise(resolve=>{let n=0;const step=()=>++n===8?resolve(true):requestAnimationFrame(step);requestAnimationFrame(step)})')
      pending=await page.ev(`(()=>{const p=document.querySelector('.modal-sheet-panel'),s=p.closest('.modal-sheet');return {state:s.dataset.state,ty:new DOMMatrixReadOnly(getComputedStyle(p).transform).m42,opacity:getComputedStyle(p).opacity,loading:!!document.querySelector('dialog [role=status]'),content:!!document.querySelector('dialog h1')}})()`)
    } finally { await page.ev('window.releaseItemQuery(); true') }
    const record=await capturing
    releaseAt=await page.ev('window.queryReleasedAt')
    await page.until('!!document.querySelector("dialog h1") && !document.querySelector("dialog [role=status]")')
    await page.waitAnimationsIdle()
    const after=await page.screenshot('after')
    record.testQueryGate={releaseAt,pending,releaseAfterRaf:8}
    return {record,shots:[before,after],checks:[
      {name:'延迟查询阶段有明确加载占位',pass:pending.loading},
      {name:'释放查询后显示当前物品且无空白',pass:await page.ev('!!document.querySelector("dialog h1") && document.querySelector(".modal-sheet").dataset.state==="open"')}
    ],notes:['Explicit query gate: '+JSON.stringify({releaseAt,pending})]}
  }
}
const landscape = {...detail,id:'item-detail-open-landscape',title:'横屏详情入场',viewport:{width:844,height:390,dpr:2},
  async run(ctx) {
    const result=await detail.run(ctx)
    result.checks.push({name:'横屏面板在实际视口内且无横向溢出',pass:await ctx.page.ev(`(()=>{const p=document.querySelector('.modal-sheet-panel'),r=p.getBoundingClientRect();return r.top>=-1&&r.bottom<=innerHeight+1&&r.left>=-1&&r.right<=innerWidth+1&&p.scrollWidth<=p.clientWidth+1})()`)})
    return result
  }
}
const options={...parseArgs(process.argv.slice(2)),acceptanceFingerprint:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')}
const extras=[form,delayed,landscape]
const list=options.scenario.includes('all') ? [...scenarios,...extras] : options.scenario.map(id=>[...scenarios,...extras].find(s=>s.id===id))
if(list.some(s=>!s))throw new Error('Unknown acceptance scenario')
const {run}=await runLab(options,{scenarioList:list})
process.exitCode=run.exitCode
