import { NavLink } from 'react-router'

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  )
}

function GridIcon({ active }: { active: boolean }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </svg>
  )
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  )
}

function GearIcon({ active }: { active: boolean }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.11A1.7 1.7 0 0 0 10.11 3V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1 1.55.61.26 1.32.1 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.11c.26.6.88 1 1.55 1H21a2 2 0 1 1 0 4h-.09c-.67 0-1.29.4-1.51 1z" />
    </svg>
  )
}

const tabs = [
  { to: '/', label: '首页', Icon: HomeIcon, end: true },
  { to: '/categories', label: '分类', Icon: GridIcon, end: false },
  { to: '/search', label: '搜索', Icon: SearchIcon, end: false },
  { to: '/settings', label: '设置', Icon: GearIcon, end: false },
]

export default function BottomNav() {
  return (
    <nav className="chrome chrome-edge-top fixed bottom-0 left-1/2 z-20 w-full max-w-[430px] -translate-x-1/2 border-t border-line sm:bottom-6 sm:rounded-b-[28px]">
      <div className="flex pb-[env(safe-area-inset-bottom)]">
        {tabs.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="group flex min-h-[54px] flex-1 items-center justify-center"
          >
            {({ isActive }) => (
              <span className="relative flex flex-col items-center gap-1 pb-1 pt-1.5">
                {/* 选中指示：一枚细小的强调色圆点，弹簧弹出 */}
                <span
                  className={`absolute -top-[3px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent transition-all duration-300 ease-spring ${
                    isActive ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
                  }`}
                />
                <span
                  className={`transition-[color,transform] duration-300 ease-spring ${
                    isActive ? 'text-ink-primary' : 'text-ink-tertiary group-active:scale-95'
                  }`}
                >
                  <Icon active={isActive} />
                </span>
                <span
                  className={`text-[10px] leading-none tracking-[0.04em] transition-colors duration-200 ${
                    isActive ? 'text-ink-primary' : 'text-ink-tertiary'
                  }`}
                >
                  {label}
                </span>
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
