import { useEffect, useState } from 'react'

/**
 * Large Title → Compact Header 折叠（Phase 2H）。
 *
 * 原理：在大标题位置放一个哨兵元素，用 IntersectionObserver 观察它是否还
 * 出现在「sticky header 下沿」之上的可视区。哨兵一旦离开视口顶部（被 header
 * 遮住），就切换为折叠态——居中小标题 + chrome 材质背景接管。
 *
 * - 不依赖任何动画库；状态切换只是 class 变化，过渡交给 CSS。
 * - prefers-reduced-motion 下全局已把 transition 压到 0.01ms，自然退化为瞬时切换。
 * - IntersectionObserver 不存在（极老环境）时优雅降级：永远显示大标题形态。
 * - 用**回调 ref** 而不是 useRef：页面在数据加载完成前渲染 null，
 *   useRef 拿到的挂载时机太早，effect 跑一次就再也不重连；回调 ref 保证
 *   哨兵真正挂上 DOM 时 effect 才启动。
 */
export function useHeaderCollapse<T extends HTMLElement = HTMLElement>() {
  const [sentinel, setSentinel] = useState<T | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!sentinel) return
    if (typeof IntersectionObserver === 'undefined') return

    // header 高度约 52px：哨兵顶部越过这条线即折叠
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry) setCollapsed(!entry.isIntersecting)
      },
      { threshold: 0, rootMargin: '-52px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinel])

  return { sentinelRef: setSentinel, collapsed }
}
