import { Link } from 'react-router'

export default function FAB() {
  return (
    <Link
      to="/items/new"
      aria-label="新增物品"
      className="fixed z-20 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-neutral-900 text-white shadow-[0_6px_16px_rgba(0,0,0,0.18)] transition-transform duration-150 active:scale-95"
      style={{
        bottom: 'calc(72px + env(safe-area-inset-bottom))',
        right: 'max(20px, calc(50% - 215px + 20px))',
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </Link>
  )
}
