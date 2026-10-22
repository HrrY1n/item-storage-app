import { Link, NavLink, useLocation } from 'react-router'

/** 概览：仪表盘式图形（一条趋势线 + 坐标基线），形状与其他三个 tab 明显不同 */
function OverviewIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7.5 15 3.5-4 3 2.5L20 7" />
    </svg>
  )
}

function ListIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M7.5 9.5h9M7.5 14.5h6" />
    </svg>
  )
}

function GridIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </svg>
  )
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  )
}

const tabs = [
  { to: '/', label: '概览', Icon: OverviewIcon, end: true },
  { to: '/items', label: '列表', Icon: ListIcon, end: false },
  { to: '/categories', label: '分类', Icon: GridIcon, end: false },
  { to: '/search', label: '搜索', Icon: SearchIcon, end: false },
]

/** 手机底栏、桌面侧栏共用同一组入口。 */
export default function BottomNav() {
  const location = useLocation()
  return (
    <nav aria-label="主导航" className="app-nav chrome chrome-edge-top z-20">
      <Link to="/" className="nav-brand" aria-label="物品库 · 概览">
        <span className="flex h-11 w-11 items-center justify-center rounded-card bg-accent-soft text-accent">
          <svg width="25" height="25" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
            <path d="m14 3 10 5.5v11L14 25 4 19.5v-11L14 3Z" />
            <path d="m4 8.5 10 5.7 10-5.7M14 14.2V25M9 5.8l10 5.6" />
          </svg>
        </span>
        <span><span className="block text-section text-ink-primary">物品库</span><span className="mt-1 block text-caption text-ink-tertiary">记录拥有，珍惜日常</span></span>
      </Link>
      <div className="nav-body">
        <div className="nav-links">
          {tabs.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className="nav-link group"
            >
              {({ isActive }) => (
                <span
                  className={`nav-link-inner transition-colors duration-200 ease-out-quint ${
                    isActive ? 'bg-accent-soft text-accent' : 'text-ink-tertiary'
                  }`}
                >
                  <Icon active={isActive} />
                  <span
                    className={`nav-label transition-colors duration-200 ${
                      isActive ? 'font-medium text-accent' : 'text-ink-tertiary'
                    }`}
                  >
                    {label}
                  </span>
                </span>
              )}
            </NavLink>
          ))}
        </div>

        <Link
          to="/items/new"
          state={{ itemBackground: location }}
          aria-label="新增物品"
          className="nav-add flex shrink-0 items-center justify-center gap-2 bg-ink-solid text-ink-inverse transition-transform duration-150 ease-out-quint active:scale-[0.96]"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="hidden text-secondary lg:inline">新增物品</span>
        </Link>
      </div>
      <div className="nav-footer">
        <NavLink to="/settings" className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-control px-3 text-secondary transition-colors ${isActive ? 'bg-accent-soft text-accent' : 'text-ink-secondary hover:bg-surface'}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" className="fill-canvas" /><circle cx="15" cy="17" r="3" className="fill-canvas" /></svg>
          设置
        </NavLink>
        <p className="mt-6 px-3 text-caption leading-relaxed text-ink-tertiary">为值得记录的物品<br />留一个位置。</p>
      </div>
    </nav>
  )
}
