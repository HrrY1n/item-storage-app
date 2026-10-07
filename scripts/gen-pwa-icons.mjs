/**
 * 生成 PWA / favicon 图标 —— **唯一入口**，不要手改 `public/icons/pwa/*.png`。
 *
 * 输入源（**单一**正式 App Icon 母版，1024+ 正方形 / full-bleed / 不透明 / 无预烘焙圆角 / 无白边）：
 *   assets/app-icons/app-icon-master-1254.png
 *
 * 本项目采用「单一正式图标」方案：
 *   - PWA manifest、maskable、apple-touch-icon、favicon **全部**来自这同一张母版；
 *   - 不做 light/dark 双母版，也不做 `<link rel="icon" media="(prefers-color-scheme: …)">` 主题切换；
 *   - iOS 若自己对主屏图标施加 dark / tinted 处理，就接受系统行为，不做非标准 hack。
 *
 * 所有派生尺寸都是对母版**等比例高质量缩放**（分离式 Lanczos3）得到：
 * 不重绘、不调色、不加深边框、不裁圆角、不补白边、不加透明度。
 *
 * 零依赖：Node 内置 zlib 手写最小 PNG 解码/编码器。
 *
 * 母版来源（可审计）：设计交付的定稿 **1254×1254** 直接转成 PNG，**不做任何背景合成**。
 *
 * ⚠️ **浅暖灰背景是设计的一部分**：它是为 iOS 自动 Dark treatment 预留的明亮区域，不是"预览背景"。
 * 因此母版 = 交付原图本身 —— 浅底铺满画布四角（full-bleed）+ 深蓝圆角内板 + 白色收纳盒 + teal 文件卡，
 * 全部保持原样（自检：母版与交付原图像素 md5 一致），外层圆角留给 iOS / Android 自己裁剪，不预烘焙。
 *
 * ❌ 绝不把外围背景合成、外延或替换成别的颜色：那会得到"大底 + 内板"的框套框，
 *    并吃掉为 iOS Dark treatment 预留的明亮区域。本脚本对母版**只做缩放**，不做任何绘制。
 *
 * 安全网（结构上保证"母版 = 唯一真相"）：
 *   1. 母版必须是正方形、bit depth 8、非隔行，且边长在 512~4096 之间；
 *   2. 母版必须完全不透明（拒绝透明圆角）；
 *   3. 母版四角必须是**同一个连续背景**（拒绝人工白边 / 单角补丁；允许渐变，也允许浅色或深色背景）；
 *   4. maskable 的**核心主体**必须落在规范安全圆（半径 0.4）内 —— 不满足直接报错，
 *      而不是靠"加白边"糊过去（见 assertMaskableSafe）；
 *   5. 每个文件写盘后回读校验尺寸，不符即抛错；
 *   6. 输出目录里的 PNG 与 targets 表严格一一对应：多出来的（含双图标时代的历史残留）直接删除。
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

/** 唯一母版：单一正式 App Icon 的真相所在 */
const MASTER_FILE = resolve(MASTER_DIR, 'app-icon-master-1254.png')
/** 母版边长下限/上限：只要求"足够大的正方形"，不锁死具体像素数，换导出尺寸时无需改代码 */
const MIN_MASTER_SIZE = 512
const MAX_MASTER_SIZE = 4096
/** Google maskable icon 规范：核心主体必须落在直径 80%（半径 0.4）的安全圆内 */
const MASKABLE_SAFE_RADIUS = 0.4
/** 四角色差上限：允许渐变与深浅背景，但拒绝"某一角是外来补丁"（人工白边 / 透明圆角留下的痕迹） */
const MAX_CORNER_SPREAD = 120

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

/**
 * 四角必须是**同一个连续背景**铺到画布四角。
 *
 * 注意这里**不**要求"四角不能是浅色"：本项目的正式图标背景就是浅暖灰（它是设计的一部分，
 * 为 iOS 自动 Dark treatment 预留的明亮区域），浅色四角完全合法。
 * 真正要拒绝的是：
 *   - 透明圆角（alpha < 255）—— 由 decodePNG 的不透明校验拦掉；
 *   - 某一角是外来补丁（人工白边 / 拼贴色块）—— 表现为四角彼此色差过大；
 *   - 四角与画布主体背景不一致（预烘焙裁切留下的痕迹）。
 * 允许渐变，也允许浅色或深色背景。
 */
