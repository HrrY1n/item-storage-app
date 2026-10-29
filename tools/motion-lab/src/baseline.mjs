import { readFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { median, combineStatus, defaultEps } from './metrics.mjs'
import { motionLabRoot, safeName, writeNewJson } from './store.mjs'

const baselinesDir = path.join(motionLabRoot, 'baselines')
const spread = values => values.length ? { median: median(values), min: Math.min(...values), max: Math.max(...values) } : null
export function validBaselineRun(summary, spec) {
  const base = summary.status === 'PASS' && !summary.crashed && summary.settledBy === 'stable' &&
    summary.checks?.length > 0 && summary.checks.every(check => check.pass) && !summary.exceptions?.length &&
    !summary.anomalies?.some(a => ['error', 'inconclusive'].includes(a.level))
  if (!base) return false
  // 输入驱动场景（手势/快速切换）的位移由输入节奏决定，改向/释放会正常产生
  // transitioncancel——不要求事件回调完整结束，其余有效性条件不变。
  if (spec?.inputDriven) return true
  return [summary.primary, ...Object.values(summary.secondary ?? {})].filter(Boolean).every(feature =>
    !feature.eventDuration || feature.eventDuration.outcome === 'ended')
}
function collectMetrics(runs) {
  const valid = runs.filter(validBaselineRun)
  const checks = { passed: 0, total: 0, failedRuns: 0, crashedRuns: 0 }
  for (const run of runs) {
    checks.total += run.checks?.length ?? 0
    checks.passed += run.checks?.filter(check => check.pass).length ?? 0
    if (run.status !== 'PASS') checks.failedRuns++
    if (run.crashed) checks.crashedRuns++
  }
  const features = {}
  for (const run of valid) for (const feature of [run.primary, ...Object.values(run.secondary ?? {})].filter(Boolean)) {
    const key = feature.label + '.' + feature.signal
    if (!features[key]) features[key] = []
    features[key].push(feature)
  }
  const aggregated = {}
  for (const [key, values] of Object.entries(features)) {
    const metric = { signal: values[0].signal, moved: [...new Set(values.map(v => v.interval?.moved))],
      easing: [...new Set(values.flatMap(v => v.easing ?? []))].sort(),
      shape: Array.from({ length: 8 }, (_, i) => median(values.map(v => v.shape?.[i]).filter(Number.isFinite))) }
    for (const name of ['amplitude', 'from', 'to', 'net']) metric[name] = spread(values.map(v => v.interval?.[name]).filter(Number.isFinite))
    metric.latencyMs = spread(values.map(v => v.latencyMs).filter(Number.isFinite))
    metric.observedMs = spread(values.map(v => v.interval?.activeMs).filter(Number.isFinite))
    aggregated[key] = metric
  }
  return { eventDurationMs: spread(valid.map(run => run.primary?.eventDuration?.durationMs).filter(Number.isFinite)),
    observedMs: spread(valid.map(run => run.primary?.interval?.activeMs).filter(Number.isFinite)),
    checks, features: aggregated, runs: valid.length, totalRuns: runs.length, rejectedRuns: runs.length - valid.length,
    errorAnomalies: runs.reduce((sum, run) => sum + (run.anomalies ?? []).filter(a => a.level === 'error').length, 0) }
}
function environment(run, summary) {
  return { sampler: '2', browser: run.env?.browser?.browser ?? null, browserArgs: ['headless', 'disable-gpu'],
    node: run.env?.node ?? null, os: run.env?.os ?? null,
    viewport: summary?.viewport ?? null, reducedMotion: summary?.reducedMotion ?? null,
    colorScheme: summary?.colorScheme ?? null, appTheme: summary?.appThemeAfter ?? null }
}
export async function saveRunBaseline(run, { log = () => {} } = {}) {
  safeName(run.runId)
  if (!run.scenarios.length || run.scenarios.some(scene => !scene.runs.length || scene.runs.some(r => !validBaselineRun(r, scene.spec))))
    throw new Error('Refusing baseline: every run must satisfy all PASS/validity conditions')
  if (run.integrity?.status !== 'PASS' || run.cleanup?.some(r => r.status !== 'PASS'))
    throw new Error('Refusing baseline: evidence or cleanup not verified')
  const payload = { version: 2, runId: run.runId, savedAt: new Date().toISOString(), source: run.source,
    scenarios: run.scenarios.map(scene => ({ id: scene.id, env: environment(run, scene.runs[0]), metrics: collectMetrics(scene.runs) })) }
  const root = path.join(baselinesDir, 'candidates', run.runId)
  await mkdir(path.dirname(root), { recursive: true })
  await mkdir(root)
  const temporary = path.join(root, 'candidate.partial.json'), file = path.join(root, 'candidate.json')
  await writeNewJson(temporary, payload)
  await rename(temporary, file)
  log('仅保存候选基线，历史基线未改: ' + file)
  return file
}
function durationEntry(name, baselineValue, current, { absoluteSlack = 150, ratioSlack = .4 } = {}) {
  const baseline = { value: baselineValue?.median ?? null, range: baselineValue ? baselineValue.min + '–' + baselineValue.max : null }
  if (!Number.isFinite(current) || !baselineValue) return { metric: name, baseline, current, class: 'info', status: 'INCONCLUSIVE', verdict: !baselineValue ? '无基线值' : '当前运行无有效数据' }
  if (baselineValue.median === 0 && current !== 0) return { metric: name, baseline, current, delta: current, class: 'error', status: 'FAIL', verdict: '零基线变为非零' }
  const inRange = current >= baselineValue.min - absoluteSlack && current <= baselineValue.max + absoluteSlack
  const ratio = baselineValue.median ? Math.abs(current - baselineValue.median) / Math.abs(baselineValue.median) : 0
  const warn = !inRange && ratio > ratioSlack
  return { metric: name, baseline, current, delta: current - baselineValue.median, class: warn ? 'warning' : 'ok', status: 'PASS',
    verdict: warn ? '诊断提示: 时长分布明显漂移；非通用毫秒断言' : '在基线区间内' }
}
function compareMetrics(baseline, current) {
  const entries = [!baseline.eventDurationMs && !current.eventDurationMs ? {metric:'主信号事件回调间隔(ms)', class:'ok',status:'PASS',verdict:'双方均无该事件（如reduce），按动效合同验收'} : durationEntry('主信号事件回调间隔(ms)', baseline.eventDurationMs, current.eventDurationMs?.median),
    durationEntry('主信号观测活动区间(ms)', baseline.observedMs, current.observedMs?.median, { absoluteSlack: 200, ratioSlack: .5 })]
  const add = (key, status, verdict, before, after) => entries.push({ metric: key, baseline: { value: before ?? null }, current: after ?? null,
    status, class: status === 'FAIL' ? 'error' : status === 'INCONCLUSIVE' ? 'info' : 'ok', verdict })
  if (current.rejectedRuns || current.checks.failedRuns) add('全部轮次有效性', 'FAIL', '包含失败/崩溃/不完整轮次', 0, current.rejectedRuns)
  for (const [key, before] of Object.entries(baseline.features ?? {})) {
    const after = current.features?.[key]
    if (!after) { add(key, 'INCONCLUSIVE', '缺少目标特征'); continue }
    if (JSON.stringify(before.moved) !== JSON.stringify(after.moved)) add(key + '.motion', 'FAIL', '动效有无发生变化', before.moved, after.moved)
    if (JSON.stringify(before.easing) !== JSON.stringify(after.easing)) add(key + '.easing', 'FAIL', '实际声明缓动改变', before.easing, after.easing)
    for (const property of ['amplitude', 'from', 'to']) {
      const b = before[property], a = after[property]
      if (!a || !b) { add(key + '.' + property, 'INCONCLUSIVE', '缺少几何特征'); continue }
      const slack = Math.max(defaultEps(before.signal) * 2, (b.max - b.min) * .2, Math.abs(b.median) * .1)
      if (a.min < b.min - slack || a.max > b.max + slack) add(key + '.' + property, 'FAIL',
        '至少一轮关键状态/幅度超出基线及几何容差；当前范围' + a.min + '–' + a.max,
        { median: b.median, min: b.min, max: b.max }, { median: a.median, min: a.min, max: a.max })
    }
    const pairs = before.shape.map((v, i) => [v, after.shape[i]]).filter(p => p.every(Number.isFinite))
    if (pairs.length >= 3 && median(pairs.map(([a, b]) => Math.abs(a - b))) > .2)
      add(key + '.shape', 'INCONCLUSIVE', '观测轨迹明显变化，需复核；分箱中位数不是插值')
    if (before.latencyMs && after.latencyMs) entries.push(durationEntry(key + '.trigger到首次变化(ms)', before.latencyMs, after.latencyMs.median))
  }
  return entries
}
export async function compareRun(run, { baselineId, log = () => {} } = {}) {
  let saved
  if (baselineId) {
    const file = path.join(baselinesDir, 'candidates', safeName(baselineId), 'candidate.json')
    saved = JSON.parse(await readFile(file, 'utf8'))
    if (saved.version !== 2) throw new Error('Unsupported candidate baseline')
  }
  const scenarios = []
  for (const scene of run.scenarios) {
    const baseline = saved?.scenarios.find(s => s.id === scene.id)
    let entries
    if (scene.spec?.inputDriven) {
      // 输入驱动场景（手势/快速切换）：几何与时长由输入节奏决定，跨批次比较必然漂移；
      // validBaselineRun 的"事件回调完整结束"判据对它们不适用（改向/释放会正常产生
      // transitioncancel），因此只断言每轮功能状态 PASS 且未崩溃。
      const broken = scene.runs.filter(summary => summary.status !== 'PASS' || summary.crashed).length
      entries = broken
        ? [{ metric: '输入驱动基线豁免', class: 'error', status: 'FAIL', verdict: '包含失败或崩溃轮次: ' + broken }]
        : [{ metric: '输入驱动基线豁免', class: 'info', status: 'PASS', verdict: '几何/时长由输入节奏决定，仅断言全部轮次有效' }]
    } else if (!baseline) entries = [{ metric: '基线', class: 'info', status: 'INCONCLUSIVE', verdict: '旧基线没有v2身份/环境合同；指定--baseline=<候选runId>' }]
    else if (JSON.stringify(baseline.env) !== JSON.stringify(environment(run, scene.runs[0])))
      entries = [{ metric: '环境', class: 'info', status: 'INCONCLUSIVE', verdict: '浏览器/运行环境/媒体/视口不匹配，不能直接比较' }]
    else entries = compareMetrics(baseline.metrics, collectMetrics(scene.runs))
    scenarios.push({ id: scene.id, entries, status: combineStatus(entries.map(entry => entry.status)) })
    log('基线比较: ' + scene.id + ' ' + scenarios.at(-1).status)
  }
  return { scenarios, status: combineStatus(scenarios.map(s => s.status)),
    note: '比较全部有效轮次及主次信号。明确合同/配置变化FAIL；缺失或不可比INCONCLUSIVE；时长漂移仅诊断提示。原历史基线永不覆写。' }
}
export const _internal = { durationEntry, collectMetrics, compareMetrics, environment }
