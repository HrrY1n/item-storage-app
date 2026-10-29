const REPORT_STYLE = "\r\n  :root { --ink:#1e293b; --muted:#64748b; --line:#e2e8f0; --bg:#f8fafc; --card:#ffffff; --accent:#2563eb; }\r\n  * { box-sizing: border-box; }\r\n  body { margin:0; padding:0; color:var(--ink); background:var(--bg); font:15px/1.65 -apple-system, \"Segoe UI\", \"Microsoft YaHei\", sans-serif; }\r\n  .wrap { max-width: 1080px; margin: 0 auto; padding: 24px 18px 64px; }\r\n  header.run { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 22px; margin-bottom:22px; }\r\n  header.run h1 { margin:0 0 6px; font-size:22px; }\r\n  header.run .meta { color:var(--muted); font-size:13px; }\r\n  section { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px 22px; margin-bottom:22px; }\r\n  h2 { margin:0 0 4px; font-size:18px; } h2 .mono { color:var(--muted); font-size:13px; font-weight:normal; }\r\n  h4 { margin:18px 0 8px; font-size:14px; color:#334155; }\r\n  .desc { color:var(--muted); margin:4px 0 10px; }\r\n  .chips { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 2px; }\r\n  .chip { background:#eef2ff; color:#3730a3; border-radius:999px; padding:2px 10px; font-size:12px; }\r\n  .chip-warn { background:#fef3c7; color:#92400e; }\r\n  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }\r\n  table.data { width:100%; border-collapse:collapse; font-size:13px; }\r\n  table.data th, table.data td { border-bottom:1px solid var(--line); padding:6px 8px; text-align:left; white-space:nowrap; }\r\n  table.data th { color:var(--muted); font-weight:600; }\r\n  .badge { display:inline-block; border-radius:999px; padding:1px 10px; font-size:12px; }\r\n  .badge-ok { background:#dcfce7; color:#166534; }\r\n  .badge-bad { background:#fee2e2; color:#991b1b; }\r\n  .badge-warn { background:#fef3c7; color:#92400e; }\r\n  .badge-info { background:#e0e7ff; color:#3730a3; }\r\n  .hint { color:var(--muted); font-size:12.5px; }\r\n  figure.chart { margin:8px 0 14px; }\r\n  figure.chart svg { width:100%; height:auto; background:#fbfdff; border:1px solid var(--line); border-radius:8px; }\r\n  figure.chart figcaption { font-size:12px; color:var(--muted); padding-top:4px; }\r\n  .grid { stroke:#eef2f7; stroke-width:1; }\r\n  .tick { font-size:11px; fill:#94a3b8; }\r\n  .legend-item { display:inline-flex; align-items:center; gap:4px; margin-right:12px; }\r\n  .legend-item i { width:14px; height:3px; display:inline-block; border-radius:2px; }\r\n  .shots { display:flex; flex-wrap:wrap; gap:12px; }\r\n  .shot { margin:0; width:186px; }\r\n  .shot figcaption { font-size:12.5px; color:#334155; font-weight:600; padding-bottom:2px; }\r\n  .shot img { width:100%; border:1px solid var(--line); border-radius:8px; cursor:zoom-in; transition:max-width .2s; }\r\n  .shot img.zoom { width:390px; max-width:100%; cursor:zoom-out; }\r\n  .shot-note { font-size:11.5px; color:var(--muted); padding-bottom:4px; }\r\n  ul.anomalies { padding-left:18px; } ul.anomalies li { margin:4px 0; }\r\n  ul.checks { padding-left:18px; } ul.checks li.pass { color:#166534; } ul.checks li.fail { color:#991b1b; font-weight:600; }\r\n  .dl { background:var(--accent); border:none; color:#fff; border-radius:8px; padding:8px 14px; font-size:13px; cursor:pointer; }\r\n  footer { color:var(--muted); font-size:12.5px; }\r\n  @media (max-width: 720px) { .shot { width:46%; } table.data { font-size:12px; } }\r\n"
const PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2']
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const fmt = value => Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '—'
const statusOf = value => value.status ?? 'INCONCLUSIVE'
function badge(status) {
  const css = status === 'PASS' ? 'badge-ok' : status === 'FAIL' ? 'badge-bad' : 'badge-warn'
  return '<span class="badge ' + css + '">' + esc(status) + '</span>'
}
export function svgCurve(seriesList, { height = 220, yLabel = '', xLabel = 'capture t (ms)' } = {}) {
  const drawable = seriesList.filter(s => s.points?.filter(p => Number.isFinite(p[1])).length > 1)
  if (!drawable.length) return '<div class="chart-empty">数据不足（少于2个有效采样点）</div>'
  const width = 640, pad = { left: 56, right: 14, top: 14, bottom: 30 }
  const all = drawable.flatMap(s => s.points).filter(p => Number.isFinite(p[1]))
  const xMax = Math.max(1, ...drawable.flatMap(s => s.points).map(p => p[0]))
  let yMin = Math.min(...all.map(p => p[1])), yMax = Math.max(...all.map(p => p[1]))
  if (yMax === yMin) { yMin--; yMax++ }
  const extra = (yMax - yMin) * .08; yMin -= extra; yMax += extra
  const x = t => pad.left + t / xMax * (width - pad.left - pad.right)
  const y = v => height - pad.bottom - (v - yMin) / (yMax - yMin) * (height - pad.top - pad.bottom)
  const parts = []
  for (let i = 0; i <= 4; i++) {
    const t = xMax * i / 4
    parts.push('<line class="grid" x1="' + x(t) + '" x2="' + x(t) + '" y1="14" y2="' + (height - 30) + '"/><text class="tick" x="' + x(t) + '" y="' + (height - 10) + '">' + Math.round(t) + '</text>')
  }
  for (let i = 0; i <= 3; i++) {
    const v = yMin + (yMax - yMin) * i / 3
    parts.push('<text class="tick" x="4" y="' + y(v) + '">' + fmt(v) + '</text>')
  }
  drawable.forEach((series, i) => {
    let segment = []
    const flush = () => {
      if (segment.length > 1) parts.push('<polyline fill="none" stroke="' + PALETTE[i % PALETTE.length] + '" stroke-width="2" points="' + segment.join(' ') + '"/>')
      segment = []
    }
    for (const point of series.points) {
      if (!Number.isFinite(point[1])) flush()
      else segment.push(x(point[0]).toFixed(1) + ',' + y(point[1]).toFixed(1))
    }
    flush()
  })
  const legend = drawable.map((s, i) => '<span class="legend-item" style="color:' + PALETTE[i % PALETTE.length] + '">' + esc(s.name) + '</span>').join(' ')
  return '<figure class="chart"><svg viewBox="0 0 640 ' + height + '">' + parts.join('') + '</svg><figcaption>' + esc(yLabel) + ' ' + esc(xLabel) + ' · ' + legend + ' · null/实例切换处断线；不补点</figcaption></figure>'
}
function chainTable(runs) {
  const rows = runs.map(s => {
    const c = s.latencyChain ?? {}
    const base = Number.isFinite(c.triggerAt) ? c.triggerAt : 0
    const rel = value => Number.isFinite(value) ? Math.round((value - base) * 100) / 100 : null
    const cell = (value, hint) => '<td title="' + esc(hint ?? '') + '">' + (Number.isFinite(value) ? fmt(value) : '—') + '</td>'
    return '<tr><td>' + (s.runIndex ?? '') + '</td>' +
      cell(rel(c.inputReceivedAt), '首个 pointerdown/touchstart/mousedown 到达（相对触发）') +
      cell(rel(c.clickAt), 'click 事件（相对触发）') +
      cell(rel(c.dialogAddedAt), 'dialog 元素加入 DOM（React 提交可见）') +
      cell(rel(c.stateOpenAt), 'data-state=open 属性提交') +
      cell(rel(c.readyAt), 'data-ready=true 属性提交') +
      cell(rel(c.firstChangeAt), '目标首次可观察变化') +
      '<td>' + (Number.isFinite(c.inputReceivedAt) && Number.isFinite(c.firstChangeAt) ? fmt(c.firstChangeAt - c.inputReceivedAt) : '—') + '</td></tr>'
  }).join('')
  return '<h4>响应链（页面内 performance.now 时钟，各列均为相对触发时刻的偏移）</h4>' +
    '<div class="table-wrap"><table class="data"><thead><tr><th>轮次</th><th>输入到达</th><th>click</th><th>dialog出现</th><th>state=open</th><th>ready</th><th>首次可见变化</th><th>输入→首变</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="hint">「输入到达→首次可见变化」为同一页面内时钟，可直接比较；Node 侧 CDP 发送时刻（record.input.sentAt，Date.now/performance.now）是另一台时钟，仅用于排序核对，不与页面内数值相加。dialog 出现与属性提交来自 MutationObserver（微任务时机），标记 React 提交在 DOM 中的可见点。</p>'
}

