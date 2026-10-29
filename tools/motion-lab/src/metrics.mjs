// All durations are observations/configuration, never display FPS.
export function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
export function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p / 100 * (sorted.length - 1))))]
}
export const defaultEps = signal => ['o', 'lum', 'sx', 'sy'].includes(signal) ? .01 : .5
export function signalSeries(record, label, signal) {
  const series = []
  let previousId
  for (const frame of record.frames ?? []) {
    const target = frame.tg?.[label], id = target?.id ?? null
    if (previousId && id && previousId !== id) series.push({ t: frame.t, v: null, id: null })
    series.push({ t: frame.t, v: target && Number.isFinite(target[signal]) ? target[signal] : null, id })
    previousId = id
  }
  return series
}
export function motionInterval(record, label, signal, { eps = defaultEps(signal) } = {}) {
  const series = signalSeries(record, label, signal), valid = series.filter(sample => sample.v !== null)
  if (valid.length < 2) return null
  const values = valid.map(sample => sample.v), from = valid[0].v, to = valid.at(-1).v
  const edges = []
  let previous = null, gap = false, internalGaps = 0
  for (const sample of series) {
    if (sample.v === null) { if (previous) gap = true; continue }
    if (gap) { internalGaps++; gap = false; previous = null }
    if (previous && (!sample.id || !previous.id || sample.id === previous.id) && Math.abs(sample.v - previous.v) > eps) edges.push(sample.t)
    previous = sample
  }
  const amplitude = Math.max(...values) - Math.min(...values)
  const ids = [...new Set(valid.map(sample => sample.id).filter(Boolean))]
  return { firstChange: edges[0] ?? null, lastChange: edges.at(-1) ?? null,
    activeMs: edges.length > 1 ? edges.at(-1) - edges[0] : 0,
    from, to, net: to - from, min: Math.min(...values), max: Math.max(...values), amplitude,
    moved: amplitude > eps, changes: edges.length, internalGaps, instances: ids,
    leadingNulls: series.findIndex(sample => sample.v !== null), seriesLength: valid.length }
}
export function frameGaps(record) {
  const frames = record.frames ?? [], gaps = frames.slice(1).map((frame, i) => frame.t - frames[i].t)
  if (!gaps.length) return { count: 0, median: null, p95: null, max: null, over2xMedian: 0 }
  const med = median(gaps)
  return { count: gaps.length, median: Math.round(med * 10) / 10, p95: percentile(gaps, 95),
    max: Math.max(...gaps), over2xMedian: gaps.filter(gap => gap > med * 2).length }
}
export function declaredTimings(record) {
  const map = new Map()
  for (const snapshot of record.animations ?? []) for (const animation of snapshot.list ?? []) {
    const key = animation.id ?? [animation.k, animation.p, animation.d, animation.e, animation.g].join('|')
    if (!map.has(key)) map.set(key, { id: animation.id ?? null, elementId: animation.elementId ?? null, target: animation.target ?? null,
      kind: animation.k, property: animation.p, durationMs: animation.d, endTimeMs: animation.e, easing: animation.g,
      delayMs: animation.delay ?? null, playbackRate: animation.rate ?? null, firstSeenAt: snapshot.t,
      lastSeenAt: snapshot.t, states: new Set(), currentTimes: [] })
    const entry = map.get(key)
    entry.lastSeenAt = snapshot.t
    entry.states.add(animation.s)
    if (Number.isFinite(animation.currentTime)) entry.currentTimes.push(animation.currentTime)
  }
  return [...map.values()].map(entry => ({ ...entry, states: [...entry.states] }))
}
export function eventDuration(record, targetLabel, property) {
  const events = (record.events ?? []).filter(event => event.target === targetLabel && event.p === property &&
    /^(transition|animation)(start|end|cancel)$/.test(event.type))
  const groups = new Map()
  let legacy = 0, legacyCurrent = null
  for (const event of events) {
    const startEvent = event.type.endsWith('start')
    if (!event.instanceId && startEvent) legacyCurrent = 'legacy-' + ++legacy
    const key = event.instanceId ?? legacyCurrent
    if (!key) continue
    if (!groups.has(key)) groups.set(key, { id: key, elementId: event.elementId ?? null, animationId: event.animationId ?? null,
      start: null, end: null, elapsedStart: null, elapsedEnd: null, outcome: 'incomplete', ambiguous: false })
    const segment = groups.get(key)
    segment.ambiguous ||= !!event.ambiguous
    if (startEvent) {
      segment.start = event.t
      segment.elapsedStart = event.elapsedMs ?? null
    } else {
      segment.end = event.t
      segment.elapsedEnd = event.elapsedMs ?? null
      segment.outcome = event.type.endsWith('cancel') ? 'cancelled' : 'ended'
      legacyCurrent = null
    }
  }
  const segments = [...groups.values()].map(segment => ({ ...segment,
    durationMs: segment.start !== null && segment.end !== null ? segment.end - segment.start : null,
    engineElapsedMs: segment.elapsedStart !== null && segment.elapsedEnd !== null ? segment.elapsedEnd - segment.elapsedStart : null }))
  if (!segments.length) return null
  const first = segments[0]
  return { ...first, outcome: segments.some(s => s.ambiguous) ? 'ambiguous' :
    segments.some(s => s.outcome === 'cancelled') ? 'cancelled' :
    segments.some(s => s.start === null || s.end === null) ? 'incomplete' : 'ended', segments }
}
export const combineStatus = statuses => statuses.includes('FAIL') ? 'FAIL' : statuses.includes('INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS'

/** 响应链分口径打点：输入到达 / DOM 出现 / React 属性提交，全部为页面内 performance.now 时钟（与 triggerAt 同源）。 */
export function timelineChain(record) {
  const input = record.timeline?.input ?? {}
  const dom = record.timeline?.dom ?? []
  const firstOf = types => types.map(type => input[type]?.t).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null
  const findDom = match => dom.find(match)?.t ?? null
  return {
    triggerAt: record.triggerAt ?? null,
    inputReceivedAt: firstOf(['pointerdown', 'touchstart', 'mousedown']),
    clickAt: input.click?.t ?? null,
    dialogAddedAt: findDom(entry => entry.kind === 'added' && entry.tag === 'DIALOG'),
    panelAddedAt: findDom(entry => entry.kind === 'added' && typeof entry.cls === 'string' && entry.cls.includes('modal-sheet')),
    statePendingAt: findDom(entry => entry.kind === 'attr' && entry.attr === 'data-state' && entry.value === 'pending'),
    stateOpenAt: findDom(entry => entry.kind === 'attr' && entry.attr === 'data-state' && entry.value === 'open'),
    readyAt: findDom(entry => entry.kind === 'attr' && entry.attr === 'data-ready' && entry.value === 'true'),
  }
}

export function detectAnomalies(record, spec) {
  const result = [], add = (level, code, message) => result.push({ level, code, message })
  if (record.triggerError) add('error', 'trigger-error', String(record.triggerError))
  if (record.captureError) add('inconclusive', 'capture-error', String(record.captureError))
  if (record.settledBy !== 'stable') add('inconclusive', 'capture-incomplete', '采集未稳定结束: ' + record.settledBy)
  if (record.hidden) add('inconclusive', 'background', '采集期间页面不可见')
  if (Object.values(record.truncated ?? {}).some(value => value > 0)) add('inconclusive', 'truncated', '采样/事件数据达到上限')
  if ((record.frames ?? []).length < 5) add('inconclusive', 'few-frames', '采样不足5次')
  if (record.meta?.sampler !== '2') add('inconclusive', 'legacy-record', '旧记录缺乏目标实例/完整性字段')
  const reduced = spec.reducedMotion === true
  if (record.meta?.reducedMotion !== reduced) add('inconclusive', 'media-mismatch', '实际reduce媒体条件与场景合同不符')
  const timings = declaredTimings(record)
  for (const entry of [spec.primary, ...(spec.secondary ?? [])].filter(Boolean)) {
    const interval = motionInterval(record, entry.label, entry.signal, { eps: entry.eps })
    if (!interval) { add('error', 'target-missing', '无足够有效目标信号: ' + entry.label); continue }
    if ((interval.internalGaps || interval.instances.length > 1) && !entry.allowRemount)
      add('inconclusive', 'target-replaced', '目标中途消失或替换: ' + entry.label)
    if (entry.stable && interval.amplitude > (entry.eps ?? defaultEps(entry.signal)))
      add('error', 'unstable-target', '预期稳定的目标发生位移: ' + entry.label)
    const measured = timings.filter(timing => timing.target === entry.label && (!entry.eventProperty || timing.property === entry.eventProperty))
    const event = entry.eventProperty ? eventDuration(record, entry.label, entry.eventProperty) : null
    if (reduced) {
      const limit = spec.maxReducedMs ?? 50
      if (measured.some(timing => timing.durationMs > limit) || interval.activeMs > limit)
        add('error', 'reduced-motion-violation', 'reduce下出现持续目标动效: ' + entry.label)
      continue
    }
    if (entry.requireMotion === false || entry.stable || entry.declaredMs == null || spec.expectMotion === false) continue
    if (!interval.moved || interval.changes < 2) add('error', 'no-motion', '未观察到有效连续运动: ' + entry.label)
    if (!measured.length) add('error', 'no-target-animation', '未观察到目标声明动画: ' + entry.label)
    const finished = measured.some(timing => timing.states.includes('finished') ||
      record.events?.some(e => e.animationId === timing.id && e.type === 'waapifinish'))
    if (record.events?.some(e=>e.type==='waapicancel'&&e.target===entry.label&&e.k==='waapi')) add('error','animation-cancelled','目标WAAPI动画被取消: '+entry.label)
    if (event?.outcome === 'cancelled') add('error', 'animation-cancelled', '目标动画被取消: ' + entry.label)
    else if (event?.outcome === 'ambiguous') add('inconclusive', 'ambiguous-event', '动画事件不能唯一归属: ' + entry.label)
    else if (event?.outcome !== 'ended' && !finished) add('inconclusive', 'animation-unfinished', '缺少正常结束证据: ' + entry.label)
  }
  if (spec.primary?.declaredMs && (motionInterval(record,spec.primary.label,spec.primary.signal)?.activeMs ?? 0) > spec.primary.declaredMs*2+200)
    add('warn','duration-long-tail','观测活动区间较期望时长长；仅诊断，未校准完成时间')
  const gaps = frameGaps(record)
  if (gaps.max > 100) add('warn', 'frame-gap', 'rAF采样最大间隔 ' + gaps.max + 'ms；不代表屏幕掉帧')
  return result
}
function shapeOf(series, interval) {
  if (!interval?.moved || interval.firstChange === null || interval.lastChange <= interval.firstChange) return []
  return Array.from({ length: 8 }, (_, index) => {
    const points = series.filter(s => s.v !== null && (s.t - interval.firstChange) / (interval.lastChange - interval.firstChange) >= index / 8 &&
      (s.t - interval.firstChange) / (interval.lastChange - interval.firstChange) <= (index + 1) / 8)
    return points.length ? Math.round((median(points.map(s => s.v)) - interval.min) / interval.amplitude * 1000) / 1000 : null
  })
}
export function summarize(record, spec) {
  const timings = declaredTimings(record)
  const measure = entry => {
    const interval = motionInterval(record, entry.label, entry.signal, { eps: entry.eps })
    const relevant = timings.filter(timing => timing.target === entry.label && (!entry.eventProperty || timing.property === entry.eventProperty))
    return { label: entry.label, signal: entry.signal, declaredMs: entry.declaredMs ?? null, expectedMs: entry.declaredMs ?? null,
      actualDeclaredMs: [...new Set(relevant.map(timing => timing.durationMs))], easing: [...new Set(relevant.map(timing => timing.easing))],
      interval, eventDuration: entry.eventProperty ? eventDuration(record, entry.label, entry.eventProperty) : null,
      latencyMs: Number.isFinite(interval?.firstChange) && Number.isFinite(record.triggerAt) ? interval?.firstChange - record.triggerAt : null,
      shape: shapeOf(signalSeries(record, entry.label, entry.signal), interval),
      shapeMethod: 'median of observed samples in 8 time bins; no interpolation', requireMotion: entry.requireMotion !== false && entry.declaredMs != null }
  }
  const secondary = {}, series = {}
  for (const entry of spec.secondary ?? []) secondary[entry.label] = measure(entry)
  for (const entry of [spec.primary, ...(spec.secondary ?? [])].filter(Boolean))
    series[entry.label] = signalSeries(record, entry.label, entry.signal).map(s => [s.t, s.v])
  const anomalies = detectAnomalies(record, spec)
  const primaryInterval = spec.primary ? measure(spec.primary).interval : null
  return { scenarioId: spec.id, frames: record.frames?.length ?? 0, totalMs: record.totalMs, triggerAt: record.triggerAt, settledBy: record.settledBy,
    reducedMotion: record.meta?.reducedMotion, colorScheme: record.meta?.colorScheme,
    appThemeBefore: record.meta?.appThemeBefore, appThemeAfter: record.meta?.appThemeAfter, viewport: record.meta?.viewport,
    primary: spec.primary ? measure(spec.primary) : null, secondary, series, gaps: frameGaps(record), timings, anomalies,
    latencyChain: { ...timelineChain(record), firstChangeAt: Number.isFinite(primaryInterval?.firstChange) ? primaryInterval.firstChange : null },
    status: combineStatus(anomalies.map(a => a.level === 'error' ? 'FAIL' : a.level === 'inconclusive' ? 'INCONCLUSIVE' : 'PASS')) }
}
export function finalizeSummary(summary, { checks = [], exceptions = [], shots = [], network = [], cleanup } = {}) {
  summary.checks = checks
  summary.exceptions = exceptions
  summary.shots = shots
  if (checks.some(check => !check.pass)) summary.anomalies.push({ level: 'error', code: 'check-failed', message: '功能/交互断言不成立' })
  if (exceptions.length) summary.anomalies.push({ level: 'error', code: 'runtime-error', message: exceptions.join('; ') })
  if (network.length) summary.anomalies.push({ level: 'inconclusive', code: 'network-blocked', message: '已在发送前拒绝非允许请求' })
  if (shots.some(shot => shot.still && shot.still.status !== 'PASS'))
    summary.anomalies.push({ level: 'inconclusive', code: 'still-failed', message: '独立复演截图取证失败；不能称为成功关键帧' })
  if (cleanup?.status === 'INCONCLUSIVE') summary.anomalies.push({ level: 'inconclusive', code: 'cleanup-failed', message: '上下文清理未确认' })
  summary.status = combineStatus(summary.anomalies.map(a => a.level === 'error' ? 'FAIL' : a.level === 'inconclusive' ? 'INCONCLUSIVE' : 'PASS'))
  summary.functionalFailure = summary.status === 'FAIL'
  return summary
}
