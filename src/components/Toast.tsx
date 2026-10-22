import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 轻量 Toast（操作反馈）。
 * 用法：const { toast, show } = useToast(); show('已保存'); 渲染 {toast}
 *
 * 视觉：深色胶囊 + 材质模糊 + 弹簧弹出，位于底部导航之上。
 */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const show = useCallback((msg: string, duration = 1800) => {
    if (timer.current) clearTimeout(timer.current)
    setMessage(msg)
    timer.current = setTimeout(() => setMessage(null), duration)
  }, [])

  const toast = message ? (
    <div
      className="fixed left-1/2 z-30 -translate-x-1/2"
      style={{ bottom: 'calc(92px + env(safe-area-inset-bottom))' }}
      role="status"
    >
      <div className="animate-pop-in rounded-pill bg-ink-solid px-5 py-2.5 text-secondary text-ink-inverse shadow-sheet">{message}</div>
    </div>
  ) : null

  return { toast, show }
}
