/**
 * 生成 PWA / favicon 图标 —— **唯一入口**，不要手改 `public/icons/pwa/*.png`。
 *
 * 输入源（设计定稿母版，1024×1024 / full-bleed / 不透明 / 无预烘焙圆角 / 无白边）：
 *   assets/app-icons/app-icon-light-1024.png   日间版（正式默认 App Icon）
 *   assets/app-icons/app-icon-dark-1024.png    夜间版（同系列 dark asset，用于主题感知 favicon）
 *
 * 所有派生尺寸都是对母版**等比例高质量缩放**（分离式 Lanczos3）得到：
 * 不重绘、不调色、不加深边框、不裁圆角、不补白边、不加透明度。
 *
 * 零依赖：Node 内置 zlib 手写最小 PNG 解码/编码器。
 *
 * 安全网（结构上保证"母版 = 唯一真相"）：
 *   1. 母版必须是 1024×1024 正方形、bit depth 8、非隔行；
 *   2. 母版必须完全不透明（拒绝透明圆角）；
 *   3. 母版四角必须是有色画面（拒绝白边 / 白底裁圆角）；
 *   4. maskable 主体必须落在规范安全圆（半径 0.4）内 —— 不满足直接报错，
 *      而不是靠"加白边"糊过去（见 assertMaskableSafe）；
 *   5. 每个文件写盘后回读校验尺寸，不符即抛错；
 *   6. 输出目录里的 PNG 与 targets 表严格一一对应：多出来的（历史残留）直接删除。
 *
 * 用法：node scripts/gen-pwa-icons.mjs（或 npm run icons）
 */

