// Reuse MotionLab's SVG renderer and the accepted v2 report stylesheet; derive all numbers from fresh raw files.
import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {readFile,writeFile,mkdir,cp,copyFile,access} from 'node:fs/promises'
const root=process.cwd(),out=path.join(root,'deliverables/motion-integration-final')
const runner=path.join(root,'.tmp/motionlab-runner/tools/motion-lab')
const {svgCurve}=await import(pathToFileURL(path.join(runner,'src/report.mjs')))
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''))
const beforeRoot=path.join(runner,'artifacts/before-final-20261029'),afterRoot=path.join(runner,'artifacts/after-final-20261029')
const before=await json(path.join(beforeRoot,'manifest.json')),after=await json(path.join(afterRoot,'manifest.json'))
assert.equal(before.source.toolFingerprint,after.source.toolFingerprint,'Same tool required')
assert.equal(before.options.acceptanceFingerprint,after.options.acceptanceFingerprint,'Same extra scenario source required')
assert.equal(before.env.browser.browser,after.env.browser.browser)
assert.equal(before.env.node,after.env.node)
assert.equal(before.env.dev.root,path.join(root,'.tmp/before-app'))
assert.equal(after.env.dev.root,root)
assert.equal(before.scenarios.length,17);assert.equal(after.scenarios.length,17)
assert.equal(after.status,'PASS','Do not label a failing integration accepted')
const integrity=await json(path.join(out,'evidence/protected-repositories-after.json'));assert.equal(integrity.status,'PASS')
const compatibility=await json(path.join(out,'evidence/compatibility-pass.json'))
const edges=await json(path.join(out,'evidence/app-edges.json'))
assert.equal(compatibility.status,'PASS');assert.equal(edges.status,'PASS')
const browser=await json(path.join(out,'evidence/business-browser.json'))
assert(browser.checks.filter(c=>['crud','form-state'].includes(c.label)).every(c=>c.pass))
const adapted=await json(path.join(out,'evidence/business-browser-adapted.json'));assert(adapted.checks.every(c=>c.pass))
const interactions=await json(path.join(root,'.tmp/browser-verification/interactions/results.json'));assert.equal(interactions.errors.length,0)
await copyFile(path.join(root,'.tmp/browser-verification/interactions/results.json'),path.join(out,'evidence/interactions-results.json'))
await copyFile(path.join(root,'.tmp/form-state-verification/results.json'),path.join(out,'evidence/form-state-results.json'))
for(const rate of [1,4])await copyFile(path.join(root,`.tmp/browser-verification/interactions/creation-entry-frames-${rate}x.json`),path.join(out,`evidence/creation-entry-frames-${rate}x.json`))
const unit=await readFile(path.join(out,'evidence/unit.txt'),'utf8'),typecheck=await readFile(path.join(out,'evidence/typecheck.txt'),'utf8'),build=await readFile(path.join(out,'evidence/build.txt'),'utf8')
const unitCount=Number(unit.match(/Tests\s+(\d+) passed/)?.[1]);assert(unitCount>0);assert(!/error TS\d/.test(typecheck));assert(build.includes('379 entries'))
const toolUnit=await readFile(path.join(out,'evidence/motionlab-unit-final.txt'),'utf8');assert(/pass 44/.test(toolUnit))
for(const [name,dir] of [['before',beforeRoot],['after',afterRoot]]) {
 const target=path.join(out,'motionlab',name)
 let exists=false;try{await access(target);exists=true}catch{}
 assert(!exists,'Refuse to overwrite copied evidence '+target)
 await mkdir(path.dirname(target),{recursive:true});await cp(dir,target,{recursive:true,errorOnExist:true,force:false})
}
const median=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2:null}
const stats=values=>{const a=values.filter(Number.isFinite);return{n:a.length,median:median(a),min:a.length?Math.min(...a):null,max:a.length?Math.max(...a):null}}
const fmt=n=>Number.isFinite(n)?n.toFixed(1):'—'
const range=s=>`${fmt(s.median)} (${fmt(s.min)}–${fmt(s.max)}, n=${s.n})`
const count=run=>{const rounds=run.scenarios.flatMap(s=>s.runs);return {total:rounds.length,pass:rounds.filter(r=>r.status==='PASS').length,fail:rounds.filter(r=>r.status==='FAIL').length,inconclusive:rounds.filter(r=>r.status==='INCONCLUSIVE').length,warnings:rounds.flatMap(r=>r.anomalies??[]).filter(a=>a.level==='warn').length}}
const rawMap=new Map()
for(const [side,run,dir]of[['before',before,beforeRoot],['after',after,afterRoot]])for(const scene of run.scenarios)for(const r of scene.runs)rawMap.set(`${side}/${scene.id}/${r.runIndex}`,await json(path.join(dir,r.rawFile)))
function observation(raw,summary){
 const input=summary.latencyChain?.inputReceivedAt
 const entry=raw.record.frames.find(f=>{const p=f.tg.panel;return Number.isFinite(input)&&f.t>=input&&p&&p.o>.02&&p.y<raw.record.meta.viewport.h-1&&p.y+p.h>1&&p.w>0})
 let previous=null,visibleReversals=0,allIncreases=0,maxIncrease=0
 for(const frame of raw.record.frames){const p=frame.tg.panel;if(!p||!Number.isFinite(p.ty)){previous=null;continue}if(previous&&p.id===previous.id&&p.ty-previous.ty>1){allIncreases++;maxIncrease=Math.max(maxIncrease,p.ty-previous.ty);if(p.o>.02&&previous.o>.02&&p.y<raw.record.meta.viewport.h&&previous.y<raw.record.meta.viewport.h)visibleReversals++}previous=p}
 return {inputToFirstGeometryMs:Number.isFinite(input)&&Number.isFinite(summary.latencyChain?.firstChangeAt)?summary.latencyChain.firstChangeAt-input:null,inputToPanelInViewMs:entry?entry.t-input:null,inputToReadyMs:Number.isFinite(input)&&Number.isFinite(summary.latencyChain?.readyAt)?summary.latencyChain.readyAt-input:null,visibleReversals,allIncreases,maxIncrease,queryGate:raw.record.testQueryGate??null}
}
const rows=after.scenarios.map(scene=>{
 const a=before.scenarios.find(s=>s.id===scene.id);assert(a&&a.runs.length===3&&scene.runs.length===3)
 const list=(side,entry)=>entry.runs.map(r=>({runIndex:r.runIndex,status:r.status,...observation(rawMap.get(`${side}/${scene.id}/${r.runIndex}`),r)}))
 const aRows=list('before',a),bRows=list('after',scene)
 const aggregate=r=>({firstGeometry:stats(r.map(v=>v.inputToFirstGeometryMs)),panelInView:stats(r.map(v=>v.inputToPanelInViewMs)),ready:stats(r.map(v=>v.inputToReadyMs)),visibleReversals:r.reduce((n,v)=>n+v.visibleReversals,0)})
 return{id:scene.id,title:scene.title,before:aRows,after:bRows,a:aggregate(aRows),b:aggregate(bRows),statuses:scene.runs.map(r=>r.status)}
})
const comparison={generatedAt:new Date().toISOString(),before:{...count(before),source:before.source,environment:before.env},after:{...count(after),source:after.source,environment:after.env},acceptanceFingerprint:after.options.acceptanceFingerprint,rows,definition:'Page-clock input arrival to first sampled geometry/style change, or panel opacity>0.02 with viewport intersection. These are DOM/rAF observations, not pixel presentation latency or hardware FPS.'}
await writeFile(path.join(out,'evidence/comparison.json'),JSON.stringify(comparison,null,2))
const basic=rows.find(r=>r.id==='item-detail-open'),delayed=rows.find(r=>r.id==='item-detail-open-delayed')
const moved=list=>list.filter(r=>r.queryGate?.pending.state==='open'&&Number(r.queryGate.pending.opacity)>.02&&r.queryGate.pending.ty<844-1).length
const table=['| 场景 | 原版 输入→首变 ms（中位/范围） | 集成版 输入→首变 ms | 集成版三轮 |','| --- | --- | --- | --- |',...rows.map(r=>`| ${r.id} | ${range(r.a.firstGeometry)} | ${range(r.b.firstGeometry)} | ${r.statuses.join(' / ')} |`)].join('\n')
const verified=`基线${before.source.commit.slice(0,7)}、集成App${after.source.commit.slice(0,7)}；${after.env.browser.browser}、${after.env.node}、同一工具指纹${after.source.toolFingerprint.slice(0,16)}、扩展场景指纹${after.options.acceptanceFingerprint.slice(0,16)}。开发构建；通常390×844@2x，小屏360×760，横屏844×390；同一合成种子及CDP鼠标/触摸。两套服务分别核验实际源码root与SHA256指纹。`
const observationText=`正常详情：输入→首次几何/样式变化，原版${range(basic.a.firstGeometry)}ms，集成版${range(basic.b.firstGeometry)}ms；面板首次进入视口（几何判定），原版${range(basic.a.panelInView)}ms，集成版${range(basic.b.panelInView)}ms。每侧n=3，未做统计显著性检验，不将小样本中位差称为确定性能提升。`
const asyncText=`受控异步查询尚未释放时，原版${moved(delayed.before)}/3轮面板已打开并移动，集成版${moved(delayed.after)}/3轮；两侧均有明确加载占位并在释放查询后显示当前物品。它证明入场与查询结果解耦，不是真机性能认证。`
await writeFile(path.join(out,'BEFORE_AFTER.md'),`# 本轮前后对比\n\n${verified}\n\n${observationText}\n\n${asyncText}\n\n原版状态：${before.status}（${JSON.stringify(count(before))}）；集成版状态：${after.status}（${JSON.stringify(count(after))}）。\n\n${table}\n\n曲线与截图见[index.html](index.html)，完整本轮报告为[motionlab/before/report.html](motionlab/before/report.html)、[motionlab/after/report.html](motionlab/after/report.html)。原始逐轮数据与文件SHA256在各manifest中。历史实验结果未用于本轮结论。\n\n“首变”可能发生在面板仍不可见时，因此另列真实视口交集与opacity判断。原版100%偏移可在不可见阶段随内容高度变化；不能把隐藏阶段的数值跳变称为可见闪烁。可见位移回退次数仅在两相邻采样均位于视口且opacity>0.02时统计。采样间隔/事件回调包含调度波动，不等于屏幕FPS或GPU呈现。\n\n未发现集成版开场、关闭、手势、滚动与草稿的功能回归；暂停/取消退出和入场回调清理另有受控组件证据。iPhone Safari、真实地址栏与软键盘等待人工验收。\n`)
await writeFile(path.join(out,'TEST_RESULTS.md'),`# 本轮测试结果\n\n状态：**集成及自动化验证完成，待实机验收**。所有下列通过项均来自本轮独立副本，不引用历史853/44/42轮作为本轮结果。\n\n| 检查 | 实际结果 | 证据 |\n| --- | --- | --- |\n| TypeScript | PASS | evidence/typecheck.txt |\n| 完整业务单元测试 | ${unitCount}项、57文件PASS | evidence/unit.txt |\n| 生产构建 | PASS，379项PWA预缓存 | evidence/build.txt |\n| CRUD | 9项PASS | evidence/crud.txt |\n| 表单/草稿/同步UI/合成备份恢复 | 9组PASS | evidence/form-state-results.json |\n| 当前组件相关交互 | ${interactions.results.length}项PASS | evidence/interactions-results.json、verification/interactions-adaptation.patch |\n| 组件生命周期回归 | ${compatibility.checks.length}项含清理PASS | evidence/compatibility-pass.json |\n| App边界/布局/取消 | ${edges.checks.length}项含清理PASS | evidence/app-edges.json |\n| MotionLab工具自测 | 44项PASS | evidence/motionlab-unit-final.txt |\n| 原版MotionLab | 17场景×3轮，${before.status} | motionlab/before/manifest.json |\n| 集成版MotionLab | 17场景×3轮，${count(after).pass}/${count(after).total} PASS | motionlab/after/manifest.json |\n| 原仓库保护 | ${integrity.filesChecked}文件、HEAD/分支/状态相同 | evidence/protected-repositories-after.json |\n\n覆盖：正常/异步/小屏/横屏详情入场；关闭卸载、焦点和滚动恢复；新增表单；长拉关闭、短拉回弹、快甩、触摸取消、斜向、内部滚动、pointercancel；快速底栏切换；reduced-motion；迟到旧查询；聚焦输入后的可用视口缩放；取消退出、外部暂停/恢复、无关暂停动画与快速重开。\n\n测试适配公开保留：原scripts/verify-interactions.mjs在未修改原版也出现相同的过早Escape断言失败。实际键盘探针证明正常取消并保留草稿；生成副本等待Router关闭DOM终态。既有“可见前必须等全部数据、固定高度、state=open表示数据已到齐”假设与本次分阶段入场冲突，改为显式加载/表单、transform单调、实际表单就绪及三帧静止终态。保留零面板动画、焦点、外层滚动等原断言；CPU4采样不再固定1400ms截断，使用8s看门狗与真实终态。原文件未修改，补丁及准备脚本在verification，原始失败日志仍在evidence。\n\n手势主raw记录长拉轨迹，附加回弹、快甩和取消保留功能断言，未保存独立完整曲线。\n\n自动化限制：Edge156无头/disable-gpu，移动视口不是Safari；可用高度变化不是手机键盘/地址栏本身；pointercancel为真实CDP鼠标拖动后派发DOM事件；n=3开发构建样本不能证明真机性能提升。未重新跑历史整套故障注入审计；复用相同采样器并执行本轮44个工具自测及全部正例。构建仍提示主包>500KB，未为此扩大重构或更新依赖。\n\n部署、push、生产账号、Worker、D1与真实物品数据：均未使用/修改。\n`)
await writeFile(path.join(out,'INTEGRATION_RESULT.md'),`# 最终集成结论\n\n**集成及自动化验证完成，待实机验收。**\n\n- 集成成功：两个提交的必要App修改迁移到当前正式本地main/fa8fa77的独立副本，补入必要的提前启动前置，共5个App文件。App检查点${after.source.commit.slice(0,7)}。\n- 版本兼容：共同历史已核实，无更晚业务冲突；修复了嵌套rAF取消不完整和无关暂停动画阻塞退出两项实测问题。未重写手势、状态架构、导航曲线或新增依赖。\n- 原有业务：本轮${unitCount}单元测试、CRUD9、表单状态9组、交互${interactions.results.length}项均通过；数据、路由、草稿、焦点与滚动在已测流程保持正确。没有对未测场景作全面保证。\n- 动效：17场景×3轮全部PASS；具体数字和波动见BEFORE_AFTER。${asyncText}\n- 正式仓库保持不变：${integrity.filesChecked}个tracked/非忽略untracked文件的SHA256及3个受保护仓库的HEAD、分支、状态均相同。没有修改原MotionLab或已验收v2副本。两套集成/对照克隆无共享Git对象/硬链接。\n- 发布门槛：没有本轮已知自动化阻断；iPhone Safari及主屏PWA实机仍待按清单验收。建议采用此候选，在实机通过后人工批准正式合并。当前不宣布完全发布。\n\n项目：D:/Codex/item-storage-app-motion-integration。HTML：[index.html](index.html)。手机步骤：[IPHONE_ACCEPTANCE.md](IPHONE_ACCEPTANCE.md)。本地交付说明与证据另建Git检查点，未推送。\n\n原版工作区、线上Worker/D1、真实数据及既有备份未写入；没有push或部署。\n`)
const previousHtml=await readFile('D:/Codex/item-storage-motion-optimization-v2/deliverables/motion-optimization-v2/10_before_after_report.html','utf8')
const style=previousHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1]??''
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const curve=id=>{
 const series=[]
 for(const side of ['before','after'])for(const r of (side==='before'?before:after).scenarios.find(s=>s.id===id).runs){
  const raw=rawMap.get(`${side}/${id}/${r.runIndex}`),input=r.latencyChain?.inputReceivedAt??raw.record.triggerAt
  let previousId
  const points=[]
  for(const f of raw.record.frames){if(f.t<input)continue;const p=f.tg.panel;if(p&&previousId&&p.id!==previousId)points.push([f.t-input,null]);points.push([f.t-input,p?.ty??null]);previousId=p?.id}
  series.push({name:`${side==='before'?'原版':'集成'} r${r.runIndex}`,points})
 }
 return svgCurve(series,{yLabel:'面板 translateY(px)',xLabel:'页面输入到达后ms'})
}
const htmlRows=rows.map(r=>`<tr><td>${esc(r.id)}</td><td>${range(r.a.firstGeometry)}</td><td>${range(r.b.firstGeometry)}</td><td>${r.statuses.join(' / ')}</td></tr>`).join('')
const charts=['item-detail-open','item-form-open','item-detail-open-delayed','item-detail-open-small','item-detail-open-landscape'].map(id=>{
 const row=rows.find(r=>r.id===id)
 return `<section><h2>${esc(row.title)}</h2>${curve(id)}<p>输入→面板首次进入视口：原版 ${range(row.a.panelInView)}ms；集成 ${range(row.b.panelInView)}ms。</p><p class="hint">可见阶段向下回退采样：原版${row.a.visibleReversals}，集成${row.b.visibleReversals}。此处为几何/透明度采样，隐藏起点变化不等于可见闪烁。</p><div class="shots">${['before','after'].map(side=>`<figure class="shot"><figcaption>${side==='before'?'原版终态':'集成终态'}</figcaption><a href="motionlab/${side}/shots/${id}-r1-after.png"><img loading="lazy" alt="${side} ${id}" src="motionlab/${side}/shots/${id}-r1-after.png"></a></figure>`).join('')}</div></section>`
}).join('')
await writeFile(path.join(out,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MarkItem 最终集成·本轮前后对比</title><style>${style}figure.chart svg text.tick[x="626"]{text-anchor:end}</style></head><body><div class="wrap"><header class="run"><h1>MarkItem 最终动效集成</h1><p><strong>集成及自动化验证完成，待实机验收</strong></p><p class="meta">${esc(verified)}</p><p class="meta">原版App指纹 ${before.source.appFingerprint}<br>集成App指纹 ${after.source.appFingerprint}</p></header><section><h2>本轮结果</h2><p>${unitCount}业务单元、44工具自测、CRUD9、表单9组、${interactions.results.length}交互、${compatibility.checks.length}组件检查、${edges.checks.length}边界检查通过。集成版MotionLab ${count(after).pass}/${count(after).total}轮PASS，原版${count(before).pass}/${count(before).total}轮PASS。</p><p>${esc(observationText)}</p><p>${esc(asyncText)}</p><p><a href="motionlab/before/report.html">完整原版报告</a> · <a href="motionlab/after/report.html">完整集成报告</a> · <a href="evidence/comparison.json">本轮对比JSON</a> · <a href="IPHONE_ACCEPTANCE.md">iPhone清单</a></p><p class="hint">复用已验收报告样式与MotionLab SVG曲线组件。所有轮次真实原始JSON、PNG、动画事件及SHA256随报告保留。没有插值、补点或使用历史结果冒充本轮数据。手势主raw记录长拉轨迹；附加回弹、快甩和取消保留功能断言，未保存独立完整曲线。</p></section><section><h2>输入到首次几何/样式变化</h2><table class="data"><thead><tr><th>场景</th><th>原版ms 中位（范围/n）</th><th>集成ms</th><th>集成状态</th></tr></thead><tbody>${htmlRows}</tbody></table><p class="hint">首变可能仍在视口外；下方另列面板进入视口。rAF和事件回调不是屏幕FPS/GPU呈现时间。本次n=3，不证明统计显著或iPhone更快。</p></section>${charts}<section><h2>验证边界与采用条件</h2><p>原仓库${integrity.filesChecked}个文件及HEAD/分支/状态不变；无push、部署、生产账号或真实数据访问。唯一App改动为5个动效源文件，两项额外兼容修复已用实际组件回归验证。</p><p>旧交互脚本适配了Router终态与分阶段内容加载假设，补丁和原始失败日志公开保留；没有通过修改业务行为去迎合旧测试。</p><p><strong>iPhone Safari / 主屏PWA、真实地址栏和软键盘等待人工验收。</strong>实机通过后再人工批准正式合并。Edge移动视口不等于手机实机。</p><p><a href="TEST_RESULTS.md">测试说明</a> · <a href="CHANGELOG.md">变更记录</a> · <a href="INTEGRATION_RESULT.md">集成结论</a> · <a href="evidence/protected-repositories-after.json">原仓库保护记录</a></p></section></div></body></html>`)
console.log(JSON.stringify({status:after.status,before:count(before),after:count(after),unitCount,interactions:interactions.results.length,normalDetail:basic,delayedGate:{before:moved(delayed.before),after:moved(delayed.after)},root:out},null,2))
