import { readFile, unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const portArg = args.find((value) => value.startsWith('--port='))
const port = Number((portArg ? portArg.slice('--port='.length) : process.env.EDGE_TEST_PORT) ?? '9222')
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid --port: ${port}`)
const pidFile = path.join(root, '.tmp', `edge-test-${port}.pid.json`)
const projectTmp = path.resolve(root, '.tmp')

let record
try {
  record = JSON.parse(await readFile(pidFile, 'utf8'))
} catch {
  console.log(JSON.stringify({ stopped: false, reason: 'no pid file', port }))
  process.exit(0)
}

const recordedProfile = path.resolve(String(record.profile ?? ''))
const profileRelative = path.relative(projectTmp, recordedProfile)
if (!Number.isInteger(record.pid) || record.port !== port || !profileRelative || profileRelative.startsWith('..') || path.isAbsolute(profileRelative)) {
  throw new Error('Refusing to stop an untrusted or non-project Edge process record.')
}

if (process.platform === 'win32') {
  try {
    execFileSync('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } catch (error) {
    if (error.status !== 128 && error.status !== 1) throw error
  }
} else {
  try { process.kill(record.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
}

await unlink(pidFile).catch(() => {})
console.log(JSON.stringify({ stopped: true, pid: record.pid, port, profile: record.profile }, null, 2))
