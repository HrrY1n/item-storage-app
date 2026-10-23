import { usePwaUpdate } from '../features/pwa/PwaUpdateContext'

/**
 * 更新就绪提示（Phase 2H.1）。
 *
 * 只在**不安全刷新**时出现（正在编辑 / 有浮层打开）：
 * 安全状态下由跨页面的更新遮层衔接提示、重载和恢复。
 *
 * 视觉沿用既有语言：chrome 材质 + surface + info 语义色；
 * 用 `role="status"` + 文字说明，不靠颜色单独传达状态，也不用 alert()。
 */
export default function UpdateBanner() {
  const { snapshot } = usePwaUpdate()
  const visible = snapshot.updatePending && snapshot.blocked

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-update-banner="blocked"
      className="chrome pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-[var(--shell-max)] justify-center px-5"
    >
      <div className="flex max-w-full items-center gap-2.5 rounded-pill border border-line bg-surface px-4 py-2.5 shadow-lift">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="shrink-0 text-info"
        >
          <path d="M12 3v12" />
          <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
          <path d="M5 20h14" />
        </svg>
        <span className="min-w-0 truncate text-secondary text-ink-primary">
          新版本已就绪，完成当前操作后自动更新
        </span>
      </div>
    </div>
  )
}
