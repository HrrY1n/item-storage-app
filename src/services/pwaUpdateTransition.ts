export const UPDATE_RESUME_KEY = 'pil.pwa.update-resume'
export const UPDATE_RESUME_TTL_MS = 120_000

interface UpdateResume {
  at: number
  path: string
  x: number
  y: number
}

// index.html 的首帧引导使用同一格式；契约测试会执行那段脚本。
export function parseUpdateResume(raw: string | null, path: string, now: number): UpdateResume | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    if (!value || typeof value !== 'object') return null
    const v = value as Record<string, unknown>
    if (typeof v.at !== 'number' || !Number.isFinite(v.at) || now - v.at < 0 || now - v.at > UPDATE_RESUME_TTL_MS) return null
    if (v.path !== path) return null
    if (![v.x, v.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10_000_000)) return null
    return { at: v.at, path, x: v.x as number, y: v.y as number }
  } catch {
    return null
  }
}

const currentPath = () => location.pathname + location.search + location.hash

export function setUpdateTransition(active: boolean): void {
  const cover = document.getElementById('pwa-update-cover')
  if (cover) {
    cover.hidden = !active
    if (active) {
      cover.dataset.phase = 'updating'
      const title = document.getElementById('pwa-update-title')
      if (title) title.textContent = '发现新版本'
    }
  }
  const root = document.getElementById('root')
  if (root) root.inert = active
}

export function reloadForUpdate(): void {
  try {
    sessionStorage.setItem(UPDATE_RESUME_KEY, JSON.stringify({
      at: Date.now(), path: currentPath(), x: window.scrollX, y: window.scrollY,
    }))
    history.scrollRestoration = 'manual'
  } catch {
    // 隐私模式无法保存界面位置时，更新仍然继续。
  }
  window.location.reload()
}

export function dismissUpdateTransition(): void {
  try { sessionStorage.removeItem(UPDATE_RESUME_KEY) } catch { /* 存储不可用 */ }
  history.scrollRestoration = 'auto'
  setUpdateTransition(false)
}

/** 新界面提交后恢复位置，再撤掉与旧页面相同的遮层；不读取或写入业务数据。 */
export function finishUpdateTransition(onComplete: () => void): () => void {
  let resume: UpdateResume | null = null
  try { resume = parseUpdateResume(sessionStorage.getItem(UPDATE_RESUME_KEY), currentPath(), Date.now()) } catch { /* 存储不可用 */ }
  const cover = document.getElementById('pwa-update-cover')
  if (!resume) {
    if (cover?.dataset.phase === 'restoring') dismissUpdateTransition()
    return () => {}
  }
  const saved = resume
  const deadline = performance.now() + 1200
  let frame = 0
  let passes = 0
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  const restore = () => {
    if (currentPath() !== saved.path) {
      dismissUpdateTransition()
      return
    }
    window.scrollTo(saved.x, saved.y)
    // 列表数据异步到达时，给页面高度一个短暂稳定窗口，避免被钳到顶部。
    if (++passes < 2 || (Math.abs(window.scrollY - saved.y) > 2 && performance.now() < deadline)) {
      frame = requestAnimationFrame(restore)
      return
    }
    try { sessionStorage.removeItem(UPDATE_RESUME_KEY) } catch { /* 存储不可用 */ }
    history.scrollRestoration = 'auto'
    const root = document.getElementById('root')
    if (root) root.inert = false
    document.getElementById('main-content')?.focus({ preventScroll: true })
    onComplete()
    if (cover) {
      cover.dataset.phase = 'complete'
      hideTimer = setTimeout(() => { cover.hidden = true }, 180)
    }
  }
  frame = requestAnimationFrame(restore)
  return () => {
    cancelAnimationFrame(frame)
    clearTimeout(hideTimer)
  }
}
