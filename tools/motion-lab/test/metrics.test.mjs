// MotionLab metrics 纯函数单元测试（node --test，无需浏览器）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  signalSeries,
  motionInterval,
  frameGaps,
  declaredTimings,
  eventDuration,
  detectAnomalies,
  summarize,
  median,
  defaultEps,
} from '../src/metrics.mjs'

function makeRecord(frames, { events = [], animations = [], meta = {} } = {}) {
  return {
    frames,
    events,
    animations,
    totalMs: frames.at(-1)?.t ?? 0,
    settledBy: 'stable',
    meta: { reducedMotion: false, colorScheme: 'light', viewport: { w: 390, h: 844, dpr: 2 }, ...meta },
  }
}

function panelFrames(pairs) {
  return pairs.map(([t, ty]) => ({ t, tg: { panel: { x: 0, y: 0, w: 390, h: 720, o: 1, tx: 0, ty, sx: 1, sy: 1 } }, running: 0 }))
}

test('median 处理奇偶长度', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(median([]), null)
})

test('defaultEps 按信号量纲选择阈值', () => {
  assert.equal(defaultEps('ty'), 0.5)
  assert.equal(defaultEps('h'), 0.5)
  assert.equal(defaultEps('o'), 0.01)
  assert.equal(defaultEps('lum'), 0.01)
})

test('signalSeries 保留缺失帧，供曲线断线', () => {
  const record = makeRecord([
    { t: 0, tg: { panel: null } },
    { t: 17, tg: { panel: { ty: 100, o: 1 } } },
    { t: 34, tg: { panel: null } },
    { t: 51, tg: { panel: { ty: 50, o: 1 } } },
  ])
  const series = signalSeries(record, 'panel', 'ty')
  assert.deepEqual(series.map(({t,v})=>({t,v})), [{t:0,v:null},{t:17,v:100},{t:34,v:null},{t:51,v:50}])
})

test('motionInterval 提取位移区间与首末缺失帧数', () => {
  const record = makeRecord([
    { t: 0, tg: { panel: null } },
    { t: 17, tg: { panel: null } },
    ...panelFrames([[34, 720], [51, 600], [68, 300], [85, 10], [102, 0], [119, 0], [136, 0]]),
  ])
  const interval = motionInterval(record, 'panel', 'ty')
  assert.equal(interval.moved, true)
  assert.equal(interval.leadingNulls, 2)
  assert.equal(interval.from, 720)
  assert.equal(interval.to, 0)
  assert.equal(interval.firstChange, 51)
  assert.equal(interval.activeMs, 102 - 51)
})

test('motionInterval 对无量纲信号使用小阈值（lum 回归用例）', () => {
  const frames = [
    { t: 5, tg: { body: { lum: 0.853, o: 1 } }, running: 0 },
    { t: 54, tg: { body: { lum: 0.394, o: 1 } }, running: 0 },
    { t: 105, tg: { body: { lum: 0.035, o: 1 } }, running: 0 },
    { t: 300, tg: { body: { lum: 0.005, o: 1 } }, running: 0 },
  ]
  const interval = motionInterval(makeRecord(frames), 'body', 'lum')
  assert.equal(interval.moved, true)
  assert.ok(interval.activeMs > 0, 'lum 过渡应被识别为有运动')
})

test('motionInterval 无运动时返回 moved=false', () => {
  const record = makeRecord(panelFrames([[0, 0], [17, 0], [34, 0]]))
  const interval = motionInterval(record, 'panel', 'ty')
  assert.equal(interval.moved, false)
  assert.equal(interval.activeMs, 0)
})

test('frameGaps 统计采样间隔', () => {
  const record = makeRecord(panelFrames([[0, 0], [16, 0], [33, 0], [50, 0], [200, 0]]))
  const gaps = frameGaps(record)
  assert.equal(gaps.count, 4)
  assert.equal(gaps.max, 150)
  assert.ok(gaps.over2xMedian >= 1)
})

test('declaredTimings 去重并保留状态集合', () => {
  const record = makeRecord([], {
    animations: [
      { t: 0, list: [{ k: 'transition', p: 'transform', s: 'running', d: 480, e: 480, g: 'linear' }] },
      { t: 100, list: [{ k: 'transition', p: 'transform', s: 'running', d: 480, e: 480, g: 'linear' }] },
      { t: 500, list: [{ k: 'transition', p: 'transform', s: 'finished', d: 480, e: 480, g: 'linear' }] },
    ],
  })
  const timings = declaredTimings(record)
  assert.equal(timings.length, 1)
  assert.deepEqual(timings[0].states.sort(), ['finished', 'running'])
})

