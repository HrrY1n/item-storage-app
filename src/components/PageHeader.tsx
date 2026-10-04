import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'

interface Props {
  title: string
  /** 右侧内容（如保存 / 编辑） */
  right?: ReactNode
  /** 自定义左侧返回行为；默认 history back */
  onBack?: () => void
  backLabel?: string
}

export default function PageHeader({ title, right, onBack, backLabel }: Props) {
  const navigate = useNavigate()

  return (
    <header className="chrome sticky top-0 z-10 border-b border-line">
      <div className="flex min-h-[52px] items-center px-2 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={onBack ?? (() => navigate(-1))}
          className="flex min-h-[44px] min-w-[44px] items-center gap-0.5 px-1 text-ink-primary transition-opacity active:opacity-50"
          aria-label="返回"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 6-6 6 6 6" />
          </svg>
          {backLabel && <span className="text-body">{backLabel}</span>}
        </button>
        <h1 className="flex-1 truncate text-center text-section text-ink-primary">
          {title}
        </h1>
        <div className="flex min-w-[44px] items-center justify-end px-1">{right}</div>
      </div>
    </header>
  )
}
