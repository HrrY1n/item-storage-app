import { useEffect, useState } from 'react'
import { BrowserRouter, Outlet, Route, Routes, useLocation } from 'react-router'
import { seedIfEmpty, upgradeSchemaVersionMeta } from './db/seed'
import { requestPersistentStorage } from './services/pwa'
import BottomNav from './components/BottomNav'
import FAB from './components/FAB'
import HomePage from './pages/HomePage'
import CategoriesPage from './pages/CategoriesPage'
import CategoryDetailPage from './pages/CategoryDetailPage'
import SearchPage from './pages/SearchPage'
import ItemFormPage from './pages/ItemFormPage'
import ItemDetailPage from './pages/ItemDetailPage'
import SettingsPage from './pages/SettingsPage'
import CategoryManagePage from './pages/CategoryManagePage'
import TagManagePage from './pages/TagManagePage'
import IconLibraryPage from './pages/IconLibraryPage'

/** 路由切换时回到顶部 */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/** 新增/编辑物品属于临时任务流：隐藏底部导航，避免填写中途误触 Tab 离开 */
function isFormRoute(pathname: string): boolean {
  return pathname === '/items/new' || /^\/items\/[^/]+\/edit$/.test(pathname)
}

function Layout() {
  const { pathname } = useLocation()
  const showBottomNav = !isFormRoute(pathname)
  const showFAB =
    showBottomNav &&
    (pathname === '/' || pathname.startsWith('/categories') || pathname.startsWith('/search'))

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-canvas sm:my-6 sm:min-h-[calc(100dvh-48px)] sm:overflow-hidden sm:rounded-[28px] sm:border sm:border-line sm:shadow-lift">
      {/* 极细颗粒层：为平面底色增加物质感（不拦截交互） */}
      <div
        className="grain pointer-events-none absolute inset-0 z-0 opacity-[0.03] mix-blend-multiply"
        aria-hidden
      />
      <ScrollToTop />
      <main
        className={`relative z-10 flex-1 ${
          showBottomNav ? 'pb-[calc(96px+env(safe-area-inset-bottom))]' : 'pb-6'
        }`}
      >
        <Outlet />
      </main>
      {showFAB && <FAB />}
      {showBottomNav && <BottomNav />}
    </div>
  )
}

/** 启动闸：先完成首次 seed（默认分类 + 预置图标资产），再渲染应用 */
function Boot() {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // 尽力申请持久化存储；不支持或被拒绝都静默跳过，绝不阻塞启动
    void requestPersistentStorage()
    seedIfEmpty()
      .then(() => upgradeSchemaVersionMeta())
      .then(() => setReady(true))
      .catch(() => setFailed(true))
  }, [])

  if (failed) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-8 text-center">
        <p className="text-secondary text-ink-secondary">本地数据库初始化失败，请刷新重试。</p>
      </div>
    )
  }
  if (!ready) return null

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="categories/:id" element={<CategoryDetailPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="items/new" element={<ItemFormPage />} />
        <Route path="items/:id" element={<ItemDetailPage />} />
        <Route path="items/:id/edit" element={<ItemFormPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/categories" element={<CategoryManagePage />} />
        <Route path="settings/tags" element={<TagManagePage />} />
        <Route path="settings/icons" element={<IconLibraryPage />} />
        <Route path="*" element={<HomePage />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Boot />
    </BrowserRouter>
  )
}
