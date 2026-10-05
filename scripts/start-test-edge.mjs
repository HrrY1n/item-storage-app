import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

function option(name, fallback) {
  const prefix = `--${name}=`
  const found = args.find((value) => value.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

function positivePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid --port: ${value}`)
  }
  return port
}

async function exists(file) {
  try {
    await access(file, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function waitForCdp(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'not ready'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error.message
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Edge CDP did not become ready on ${port}: ${lastError}`)
}

async function findEdge() {
  const configured = option('edge', process.env.EDGE_PATH)
  const candidates = [
    configured,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'msedge.exe',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (candidate === 'msedge.exe' || await exists(candidate)) return candidate
  }
  throw new Error('Microsoft Edge executable was not found; pass --edge=<path>.')
}

const port = positivePort(option('port', process.env.EDGE_TEST_PORT ?? '9222'))
const profileArg = option('profile', process.env.EDGE_TEST_PROFILE ?? `.tmp/edge-test-profile-${port}`)
const profile = path.resolve(root, profileArg)
const projectTmp = path.resolve(root, '.tmp')
const profileRelative = path.relative(projectTmp, profile)
if (!profileRelative || profileRelative.startsWith('..') || path.isAbsolute(profileRelative)) {
  throw new Error(`Refusing a test profile outside ${projectTmp}.`)
}
const pidFile = path.join(root, '.tmp', `edge-test-${port}.pid.json`)

if (await exists(pidFile)) {
  try {
    const previous = JSON.parse(await readFile(pidFile, 'utf8'))
    if (Number.isInteger(previous.pid) && await alive(previous.pid)) {
      throw new Error(`Test Edge is already running (pid ${previous.pid}, port ${port}).`)
    }
  } catch (error) {
    if (error.message.includes('already running')) throw error
  }
  await unlink(pidFile).catch(() => {})
}

await mkdir(profile, { recursive: true })
await mkdir(path.dirname(pidFile), { recursive: true })
const executable = await findEdge()
const edgeArgs = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${profile}`,
  '--profile-directory=Default',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-features=ImportOnEachLaunch',
  '--password-store=basic',
  'about:blank',
]

const child = spawn(executable, edgeArgs, {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
})
if (!child.pid) throw new Error('Edge process did not start.')
child.unref()

const record = {
  pid: child.pid,
  port,
  profile,
  executable,
  args: edgeArgs,
  started_at: new Date().toISOString(),
}
await writeFile(pidFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8')

try {
  const version = await waitForCdp(port)
  console.log(JSON.stringify({ ...record, cdp: version }, null, 2))
} catch (error) {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {}
  }
  await unlink(pidFile).catch(() => {})
  throw error
}
