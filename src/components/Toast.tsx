import { useCallback, useRef, useState } from 'react'

/**
 * 轻量 Toast（Prototype 操作反馈）。
 * 用法：const { toast, show } = useToast(); show('已保存'); 渲染 {toast}
 */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((msg: string, duration = 1800) => {
    if (timer.current) clearTimeout(timer.current)
    setMessage(msg)
    timer.current = setTimeout(() => setMessage(null), duration)
  }, [])

  const toast = message ? (
    <div
      className="fixed left-1/2 z-30 -translate-x-1/2 rounded-full bg-neutral-900/92 px-4 py-2 text-[13px] text-white shadow-lg"
      style={{ bottom: 'calc(88px + env(safe-area-inset-bottom))' }}
      role="status"
    >
      {message}
    </div>
  ) : null

  return { toast, show }
}
