// rAF measures main-thread sampling, never display presentation FPS.
function installSampler() {
  if (window.__ml) return
  const round = value => Math.round(value * 100) / 100
  const elements = new WeakMap(), animations = new WeakMap()
  let nextElement = 0, nextAnimation = 0, current, paused = []
  const elementId = element => {
    if (!element) return null
    if (!elements.has(element)) elements.set(element, 'el-' + ++nextElement)
    return elements.get(element)
  }
  const animationId = animation => {
    if (!animations.has(animation)) animations.set(animation, 'anim-' + ++nextAnimation)
    return animations.get(animation)
  }
  const luminance = color => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(color)
    if (!m) return null
    const c = value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4 }
    return round((.2126 * c(+m[1]) + .7152 * c(+m[2]) + .0722 * c(+m[3])) * 1000) / 1000
  }
  const describe = element => {
    if (!element) return null
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
    const matrix = new DOMMatrixReadOnly(style.transform)
    const scaleSupported = matrix.is2D && Math.abs(matrix.b) < .00001 && Math.abs(matrix.c) < .00001 &&
      (!style.scale || style.scale === 'none') && (!style.rotate || style.rotate === 'none')
    return { id: elementId(element), x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height),
      o: round(parseFloat(style.opacity)), tx: round(matrix.m41), ty: round(matrix.m42),
      sx: scaleSupported ? round(matrix.a) : null, sy: scaleSupported ? round(matrix.d) : null, scaleSupported,
      lum: luminance(style.backgroundColor), scrollTop: round(element.scrollTop), scrollLeft: round(element.scrollLeft) }
  }
  const labels = (element, targets) => {
    const direct = targets.find(target => element?.matches?.(target.sel))?.label ?? null
    const ancestor = targets.find(target => element?.closest?.(target.sel))?.label ?? null
    return { target: direct, parentLabel: direct ? null : ancestor }
  }
  const animationInfo = (animation, targets) => {
    const element = animation.effect?.target
    if (!(element instanceof Element)) return null
    const label = labels(element, targets)
    if (!label.target) return null
    const timing = animation.effect.getComputedTiming(), input = animation.effect.getTiming()
    const kind = typeof CSSTransition !== 'undefined' && animation instanceof CSSTransition ? 'transition' :
      typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation ? 'animation' : 'waapi'
    return { id: animationId(animation), elementId: elementId(element), target: label.target, pseudo: animation.effect.pseudoElement ?? '',
      k: kind, p: animation.transitionProperty || animation.animationName || '', s: animation.playState, pending: animation.pending,
      d: typeof timing.duration === 'number' ? timing.duration : null, e: Number.isFinite(timing.endTime) ? timing.endTime : null,
      g: timing.easing, delay: input.delay, iterations: input.iterations, rate: animation.playbackRate,
      currentTime: typeof animation.currentTime === 'number' ? round(animation.currentTime) : null,
      startTime: typeof animation.startTime === 'number' ? round(animation.startTime) : null, progress: timing.progress }
  }
  window.__ml = {
    version: '2',
    armed: false,
    begin(config) {
      if (current && !current.done) throw new Error('Capture already active')
      const { targets } = config
      const settleMs = config.settleMs ?? 350, maxMs = config.maxMs ?? 4000
      const start = performance.now()
      const record = {
        meta: { sampler: '2', startedAt: new Date().toISOString(), url: location.href,
          viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
          appThemeBefore: document.documentElement.dataset.theme,
          geometryScope: 'CSS viewport border boxes; own transform tx/ty; no ancestor/layout decomposition',
          config: { targets, settleMs, maxMs } },
        frames: [], events: [], animations: [], triggerError: null, triggerAt: null,
        truncated: { events: 0, animations: 0, snapshots: 0, frames: 0 }, visibility: [], lifecycles: [],
      }
      let resolve, lastActivity = start, previous = null, raf, watchdog, eventNumber = 0, instanceNumber = 0
      const promise = new Promise(done => { resolve = done })
      const listeners = [], active = new Map(), observed = new Set()
      const state = { record, promise, done: false }
      current = state
      window.__ml.armed = false
      const t = () => round(performance.now() - start)
      // 计时口径分链记录：输入事件到达 / React 提交（DOM 属性与节点出现）/ 动画事件各自独立打点，
      // 全部使用页面内 performance.now 时钟（与 triggerAt 同源），Node 侧发送时刻由捕获层单独记录。
      const inputMarks = {}
      const domTimeline = []
      const inputListener = event => {
        if (inputMarks[event.type] || !record.triggerAt) return
        inputMarks[event.type] = { t: t(), timeStamp: round(event.timeStamp) }
      }
      for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click']) {
        document.addEventListener(type, inputListener, true)
        listeners.push([type, inputListener])
      }
      let domObserver
      if (typeof MutationObserver !== 'undefined') {
        domObserver = new MutationObserver(mutations => {
          if (domTimeline.length >= 80) return
          for (const mutation of mutations) {
            const at = t()
            if (mutation.type === 'childList') {
              for (const node of mutation.addedNodes) if (node.nodeType === 1 && domTimeline.length < 80)
                domTimeline.push({ t: at, kind: 'added', tag: node.tagName, cls: typeof node.className === 'string' ? node.className.slice(0, 50) : '' })
            } else if (domTimeline.length < 80)
              domTimeline.push({ t: at, kind: 'attr', target: mutation.target.tagName, attr: mutation.attributeName,
                value: String(mutation.target.getAttribute(mutation.attributeName) ?? '').slice(0, 24) })
          }
        })
        domObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
          attributeFilter: ['data-state', 'data-ready', 'open'] })
      }
      const append = entry => {
        if (record.events.length < (config.eventLimit ?? 3000)) record.events.push({ eventId: 'event-' + ++eventNumber, t: t(), ...entry })
        else record.truncated.events++
      }
      const finish = reason => {
        if (state.done) return
        state.done = true
        cancelAnimationFrame(raf)
        clearTimeout(watchdog)
        for (const [type, listener] of listeners) document.removeEventListener(type, listener, true)
        domObserver?.disconnect()
        record.totalMs = t()
        record.settledBy = reason
        record.meta.appThemeAfter = document.documentElement.dataset.theme
        record.timeline = { clock: 'performance.now relative to capture start; Node send times are a separate clock (see record.input.sentAt)',
          input: inputMarks, dom: domTimeline }
        resolve(record)
      }
      const visibility = () => {
        record.visibility.push({ t: t(), state: document.visibilityState })
        if (document.visibilityState !== 'visible') record.hidden = true
      }
      visibility()
      document.addEventListener('visibilitychange', visibility, true)
      listeners.push(['visibilitychange', visibility])
      const eventHandler = event => {
        const label = labels(event.target, targets)
        if (!label.target && !label.parentLabel) return
        const kind = event.type.startsWith('transition') ? 'transition' : 'animation'
        const p = event.propertyName || event.animationName || ''
        const eid = elementId(event.target), pseudo = event.pseudoElement ?? ''
        const key = [eid, pseudo, kind, p].join('|')
        if (!active.has(key)) active.set(key, [])
        const queue = active.get(key)
        const isRun = event.type === 'transitionrun'
        const isStart = event.type === 'transitionstart' || event.type === 'animationstart'
        let instance
        if (isRun || isStart) {
          instance = !isRun ? queue.find(entry => !entry.started && !entry.closed) : null
          if (!instance) {
            const matches = document.getAnimations().map(a => animationInfo(a, targets)).filter(a => a && a.elementId === eid && a.p === p && a.pseudo === pseudo)
            instance = { id: 'instance-' + ++instanceNumber, animationId: matches.length === 1 ? matches[0].id : null,
              ambiguous: matches.length > 1, started: false, closed: false }
            queue.push(instance)
          }
          if (isStart) instance.started = true
        } else {
          instance = queue.find(entry => !entry.closed && (entry.started || event.type.endsWith('cancel')))
          if (instance) instance.closed = true
        }
        append({ type: event.type, p, ...label, elementId: eid, pseudo,
          instanceId: instance?.id ?? null, animationId: instance?.animationId ?? null, ambiguous: instance?.ambiguous ?? false,
          elapsedMs: round(event.elapsedTime * 1000), timeStamp: round(event.timeStamp), connected: event.target.isConnected })
        if (label.target) lastActivity = performance.now()
      }
      for (const type of ['transitionrun', 'transitionstart', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) {
        document.addEventListener(type, eventHandler, true)
        listeners.push([type, eventHandler])
      }
      const tick = rafTime => {
        if (state.done) return
        try {
          const now = performance.now(), frame = { t: round(now - start), rafTime: round(rafTime - start), tg: {},
            scroll: { x: scrollX, y: scrollY, visualScale: visualViewport?.scale ?? 1 }, running: 0 }
          for (const target of targets) {
            const value = describe(document.querySelector(target.sel))
            frame.tg[target.label] = value
            const before = previous?.tg[target.label]
            if ((before?.id ?? null) !== (value?.id ?? null)) {
              lastActivity = now
              record.lifecycles.push({ t: frame.t, target: target.label, from: before?.id ?? null, to: value?.id ?? null })
            }
            if (value && before) for (const key of ['x', 'y', 'w', 'h', 'o', 'tx', 'ty', 'sx', 'sy', 'lum']) {
              const epsilon = ['o', 'lum', 'sx', 'sy'].includes(key) ? .004 : .25
              if (Number.isFinite(value[key]) && Number.isFinite(before[key]) && Math.abs(value[key] - before[key]) > epsilon) lastActivity = now
            }
          }
          const list = []
          for (const animation of document.getAnimations()) {
            const info = animationInfo(animation, targets)
            if (!info) continue
            if (animation.pending || animation.playState === 'running') frame.running++
            if (list.length < (config.animationLimit ?? 100)) list.push(info)
            else record.truncated.animations++
            if (!observed.has(animation)) {
              observed.add(animation)
              for (const type of ['finish', 'cancel']) animation.addEventListener(type, () => {
                if (!state.done) append({ ...info, ...animationInfo(animation, targets), type: 'waapi' + type,
                  animationId: info.id, elementId: info.elementId })
              }, { once: true })
            }
          }
          if (frame.running) lastActivity = now
          if (record.animations.length < 600) record.animations.push({ t: frame.t, list })
          else record.truncated.snapshots++
          frame.sampleCostMs = round(performance.now() - now)
          if (record.frames.length < 1500) record.frames.push(frame)
          else record.truncated.frames++
          previous = frame
          window.__ml.armed = record.frames.length >= 2
          if (record.triggerAt !== null && now - lastActivity >= settleMs) return finish('stable')
          if (now - start >= maxMs) return finish('maxMs')
          raf = requestAnimationFrame(tick)
        } catch (error) { record.captureError = String(error); finish('capture-error') }
      }
      state.trigger = () => { record.triggerAt = t(); lastActivity = performance.now() }
      state.finish = finish
      watchdog = setTimeout(() => finish('watchdog'), maxMs + 250)
      raf = requestAnimationFrame(tick)
      return true
    },
    trigger() {
      if (!current || current.done || !this.armed) throw new Error('Capture is not armed')
      current.trigger()
      return current.record.triggerAt
    },
    result() { return current?.promise },
    partial() { return current?.record ?? null },
    cancel() { current?.finish('cancelled') },
    stills(config) {
      const { matchSel, matchProp, fraction, expectedMs } = config
      return new Promise(resolve => {
        let done = false, timer
        const started = performance.now()
        const finish = result => {
          if (done) return
          done = true
          clearTimeout(timer)
          document.removeEventListener('transitionstart', arm, true)
          document.removeEventListener('animationstart', arm, true)
          resolve({ replay: true, requestedFraction: fraction, fraction, atMs: round(performance.now() - started), ...result })
        }
        const arm = event => {
          if (done || !event.target.matches(matchSel) || (event.propertyName || event.animationName) !== matchProp) return
          document.removeEventListener('transitionstart', arm, true)
          document.removeEventListener('animationstart', arm, true)
          Promise.resolve().then(async () => {
            const element = document.querySelector(matchSel)
            const matches = document.getAnimations().filter(animation => animation.effect?.target === element &&
              (animation.transitionProperty || animation.animationName) === matchProp && animation.playState === 'running')
            if (matches.length !== 1) return finish({ status: 'INCONCLUSIVE', paused: 0, note: 'no-unique-running-animation' })
            // A visual target can have concurrent opacity/layout transitions.
            paused = document.getAnimations().filter(animation => animation.effect?.target === element &&
              (animation.playState === 'running' || animation.pending))
            const timing = matches[0].effect.getComputedTiming()
            const seekTime = matches[0].effect.getTiming().delay + timing.duration * fraction
            for (const animation of paused) animation.pause()
            await Promise.all(paused.map(animation => animation.ready))
            for (const animation of paused) animation.currentTime = seekTime
            const layoutAnimations = config.settleSel ? document.getAnimations().filter(animation =>
              animation.effect?.target?.matches?.(config.settleSel) && !paused.includes(animation)) : []
            await Promise.all(layoutAnimations.map(animation => animation.finished))
            if (done) return
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            const info = animationInfo(matches[0], [{ sel: matchSel, label: 'frozen' }])
            finish({ status: element?.isConnected ? 'PASS' : 'INCONCLUSIVE', paused: paused.length, elementId: elementId(element),
              method: 'independent replay; pause target animations and seek actual animation timeline', seekTime,
              settledLayoutAnimations: layoutAnimations.map(animation => animationId(animation)),
              pausedAnimations: paused.map(animation => animationInfo(animation, [{ sel: matchSel, label: 'frozen' }])),
              currentTime: info.currentTime, durationMs: info.d, actualProgress: info.progress, frozen: describe(element) })
          }).catch(error => finish({ status: 'INCONCLUSIVE', paused: paused.length, note: 'freeze-error: ' + String(error) }))
        }
        document.addEventListener('transitionstart', arm, true)
        document.addEventListener('animationstart', arm, true)
        timer = setTimeout(() => finish({ status: 'INCONCLUSIVE', paused: 0, note: 'no-matching-animation-start' }), config.timeoutMs ?? expectedMs * 2 + 500)
      })
    },
    release() {
      for (const animation of paused) if (animation.playState === 'paused') animation.play()
      const count = paused.length
      paused = []
      return count
    },
    describe(sel) { return describe(document.querySelector(sel)) },
  }
}
export const samplerSource = '(' + installSampler.toString() + ')();'
export const captureCall = config => 'window.__ml.begin(' + JSON.stringify(config) + ')'
export const stillsCall = config => 'window.__ml.stills(' + JSON.stringify(config) + ')'
export const releaseCall = () => 'window.__ml.release()'
