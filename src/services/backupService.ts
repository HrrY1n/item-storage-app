import type JSZip from 'jszip'
import { readSnapshot, replaceAllWithBackup, type Snapshot } from '../db/repositories/backupRepository'
import {
  BACKUP_SCHEMA_VERSION,
  toBackupPayload,
  toSummary,
  validateBackupData,
  validateManifest,
  type BackupData,
  type BackupManifest,
  type BackupPayload,
  type BackupSummary,
} from '../domain/backup'
import { APP_VERSION } from '../appInfo'

/**
 * 备份/恢复的编排层：组装 ZIP、解析校验、调用 repository 执行替换。
 *
 * 安全约定（关键）：解析与校验阶段**绝不写数据库**。
 * 只有在 readAndValidateBackup 成功且用户确认后，才会调用 restoreFromPayload。
 */

/** ZIP 内承载二进制资产的目录名 */
const ASSETS_DIR = 'assets'

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
}

/** 按本地日期生成备份文件名：private-item-library-backup-YYYY-MM-DD.zip */
export function buildBackupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `private-item-library-backup-${ymd}.zip`
}

function buildManifest(snapshot: Snapshot, now: Date): BackupManifest {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    itemCount: snapshot.items.length,
    categoryCount: snapshot.categories.length,
    tagCount: snapshot.tags.length,
    assetCount: snapshot.assets.length,
  }
}

/**
 * 把内存中的 Assets 转成"元数据 + 独立文件"两部分。
 * preset 静态图标不进 ZIP（随包交付），只有真实用户二进制资产才写入 assets/。
 */
async function splitAssets(snapshot: Snapshot) {
  const metas: BackupData['assets'] = []
  const files: { name: string; bytes: Uint8Array }[] = []

  for (const asset of snapshot.assets) {
    if (asset.kind === 'preset' || !asset.blob) {
      metas.push({
        id: asset.id,
        kind: asset.kind,
        path: asset.path,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        styleVersion: asset.styleVersion,
        promptVersion: asset.promptVersion,
        sourceAssetId: asset.sourceAssetId,
        createdAt: asset.createdAt,
      })
      continue
    }
    const ext = MIME_EXT[asset.mime] ?? '.bin'
    const name = `${asset.id}${ext}`
    const bytes = new Uint8Array(await asset.blob.arrayBuffer())
    files.push({ name, bytes })
    metas.push({
      id: asset.id,
      kind: asset.kind,
      path: asset.path,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      styleVersion: asset.styleVersion,
      promptVersion: asset.promptVersion,
      sourceAssetId: asset.sourceAssetId,
      createdAt: asset.createdAt,
      file: name,
    })
  }

  return { metas, files }
}

/**
 * JSZip 仅备份/恢复时需要，体积较大（~100KB），因此按需动态加载，
 * 避免拖慢 App Shell 首屏。离线时该 chunk 同样已被 precache，功能不受影响。
 */
async function loadJSZip() {
  const mod = await import('jszip')
  return mod.default
}

/** 组装 ZIP 内容（不落盘、不下载；导出与测试共用同一份构建逻辑） */
export async function buildBackupArchive(
  snapshot?: Snapshot,
  now: Date = new Date(),
): Promise<{ zip: JSZip; manifest: BackupManifest; data: BackupData }> {
  const JSZipCtor = await loadJSZip()
  const snap = snapshot ?? (await readSnapshot())
  const manifest = buildManifest(snap, now)
  const { metas, files } = await splitAssets(snap)

  const data: BackupData = {
    items: snap.items,
    categories: snap.categories,
    tags: snap.tags,
    itemTags: snap.itemTags,
    assets: metas,
    appMeta: snap.appMeta,
  }

  const zip = new JSZipCtor()
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('data.json', JSON.stringify(data, null, 2))

  const assetsFolder = zip.folder(ASSETS_DIR)!
  for (const f of files) assetsFolder.file(f.name, f.bytes)

  return { zip, manifest, data }
}

export interface ExportResult {
  blob: Blob
  fileName: string
  summary: BackupSummary
}

