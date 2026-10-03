import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { loadDemoData } from './mock/loadDemoData'

// 仅开发环境暴露演示数据加载器：浏览器控制台执行 `await window.__loadDemoData()`
if (import.meta.env.DEV) {
  ;(window as unknown as { __loadDemoData: typeof loadDemoData }).__loadDemoData = loadDemoData
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
