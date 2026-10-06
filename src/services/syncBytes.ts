/**
 * base64url 编码（URL-safe，无 padding）。
 *
 * ⚠️ 为什么要单独一个文件、且**不放在 worker/ 目录**：
 * Worker 侧的实现在 worker/syncLogic.ts 里，那份是纯函数、可被 Worker 测试覆盖；
 * 而客户端（浏览器 + Node 测试）需要同一份算法。两者必须一致 ——
 * 配对码是"A 端生成、B 端解析"，两边编码不一致会直接导致配对失败。
 *
 * 因此这里定义唯一实现，worker 侧改为从这里引入。
 *
 * ⚠️ 刻意不用 btoa / Buffer：Workers 运行时没有 Buffer，
 * 而 btoa 在 lib: ES2022 下不存在。纯字节表实现在任何运行时都能跑。
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    // 末尾不足 3 字节用 0 补齐，多余字符最后统一截掉
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0
    out += B64[b0 >> 2]
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)]
    out += B64[((b1 & 0x0f) << 2) | (b2 >> 6)]
    out += B64[b2 & 0x3f]
  }
  // 每 3 字节组固定产生 4 个字符：n%3===1 多 2 个，n%3===2 多 1 个
  const rest = bytes.length % 3
  if (rest === 1) return out.slice(0, out.length - 2)
  if (rest === 2) return out.slice(0, out.length - 1)
  return out
}

/**
 * base64url 字符串 → 字节（配对码解析用）。
 *
 * ⚠️ 这里**必须用标准 base64 字母表**做 indexOf，而不是上面那个 URL-safe 表。
 *   曾经的 bug：先把 `-_` 换成 `+/`，却仍然用 URL-safe 表去查 ——
 *   转换后的字符在那张表里根本不存在，`indexOf` 全部返回 -1，
 *   解出来是乱码，`JSON.parse` 必然失败 → **B 设备永远无法加入**。
 *   （第一版只有 encode 的测试，decode 一直没被覆盖到。）
 */
const STD_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function fromBase64Url(text: string): Uint8Array {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  const out: number[] = []
  for (let i = 0; i < normalized.length; i += 4) {
    const c0 = STD_B64.indexOf(normalized[i]!)
    const c1 = normalized[i + 1] === undefined ? -1 : STD_B64.indexOf(normalized[i + 1])
    const c2 = normalized[i + 2] === undefined ? -1 : STD_B64.indexOf(normalized[i + 2])
    const c3 = normalized[i + 3] === undefined ? -1 : STD_B64.indexOf(normalized[i + 3])
    if (c0 < 0 || c1 < 0) break // 非法字符，停止解码
    // 标准 base64 解码：每 4 个6-bit 字符还原成 3 个字节
    // ⚠️ 掩码必须是 `c1 & 15` 与 `c2 & 3`（各取剩余位）；
    //   写成 0x0f 会把多余位一起推进字节 → 解出乱码。
    out.push(((c0 << 2) | (c1 >> 4)) & 0xff)
    if (c2 >= 0) out.push((((c1 & 0x0f) << 4) | (c2 >> 2)) & 0xff)
    if (c3 >= 0) out.push((((c2 & 0x03) << 6) | c3) & 0xff)
  }
  return new Uint8Array(out)
}