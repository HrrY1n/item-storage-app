/**
 * PWA 运行时能力检测与存储持久化。
 *
 * 原则：全部能力都是**尽力而为**——不支持时静默降级，绝不阻塞应用启动或使用。
 */

/** 是否以「已安装」形态运行（iOS 主屏 / Android standalone / PWA 窗口） */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // iOS Safari 历史上只暴露 navigator.standalone
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone
  return legacy === true
}

/**
 * 请求浏览器把本站存储标记为持久化，降低 IndexedDB 被系统自动清理的概率。
 *
 * 注意：这只是一项"偏好请求"，浏览器可以拒绝，且用户清除浏览数据时依然会被清除——
 * 真正可靠的长期安全手段是定期导出备份。
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    // 已获授权则直接返回，避免无谓的许可提示
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
