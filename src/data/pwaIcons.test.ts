/**
 * PWA 图标资产契约。
 *
 * 与 src/data/icons.test.ts 保持同一约束：不引入 node:fs（生产代码与测试都不用 Node API，
 * 本仓库不装 @types/node）。因此这里不解析 PNG 二进制尺寸 ——
 * 尺寸的唯一来源是 scripts/gen-pwa-icons.mjs 的 targets 表，
 * 而该脚本每次生成后都会回读文件、用 readPNGSize 校验尺寸，不符即抛错。
 * 所以本测试负责锁住：四个 target 齐全、文件名与 targets 一一对应、PNG magic 正确。
 */
import { describe, expect, it } from 'vitest'
import generator from '../../scripts/gen-pwa-icons.mjs?raw'

/** 仓库内实际存在的 PWA 图标（?url 拿到路径，证明文件存在且能被 Vite 解析） */
const pwaIconPaths = Object.keys(
  import.meta.glob('/public/icons/pwa/*.png', { eager: true, query: '?url', import: 'default' }),
).map((p) => p.split('/').pop() ?? '')

/** ?raw 会把 PNG 当 UTF-8 文本解码，仅签名里的 0x89 变成 U+FFFD，其余头部字节保持原值 */
const pngMagicOf = (raw: string) => [raw.charCodeAt(1), raw.charCodeAt(2), raw.charCodeAt(3)]

const EXPECTED = [
  { name: 'apple-touch-icon-180x180.png', size: 180 },
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'maskable-512x512.png', size: 512 },
]

describe('PWA 图标资产', () => {
  it('四个 target 全部生成，无多余也无缺失', () => {
    expect([...pwaIconPaths].sort()).toEqual(EXPECTED.map((t) => t.name).sort())
  })

  it.each(EXPECTED)('$name 由 generator 以 $size x $size 生成', ({ name, size }) => {
    // targets 表是尺寸的唯一来源：name / size / ratio 三者必须同时声明
    expect(generator).toMatch(
      new RegExp(`\\{\\s*name:\\s*'${name.replace('.', '\\.')}',\\s*size:\\s*${size},\\s*ratio:\\s*0\\.\\d+`),
    )
  })

  it('generator 生成后会回读文件自检尺寸（防止手工换 PNG 而不同步生成器）', () => {
    expect(generator).toContain('readPNGSize')
    expect(generator).toContain('尺寸异常')
  })

  it('四张图都是合法 PNG（signature 0x89 P N G）', () => {
    const raws = import.meta.glob('/public/icons/pwa/*.png', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>
    expect(Object.keys(raws).length).toBe(EXPECTED.length)
    for (const [path, raw] of Object.entries(raws)) {
      expect(raw.length, path).toBeGreaterThan(0)
      expect(pngMagicOf(raw), path).toEqual([0x50, 0x4e, 0x47]) // 'P' 'N' 'G'
    }
  })

  it('apple-touch-icon 与 manifest 的引用路径保持不变', () => {
    expect(generator).toContain("resolve(__dirname, '../public/icons/pwa')")
  })
})
