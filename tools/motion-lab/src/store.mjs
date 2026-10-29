import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const motionLabRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const sha256 = data => createHash('sha256').update(data).digest('hex')
export function safeName(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value))
    throw new Error('Expected safe single-segment name: ' + value)
  return value
}
export function newRunId(prefix = 'motion') {
  return safeName(prefix + '-' + new Date().toISOString().replace(/[-:.]/g, '') + '-' + randomUUID().slice(0, 8))
}
export async function writeNewJson(file, payload) {
  await writeFile(file, JSON.stringify(payload, null, 2), { flag: 'wx' })
}
export class ArtifactStore {
  constructor(runId, artifactRoot = path.join(motionLabRoot, 'artifacts')) {
    this.runId = safeName(runId)
    this.parent = path.resolve(artifactRoot)
    this.root = path.join(this.parent, this.runId)
    this.rawDir = path.join(this.root, 'raw')
    this.shotDir = path.join(this.root, 'shots')
  }
  async prepare() {
    await mkdir(this.parent, { recursive: true })
    if (path.resolve(await realpath(this.parent)).toLowerCase() !== this.parent.toLowerCase()) throw new Error('Artifact parent must not be a link')
    await mkdir(this.root) // Existing runs are immutable, including interrupted attempts.
    await mkdir(this.rawDir)
    await mkdir(this.shotDir)
    return this
  }
  scenarioPaths(scenarioId, runIndex = 1) {
    safeName(scenarioId)
    if (!Number.isInteger(runIndex) || runIndex < 1) throw new Error('Invalid run index')
    const base = scenarioId + '-r' + runIndex
    return { base, raw: path.join(this.rawDir, base + '.json'), shots: name => path.join(this.shotDir, base + '-' + safeName(name) + '.png') }
  }
  async writeRaw(id, index, payload) {
    const file = this.scenarioPaths(id, index).raw
    await writeNewJson(file, payload)
    return file
  }
  async writeShot(id, index, name, data) {
    const file = this.scenarioPaths(id, index).shots(name)
    await writeFile(file, Buffer.from(data, 'base64'), { flag: 'wx' })
    return file
  }
  async writeReport(html) {
    const file = path.join(this.root, 'report.html')
    await writeFile(file, html, { flag: 'wx' })
    return file
  }
  async writeManifest(run) {
    const file = path.join(this.root, 'manifest.json')
    await writeNewJson(file, run)
    return file
  }
  relative(file) {
    const relative = path.relative(this.root, file)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Artifact escapes run')
    return relative.split(path.sep).join('/')
  }
  async verify(run) {
    const files = [], missing = []
    for (const scenario of run.scenarios) for (const summary of scenario.runs) {
      for (const ref of [summary.rawFile, ...(summary.shots ?? []).map(shot => shot.file)].filter(Boolean)) {
        const file = path.resolve(this.root, ref)
        this.relative(file)
        try { const data = await readFile(file); files.push({ file: ref, bytes: data.length, sha256: sha256(data) }) }
        catch (error) { missing.push({ file: ref, error: error.code ?? String(error) }) }
      }
    }
    return { status: missing.length ? 'INCONCLUSIVE' : 'PASS', files, missing }
  }
}
