import { afterEach, describe, expect, it, vi } from 'vitest'
import html from '../../index.html?raw'
import {
  UPDATE_RESUME_KEY, UPDATE_RESUME_TTL_MS, parseUpdateResume,
  setUpdateTransition, reloadForUpdate, finishUpdateTransition, dismissUpdateTransition,
} from './pwaUpdateTransition'

const NOW = 1_800_000_000_000
const PATH = '/settings?view=all#update'
const saved = { at: NOW - 1000, path: PATH, x: 0, y: 420 }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('更新后界面恢复的首帧契约', () => {
  const script = html.match(/<script id="pwa-update-bootstrap">([\s\S]*?)<\/script>/)?.[1]
  const runBootstrap = (environment: Record<string, unknown>) =>
    new Function(...Object.keys(environment), script!)(...Object.values(environment))
  it('HTML 首帧和运行时对有效、失效和损坏记录作出同一判断', () => {
    expect(script).toBeTruthy()
    const cases = [null, '', '{bad', 'null', '[]', '{}', JSON.stringify(saved),
      JSON.stringify({ ...saved, at: NOW - UPDATE_RESUME_TTL_MS }),
      JSON.stringify({ ...saved, at: NOW - UPDATE_RESUME_TTL_MS - 1 }),
      JSON.stringify({ ...saved, at: NOW + 1 }),
      JSON.stringify({ ...saved, path: '/' }), JSON.stringify({ ...saved, at: '1' }),
      JSON.stringify({ ...saved, y: -1 }), JSON.stringify({ ...saved, x: 10_000_001 }),
      JSON.stringify({ ...saved, y: null }), JSON.stringify({ ...saved, x: '0' })]
    for (const raw of cases) {
      const cover = { hidden: true }
      const root = { inert: false }
      runBootstrap({
        sessionStorage: { getItem: () => raw }, Date: { now: () => NOW },
        location: { pathname: '/settings', search: '?view=all', hash: '#update' },
        document: { getElementById: (id: string) => id === 'root' ? root : cover }, history: {},
      })
      const valid = parseUpdateResume(raw, PATH, NOW) !== null
      expect(cover.hidden, String(raw)).toBe(!valid)
      expect(root.inert, String(raw)).toBe(valid)
    }
  })

  it('首帧存储被浏览器禁用时不会遮住正常页面', () => {
    const document = { getElementById: vi.fn() }
    expect(() => runBootstrap({
      sessionStorage: { getItem: () => { throw new Error('denied') } }, document,
    })).not.toThrow()
    expect(document.getElementById).not.toHaveBeenCalled()
  })
})

function browser(raw: string | null = JSON.stringify(saved)) {
  vi.useFakeTimers()
  const store = new Map(raw ? [[UPDATE_RESUME_KEY, raw]] : [])
  const nodes = {
    root: { inert: false },
    'pwa-update-cover': { hidden: true, dataset: { phase: 'restoring' } },
    'pwa-update-title': { textContent: '正在恢复页面' },
    'main-content': { focus: vi.fn() },
  }
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  const reload = vi.fn()
  const win = { scrollX: 0, scrollY: 0, location: { reload }, scrollTo: (x: number, y: number) => { win.scrollX = x; win.scrollY = y } }
  vi.stubGlobal('window', win)
  vi.stubGlobal('location', { pathname: '/settings', search: '?view=all', hash: '#update' })
  vi.stubGlobal('history', { scrollRestoration: 'auto' })
  vi.stubGlobal('document', { getElementById: (id: keyof typeof nodes) => nodes[id] })
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) } })
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.setSystemTime(NOW)
  const frame = () => { const current = [...frames.values()]; frames.clear(); current.forEach(fn => fn(0)) }
  return { store, nodes, win, reload, frame }
}

it('刷新前保存当前 URL 和位置；隐私模式保存失败仍能刷新', () => {
  const h = browser(null)
  h.win.scrollY = 420
  setUpdateTransition(true)
  expect(h.nodes.root.inert).toBe(true)
  expect(h.nodes['pwa-update-cover'].hidden).toBe(false)
  expect(h.nodes['pwa-update-title'].textContent).toBe('发现新版本')
  reloadForUpdate()
  expect(parseUpdateResume(h.store.get(UPDATE_RESUME_KEY)!, PATH, NOW)).toEqual({ ...saved, at: NOW })
  expect(h.reload).toHaveBeenCalledOnce()
  vi.stubGlobal('sessionStorage', { setItem: () => { throw new Error('denied') } })
  expect(reloadForUpdate).not.toThrow()
  expect(h.reload).toHaveBeenCalledTimes(2)
})

it('界面稳定后恢复滚动、退出遮层并仅提示一次完成', () => {
  const h = browser()
  const complete = vi.fn()
  h.nodes.root.inert = true
  h.nodes['pwa-update-cover'].hidden = false
  finishUpdateTransition(complete)
  h.frame()
  expect(complete).not.toHaveBeenCalled()
  expect(h.win.scrollY).toBe(420)
  h.frame()
  expect(complete).toHaveBeenCalledOnce()
  expect(h.nodes.root.inert).toBe(false)
  expect(h.nodes['main-content'].focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(h.nodes['pwa-update-cover'].dataset.phase).toBe('complete')
  vi.advanceTimersByTime(180)
  expect(h.nodes['pwa-update-cover'].hidden).toBe(true)
  finishUpdateTransition(complete)
  h.frame()
  expect(complete).toHaveBeenCalledOnce()
})

it('卸载时取消恢复，记录仍可由后续启动消费', () => {
  const h = browser()
  const complete = vi.fn()
  const cancel = finishUpdateTransition(complete)
  cancel()
  h.frame()
  expect(complete).not.toHaveBeenCalled()
  expect(h.store.has(UPDATE_RESUME_KEY)).toBe(true)
})

it('数据库启动失败或恢复目标已失效时撤掉遮层，不报告完成', () => {
  const h = browser('{bad')
  h.nodes.root.inert = true
  h.nodes['pwa-update-cover'].hidden = false
  const complete = vi.fn()
  finishUpdateTransition(complete)
  expect(h.nodes.root.inert).toBe(false)
  expect(h.nodes['pwa-update-cover'].hidden).toBe(true)
  expect(complete).not.toHaveBeenCalled()
  h.store.set(UPDATE_RESUME_KEY, JSON.stringify(saved))
  dismissUpdateTransition()
  expect(h.store.has(UPDATE_RESUME_KEY)).toBe(false)
})
