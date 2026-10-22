import type { Location } from 'react-router'

/** 站内新增/详情/编辑保留背景；直接链接仍显示完整页面。 */
export function itemPanelBackground(location: Location): Location | undefined {
  if (!/^\/items\/[^/]+(?:\/edit)?$/.test(location.pathname)) return
  const background: unknown = location.state?.itemBackground
  if (!background || typeof background !== 'object') return
  const candidate = background as Partial<Location>
  if (typeof candidate.pathname !== 'string' || !candidate.pathname.startsWith('/') || candidate.pathname.startsWith('//')
    || typeof candidate.search !== 'string' || typeof candidate.hash !== 'string' || typeof candidate.key !== 'string'
    || /^\/items\/[^/]+(?:\/edit)?$/.test(candidate.pathname)) return
  return candidate as Location
}