import { deflateSync, inflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/icons/pwa')
const MASTER_DIR = resolve(__dirname, '../assets/app-icons')

const MASTER_SIZE = 1024
/** Google maskable icon 规范：主体必须落在直径 80%（半径 0.4）的安全圆内 */
const MASKABLE_SAFE_RADIUS = 0.4

const MASTERS = {
  light: resolve(MASTER_DIR, 'app-icon-light-1024.png'),
  dark: resolve(MASTER_DIR, 'app-icon-dark-1024.png'),
}

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

/** 读取 PNG 的 IHDR 尺寸（用于生成后自检） */
function readPNGSize(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) throw new Error('PNG signature 不正确')
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('缺少 IHDR')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

// ------------------------------------------------------------------ PNG 解码

const CHANNELS_OF = { 0: 1, 2: 3, 4: 2, 6: 4 }

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * 解码 8bit / 非隔行 PNG → RGB（丢掉 alpha，但要求 alpha 全部不透明）。
 * 只支持生成器实际需要的子集，遇到不支持的形态直接报错而不是猜。
 */
function decodePNG(buffer, label) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) throw new Error(`${label}: PNG signature 不正确`)
  }

  let offset = 8
  let ihdr = null
  const idat = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') ihdr = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!ihdr) throw new Error(`${label}: 缺少 IHDR`)

  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]
  const colorType = ihdr[9]
  const interlace = ihdr[12]
  if (bitDepth !== 8) throw new Error(`${label}: 只支持 8bit 深度（实际 ${bitDepth}）`)
  if (interlace !== 0) throw new Error(`${label}: 不支持隔行扫描 PNG`)
  const channels = CHANNELS_OF[colorType]
  if (!channels) throw new Error(`${label}: 不支持的颜色类型 ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const samples = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = samples.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? samples.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) v += paeth(a, b, c)
      else if (filter !== 0) throw new Error(`${label}: 未知的行过滤器 ${filter}`)
      cur[i] = v & 0xff
    }
  }

  // 展开为 RGB：灰度复制三通道；带 alpha 的一律要求全不透明（母版必须 full-bleed）
  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    const s = i * channels
    if (channels === 1) {
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = samples[s]
    } else if (channels === 2) {
      if (samples[s + 1] !== 255) throw new Error(`${label}: 母版必须完全不透明（存在透明像素）`)
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = samples[s]
    } else {
      if (channels === 4 && samples[s + 3] !== 255) {
        throw new Error(`${label}: 母版必须完全不透明（存在透明像素）`)
      }
      rgb[i * 3] = samples[s]
      rgb[i * 3 + 1] = samples[s + 1]
      rgb[i * 3 + 2] = samples[s + 2]
    }
  }

  return { width, height, rgb }
}

// ------------------------------------------------------------------ 重采样

/** Lanczos3 核 */
function lanczos3(x) {
  const a = Math.abs(x)
  if (a === 0) return 1
  if (a >= 3) return 0
  const px = Math.PI * x
  return ((Math.sin(px) / px) * Math.sin(px / 3)) / (px / 3)
}

/**
 * 预计算降采样的权重表（分离式，两个方向各算一次即可复用到每一行/列）。
 * scale > 1（降采样）时按 scale 展宽核，等效于先做抗锯齿低通再采样。
 */
function buildWeights(srcSize, dstSize) {
  const scale = srcSize / dstSize
  const filterScale = Math.max(1, scale)
  const support = 3 * filterScale
  const table = []
  for (let i = 0; i < dstSize; i++) {
    const center = (i + 0.5) * scale
    const from = Math.max(0, Math.floor(center - support + 0.5))
    const to = Math.min(srcSize - 1, Math.ceil(center + support - 0.5))
    const weights = []
    let sum = 0
    for (let t = from; t <= to; t++) {
      const w = lanczos3((t + 0.5 - center) / filterScale)
      weights.push(w)
      sum += w
    }
    if (sum === 0) {
      weights.length = 0
      weights.push(1)
      table.push({ from: Math.min(srcSize - 1, Math.round(center)), weights })
      continue
    }
    for (let k = 0; k < weights.length; k++) weights[k] /= sum
    table.push({ from, weights })
  }
  return table
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/** 等比例（方图 → 方图）Lanczos3 重采样；尺寸相同则原样返回 */
function resample(src, sw, sh, dst) {
  if (sw === dst && sh === dst) return Buffer.from(src)
  const hw = buildWeights(sw, dst)
  const tmp = Buffer.alloc(dst * sh * 3)
  for (let y = 0; y < sh; y++) {
    const rowIn = y * sw * 3
    const rowOut = y * dst * 3
    for (let x = 0; x < dst; x++) {
      const { from, weights } = hw[x]
      let r = 0
      let g = 0
      let b = 0
      for (let k = 0; k < weights.length; k++) {
        const o = rowIn + (from + k) * 3
        const w = weights[k]
        r += src[o] * w
        g += src[o + 1] * w
        b += src[o + 2] * w
      }
      const o = rowOut + x * 3
      tmp[o] = clamp255(r)
      tmp[o + 1] = clamp255(g)
      tmp[o + 2] = clamp255(b)
    }
  }

  const vw = buildWeights(sh, dst)
  const out = Buffer.alloc(dst * dst * 3)
  for (let y = 0; y < dst; y++) {
    const { from, weights } = vw[y]
    for (let x = 0; x < dst; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = 0; k < weights.length; k++) {
        const o = ((from + k) * dst + x) * 3
        const w = weights[k]
        r += tmp[o] * w
        g += tmp[o + 1] * w
        b += tmp[o + 2] * w
      }
      const o = (y * dst + x) * 3
      out[o] = clamp255(r)
      out[o + 1] = clamp255(g)
      out[o + 2] = clamp255(b)
    }
  }
  return out
}

// ------------------------------------------------------------------ 母版校验

const luminance = (rgb, i) => rgb[i * 3] * 0.2126 + rgb[i * 3 + 1] * 0.7152 + rgb[i * 3 + 2] * 0.0722

/** 四角不能是白（白边 / 白底裁圆角都会在这里暴露） */
function assertNoWhiteCorners(master, label) {
  const { width, height, rgb } = master
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]
  for (const [x, y] of corners) {
    const i = (y * width + x) * 3
    const min = Math.min(rgb[i], rgb[i + 1], rgb[i + 2])
    if (min > 240) {
      throw new Error(
        `${label}: 四角像素接近纯白 (${rgb[i]},${rgb[i + 1]},${rgb[i + 2]}) —— ` +
          '母版必须是无白边、无预烘焙圆角的 full-bleed 方形',
      )
    }
  }
}

/**
 * maskable 安全检查：主体必须完全落在半径 0.4 的安全圆内。
 * 主体判定：以四条边 12px 色带的最大亮度为背景基准，亮度 > 基准 + 60 视为主体
 * （背景是有色渐变，盒体/卡片远亮于它，因此这个判据对两套母版都稳定）。
 */
function assertMaskableSafe(master, label) {
  const { width, height, rgb } = master
  const band = 12
  let bgMax = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y < band || y >= height - band || x < band || x >= width - band) {
        const l = luminance(rgb, y * width + x)
        if (l > bgMax) bgMax = l
      }
    }
  }
  const threshold = bgMax + 60
  let maxRadius = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (luminance(rgb, y * width + x) <= threshold) continue
      const r = Math.hypot((x + 0.5) / width - 0.5, (y + 0.5) / height - 0.5)
      if (r > maxRadius) maxRadius = r
    }
  }
  if (maxRadius > MASKABLE_SAFE_RADIUS) {
    throw new Error(
      `${label}: 主体最大半径 ${maxRadius.toFixed(4)} 超出 maskable 安全圆 ${MASKABLE_SAFE_RADIUS}。` +
        '请让设计师把主体在内缩小（而不是在生成端补白边 / 加圆角）。',
    )
  }
  return { bgMax, maxRadius }
}

function loadMaster(name) {
  const path = MASTERS[name]
  const label = `${name} 母版 (${path})`
  const master = decodePNG(readFileSync(path), label)
  if (master.width !== MASTER_SIZE || master.height !== MASTER_SIZE) {
    throw new Error(`${label}: 必须是 ${MASTER_SIZE}×${MASTER_SIZE}（实际 ${master.width}×${master.height}）`)
  }
  assertNoWhiteCorners(master, label)
  return master
}

// ------------------------------------------------------------------ 输出

/** 每个派生尺寸都声明大小与取哪套母版；文件名必须与 index.html / manifest 的引用一致 */
const targets = [
  { name: 'pwa-192x192.png', size: 192, source: 'light' },
  { name: 'pwa-512x512.png', size: 512, source: 'light' },
  { name: 'maskable-512x512.png', size: 512, source: 'light' },
  { name: 'apple-touch-icon-180x180-v2.png', size: 180, source: 'light' },
  { name: 'favicon-light-32x32.png', size: 32, source: 'light' },
  { name: 'favicon-dark-32x32.png', size: 32, source: 'dark' },
]

const masters = {
  light: loadMaster('light'),
  dark: loadMaster('dark'),
}

const safe = assertMaskableSafe(masters.light, 'light 母版')
console.log(
  `maskable 安全检查：主体最大半径 ${safe.maxRadius.toFixed(4)} ≤ ${MASKABLE_SAFE_RADIUS}` +
    `（背景亮度基准 ${safe.bgMax.toFixed(1)}）—— 母版可直接用作 maskable，无需补白边\n`,
)

mkdirSync(OUT_DIR, { recursive: true })
for (const t of targets) {
  const master = masters[t.source]
  const out = resample(master.rgb, master.width, master.height, t.size)
  const png = encodePNG(t.size, t.size, out)
  const file = resolve(OUT_DIR, t.name)
  writeFileSync(file, png)

  // 生成后自检：回读文件，确认 PNG 可解析且尺寸正确
  const { width, height } = readPNGSize(readFileSync(file))
  if (width !== t.size || height !== t.size) {
    throw new Error(`${t.name} 尺寸异常：${width}x${height}，期望 ${t.size}x${t.size}`)
  }
  console.log(
    `${t.name.padEnd(32)} ${String(width).padStart(4)}x${height}  ${t.source.padEnd(5)} ${(png.length / 1024).toFixed(1)} KB`,
  )
}

// 清理：输出目录归生成器所有，不属于 targets 的 PNG 都是历史残留（否则会继续被 precache）
const expected = new Set(targets.map((t) => t.name))
const stale = readdirSync(OUT_DIR).filter((f) => f.endsWith('.png') && !expected.has(f))
for (const f of stale) {
  unlinkSync(resolve(OUT_DIR, f))
  console.log(`已删除历史残留：${f}`)
}

console.log('\n输出目录：public/icons/pwa/')
