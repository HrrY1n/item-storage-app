/**
 * 标签名标准化（domain 纯函数，全部有测试）。
 *
 * 规则：
 *  - trim 首尾空白
 *  - 去掉开头一个或多个 '#'
 *  - 内部连续空白折叠为单个空格
 *  - 显示名保留原始大小写；比较键统一小写折叠
 *  - 结果为空 → 非法
 */
export interface NormalizedTagName {
  display: string
  key: string
}

export function normalizeTagName(raw: string): NormalizedTagName | null {
  const display = raw
    .trim()
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!display) return null
  return { display, key: display.toLowerCase() }
}

/** 两个标签输入是否指向同一个标签 */
export function sameTagName(a: string, b: string): boolean {
  const na = normalizeTagName(a)
  const nb = normalizeTagName(b)
  return na !== null && nb !== null && na.key === nb.key
}
