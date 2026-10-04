import { Link } from 'react-router'

export default function FAB() {
  return (
    <Link
      to="/items/new"
      aria-label="新增物品"
      className="group fixed bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 flex h-[54px] w-[54px] items-center justify-center rounded-full bg-neutral-900 text-white shadow-fab transition-transform duration-200 ease-spring active:scale-[0.9] sm:bottom-6 sm:mb-[72px] sm:hover:scale-[1.04]"
      style={{ right: 'max(20px, calc(50% - 215px + 20px))' }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        className="transition-transform duration-300 ease-spring group-active:rotate-90"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </Link>
  )
}
