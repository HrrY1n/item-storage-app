/**
 * 生成 PWA 图标（192 / 512 / maskable-512 / apple-touch-icon-180）。
 *
 * 不引入任何第三方依赖：直接用 Node 内置 zlib 手写最小 PNG 编码器。
 * 渲染采用 3 倍超采样后降采样，保证圆角与边缘平滑。
 *
 * 构图：浅色背景 + 深色圆角底板 + 浅色收纳档案盒（盒中露出分类卡，前景卡为品牌青绿）。
 * 全部几何以「底板边长」为唯一单位（比例坐标），因此 normal 与 maskable 共享同一套构图。
 *
 * 用法：node scripts/gen-pwa-icons.mjs
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

/** 读取本生成器产出的 PNG（filter: None, truecolor），用于生成后自检尺寸 */
function readPNGSize(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) throw new Error('PNG signature 不正确')
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('缺少 IHDR')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

// ------------------------------------------------------------------ 绘制原语

function createSurface(size) {
  return { size, rgb: Buffer.alloc(size * size * 3) }
}

function blendPixel(surface, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= surface.size || y >= surface.size) return
  if (alpha <= 0) return
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

function fillRoundRect(surface, rx, ry, rw, rh, r, color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(rx))
  const y0 = Math.max(0, Math.floor(ry))
  const x1 = Math.min(surface.size, Math.ceil(rx + rw))
  const y1 = Math.min(surface.size, Math.ceil(ry + rh))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = roundRectCoverage(x, y, rx, ry, rw, rh, r)
      if (c > 0) blendPixel(surface, x, y, color, c * alpha)
    }
  }
}

/** 竖直线性渐变的圆角矩形（top → bottom） */
function fillRoundRectGradientY(surface, rx, ry, rw, rh, r, top, bottom, alpha = 1) {
  const x0 = Math.max(0, Math.floor(rx))
  const y0 = Math.max(0, Math.floor(ry))
  const x1 = Math.min(surface.size, Math.ceil(rx + rw))
  const y1 = Math.min(surface.size, Math.ceil(ry + rh))
  for (let y = y0; y < y1; y++) {
    const t = rh <= 1 ? 0 : Math.min(1, Math.max(0, (y + 0.5 - ry) / rh))
    const color = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
    ]
    for (let x = x0; x < x1; x++) {
      const c = roundRectCoverage(x, y, rx, ry, rw, rh, r)
      if (c > 0) blendPixel(surface, x, y, color, c * alpha)
    }
  }
}

/** 径向衰减的椭圆（只用作极轻的接触阴影） */
function fillSoftEllipse(surface, cx, cy, rx, ry, color, alpha) {
  const x0 = Math.max(0, Math.floor(cx - rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const x1 = Math.min(surface.size, Math.ceil(cx + rx))
  const y1 = Math.min(surface.size, Math.ceil(cy + ry))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const nx = (x + 0.5 - cx) / rx
      const ny = (y + 0.5 - cy) / ry
      const d = Math.hypot(nx, ny)
      if (d >= 1) continue
      blendPixel(surface, x, y, color, alpha * Math.pow(1 - d, 1.6))
    }
  }
}

// ------------------------------------------------- 多边形（圆角 + 抗锯齿填充）

const vSub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const vLen = (v) => Math.hypot(v[0], v[1])
const vNorm = (v) => {
  const l = vLen(v) || 1
  return [v[0] / l, v[1] / l]
}

/** 把多边形每个角按 radius 倒角，输出稠密折线（二次贝塞尔近似圆弧） */
function chamferPolygon(pts, radius) {
  const out = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const prev = pts[(i - 1 + n) % n]
    const next = pts[(i + 1) % n]
    const toPrev = vNorm(vSub(prev, p))
    const toNext = vNorm(vSub(next, p))
    const d = Math.min(radius, vLen(vSub(prev, p)) / 2, vLen(vSub(next, p)) / 2)
    if (d <= 0.01) {
      out.push(p)
      continue
    }
    const a = [p[0] + toPrev[0] * d, p[1] + toPrev[1] * d]
    const b = [p[0] + toNext[0] * d, p[1] + toNext[1] * d]
    for (let t = 0; t <= 1.0001; t += 0.2) {
      const u = 1 - t
      out.push([
        u * u * a[0] + 2 * u * t * p[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * p[1] + t * t * b[1],
      ])
    }
  }
  return out
}

/** 射线法 inside test */
function pointInPolygon(px, py, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** 4x 子采样得到多边形覆盖率（再叠加外层 3x 超采样，边缘足够干净） */
function polygonCoverage(x, y, poly) {
  let hits = 0
  for (let sy = 0; sy < 2; sy++) {
    for (let sx = 0; sx < 2; sx++) {
      const px = x + 0.25 + sx * 0.5
      const py = y + 0.25 + sy * 0.5
      if (pointInPolygon(px, py, poly)) hits++
    }
  }
  return hits / 4
}

function fillPolygon(surface, pts, radius, color, alpha = 1) {
  const poly = chamferPolygon(pts, radius)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of poly) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const x0 = Math.max(0, Math.floor(minX))
  const y0 = Math.max(0, Math.floor(minY))
  const x1 = Math.min(surface.size, Math.ceil(maxX))
  const y1 = Math.min(surface.size, Math.ceil(maxY))
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = polygonCoverage(x, y, poly)
      if (c > 0) blendPixel(surface, x, y, color, c * alpha)
    }
  }
}