test('eventDuration 配对 start/end 与 cancel', () => {
  const ended = eventDuration(
    { events: [
      { t: 10, type: 'transitionstart', p: 'transform', target: 'panel' },
      { t: 490, type: 'transitionend', p: 'transform', target: 'panel' },
    ] },
    'panel',
    'transform',
  )
  assert.equal(ended.durationMs, 480)
  assert.equal(ended.outcome, 'ended')

  const cancelled = eventDuration(
    { events: [
      { t: 10, type: 'transitionstart', p: 'transform', target: 'panel' },
      { t: 60, type: 'transitioncancel', p: 'transform', target: 'panel' },
    ] },
    'panel',
    'transform',
  )
  assert.equal(cancelled.outcome, 'cancelled')

  const none = eventDuration(
    { events: [{ t: 10, type: 'transitionstart', p: 'opacity', target: 'other' }] },
    'panel',
    'transform',
  )
  assert.equal(none, null)
})

test('detectAnomalies 覆盖主要规则', () => {
  const spec = { primary: { label: 'panel', signal: 'ty', declaredMs: 480 }, expectMotion: true }
  const noMotion = detectAnomalies(makeRecord(panelFrames([[0, 0], [17, 0], [34, 0]])), spec)
  assert.ok(noMotion.some(a => a.code === 'no-motion' && a.level === 'error'))

  const reduced = detectAnomalies(
    makeRecord(panelFrames([[0, 0], [17, 0]]), { meta: { reducedMotion: true } }),
    {...spec,reducedMotion:true},
  )
  assert.ok(!reduced.some(a => a.level === 'error'))

  const longFrames = panelFrames([[0, 720], [100, 500], [1500, 300], [2300, 0], [2400, 0]])
  const longTail = detectAnomalies(makeRecord(longFrames), spec)
  assert.ok(longTail.some(a => a.code === 'duration-long-tail'))
  assert.ok(longTail.some(a => a.code === 'frame-gap'))

  const missing = detectAnomalies(makeRecord([{ t: 0, tg: {} }]), spec)
  assert.ok(missing.some(a => a.code === 'target-missing' && a.level === 'error'))

  const error = detectAnomalies({ ...makeRecord(panelFrames([[0, 0], [17, 0]])), triggerError: 'boom' }, spec)
  assert.ok(error.some(a => a.code === 'trigger-error' && a.level === 'error'))
})

test('summarize 产出报告与基线所需结构', () => {
  const record = makeRecord(
    [
      { t: 0, tg: { panel: null, backdrop: null } },
      ...[
        [17, 720, 0], [34, 500, 0.4], [51, 200, 0.8], [68, 0, 1], [85, 0, 1], [102, 0, 1],
      ].map(([t, ty, o]) => ({ t, tg: { panel: { ty, o: 1, x: 0, y: 0, w: 390, h: 720, tx: 0, sx: 1, sy: 1 }, backdrop: { o, ty: 0, x: 0, y: 0, w: 390, h: 844, tx: 0, sx: 1, sy: 1 } }, running: 0 })),
    ],
    {
      events: [
        { t: 20, type: 'transitionstart', p: 'transform', target: 'panel' },
        { t: 500, type: 'transitionend', p: 'transform', target: 'panel' },
      ],
    },
  )
  const spec = {
    id: 'demo',
    primary: { label: 'panel', signal: 'ty', declaredMs: 480, eventProperty: 'transform' },
    secondary: [{ label: 'backdrop', signal: 'o', declaredMs: 220, eventProperty: 'opacity' }],
  }
  const summary = summarize(record, spec)
  assert.equal(summary.scenarioId, 'demo')
  assert.ok(summary.primary.interval.moved)
  assert.equal(summary.primary.eventDuration.durationMs, 480)
  assert.ok(summary.series.panel.length >= 5)
  assert.ok(summary.series.backdrop.length >= 5)
  assert.ok(summary.gaps.count > 0)
  assert.ok(Array.isArray(summary.anomalies))
})
