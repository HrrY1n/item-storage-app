import { Link, NavLink } from 'react-router'

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

/**
 * 底部主导航：**概览 / 列表 / 分类 / 搜索** + 独立的「+」。
 *
 * 「设置」刻意**不在**主导航里 —— 它是低频入口，放在概览页右上角的齿轮更合适，
 * 于是底栏四个位置全部对应"每天真的会用的动作"。
 *
 * 「+」是导航条自己的一部分（与条同高的实心圆钮），而不是浮在条上方的孤立方块：
 * 这样它永远贴条、永远不会被内容遮住，也不会与底栏产生两层阴影打架。
 *
 * 材质层：一层克制的半透明 chrome（blur 只用在导航/顶栏，内容层一律实色）。
 * prefers-reduced-transparency 时自动降级为实色。
 */
export default function BottomNav() {
  return (
    <nav className="chrome chrome-edge-top fixed bottom-0 left-1/2 z-20 w-full max-w-[var(--shell-max)] -translate-x-1/2 border-t border-line sm:bottom-6 sm:rounded-b-app">
      <div className="flex items-center gap-1.5 px-2 pb-[env(safe-area-inset-bottom)]">
        <div className="flex flex-1">
          {tabs.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className="group flex min-h-[64px] flex-1 items-center justify-center"
            >
              {({ isActive }) => (
                <span
                  className={`flex flex-col items-center gap-1 rounded-pill px-3 py-1.5 transition-colors duration-200 ease-out-quint ${
                    isActive ? 'bg-accent-soft text-accent' : 'text-ink-tertiary'
                  }`}
                >
                  <Icon active={isActive} />
                  <span
                    className={`text-[10px] leading-none tracking-[0.04em] transition-colors duration-200 ${
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

        {/* 新增：与导航条同高的实心圆钮。用 ink-solid 而非强调色 ——
            它是最高频入口，中性但强对比的实心块比彩色按钮更耐看。 */}
        <Link
          to="/items/new"
          aria-label="新增物品"
          className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-pill bg-ink-solid text-ink-inverse shadow-fab transition-transform duration-150 ease-out-quint active:scale-[0.94] sm:hover:-translate-y-0.5"
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
        </Link>
      </div>
    </nav>
  )
}