// ------------------------------------------------------------------ 图标构图

const BG = [0xfa, 0xfa, 0xfa]
const INK = [0x1f, 0x29, 0x37]
const ACCENT = [0x2d, 0x6c, 0x6f]

/** 盒体与卡片：同一浅色族，靠明度差（而非描边）区分层次，保证小尺寸不糊 */
const BOX = [0xef, 0xf1, 0xf3] // 盒身 / 盖沿
const BOX_LIP = [0xf9, 0xfa, 0xfb] // 盖沿上沿高光
const WALL_TOP = [0xe6, 0xea, 0xed] // 盒内后壁顶端（最深 → 与卡片拉开层次）
const CARD_MID = [0xf5, 0xf7, 0xf8] // 后方中性卡（接近纯白，明显亮于后壁）

/**
 * 构图（比例坐标，原点在底板左上角，底板边长 = 1）：
 *   0.00–1.00  深色圆角底板
 *   0.18–0.83  盒内后壁（最高、最浅的浅色形，托住分类卡）
 *   0.20–0.42  盒口以上露出的分类卡：右侧 1 张中性卡 + 左侧前景青绿卡
 *   0.11–0.85  盖沿（横向厚圆角条，明显宽于盒身 → 读作「上沿」而非托盘）
 *   0.15–0.82  盒身（宽高比≈2.2，底部圆角明显）
 *   0.35–0.65  正面标签槽（INK 外框 + 浅色内芯）
 *
 * contentRatio 决定底板占画布的比例：normal 稍大、maskable 略小以留出裁切安全区。
 * 由于所有几何都以底板边长为单位，两者共享完全相同的构图。
 */
function drawComposition(surface, contentRatio) {
  const s = surface.size
  fillBackground(surface, BG)

  const B = s * contentRatio
  const ox = (s - B) / 2
  /** 比例坐标 → 像素；DY 让整组图形在底板内视觉居中 */
  const DY = -0.014
  const px = (u) => ox + u * B
  const py = (u) => ox + (u + DY) * B

  // Layer 2：深色圆角底板
  fillRoundRect(surface, ox, ox, B, B, B * 0.225, INK)

  // Layer 3 前置：盒底接触阴影（极轻，落在底板上）
  fillSoftEllipse(surface, px(0.48), py(0.868), B * 0.28, B * 0.032, [0x00, 0x00, 0x00], 0.16)

  // Layer 3a：盒内后壁
  fillRoundRectGradientY(
    surface,
    px(0.175),
    py(0.205),
    B * 0.65,
    B * 0.4,
    B * 0.05,
    WALL_TOP,
    BOX,
  )

  // Layer 4：分类卡（从后往前：右侧中性卡 → 前景青绿卡）
  fillRoundRect(surface, px(0.545), py(0.245), B * 0.25, B * 0.28, B * 0.03, CARD_MID)
  // 前景卡略微右倾（更像插进盒里的分类卡），仍保留圆角
  fillPolygon(
    surface,
    [
      [px(0.2), py(0.272)],
      [px(0.6), py(0.252)],
      [px(0.565), py(0.62)],
      [px(0.235), py(0.62)],
    ],
    B * 0.03,
    ACCENT,
  )

  // Layer 5a：盖沿投在盒身上的阴影
  fillRoundRect(surface, px(0.15), py(0.552), B * 0.665, B * 0.032, B * 0.012, INK, 0.13)

  // Layer 5b：盒身（宽高比≈2.0，底部圆角明显）
  fillRoundRectGradientY(
    surface,
    px(0.15),
    py(0.542),
    B * 0.665,
    B * 0.332,
    B * 0.068,
    BOX,
    BOX,
  )

  // Layer 5c：盖沿（宽于盒身，顶部带高光 → 读作盒子的「上沿」）
  fillRoundRectGradientY(
    surface,
    px(0.12),
    py(0.415),
    B * 0.725,
    B * 0.15,
    B * 0.055,
    BOX_LIP,
    BOX,
  )
  fillRoundRect(surface, px(0.12), py(0.532), B * 0.725, B * 0.014, B * 0.006, INK, 0.1)

  // Layer 5d：正面标签槽（INK 外框 + 浅色内芯）
  fillRoundRect(surface, px(0.353), py(0.612), B * 0.294, B * 0.132, B * 0.037, INK)
  fillRoundRect(surface, px(0.391), py(0.647), B * 0.218, B * 0.062, B * 0.02, BOX)
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
  { name: 'pwa-192x192.png', size: 192, ratio: 0.7 },
  { name: 'pwa-512x512.png', size: 512, ratio: 0.7 },
  { name: 'maskable-512x512.png', size: 512, ratio: 0.66 },
  { name: 'apple-touch-icon-180x180.png', size: 180, ratio: 0.7 },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const t of targets) {
  const png = render(t.size, t.ratio)
  const file = resolve(OUT_DIR, t.name)
  writeFileSync(file, png)

  // 生成后自检：回读文件，确认 PNG 可解析且尺寸正确
  const { width, height } = readPNGSize(readFileSync(file))
  if (width !== t.size || height !== t.size) {
    throw new Error(`${t.name} 尺寸异常：${width}x${height}，期望 ${t.size}x${t.size}`)
  }
  console.log(
    `${t.name.padEnd(30)} ${String(width).padStart(4)}x${height}  ${(png.length / 1024).toFixed(1)} KB`,
  )
}
console.log('\n输出目录：public/icons/pwa/')