function assertFullBleedCorners(master, label) {
  const { width, height, rgb } = master
  const block = 8
  const blocks = [
    [0, 0],
    [width - block, 0],
    [0, height - block],
    [width - block, height - block],
  ]
  const avg = blocks.map(([bx, by]) => {
    let r = 0
    let g = 0
    let b = 0
    for (let y = by; y < by + block; y++) {
      for (let x = bx; x < bx + block; x++) {
        const i = (y * width + x) * 3
        r += rgb[i]
        g += rgb[i + 1]
        b += rgb[i + 2]
      }
    }
    const n = block * block
    return [r / n, g / n, b / n]
  })
  let worst = 0
  let pair = ''
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const d = Math.hypot(avg[i][0] - avg[j][0], avg[i][1] - avg[j][1], avg[i][2] - avg[j][2])
      if (d > worst) {
        worst = d
        pair = `${i + 1}↔${j + 1}`
      }
    }
  }
  if (worst > MAX_CORNER_SPREAD) {
    throw new Error(
      `${label}: 四角不是同一个连续背景（最大色差 ${worst.toFixed(1)} > ${MAX_CORNER_SPREAD}，角 ${pair}）—— ` +
        '母版必须是背景铺满画布四角的 full-bleed 方形：不允许透明圆角、人工白边或单角补丁',
    )
  }
  return { corners: avg, spread: worst }
}

const colorDistance = (rgb, i, ref) =>
  Math.hypot(rgb[i * 3] - ref[0], rgb[i * 3 + 1] - ref[1], rgb[i * 3 + 2] - ref[2])

/** 一组像素的中位色（大集合按步长采样，够用且快） */
function medianColorOf(rgb, indices) {
  const step = Math.max(1, Math.floor(indices.length / 20000))
  const rs = []
  const gs = []
  const bs = []
  for (let k = 0; k < indices.length; k += step) {
    const i = indices[k]
    rs.push(rgb[i * 3])
    gs.push(rgb[i * 3 + 1])
    bs.push(rgb[i * 3 + 2])
  }
  const mid = (arr) => {
    arr.sort((a, b) => a - b)
    return arr[arr.length >> 1]
  }
  return [mid(rs), mid(gs), mid(bs)]
}

/**
 * maskable 安全检查：**核心主体（收纳盒 / 卡片）**必须完全落在半径 0.4 的安全圆内。
 *
 * 判据必须两级，因为背景可能是浅色也可能是深色：
 *   1. 背景 = 四角中位色；
 *   2. 内板 = 与背景色差 > 60 的像素（浅底设计里是深蓝内板；深底设计里这一层就是盒体本身）；
 *   3. 核心主体 = **内板范围内**亮度高于内板中位色 + 60 的像素（白色盒体 / teal 卡片）。
 * 内板是装饰性底板、盒体投影是软渐变，它们的四角被裁掉不影响识别；
 * 真正不能被裁的是盒体，所以只校验盒体。
 */
function assertMaskableSafe(master, label) {
  const { width, height, rgb } = master
  const bg = medianColorOf(rgb, cornerIndices(width, height))
  const innerMask = new Uint8Array(width * height)
  const inner = []
  for (let i = 0; i < width * height; i++) {
    if (colorDistance(rgb, i, bg) > 60) {
      innerMask[i] = 1
      inner.push(i)
    }
  }
  if (inner.length === 0) {
    throw new Error(`${label}: 找不到与背景不同的内层图形 —— 请检查母版构图`)
  }
  const plate = medianColorOf(rgb, inner)
  const plateLum = luminance(plate, 0)
  const deep = deepInside(innerMask, width, height, Math.round(width * 0.05))
  let subject = deep.filter((i) => luminance(rgb, i) > plateLum + 60)
  // 若内板本身就是主体（没有独立内板的深底母版），退回用内板深处范围
  if (subject.length < width * height * 0.005) subject = deep
  if (subject.length === 0) {
    throw new Error(`${label}: 无法定位核心主体（内板 ${inner.length}px）—— 请检查母版构图`)
  }

  let maxRadius = 0
  for (const i of subject) {
    const x = i % width
    const y = (i - x) / width
    const r = Math.hypot((x + 0.5) / width - 0.5, (y + 0.5) / height - 0.5)
    if (r > maxRadius) maxRadius = r
  }
  return { bg, plate, subjectCount: subject.length, maxRadius }
}

/**
 * 内层图形的"深处"：按行/列范围各收缩 E 像素（等价于方形腐蚀，O(n)）。
 * 目的是排除紧贴内板外缘的**投影**：投影是软渐变、被遮罩切到无所谓，
 * 但它的半径比盒体大，会污染安全区判定。
 */
