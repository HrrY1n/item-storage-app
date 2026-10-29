import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { sha256 } from './store.mjs'

const exec = promisify(execFile)
export const repoRoot = path.resolve(process.env.MOTIONLAB_APP_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function sourceFingerprint() {
  const { stdout } = await exec('git', ['--no-optional-locks', 'ls-files', 'src', 'public', 'index.html', 'package-lock.json', 'vite.config.ts'], { cwd: repoRoot, windowsHide: true })
  const names = stdout.trim().split(/\r?\n/).filter(Boolean)
  const hashes = await Promise.all(names.map(async file => file + ':' + sha256(await readFile(path.join(repoRoot, file)))))
  return sha256(hashes.join('\n'))
}
export async function availablePort(preferred = 0) {
  if (!Number.isInteger(preferred) || preferred < 0 || preferred > 65535) throw new Error('Invalid port')
  const reserve = port => new Promise((resolve, reject) => {
    const socket = createServer()
    socket.once('error', reject)
    socket.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      const chosen = socket.address().port
      socket.close(error => error ? reject(error) : resolve(chosen))
    })
  })
  try { return await reserve(preferred) }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; return reserve(0) }
}
export async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid owned PID')
  if (process.platform !== 'win32') throw new Error('BLOCKED: process verification requires Windows')
  const script = '$p=Get-CimInstance Win32_Process -Filter "ProcessId = ' + pid + '"; if($p){[pscustomobject]@{pid=$p.ProcessId;exe=$p.ExecutablePath;command=$p.CommandLine;created=$p.CreationDate.ToUniversalTime().ToString("o")}|ConvertTo-Json -Compress}'
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 })
  return stdout.trim() ? JSON.parse(stdout) : null
}
export function assertIdentity(actual, expected) {
  if (!actual || actual.pid !== expected.pid || !actual.command || !actual.exe) throw new Error('BLOCKED: owned process is not identifiable')
  if (expected.created && actual.created !== expected.created) throw new Error('BLOCKED: owned PID was reused')
  const command = new Set((actual.command.match(/(?:[^\s"]|"[^"]*")+/g) ?? []).map(value => value.replaceAll('"', '').toLowerCase().replaceAll('\\', '/')))
  for (const token of expected.tokens)
    if (!command.has(token.toLowerCase().replaceAll('\\', '/'))) throw new Error('BLOCKED: process command mismatch')
  return actual
}
async function verifyOwned(expected, port) {
  const actual = assertIdentity(await processIdentity(expected.pid), expected)
  const script = '@(Get-NetTCPConnection -State Listen -LocalPort ' + port + ' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) | ConvertTo-Json -Compress'
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 })
  const value = stdout.trim() ? JSON.parse(stdout) : []
  const owners = Array.isArray(value) ? value : [value]
  if (owners.length !== 1 || owners[0] !== expected.pid) throw new Error('BLOCKED: port does not belong to this process')
  return actual
}
async function npmRun(script, args) {
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  return exec(process.execPath, [npm, 'run', script, '--', ...args], { cwd: repoRoot, windowsHide: true, env: { ...process.env, npm_config_cache: path.join(repoRoot,'.tmp/npm-cache'), npm_config_offline:'true', npm_config_update_notifier:'false' }, timeout: 45000, maxBuffer: 1024 * 1024 })
}
async function waitFor(operation, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { return await operation() } catch (error) { last = error }
    await sleep(150)
  }
  throw last ?? new Error('Owned service readiness timed out')
}
export async function cleanupResources(resources) {
  return Promise.all(resources.filter(Boolean).map(async resource => {
    try { return { resource: resource.name, status: 'PASS', detail: await resource.stop() } }
    catch (error) { return { resource: resource.name, status: 'INCONCLUSIVE', error: String(error) } }
  }))
}
export async function ensureDevServer({ port = 5173, log = () => {} } = {}) {
  const chosen = await availablePort(port)
  const nonce = randomUUID()
  const script = fileURLToPath(new URL('./dev-server.mjs', import.meta.url))
  const child = spawn(process.execPath, [script, String(chosen), nonce], { cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  child.stdout.on('data', () => {})
  child.on('error', error => { stderr += String(error) })
  const expected = { pid: child.pid, tokens: [script, nonce] }
  const baseUrl = 'http://127.0.0.1:' + chosen
  const stop = async () => {
    if (child.exitCode !== null) return 'already exited'
    const exited = new Promise(resolve => child.once('exit', resolve))
    // The private IPC handle identifies our child even if CIM is unavailable.
    for (let attempt = 0; attempt < 30 && child.exitCode === null; attempt++) {
      if (child.connected) child.send('stop', () => {})
      await Promise.race([exited, sleep(150)])
    }
    if (child.exitCode === null && await processIdentity(child.pid)) {
      assertIdentity(await processIdentity(child.pid), expected)
      child.kill()
      await Promise.race([exited, sleep(3000)])
    }
    if (await processIdentity(child.pid)) throw new Error('Owned dev server still running')
    return 'owned child stopped'
  }
  try {
    const identity = assertIdentity(await processIdentity(child.pid), expected)
    expected.created = identity.created
    const fingerprint = await sourceFingerprint()
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error('Vite exited: ' + stderr)
      await verifyOwned(expected, chosen)
      const response = await fetch(baseUrl + '/__motionlab/identity', { redirect: 'error', signal: AbortSignal.timeout(2500) })
      const data = await response.json()
      if (data.nonce !== nonce || data.pid !== child.pid || path.resolve(data.root) !== repoRoot || data.fingerprint !== fingerprint) throw new Error('BLOCKED: source identity mismatch')
      return data
    })
    log('已验证独立开发服务 ' + baseUrl + ' pid=' + child.pid)
    return { name: 'dev', baseUrl, identity: { ...identity, root: repoRoot, fingerprint, port: chosen }, stop }
  } catch (error) {
    try { error.cleanup = [{ resource: 'dev-startup', status: 'PASS', detail: await stop() }] }
    catch (cleanupError) { error.cleanup = [{ resource: 'dev-startup', status: 'INCONCLUSIVE', error: String(cleanupError) }] }
    throw error
  }
}
export async function ensureEdge({ port = 9225, log = () => {} } = {}) {
  const chosen = await availablePort(port)
  const profile = path.join(repoRoot, '.tmp', 'edge-test-profile-' + chosen)
  const pidFile = path.join(repoRoot, '.tmp', 'edge-test-' + chosen + '.pid.json')
  // Never connect to an occupied port, even if an old PID file appears plausible.
  await npmRun('browser:start', ['--port=' + chosen, '--profile=' + profile])
  const record = JSON.parse(await readFile(pidFile, 'utf8'))
  const expected = { pid: record.pid, tokens: ['--remote-debugging-port=' + chosen, '--user-data-dir=' + profile,
    '--disable-sync', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-features=ImportOnEachLaunch'] }
  const stop = async () => {
    const actual = await processIdentity(expected.pid)
    if (!actual) return 'already exited'
    assertIdentity(actual, expected)
    const current = JSON.parse(await readFile(pidFile, 'utf8'))
    if (current.pid !== record.pid || current.port !== chosen || path.resolve(current.profile) !== profile) throw new Error('BLOCKED: PID record changed')
    await npmRun('browser:stop', ['--port=' + chosen])
    await waitFor(async () => { if (await processIdentity(expected.pid)) throw new Error('Owned Edge still running'); return true }, 10000)
    return 'launcher stopped owned PID'
  }
  try {
    if (record.port !== chosen || path.resolve(record.profile) !== profile) throw new Error('BLOCKED: launcher identity mismatch')
    const identity = assertIdentity(await processIdentity(record.pid), expected)
    expected.created = identity.created
    await verifyOwned(expected, chosen)
    const cdpBase = 'http://127.0.0.1:' + chosen
    const response = await fetch(cdpBase + '/json/version', { redirect: 'error', signal: AbortSignal.timeout(3000) })
    const version = await response.json()
    const socket = new URL(version.webSocketDebuggerUrl)
    if (socket.hostname !== '127.0.0.1' || Number(socket.port) !== chosen) throw new Error('BLOCKED: unexpected CDP endpoint')
    log('已验证项目隔离 Edge port=' + chosen + ' pid=' + record.pid)
    return { name: 'edge', cdpBase, port: chosen, verifyOwnership: () => verifyOwned(expected, chosen),
      identity: { ...identity, profile, port: chosen, args: record.args, browser: version.Browser, protocol: version['Protocol-Version'] }, stop }
  } catch (error) { await stop(); throw error }
}
export async function ensureEnvironment({ port = 9225, devPort = 5173, log } = {}) {
  const resources = []
  try {
    const dev = await ensureDevServer({ port: devPort, log })
    resources.push(dev)
    const edge = await ensureEdge({ port, log })
    resources.push(edge)
    return { cdpBase: edge.cdpBase, baseUrl: dev.baseUrl, port: edge.port, verifyOwnership: edge.verifyOwnership,
      metadata: { browser: edge.identity, dev: dev.identity, node: process.version, os: { platform: process.platform, release: os.release(), arch: os.arch() }, fingerprint: dev.identity.fingerprint },
      cleanup: () => cleanupResources(resources) }
  } catch (error) { error.cleanup = [...(error.cleanup ?? []), ...await cleanupResources(resources)]; throw error }
}
