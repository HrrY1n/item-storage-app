/**
 * Workers 运行时的最小类型声明。
 *
 * 为什么不装 @cloudflare/workers-types：本项目环境里 `npm i` 装不上新包
 * （历史记录：网络超时）。而 Worker 代码只用到了极少数 API，
 * 手工声明这几处既足够让类型检查生效，又不引入外部依赖。
 *
 * 若将来能联网安装，可换成官方包并删除本文件：
 *   npm i -D @cloudflare/workers-types
 *   → 并把 tsconfig.worker.json 的 "types" 改成 ["@cloudflare/workers-types"]
 */

/** D1 的 prepared statement（只声明用到的方法） */
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  run<T = unknown>(): Promise<unknown>
  all<T = unknown>(): Promise<{ results?: T[] }>
}

/** D1 数据库绑定 */
interface D1Database {
  prepare(query: string): D1PreparedStatement
  /** 批处理：所有语句一次提交（D1 免费版单次调用有 50 条查询上限） */
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>
}

/**
 * WebCrypto 的 subset —— Workers 的 `crypto` 是 WebCrypto，
 * 但只暴露摘要 / 随机数 / HMAC / 签名，**没有 timingSafeEqual**。
 */
interface Crypto {
  randomUUID(): string
  getRandomValues<T extends ArrayBufferView>(array: T): T
  subtle: {
    digest(algorithm: 'SHA-256', data: BufferSource): Promise<ArrayBuffer>
  }
}

declare const crypto: Crypto

/* --- fetch 相关 ------------------------------------------------------ *
 * Workers 运行时提供完整的 Fetch API，但 lib: ES2022 里没有这些类型
 * （加 "dom" 会把整个 DOM 塞进来，而 Worker 侧用不到那些）。
 * 这里只声明实际用到的那几个构造器与最小形状。
 * ------------------------------------------------------------------- */

interface Headers {
  get(name: string): string | null
}

interface Request {
  method: string
  readonly url: string
  headers: Headers
  json(): Promise<unknown>
}

/** Workers 提供 TextEncoder（与 DOM 同名，但 lib: ES2022 里没有） */
declare class TextEncoder {
  encode(input?: string): Uint8Array
}

declare class Response {
  constructor(body?: string, init?: { status?: number; headers?: Record<string, string> })
  status: number
}

/** Workers 提供完整的 WHATWG URL；lib: ES2022 里没有，DOM 的又太宽 */
declare class URL {
  constructor(input: string, base?: string)
  readonly pathname: string
  readonly searchParams: { get(name: string): string | null }
}

declare const console: {
  log(...args: unknown[]): void
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
}