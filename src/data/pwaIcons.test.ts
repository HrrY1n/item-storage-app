/**
 * PWA / App Icon 资产契约。
 *
 * 与 src/data/icons.test.ts 保持同一约束：不引入 node:fs（生产代码与测试都不用 Node API，
 * 本仓库不装 @types/node）。因此这里不解析 PNG 二进制尺寸 ——
 * 尺寸的唯一来源是 scripts/gen-pwa-icons.mjs 的 targets 表，
 * 而该脚本每次生成后都会回读文件、用 readPNGSize 校验尺寸，不符即抛错。
 *
 * 所以本测试负责锁住：
 *   1. public/icons/pwa/ 的文件与 targets 表严格一一对应（不多不少，杜绝历史残留）；
 *   2. 每个派生尺寸都能在生成器里找到 name / size / **source**（取自哪套母版）三件套；
 *   3. 母版存在、被生成器引用、且生成器带「不透明 + 无白角」守卫；
 *   4. index.html 与 vite.config.ts（manifest）的引用路径真实有效且与 targets 一致；
 *   5. iOS 主屏图标走带版本的新文件名（cache bust），旧文件名不再被引用。
 */
import { describe, expect, it } from 'vitest'
import generator from '../../scripts/gen-pwa-icons.mjs?raw'
import viteConfig from '../../vite.config.ts?raw'
import html from '../../index.html?raw'

const namesIn = (glob: Record<string, unknown>) =>
  Object.keys(glob)
    .map((p) => p.split('/').pop() ?? '')
    .sort()

/** 仓库内实际存在的 PWA 图标（?url 拿到路径，证明文件存在且能被 Vite 解析） */
const pwaIconPaths = namesIn(
  import.meta.glob('/public/icons/pwa/*.png', { eager: true, query: '?url', import: 'default' }),
)

/** 设计定稿母版：只作为生成器的输入源，不参与运行时，也不进 precache */
const masterPaths = namesIn(
  import.meta.glob('/assets/app-icons/*.png', { eager: true, query: '?url', import: 'default' }),
)

const EXPECTED = [
  { name: 'apple-touch-icon-180x180-v2.png', size: 180, source: 'light' },
  { name: 'favicon-dark-32x32.png', size: 32, source: 'dark' },
  { name: 'favicon-light-32x32.png', size: 32, source: 'light' },
  { name: 'maskable-512x512.png', size: 512, source: 'light' },
  { name: 'pwa-192x192.png', size: 192, source: 'light' },
  { name: 'pwa-512x512.png', size: 512, source: 'light' },
]

/** ?raw 会把 PNG 当 UTF-8 文本解码，仅签名里的 0x89 变成 U+FFFD，其余头部字节保持原值 */
const pngMagicOf = (raw: string) => [raw.charCodeAt(1), raw.charCodeAt(2), raw.charCodeAt(3)]