function deepInside(mask, width, height, e) {
  const rowLo = new Int32Array(height).fill(-1)
  const rowHi = new Int32Array(height).fill(-1)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        rowLo[y] = x
        break
      }
    }
    for (let x = width - 1; x >= 0; x--) {
      if (mask[y * width + x]) {
        rowHi[y] = x
        break
      }
    }
  }
  const colTop = new Int32Array(width).fill(-1)
  const colBot = new Int32Array(width).fill(-1)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (mask[y * width + x]) {
        colTop[x] = y
        break
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      if (mask[y * width + x]) {
        colBot[x] = y
        break
      }
    }
  }
  const out = []
  for (let y = 0; y < height; y++) {
    const lo = rowLo[y]
    const hi = rowHi[y]
    if (lo < 0) continue
    for (let x = lo + e; x <= hi - e; x++) {
      if (y < colTop[x] + e || y > colBot[x] - e) continue
      out.push(y * width + x)
    }
  }
  return out
}

/** 四角 24×24 块的像素下标（用来取背景中位色） */
function cornerIndices(width, height) {
  const out = []
  const n = 24
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out.push(y * width + x)
      out.push(y * width + (width - 1 - x))
      out.push((height - 1 - y) * width + x)
      out.push((height - 1 - y) * width + (width - 1 - x))
    }
  }
  return out
}

function loadMaster() {
  const label = `母版 (${MASTER_FILE})`
  const master = decodePNG(readFileSync(MASTER_FILE), label)
  if (master.width !== master.height) {
    throw new Error(`${label}: 必须是正方形（实际 ${master.width}×${master.height}）`)
  }
  if (master.width < MIN_MASTER_SIZE || master.width > MAX_MASTER_SIZE) {
    throw new Error(
      `${label}: 边长必须在 ${MIN_MASTER_SIZE}~${MAX_MASTER_SIZE} 之间（实际 ${master.width}）`,
    )
  }
  const corners = assertFullBleedCorners(master, label)
  return { ...master, corners }
}

// ------------------------------------------------------------------ 输出

/** 每个派生尺寸只声明名字与大小：输入源是唯一的一张母版 */
const targets = [
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'maskable-512x512.png', size: 512 },
  { name: 'apple-touch-icon-180x180-v4.png', size: 180 },
  { name: 'favicon-32x32.png', size: 32 },
]

const master = loadMaster()

const safe = assertMaskableSafe(master, '母版')
if (safe.maxRadius > MASKABLE_SAFE_RADIUS) {
  throw new Error(
    `母版: 核心主体最大半径 ${safe.maxRadius.toFixed(4)} 超出 maskable 安全圆 ${MASKABLE_SAFE_RADIUS}。` +
      '请让设计师把主体在内缩小（而不是在生成端补白边 / 加圆角）。',
  )
}
const corner = master.corners.corners[0]
console.log(
  `母版 ${master.width}×${master.height}｜四角背景 (${corner.map((v) => Math.round(v)).join(',')})，` +
    `四角最大色差 ${master.corners.spread.toFixed(1)} → 背景铺满 full-bleed\n` +
    `maskable 安全检查：核心主体（盒体/卡片）最大半径 ${safe.maxRadius.toFixed(4)} ≤ ${MASKABLE_SAFE_RADIUS}` +
    `（背景 (${safe.bg.map((v) => Math.round(v)).join(',')}) → 内板 (${safe.plate.map((v) => Math.round(v)).join(',')})）` +
    `—— 可直接用作 maskable，无需补白边\n`,
)

mkdirSync(OUT_DIR, { recursive: true })
for (const t of targets) {
  const out = resample(master.rgb, master.width, master.height, t.size)
  const png = encodePNG(t.size, t.size, out)
  const file = resolve(OUT_DIR, t.name)
  writeFileSync(file, png)

  // 生成后自检：回读文件，确认 PNG 可解析且尺寸正确
  const { width, height } = readPNGSize(readFileSync(file))
  if (width !== t.size || height !== t.size) {
    throw new Error(`${t.name} 尺寸异常：${width}x${height}，期望 ${t.size}x${t.size}`)
  }
  console.log(`${t.name.padEnd(32)} ${String(width).padStart(4)}x${height}  ${(png.length / 1024).toFixed(1)} KB`)
}

// 清理：输出目录归生成器所有，不属于 targets 的 PNG 都是历史残留（否则会继续被 precache）
const expected = new Set(targets.map((t) => t.name))
const stale = readdirSync(OUT_DIR).filter((f) => f.endsWith('.png') && !expected.has(f))
for (const f of stale) {
  unlinkSync(resolve(OUT_DIR, f))
  console.log(`已删除历史残留：${f}`)
}

console.log('\n输出目录：public/icons/pwa/')
