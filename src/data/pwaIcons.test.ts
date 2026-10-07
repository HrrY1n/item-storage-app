/**
 * PWA / App Icon 资产契约（**单一正式图标**方案）。
 *
 * 与 src/data/icons.test.ts 保持同一约束：不引入 node:fs（生产代码与测试都不用 Node API，
 * 本仓库不装 @types/node）。因此这里不解析 PNG 二进制尺寸 ——
 * 尺寸的唯一来源是 scripts/gen-pwa-icons.mjs 的 targets 表，
 * 而该脚本每次生成后都会回读文件、用 readPNGSize 校验尺寸，不符即抛错。
 *
 * 所以本测试负责锁住：
 *   1. public/icons/pwa/ 的文件与 targets 表严格一一对应（不多不少，杜绝历史残留）；
 *   2. 输入源是**唯一一张**母版，且不存在 light/dark 双轨残留（单一正式图标方案的不变量）；
 *   3. 母版存在、被生成器引用、且生成器带「不透明 + 无白角」守卫；
 *   4. index.html：恰好一条 apple-touch-icon（走带版本的新文件名）、恰好一条 favicon 且**无 media**
 *      （明确不做主题图标切换）；
 *   5. vite.config.ts（manifest）的三条 icons 都能在 targets 表里找到，purpose 架构为 any + maskable。
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

/** 唯一母版：只作为生成器的输入源，不参与运行时，也不进 precache */
const masterPaths = namesIn(
  import.meta.glob('/assets/app-icons/*.png', { eager: true, query: '?url', import: 'default' }),
)

const EXPECTED = [
  { name: 'apple-touch-icon-180x180-v5.png', size: 180 },
  { name: 'favicon-32x32.png', size: 32 },
  { name: 'maskable-512x512.png', size: 512 },
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
]

const MASTER_NAME = 'app-icon-master-1254.png'

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

describe('PWA 图标资产（单一正式图标）', () => {
  it('targets 表与 public/icons/pwa/ 一一对应，无多余也无缺失', () => {
    expect(pwaIconPaths).toEqual([...EXPECTED].map((t) => t.name).sort())
  })

  it.each(EXPECTED)('$name 由 generator 以 $size x $size 生成', ({ name, size }) => {
    // targets 表是尺寸的唯一来源：name / size 必须同时声明（输入源只有一张母版，因此没有 source 字段）
    expect(generator).toMatch(new RegExp(`\\{\\s*name:\\s*'${escapeRe(name)}',\\s*size:\\s*${size}\\s*\\}`))
  })

  it('generator 生成后会回读文件自检尺寸（防止手工换 PNG 而不同步生成器）', () => {
    expect(generator).toContain('readPNGSize')
    expect(generator).toContain('尺寸异常')
  })

  it('五张图都是合法 PNG（signature 0x89 P N G）', () => {
    expect(Object.keys(pwaIconRaw).length).toBe(EXPECTED.length)
    for (const [path, raw] of Object.entries(pwaIconRaw)) {
      expect(raw.length, path).toBeGreaterThan(0)
      expect(pngMagicOf(raw), path).toEqual([0x50, 0x4e, 0x47]) // 'P' 'N' 'G'
    }
  })

  it('输入源是唯一一张 1024+ 母版', () => {
    expect(masterPaths).toEqual([MASTER_NAME])
    expect(generator).toContain("resolve(__dirname, '../assets/app-icons')")
    expect(generator).toContain(MASTER_NAME)
    // 单一母版方案：生成器不再有 light/dark 双输入
    expect(generator).not.toMatch(/app-icon-(light|dark)-/)
  })

  it('不存在 light/dark 双轨残留（单一正式图标方案的不变量）', () => {
    // 产物里不允许再有任何 light / dark 分支图标
    expect(pwaIconPaths.filter((n) => /light|dark/.test(n))).toEqual([])
    // targets 表也不允许出现第二张母版（双轨时代的 source 字段）
    expect(generator).not.toMatch(/source:\s*'/)
  })

  it('生成器带「母版必须不透明 / 四角是同一个连续背景」守卫', () => {
    // 这条守卫是"只缩放、不重绘背景"的强制手段：
    // 透明圆角、人工白边、单角补丁都会在生成阶段直接失败；而浅色或深色背景本身都是合法的
    expect(generator).toContain('母版必须完全不透明')
    expect(generator).toContain('assertFullBleedCorners')
    expect(generator).toContain('MAX_CORNER_SPREAD')
    expect(generator).toContain('MIN_MASTER_SIZE')
  })

  it('生成器不再做任何背景合成（Laplace / 谐波扩散已彻底删除）', () => {
    // 浅暖灰背景是**设计的一部分**（为 iOS 自动 Dark treatment 预留的明亮区域），
    // 曾经被谐波扩散成深蓝，造成"蓝色大底 + 深蓝内板"的框套框 —— 这里锁死不再复发。
    expect(generator).not.toMatch(/Laplace|谐波扩散|harmonic/)
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

  it('index.html：恰好一条 apple-touch-icon，且指向带版本的新文件名', () => {
    const appleHrefs = [...html.matchAll(/rel="apple-touch-icon"\s+href="([^"]+)"/g)].map((m) => m[1])
    expect(appleHrefs).toEqual(['/icons/pwa/apple-touch-icon-180x180-v5.png'])
    // 旧路径不能以任何 href 形式残留（注释里提到旧文件名是刻意的说明文字，不算引用）
    expect(html).not.toMatch(/href="[^"]*apple-touch-icon-180x180\.png/)
    expect(html).not.toMatch(/href="[^"]*apple-touch-icon-180x180-v2\.png/)
    expect(html).not.toMatch(/href="[^"]*apple-touch-icon-180x180-v3\.png/)
    for (const gone of [
      'apple-touch-icon-180x180.png',
      'apple-touch-icon-180x180-v2.png',
      'apple-touch-icon-180x180-v3.png',
    ]) {
      expect(pwaIconPaths).not.toContain(gone)
    }
  })

  it('index.html：恰好一条 favicon，且不带 media（不做 light/dark 主题切换）', () => {
    const favicons = [...html.matchAll(/<link[^>]*rel="icon"[^>]*>/g)].map((m) => m[0])
    expect(favicons.length).toBe(1)
    expect(favicons[0]).toContain('href="/icons/pwa/favicon-32x32.png"')
    expect(favicons[0]).not.toContain('media=')
    // 图标声明里不该再出现主题切换条件（HTML 里的主题引导脚本与本条无关，它用的是 window.matchMedia）
    expect(html).not.toMatch(/rel="icon"[^>]*prefers-color-scheme/)
    expect(html).not.toMatch(/apple-touch-icon[^>]*prefers-color-scheme/)
  })
})