const pwaIconRaw = import.meta.glob('/public/icons/pwa/*.png', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const rawOf = (name: string) => {
  const hit = Object.entries(pwaIconRaw).find(([p]) => p.endsWith(`/${name}`))
  if (!hit) throw new Error(`缺少 ${name}`)
  return hit[1]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('PWA 图标资产', () => {
  it('targets 表与 public/icons/pwa/ 一一对应，无多余也无缺失', () => {
    expect(pwaIconPaths).toEqual([...EXPECTED].map((t) => t.name).sort())
  })

  it.each(EXPECTED)('$name 由 generator 从 $source 母版以 $size x $size 生成', ({ name, size, source }) => {
    // targets 表是尺寸与来源的唯一来源：name / size / source 三者必须同时声明
    expect(generator).toMatch(
      new RegExp(`\\{\\s*name:\\s*'${escapeRe(name)}',\\s*size:\\s*${size},\\s*source:\\s*'${source}'`),
    )
  })

  it('generator 生成后会回读文件自检尺寸（防止手工换 PNG 而不同步生成器）', () => {
    expect(generator).toContain('readPNGSize')
    expect(generator).toContain('尺寸异常')
  })

  it('六张图都是合法 PNG（signature 0x89 P N G）', () => {
    expect(Object.keys(pwaIconRaw).length).toBe(EXPECTED.length)
    for (const [path, raw] of Object.entries(pwaIconRaw)) {
      expect(raw.length, path).toBeGreaterThan(0)
      expect(pngMagicOf(raw), path).toEqual([0x50, 0x4e, 0x47]) // 'P' 'N' 'G'
    }
  })

  it('两套 1024 母版存在且是生成器唯一输入源', () => {
    expect(masterPaths).toEqual(['app-icon-dark-1024.png', 'app-icon-light-1024.png'])
    expect(generator).toContain("resolve(__dirname, '../assets/app-icons')")
    expect(generator).toContain('app-icon-light-1024.png')
    expect(generator).toContain('app-icon-dark-1024.png')
  })

  it('生成器带「母版必须不透明 / 四角不得是白边」守卫', () => {
    // 这两条守卫是"只缩放、不重绘"的强制手段：透明圆角与白边都会在生成阶段直接失败
    expect(generator).toContain('母版必须完全不透明')
    expect(generator).toContain('assertNoWhiteCorners')
    expect(generator).toContain('MASTER_SIZE')
  })

  it('maskable 走安全区自动校验，而不是靠补白边', () => {
    expect(generator).toContain('assertMaskableSafe')
    expect(generator).toContain('MASKABLE_SAFE_RADIUS')
    // 母版本身就是 full-bleed、主体又在 40% 安全圆内 → maskable 不需要任何额外处理：
    // 两个 512 文件必须逐字节相同。将来若要为 maskable 单独缩小构图，这条断言会失败，
    // 从而强制改测试 —— 也就是一次有意识的决定，而不是悄悄漂移。
    expect(rawOf('maskable-512x512.png')).toBe(rawOf('pwa-512x512.png'))
  })

  it('输出目录归生成器所有，且会清掉不属于 targets 的历史残留', () => {
    expect(generator).toContain("resolve(__dirname, '../public/icons/pwa')")
    expect(generator).toContain('已删除历史残留')
  })

  it('manifest 的 icons 路径全部能在 targets 表里找到，且 purpose 架构保持 any + maskable', () => {
    const sources = [...viteConfig.matchAll(/src:\s*'(\/icons\/pwa\/[^']+)'/g)].map((m) => m[1].split('/').pop())
    expect(sources.length).toBe(3)
    for (const src of sources) expect(EXPECTED.map((t) => t.name)).toContain(src)
    expect(viteConfig).toContain("purpose: 'any'")
    expect(viteConfig).toContain("purpose: 'maskable'")
    // 不在 manifest 里虚构 dark-mode icon（media 查询的 manifest icon 至今没有标准支持）
    expect(viteConfig).not.toContain('prefers-color-scheme')
  })

  it('index.html：apple-touch-icon 指向带版本的新文件名，旧文件名已彻底消失', () => {
    // 只认引用（href）：注释里出现旧文件名是刻意的说明文字，不算引用
    const appleHrefs = [...html.matchAll(/rel="apple-touch-icon"\s+href="([^"]+)"/g)].map((m) => m[1])
    expect(appleHrefs).toEqual(['/icons/pwa/apple-touch-icon-180x180-v2.png'])
    expect(html).not.toMatch(/href="[^"]*apple-touch-icon-180x180\.png/)
    expect(pwaIconPaths).not.toContain('apple-touch-icon-180x180.png')
  })

  it('index.html：favicon 按 prefers-color-scheme 分日/夜两版，且日间版在前', () => {
    const icons = [...html.matchAll(/href="(\/icons\/pwa\/favicon-[^"]+)"/g)].map((m) => m[1])
    expect(icons).toEqual(['/icons/pwa/favicon-light-32x32.png', '/icons/pwa/favicon-dark-32x32.png'])
    const lightAt = html.indexOf('media="(prefers-color-scheme: light)"')
    const darkAt = html.indexOf('media="(prefers-color-scheme: dark)"')
    expect(lightAt).toBeGreaterThan(-1)
    expect(darkAt).toBeGreaterThan(lightAt)
  })
})