function provenanceLine(run) {
  const source = run.source ?? {}
  const commit = typeof source.commit === 'string' ? source.commit.slice(0, 10) : '未知'
  const dirty = source.modifiedTrackedFiles?.length ? ' <span class="badge badge-warn">工作区有未提交修改: ' + esc(source.modifiedTrackedFiles.join(', ')) + '</span>' : ' <span class="badge badge-ok">工作区干净</span>'
  return '<p class="meta">本次测量的 App 源码提交 <strong>' + esc(commit) + '</strong>' + dirty +
    ' · App 指纹 <code>' + esc(String(source.appFingerprint ?? '').slice(0, 16)) + '…</code> · 工具指纹 <code>' + esc(String(source.toolFingerprint ?? '').slice(0, 16)) + '…</code> · 浏览器 ' +
    esc(run.env?.browser?.browser ?? '未知') + ' · Node ' + esc(run.env?.node ?? '未知') + '</p>'
}

function metricsTable(runs) {
  const rows = runs.map((s, i) => {
    const p = s.primary
    return '<tr><td>' + (s.runIndex ?? i + 1) + '</td><td>' + badge(statusOf(s)) + '</td><td>' + fmt(p?.expectedMs ?? p?.declaredMs) +
      '</td><td>' + esc(p?.actualDeclaredMs?.map(fmt).join('/') || '未知') + '</td><td>' +
      (p?.eventDuration ? fmt(p.eventDuration.durationMs) + ' (' + esc(p.eventDuration.outcome) + ')' : '—') +
      '</td><td>' + fmt(p?.interval?.activeMs) + '</td><td>' + fmt(p?.interval?.amplitude) + '</td><td>' +
      fmt(s.totalMs) + '</td><td>' + fmt(s.frames) + '</td><td>' + fmt(s.gaps?.median) + '/' + fmt(s.gaps?.max) + '</td></tr>'
  }).join('')
  return '<div class="table-wrap"><table class="data"><thead><tr><th>轮次</th><th>状态</th><th>期望ms</th><th>实际声明ms</th><th>事件回调间隔ms</th><th>观测活动区间ms</th><th>幅度</th><th>完整采集ms</th><th>采样次数</th><th>间隔中位/最大ms</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="hint">期望来自场景；实际声明来自目标动画。事件回调间隔含调度影响，不是精确完成时间；活动区间受采样阈值影响；完整采集含静默等待。采样间隔不代表浏览器实际渲染帧率。</p>'
}
function shotsSection(summary, shotsBase64) {
  if (!summary?.shots?.length) return '<p class="hint">无截图证据。</p>'
  const items = summary.shots.map(shot => {
    let note = ''
    if (shot.still) {
      const s = shot.still
      note = s.status === 'PASS' ?
        '独立复演定位 · 请求比例' + Math.round(s.fraction * 100) + '% · 实际currentTime=' + fmt(s.currentTime) +
        'ms · tx=' + fmt(s.frozen?.tx) + ', ty=' + fmt(s.frozen?.ty) :
        '独立复演取证失败 · INCONCLUSIVE · ' + (s.note ?? '目标不稳定')
    }
    const base64 = shotsBase64.get(shot.file)
    const content = base64 ? '<img loading="lazy" src="data:image/png;base64,' + base64 + '" alt="' + esc(shot.name) + '" onclick="this.classList.toggle(\'zoom\')"/>' :
      '<a href="' + esc(shot.file) + '">外部PNG</a>'
    return '<figure class="shot"><figcaption>' + esc(shot.name) + '</figcaption><div class="shot-note">' + esc(note) + '</div>' + content + '</figure>'
  }).join('')
  const v = summary.viewport ?? {}
  return '<p class="hint">第' + summary.runIndex + '轮截图；视口' + fmt(v.w ?? v.width) + '×' + fmt(v.h ?? v.height) + ' CSS px @' + fmt(v.dpr) +
    'x。before/after围绕主采集；mid是另一次真实输入复演，不对应主曲线同一次播放。</p><div class="shots">' + items + '</div>'
}
function checksAndIssues(runs) {
  return runs.map((s, i) => '<h4>第' + (s.runIndex ?? i + 1) + '轮 ' + badge(statusOf(s)) + '</h4><ul class="checks">' +
    (s.checks ?? []).map(c => '<li class="' + (c.pass ? 'pass' : 'fail') + '">' + (c.pass ? '✓ ' : '✗ ') + esc(c.name) + '</li>').join('') +
    '</ul><ul class="anomalies">' + (s.anomalies ?? []).map(a => '<li>' + esc(a.level) + ' · ' + esc(a.code) + ': ' + esc(a.message) + '</li>').join('') +
    (s.crashed ? '<li>执行中断: ' + esc(s.crashed) + '</li>' : '') + (s.exceptions ?? []).map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>').join('')
}
function comparisonSection(comparison) {
  if (!comparison) return ''
  return '<section><h2>基线对比 ' + badge(comparison.status ?? 'INCONCLUSIVE') + '</h2>' +
    (comparison.scenarios ?? []).map(scene => '<h4>' + esc(scene.id) + '</h4><ul>' + scene.entries.map(e =>
      '<li>' + badge(e.status ?? (e.class === 'error' ? 'FAIL' : e.class === 'ok' ? 'PASS' : 'INCONCLUSIVE')) + ' ' + esc(e.metric) + ': ' + esc(e.verdict) +
      (e.class === 'warning' ? '（非阻断诊断提示）' : '') + '</li>').join('') + '</ul>').join('') + '<p>' + esc(comparison.note) + '</p></section>'
}
export function renderReport(run, comparison = null, { shotsBase64 = new Map(), records = new Map(), generatedAt = new Date().toISOString() } = {}) {
  const sections = run.scenarios.map(scene => {
    const runs = scene.runs.map((s, i) => ({ ...s, runIndex: s.runIndex ?? i + 1 }))
    const first = runs.find(s => s.shots?.length), viewport = runs.find(s => s.viewport)?.viewport ?? {}
    const portable = { runId: run.runId, scenario: { id: scene.id, title: scene.title }, environment: run.env, source: run.source,
      runs: runs.map(s => ({ run: s.runIndex, summary: s, raw: records.get(scene.id + '-r' + s.runIndex) ?? null })),
      integrity: run.integrity }
    const complete = portable.runs.every(r => r.raw?.record)
    const labels = [...new Set(runs.flatMap(s => Object.keys(s.series ?? {})))]
    const charts = labels.map(label => '<h4>' + esc(label) + '</h4>' + svgCurve(runs.map(s =>
      ({ name: '第 ' + s.runIndex + ' 轮', points: s.series?.[label] ?? [] })))).join('')
    const eventTables = runs.map(s => {
      const record = records.get(scene.id + '-r' + s.runIndex)?.record
      if (!record) return '<p>第' + s.runIndex + '轮：无完整raw，无法复算。</p>'
      const events = record.events ?? []
      return '<details><summary>第' + s.runIndex + '轮动画事件（展示前80/' + events.length + '，完整记录在JSON）</summary><pre>' + esc(JSON.stringify(events.slice(0, 80), null, 2)) + '</pre></details>'
    }).join('')
    return '<section id="' + esc(scene.id) + '"><h2>' + esc(scene.title) + ' <span class="mono">' + esc(scene.id) + '</span></h2><p>' +
      esc(scene.description) + '</p><p class="chip">视口 ' + fmt(viewport.w ?? viewport.width) + '×' + fmt(viewport.h ?? viewport.height) +
      ' @' + fmt(viewport.dpr) + 'x</p><p>' + runs.map(s => '第' + s.runIndex + '轮：系统' + esc(s.colorScheme) + ' / App ' +
      esc(s.appThemeBefore) + '→' + esc(s.appThemeAfter) + ' / reduce=' + esc(s.reducedMotion)).join('<br/>') + '</p>' +
      metricsTable(runs) + chainTable(runs) + charts + shotsSection(first, shotsBase64) + checksAndIssues(runs) + eventTables +
      '<h4>原始数据与完整性</h4><p>' + (complete ? '本HTML内嵌本场景全部完整raw，可下载复算。' : '本HTML缺少部分完整raw；仅分享HTML不能完整复算，必须携带外部raw包。') + '</p>' +
      runs.map(s => s.rawFile ? '<p><a href="' + esc(s.rawFile) + '">' + esc(s.rawFile) + '</a></p>' : '<p>第' + s.runIndex + '轮未提供raw文件</p>').join('') +
      '<button class="dl" data-name="motion-lab-' + esc(scene.id) + '-portable.json" onclick="downloadPortable(this)">下载本场景数据（JSON）</button>' +
      '<script type="application/json" data-portable="' + esc(scene.id) + '">' + JSON.stringify(portable).replaceAll('<', '\\u003c') + '</script></section>'
  }).join('')
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>MotionLab 动效分析报告 · ' +
    esc(run.runId) + '</title><style>' + REPORT_STYLE + ' pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}</style></head><body><div class="wrap">' +
    '<header class="run"><h1>MotionLab 动效分析报告 ' + badge(run.status ?? 'INCONCLUSIVE') + '</h1><p>运行 ' + esc(run.runId) + ' · ' + esc(generatedAt) +
    '</p>' + provenanceLine(run) + '<details><summary>浏览器/Node/系统/源码及运行配置</summary><pre>' + esc(JSON.stringify({ env: run.env, source: run.source, options: run.options }, null, 2)) + '</pre></details></header>' +
    '<section><h2>总览</h2>' + run.scenarios.map(s => '<p><a href="#' + esc(s.id) + '">' + esc(s.title) + '</a> ' +
      s.runs.map((r, i) => '第' + (r.runIndex ?? i + 1) + '轮 ' + badge(statusOf(r))).join(' · ') + '</p>').join('') + '</section>' +
    sections + comparisonSection(comparison) + '<section><h2>文件完整性</h2><pre>' + esc(JSON.stringify(run.integrity ?? { status: 'INCONCLUSIVE' }, null, 2)) + '</pre>' +
    '<h4>最终清理</h4><pre>' + esc(JSON.stringify(run.cleanup ?? [], null, 2)) + '</pre></section>' +
    '<footer>范围：本地Windows headless Edge（disable-gpu）、开发构建、CSS视口坐标与自身平移。旋转/倾斜/祖先变换/独立scale/滚动分解、真实屏幕FPS、GPU呈现和真机手感未验证。rAF仅主线程采样；无轨迹补点。复演截图独立标记。PASS要求合同与证据成立；FAIL为明确违约；INCONCLUSIVE不可作为验收成功。</footer></div>' +
    '<script>function downloadPortable(button){const id=button.dataset.name.replace(/^motion-lab-/,"").replace(/-portable\\.json$/,"");const node=document.querySelector(\'script[data-portable="\'+id+\'"]\');if(!node)return;const url=URL.createObjectURL(new Blob([node.textContent],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=button.dataset.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}</script></body></html>'
}
