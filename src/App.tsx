import { useEffect, useState } from 'react'
import { BrowserRouter, Outlet, Route, Routes, useLocation } from 'react-router'
import { seedIfEmpty, syncPresetAssets, upgradeSchemaVersionMeta } from './db/seed'
import { requestPersistentStorage } from './services/pwa'
import BottomNav from './components/BottomNav'
import UpdateBanner from './components/UpdateBanner'
import { PwaUpdateProvider } from './features/pwa/PwaUpdateContext'
import { SyncProvider } from './features/sync/SyncContext'
import HomePage from './pages/HomePage'
import ItemsListPage from './pages/ItemsListPage'
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

  // 桌面端取景：外壳固定为「视口高度 − 上下留白」并在内部滚动，
  // 这样底部导航（内含新增按钮）始终贴合取景框边缘，而不是浮在长页面上。
  return (
    <div className="shell-scroll relative mx-auto flex min-h-dvh w-full max-w-[var(--shell-max)] flex-col bg-canvas sm:my-6 sm:h-[calc(100dvh-48px)] sm:min-h-0 sm:overflow-y-auto sm:rounded-app sm:border sm:border-line sm:shadow-lift">
      {/* 极细颗粒层：为平面底色增加物质感（不拦截交互）。
          混合模式与透明度由主题变量决定：浅色 multiply，深色 screen。 */}
      <div className="grain pointer-events-none absolute inset-0 z-0" aria-hidden />
      <ScrollToTop />
      <main
        className={`relative z-10 flex-1 ${
          // 底栏 64px + 32px 呼吸，保证最后一项内容永不被遮挡
          showBottomNav ? 'pb-[calc(96px+env(safe-area-inset-bottom))]' : 'pb-6'
        }`}
      >
        <Outlet />
      </main>
      {showBottomNav && <BottomNav />}
      {/* 更新提示只在"不能立刻刷新"时出现；安全状态下后台静默完成更新 */}
      <UpdateBanner />
    </div>
  )
}

/** 启动闸：先完成首次 seed 与预置图标同步，再渲染应用 */
function Boot() {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // 尽力申请持久化存储；不支持或被拒绝都静默跳过，绝不阻塞启动
    void requestPersistentStorage()
    seedIfEmpty()
      .then(() => upgradeSchemaVersionMeta())
      // 老库补齐新图标：幂等 upsert，绝不触碰用户资产（详见 syncPresetAssets 契约）
      .then(() => syncPresetAssets())
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
        <Route path="items" element={<ItemsListPage />} />
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
      <PwaUpdateProvider>
        {/* 同步引擎在 provider 内部惰性获取；未启用同步时
            所有同步调用都会直接空转，不发任何网络请求。 */}
        <SyncProvider>
          <Boot />
        </SyncProvider>
      </PwaUpdateProvider>
    </BrowserRouter>
  )
}