/** 导出：读取数据库 → 组装 → 生成 Blob */
export async function exportBackup(snapshot?: Snapshot): Promise<ExportResult> {
  const now = new Date()
  const { zip, manifest } = await buildBackupArchive(snapshot, now)
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    mimeType: 'application/zip',
  })
  return { blob, fileName: buildBackupFileName(now), summary: toSummary(manifest) }
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export type ReadResult =
  | { ok: true; summary: BackupSummary; payload: BackupPayload }
  | { ok: false; error: string }

/** parseJson 只依赖 asnyc('string')，用最小结构类型解耦，避免依赖 JSZip 的内部类型 */
interface ZipTextFile {
  async(type: 'string'): Promise<string>
}

/** 安全的 JSON 解析失败信息统一处理 */
async function parseJson<T>(file: ZipTextFile, label: string): Promise<T | { __error: string }> {
  try {
    return JSON.parse(await file.async('string')) as T
  } catch {
    return { __error: `${label} 解析失败，不是合法的 JSON` }
  }
}

/**
 * 读取并**只做校验**，完全不触碰数据库。
 * 返回可写入的 payload，但写入必须等用户确认后由 restoreFromPayload 执行。
 */
export async function readAndValidateBackup(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<ReadResult> {
  const JSZipCtor = await loadJSZip()

  let zip: JSZip
  try {
    zip = await JSZipCtor.loadAsync(input)
  } catch {
    return { ok: false, error: '无法读取该文件，它可能不是有效的 ZIP 备份包或已损坏' }
  }

  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) return { ok: false, error: '备份包缺少 manifest.json，无法确认备份格式' }

  const dataFile = zip.file('data.json')
  if (!dataFile) return { ok: false, error: '备份包缺少 data.json，没有可恢复的数据' }

  const manifestRaw = await parseJson<unknown>(manifestFile, 'manifest.json')
  if (typeof manifestRaw === 'object' && manifestRaw !== null && '__error' in manifestRaw) {
    return { ok: false, error: (manifestRaw as { __error: string }).__error }
  }

  const manifestResult = validateManifest(manifestRaw)
  if (!manifestResult.ok) return manifestResult

  const dataRaw = await parseJson<unknown>(dataFile, 'data.json')
  if (typeof dataRaw === 'object' && dataRaw !== null && '__error' in dataRaw) {
    return { ok: false, error: (dataRaw as { __error: string }).__error }
  }

  const dataResult = validateBackupData(dataRaw, manifestResult.value.schemaVersion)
  if (!dataResult.ok) return dataResult

  // 读取二进制资产（缺失不报错：退化为 blob=null）
  // 注意：zip.folder('assets').files 会返回整个包的索引，必须按前缀自行过滤
  const assetFiles: Record<string, Uint8Array> = {}
  const assetPaths = Object.keys(zip.files).filter(
    (p) => p.startsWith(ASSETS_DIR + '/') && !zip.files[p].dir,
  )
  for (const path of assetPaths) {
    const f = zip.file(path)
    if (f) assetFiles[path.slice(ASSETS_DIR.length + 1)] = await f.async('uint8array')
  }

  const payload = toBackupPayload(dataResult.value, assetFiles)
  return { ok: true, summary: toSummary(manifestResult.value), payload }
}

/** 真正执行替换写入：必须在校验通过 + 用户确认之后调用 */
export async function restoreFromPayload(payload: BackupPayload): Promise<void> {
  await replaceAllWithBackup(payload)

  // Phase 3B：恢复完成后同步状态必须重置，否则会拿着"旧游标"去pull，
  // 结果是恢复出来的数据永远推不上云、或云端新数据永远拉不下来。
  //
  // 这里刻意**不自动合并**：ZIP Restore 是 Replace Restore，与增量同步语义冲突，
  // 任何自动决策都可能在用户不知情时丢掉一整台设备的新数据。
  // 改为：清空 outbox + 游标归零 + 关闭同步，由用户在设置页明确二选一
  //（以本机为准 / 以云端为准）。详见 PHASE_3B_IMPLEMENTATION_PLAN.md §6。
  try {
    const { syncRepository } = await import('../db/repositories/syncRepository')
    await syncRepository.clearQueue()
    await syncRepository.disable()
  } catch {
    /* 同步模块不可用时静默跳过：备份恢复是更重要的操作，绝不因它失败 */
  }
}
