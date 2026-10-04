import { flushSync } from 'react-dom'

/**
 * 共享元素过渡（View Transitions API）的**渐进增强**封装。
 *
 * 只在同时满足以下条件时启用：
 *   1. 浏览器支持 document.startViewTransition
 *   2. 用户未开启「减少动效」
 * 否则直接执行 navigate —— 功能绝不依赖过渡，也不产生任何副作用。
 *
 * 用途：Item Card 的图版 → Item Detail 的主图版，建立"同一件物品"的空间连续性。
 */
export const SHARED_OBJECT_NAME = 'item-hero'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> }
}

export function supportsViewTransition(): boolean {
  if (typeof document === 'undefined') return false
  const d = document as ViewTransitionDocument
  return typeof d.startViewTransition === 'function' && !prefersReducedMotion()
}

/**
 * 执行带共享元素过渡的导航。
 *
 * @param navigate  真正跳转的函数（会被 flushSync 包裹以保证在同一帧完成 DOM 更新）
 * @param before    过渡开始前调用（用来给"起点元素"打上 view-transition-name）
 * @param after     过渡结束后调用（清理起点元素的 name，避免残留影响后续导航）
 */
export function navigateWithViewTransition(
  navigate: () => void,
  before?: () => void,
  after?: () => void,
): void {
  const d = document as ViewTransitionDocument
  if (!supportsViewTransition() || typeof d.startViewTransition !== 'function') {
    navigate()
    return
  }

  before?.()
  let transition: { finished: Promise<void> } | undefined
  try {
    transition = d.startViewTransition(() => {
      // 同步提交 React 更新，确保新页面的快照里已经存在目标元素
      flushSync(() => {
        navigate()
      })
    })
  } catch {
    // 任何异常都退回普通导航，绝不影响可用性
    after?.()
    navigate()
    return
  }

  void transition.finished.catch(() => undefined).finally(() => after?.())
}
