import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'

interface Props {
  title: string
  /** 右侧内容（如保存 / 编辑） */
  right?: ReactNode
  /** 自定义左侧返回行为；默认 history back */
  onBack?: () => void
  backLabel?: string
  /**
   * 浮层模式（Large Title 页面专用）：
   * 未折叠时 header 背景透明、居中标题隐藏（大标题在内容区承担层级）；
   * 折叠后 chrome 材质 + hairline 接管，居中小标题淡入。
   * 两个标题从不同时可见——这是 iOS Large Title collapse 的核心纪律。
   */
  floating?: boolean
  /** floating 模式下的折叠状态，由 useHeaderCollapse 提供 */
  collapsed?: boolean
}

/** 浮层模式下，返回 / 右侧按钮包一层圆形 chrome 底（悬浮在内容上仍可读） */
function ChromeCircle({ children }: { children: ReactNode }) {
  return (
    <span className="chrome flex h-9 min-w-[36px] items-center justify-center rounded-pill border border-line px-1.5 shadow-card">
      {children}
    </span>
  )
}

export default function PageHeader({
  title,
  right,
  onBack,
  backLabel,
  floating = false,
  collapsed = true,
}: Props) {
  const navigate = useNavigate()
  const solid = !floating || collapsed

  return (
    <header
      className={`sticky top-0 z-10 border-b transition-colors duration-200 ${
        solid ? 'chrome border-line' : 'border-transparent bg-transparent'
      }`}
    >
      <div className="flex min-h-[52px] items-center px-2 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={onBack ?? (() => navigate(-1))}
          className="flex min-h-[44px] min-w-[44px] items-center gap-0.5 px-1 text-ink-primary transition-opacity active:opacity-50"
          aria-label="返回"
        >
          {floating ? (
            <ChromeCircle>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 6-6 6 6 6" />
              </svg>
            </ChromeCircle>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 6-6 6 6 6" />
            </svg>
          )}
          {backLabel && <span className="text-body">{backLabel}</span>}
        </button>
        <h1
          className={`flex-1 truncate text-center text-section text-ink-primary transition-opacity duration-200 ${
            solid && floating ? 'opacity-100' : floating ? 'opacity-0' : 'opacity-100'
          }`}
          aria-hidden={floating && !collapsed}
        >
          {title}
        </h1>
        <div className="flex min-w-[44px] items-center justify-end px-1">
          {floating ? <ChromeCircle>{right}</ChromeCircle> : right}
        </div>
      </div>
    </header>
  )
}
