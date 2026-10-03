/**
 * 生成 PWA 图标（192 / 512 / maskable-512 / apple-touch-icon-180）。
 *
 * 不引入任何第三方依赖：直接用 Node 内置 zlib 手写最小 PNG 编码器。
 * 渲染采用 3 倍超采样后降采样，保证圆角与边缘平滑。
 *
 * 用法：node scripts/gen-pwa-icons.mjs
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/icons/pwa')

// ------------------------------------------------------------------ PNG 编码

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** RGB(8bit, colorType=2) 最小 PNG 编码 */
function encodePNG(width, height, rgb) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ------------------------------------------------------------------ 绘制原语

function createSurface(size) {
  return { size, rgb: Buffer.alloc(size * size * 3) }
}

function blendPixel(surface, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= surface.size || y >= surface.size) return
  const i = (y * surface.size + x) * 3
  if (alpha >= 1) {
    surface.rgb[i] = color[0]
    surface.rgb[i + 1] = color[1]
    surface.rgb[i + 2] = color[2]
    return
  }
  surface.rgb[i] = Math.round(surface.rgb[i] * (1 - alpha) + color[0] * alpha)
  surface.rgb[i + 1] = Math.round(surface.rgb[i + 1] * (1 - alpha) + color[1] * alpha)
  surface.rgb[i + 2] = Math.round(surface.rgb[i + 2] * (1 - alpha) + color[2] * alpha)
}

function fillBackground(surface, color) {
  for (let y = 0; y < surface.size; y++) {
    for (let x = 0; x < surface.size; x++) blendPixel(surface, x, y, color, 1)
  }
}

/** 圆角矩形的覆盖率采样（返回 0~1，天然带抗锯齿） */
function roundRectCoverage(x, y, rx, ry, rw, rh, r) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return 0
  const px = x + 0.5
  const py = y + 0.5
  const cx = Math.min(Math.max(px, rx + r), rx + rw - r)
  const cy = Math.min(Math.max(py, ry + r), ry + rh - r)
  const dx = px - cx
  const dy = py - cy
  const dist = Math.hypot(dx, dy)
  return Math.max(0, Math.min(1, r - dist + 0.5))
}

function fillRoundRect(surface, rx, ry, rw, rh, r, color) {
  const x0 = Math.max(0, Math.floor(rx))
  const y0 = Math.max(0, Math.floor(ry))
  const x1 = Math.min(surface.size, Math.ceil(rx + rw))
  const y1 = Math.min(surface.size, Math.ceil(ry + rh))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = roundRectCoverage(x, y, rx, ry, rw, rh, r)
      if (a > 0) blendPixel(surface, x, y, color, a)
    }
  }
}

// ------------------------------------------------------------------ 图标构图

const BG = [0xfa, 0xfa, 0xfa]
const INK = [0x1f, 0x29, 0x37]
const ACCENT = [0x2d, 0x6c, 0x6f]

/**
 * 构图：深色圆角底板 + 2x2 收纳格 + 一个强调色物件。
 * contentRatio 控制在 excluding 安全区（maskable 用更小的值）。
 */
function drawComposition(surface, contentRatio) {
  const s = surface.size
  fillBackground(surface, BG)

  const boardSize = s * contentRatio
  const board = (s - boardSize) / 2
  const r = boardSize * 0.22
  fillRoundRect(surface, board, board, boardSize, boardSize, r, INK)

  const pad = boardSize * 0.14
  const gap = boardSize * 0.06
  const cell = (boardSize - pad * 2 - gap) / 2

  // 左上强调格（强调色），其余三个为浅色格
  const cells = [
    { x: board + pad, y: board + pad, color: ACCENT },
    { x: board + pad + cell + gap, y: board + pad, color: BG },
    { x: board + pad, y: board + pad + cell + gap, color: BG },
    { x: board + pad + cell + gap, y: board + pad + cell + gap, color: BG },
  ]

  for (const c of cells) {
    fillRoundRect(surface, c.x, c.y, cell, cell, cell * 0.24, c.color)
  }
}

/** 超采样渲染后降采样到目标尺寸 */
function render(size, contentRatio) {
  const scale = 3
  const big = createSurface(size * scale)
  drawComposition(big, contentRatio)

  const out = Buffer.alloc(size * size * 3)
  const n = scale * scale
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * big.size + (x * scale + dx)) * 3
          r += big.rgb[i]
          g += big.rgb[i + 1]
          b += big.rgb[i + 2]
        }
      }
      const o = (y * size + x) * 3
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
    }
  }
  return encodePNG(size, size, out)
}

// ------------------------------------------------------------------ 输出

const targets = [
  { name: 'pwa-192x192.png', size: 192, ratio: 0.66 },
  { name: 'pwa-512x512.png', size: 512, ratio: 0.66 },
  { name: 'maskable-512x512.png', size: 512, ratio: 0.58 },
  { name: 'apple-touch-icon-180x180.png', size: 180, ratio: 0.66 },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const t of targets) {
  const png = render(t.size, t.ratio)
  writeFileSync(resolve(OUT_DIR, t.name), png)
  console.log(`${t.name.padEnd(30)} ${String(t.size).padStart(4)}x${t.size}  ${(png.length / 1024).toFixed(1)} KB`)
}
console.log('\n输出目录：public/icons/pwa/')
