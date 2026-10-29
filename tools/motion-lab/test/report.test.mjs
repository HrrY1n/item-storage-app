// MotionLab 报告生成与采样器注入源测试（node --test，无需浏览器）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderReport, svgCurve } from '../src/report.mjs'
import { samplerSource } from '../src/sampler.mjs'

function fixtureRun() {
  return {
    runId: 'motion-test',
    startedAt: '2026-10-26T00:00:00.000Z',
    options: { repeat: 1 },
    env: { baseUrl: 'http://127.0.0.1:5173', port: 9225 },
    scenarios: [
      {
        id: 'demo-scenario',
        title: '演示场景 <标签检查>',
        description: '用于报告测试的合成数据',
        spec: {
          primary: { label: 'panel', signal: 'ty', declaredMs: 480, eventProperty: 'transform' },
          secondary: [{ label: 'backdrop', signal: 'o', declaredMs: 220 }],
        },
        runs: [
          {
            frames: 20,
            totalMs: 900,
            triggerAt: 30,
            settledBy: 'stable',
            reducedMotion: false,
            colorScheme: 'light',
            viewport: { width: 390, height: 844, dpr: 2 },
            primary: {
              label: 'panel',
              signal: 'ty',
              declaredMs: 480,
              interval: { activeMs: 420, from: 720, to: 0, moved: true, leadingNulls: 3, firstChange: 60, lastChange: 480, seriesLength: 17 },
              eventDuration: { start: 60, end: 540, durationMs: 480, outcome: 'ended' },
            },
            secondary: {
              backdrop: { signal: 'o', declaredMs: 220, interval: { activeMs: 180, from: 0, to: 1, moved: true }, eventDuration: null },
            },
            series: {
              panel: [[0, 720], [60, 700], [120, 400], [300, 100], [540, 0], [700, 0]],
              backdrop: [[0, 0], [60, 0.3], [120, 0.7], [300, 1], [700, 1]],
            },
            gaps: { count: 19, median: 16.7, p95: 22, max: 33, over2xMedian: 1 },
            timings: [],
            anomalies: [{ level: 'info', code: 'demo-info', message: '说明 & <转义检查>' }],
            checks: [{ name: '示例检查', pass: true }],
            exceptions: [],
            functionalFailure: false,
            shots: [{ name: 'before', file: 'shots/demo-scenario-r1-before.png', still: null }],
          },
        ],
      },
    ],
  }
}

test('svgCurve 生成折线与图例', () => {
  const svg = svgCurve([{ name: 'A', points: [[0, 0], [100, 50], [200, 10]] }])
  assert.ok(svg.includes('<polyline'))
  assert.ok(svg.includes('legend-item'))
  assert.ok(svg.includes('A'))
})

test('svgCurve 单点数据返回占位', () => {
  const html = svgCurve([{ name: 'A', points: [[0, 0]] }])
  assert.ok(html.includes('chart-empty'))
})

test('renderReport 输出自包含结构', () => {
  const html = renderReport(fixtureRun(), null, { shotsBase64: new Map(), records: new Map() })
  assert.ok(html.includes('MotionLab 动效分析报告'))
  assert.ok(html.includes('演示场景 &lt;标签检查&gt;'), '标题需 HTML 转义')
  assert.ok(html.includes('<polyline'), '应包含曲线图')
  assert.ok(html.includes('demo-scenario-r1-before.png'), '截图文件引用')
  assert.ok(html.includes('下载本场景数据'), '原始数据下载入口')
  assert.ok(html.includes('不代表浏览器实际渲染帧率'), '测量边界声明')
})

test('renderReport 内嵌 JSON 可被浏览器原样解析', () => {
  const html = renderReport(fixtureRun(), null, { shotsBase64: new Map(), records: new Map() })
  const match = html.match(/<script type="application\/json" data-portable="demo-scenario">([\s\S]*?)<\/script>/)
  assert.ok(match, '应存在内嵌 JSON 块')
  const parsed = JSON.parse(match[1])
  assert.equal(parsed.scenario.id, 'demo-scenario')
  assert.ok(parsed.runs[0].summary.series.panel.length > 0)
  assert.ok(!match[1].includes('&quot;'), 'JSON 块内不应有 HTML 实体转义')
})

test('renderReport 基线对比区块', () => {
  const comparison = {
    scenarios: [
      { id: 'demo-scenario', entries: [
        { metric: '主信号事件时长 (ms)', baseline: { value: 480, range: '470–490' }, current: 500, delta: 20, class: 'ok', verdict: '在基线区间内' },
      ] },
    ],
    note: '测试说明',
  }
  const html = renderReport(fixtureRun(), comparison, { shotsBase64: new Map(), records: new Map() })
  assert.ok(html.includes('基线对比'))
  assert.ok(html.includes('在基线区间内'))
})

test('采样器注入源语法有效且幂等防护', () => {
  assert.doesNotThrow(() => new Function(samplerSource))
  assert.ok(samplerSource.includes('if (window.__ml) return'), '重复注入防护')
  assert.ok(samplerSource.includes('requestAnimationFrame'), 'rAF 采样循环')
  assert.ok(samplerSource.includes('getAnimations'), '动画快照')
})
