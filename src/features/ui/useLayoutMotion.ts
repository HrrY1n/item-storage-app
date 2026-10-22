import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/** 只为一次明确的 UI 变更测量可视条目；不在滚动或高度动画的每帧强制测量。 */
export function useLayoutMotion(key: string) {
  const ref = useRef<HTMLDivElement>(null)
  const before = useRef<Map<string, DOMRect> | null>(null)
  const animations = useRef<Animation[]>([])
  const nodes = () => Array.from(ref.current?.children ?? []).filter((node): node is HTMLElement => node instanceof HTMLElement)
  const cancel = useCallback(() => { animations.current.forEach(animation => animation.cancel()); animations.current = [] }, [])
  const capture = useCallback(() => {
    const positions = new Map<string, DOMRect>()
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const node of nodes()) {
        const id = node.dataset.layoutId ?? node.dataset.itemCard
        const rect = node.getBoundingClientRect()
        if (id && rect.bottom > 0 && rect.top < innerHeight) positions.set(id, rect)
      }
    }
    before.current = positions
    cancel()
  }, [cancel])
  useLayoutEffect(() => {
    const positions = before.current
    before.current = null
    if (!positions?.size || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const node of nodes()) {
      const old = positions.get(node.dataset.layoutId ?? node.dataset.itemCard ?? '')
      const rect = node.getBoundingClientRect()
      if (!old || !node.animate || rect.bottom < 0 || rect.top > innerHeight) continue
      const x = old.left - rect.left, y = old.top - rect.top
      if (Math.abs(x) + Math.abs(y) < 1) continue
      const animation = node.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], {
        duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      })
      animations.current.push(animation)
    }
  }, [key])
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => { if (reduced.matches) { before.current = null; cancel() } }
    reduced.addEventListener('change', change)
    return () => { reduced.removeEventListener('change', change); cancel() }
  }, [cancel])
  return { ref, capture }
}
