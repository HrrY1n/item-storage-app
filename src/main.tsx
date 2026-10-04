import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ThemeProvider } from './theme/ThemeProvider'
import { loadDemoData } from './mock/loadDemoData'
import { db } from './db/db'
import { exportBackup, readAndValidateBackup, restoreFromPayload } from './services/backupService'

// 仅开发环境暴露演示数据加载器与备份验证钩子（生产构建不会包含）
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>
  w.__loadDemoData = loadDemoData
  w.__backup = {
    /** 导出并把 Blob 暂存在 window.__exportedBackupBlob（供自动化验证用） */
    async export(): Promise<string> {
      const r = await exportBackup()
      w.__exportedBackupBlob = r.blob
      return r.fileName
    },
    /** 清空全部业务表（自动化验证用） */
    async wipe(): Promise<string> {
      await Promise.all([
        db.items.clear(),
        db.categories.clear(),
        db.tags.clear(),
        db.itemTags.clear(),
        db.assets.clear(),
        db.appMeta.clear(),
      ])
      return 'wiped'
    },
    /** 从暂存的导出 Blob 恢复 */
    async restore(): Promise<string> {
      const blob = w.__exportedBackupBlob as Blob | undefined
      if (!blob) throw new Error('no exported backup blob')
      const r = await readAndValidateBackup(blob)
      if (!r.ok) throw new Error(r.error)
      await restoreFromPayload(r.payload)
      return 'restored'
    },
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
