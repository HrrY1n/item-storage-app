// MotionLab 基线对比规则测试（node --test，无需浏览器与文件系统）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { _internal } from '../src/baseline.mjs'

const { durationEntry } = _internal

test('当前值落在基线区间内 → ok', () => {
  const entry = durationEntry('事件时长', { median: 480, min: 460, max: 500 }, 470)
  assert.equal(entry.class, 'ok')
  assert.equal(entry.verdict, '在基线区间内')
})

test('超出区间但在容差内 → ok（软阈值防误报）', () => {
  const entry = durationEntry('事件时长', { median: 480, min: 460, max: 500 }, 610)
  assert.equal(entry.class, 'ok')
})

test('超出容差且相对偏离大 → warning', () => {
  const entry = durationEntry('事件时长', { median: 480, min: 460, max: 500 }, 900)
  assert.equal(entry.class, 'warning')
})

test('无基线 → info', () => {
  const entry = durationEntry('事件时长', null, 480)
  assert.equal(entry.class, 'info')
  assert.equal(entry.verdict, '无基线值')
})

test('当前无有效数据 → info 且不崩溃', () => {
  const entry = durationEntry('事件时长', { median: 480, min: 460, max: 500 }, null)
  assert.equal(entry.class, 'info')
})

test('观测区间使用更宽的容差参数', () => {
  const within = durationEntry('观测区间', { median: 400, min: 380, max: 420 }, 590, { absoluteSlack: 200, ratioSlack: 0.5 })
  assert.equal(within.class, 'ok')
  const beyond = durationEntry('观测区间', { median: 400, min: 380, max: 420 }, 800, { absoluteSlack: 200, ratioSlack: 0.5 })
  assert.equal(beyond.class, 'warning')
})
