import { syncRepository } from '../db/repositories/syncRepository'
import { isRecognitionImage, validateRecognitionCandidate, type RecognitionMode } from '../domain/recognition'

/** 浏览器缩图并重新编码，上传内容不保留原图的 EXIF 元数据。 */
export async function prepareRecognitionImage(file: File, crop = { top: 0, bottom: 100 }): Promise<{ image: string; width: number; height: number }> {
  if (!file.type.startsWith('image/') || file.size > 15 * 1024 * 1024) throw new Error('请选择小于 15 MB 的图片。')
  if (!Number.isFinite(crop.top) || !Number.isFinite(crop.bottom) || crop.top < 0 || crop.bottom > 100 || crop.top >= crop.bottom) throw new Error('请选择有效的裁剪区域。')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    try { await image.decode() } catch { throw new Error('无法读取这张图片，请改用 JPEG、PNG 或 WebP。') }
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片没有有效尺寸。')
    const top = Math.floor(image.naturalHeight * crop.top / 100)
    const height = Math.max(1, Math.ceil(image.naturalHeight * crop.bottom / 100) - top)
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理图片。')
    for (const quality of [0.85, 0.7, 0.5]) {
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, top, image.naturalWidth, height, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL('image/jpeg', quality)
      if (isRecognitionImage(data)) return { image: data, width: canvas.width, height: canvas.height }
    }
    throw new Error('图片内容较大，请先裁剪到物品或订单商品区域后重试。')
  } finally { URL.revokeObjectURL(url) }
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: '请先在设置中完成本设备的云端配对，再使用 AI 识别。',
  'sync-unavailable': '此环境尚未连接云端识别服务，可继续手动填写。',
  'ai-not-configured': '云端 AI 尚未启用；需先确认免费计划并连接识别服务。',
  'image-too-large': '图片过大，请裁剪后重试。',
  'invalid-image': '图片格式无效，请重新选择图片。',
  'invalid-body': '图片请求无效，请重新选择图片。',
  'ai-too-frequent': '请求较频繁，请等几秒再试。',
  'ai-quota-exhausted': '识别额度已用尽或暂时受限，请稍后再试，也可继续手动填写。',
  'ai-timeout': '识别超时，图片和表单仍然保留，可以重试。',
  'ai-invalid-result': '没有得到可靠的识别结果，请裁剪图片后重试或手动填写。',
  'ai-unavailable': '识别服务暂时不可用，可以稍后重试或手动填写。',
}

export async function recognizeItemImage(image: string, mode: RecognitionMode, categoryNames: string[], signal: AbortSignal) {
  const state = await syncRepository.getState()
  if (!state?.secret) throw new Error(ERROR_MESSAGES.unauthorized)
  if (navigator.onLine === false) throw new Error('当前处于离线状态，可继续手动填写。')
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(abort, 60000)
  try {
    const response = await fetch('/api/ai/recognize', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.secret}` },
      body: JSON.stringify({ image, mode, categoryNames }),
    })
    const raw = await response.text()
    if (raw.length > 16000) throw new Error(ERROR_MESSAGES['ai-invalid-result'])
    let body: unknown
    try { body = JSON.parse(raw) } catch { throw new Error(ERROR_MESSAGES['ai-unavailable']) }
    if (!response.ok) {
      const code = body && typeof body === 'object' && 'error' in body ? String(body.error) : ''
      throw new Error(ERROR_MESSAGES[code] ?? ERROR_MESSAGES['ai-unavailable'])
    }
    if (!body || typeof body !== 'object' || !('candidate' in body)) throw new Error(ERROR_MESSAGES['ai-invalid-result'])
    try { return validateRecognitionCandidate(body.candidate, mode) }
    catch { throw new Error(ERROR_MESSAGES['ai-invalid-result']) }
  } catch (error) {
    if (signal.aborted) throw error
    if (controller.signal.aborted) throw new Error(ERROR_MESSAGES['ai-timeout'])
    if (error instanceof TypeError) throw new Error('暂时无法连接识别服务，请检查网络后重试。')
    throw error
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
