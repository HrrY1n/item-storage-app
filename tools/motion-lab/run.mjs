#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { ensureEnvironment, repoRoot } from './src/env.mjs'
import { openMotionPage } from './src/page.mjs'
import { summarize, finalizeSummary, combineStatus } from './src/metrics.mjs'
import { ArtifactStore, motionLabRoot, newRunId, safeName, sha256 } from './src/store.mjs'
import { findScenarios } from './src/scenarios/index.mjs'
import { compareRun, saveRunBaseline } from './src/baseline.mjs'
import { renderReport } from './src/report.mjs'

export function parseArgs(argv) {
  const options = { scenario: ['all'], repeat: 1, port: 9225, devPort: 5173, runId: newRunId(), saveBaseline: false, compare: false, html: true, accept: true }
  for (const arg of argv) {
    if (arg.startsWith('--scenario=')) options.scenario = arg.slice(11).split(',')
    else if (arg.startsWith('--repeat=')) options.repeat = Number(arg.slice(9))
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice(7))
    else if (arg.startsWith('--dev-port=')) options.devPort = Number(arg.slice(11))
    else if (arg.startsWith('--out=')) options.runId = safeName(arg.slice(6))
    else if (arg.startsWith('--baseline=')) { options.baselineId = safeName(arg.slice(11)); options.compare = true }
    else if (arg === '--save-baseline') options.saveBaseline = true
    else if (arg === '--compare') options.compare = true
    else if (arg === '--no-report' || arg === '--no-html') options.html = false
    else if (arg === '--diagnostic') options.accept = false
    else if (arg === '--accept') options.accept = true
    else throw new Error('Unknown argument: ' + arg)
  }
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 100) throw new Error('repeat must be 1..100')
  for (const port of [options.port, options.devPort]) if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port must be 1024..65535')
  return options
}
export const exitCodeFor = (status, accept = true) => status === 'FAIL' ? 1 : status === 'INCONCLUSIVE' && accept ? 2 : 0

async function sourceMetadata(env) {
  const files = []
  const collect = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await collect(full)
      else if (entry.name.endsWith('.mjs')) files.push(full)
    }
  }
  await collect(path.join(motionLabRoot, 'src'))
  files.push(fileURLToPath(import.meta.url))
  files.sort()
  const hashes = await Promise.all(files.map(async file => path.relative(motionLabRoot, file) + ':' + sha256(await readFile(file))))
  const git = args => execFileSync('git', ['--no-optional-locks', ...args], { cwd: repoRoot, windowsHide: true, stdio: ['ignore','pipe','pipe'] }).toString().trim()
  return { commit: git(['rev-parse', 'HEAD']), modifiedTrackedFiles: git(['diff', '--name-only']).split(/\r?\n/).filter(Boolean),
    appFingerprint: env.metadata.fingerprint, toolFingerprint: sha256(hashes.join('\n')) }
}

export async function runScenarioOnce(scenario, runIndex, env, store, { onPage = () => {}, log = console.log, configurePage } = {}) {
  const startedAt = new Date().toISOString()
  let page, result, error, cleanup
  let runtimeExceptions = []
  const failureShots = []
  try {
    page = await openMotionPage(env)
    onPage(page)
    await page.setViewport(scenario.viewport ?? { width: 390, height: 844, dpr: 2 })
    await page.setReducedMotion(scenario.media?.reducedMotion === true)
    await page.setColorScheme(scenario.media?.colorScheme ?? 'light')
    await configurePage?.(page)
    result = await scenario.run({ page, store, runIndex, log })
  } catch (caught) {
    error = caught
    if (page && !page.session.closed) {
      try { failureShots.push(await page.screenshot('failure')) } catch {}
      try { if (!page.lastRecord) page.lastRecord = await page.ev('window.__ml?.partial()') } catch {}
    }
  } finally {
    if (page) {
      runtimeExceptions = [...page.exceptions.map(detail => detail.exception?.description ?? detail.text ?? JSON.stringify(detail)), ...page.session.errors]
      cleanup = await page.disposeContext()
    }
    onPage(null)
  }
  const record = result?.record ?? page?.lastRecord ?? null
  let summary = record ? summarize(record, scenario.spec) : { frames: 0, anomalies: [], primary: null, secondary: {}, series: {}, status: 'INCONCLUSIVE' }
  if (error) {
    summary.crashed = String(error.stack ?? error)
    summary.anomalies.push({ level: /not actionable|blocked or outside|did not accept/.test(String(error)) ? 'error' : 'inconclusive',
      code: 'scenario-crashed', message: String(error.message ?? error) })
  }
  if (!result?.checks?.length) summary.anomalies.push({ level: 'inconclusive', code: 'missing-checks', message: '缺少功能终态断言' })
  const shots = []
  for (const shot of [...(result?.shots ?? []), ...failureShots]) {
    const file = await store.writeShot(scenario.id, runIndex, shot.name, shot.data)
    shots.push({ name: shot.name, file: store.relative(file), still: shot.still ?? null })
  }
  summary = finalizeSummary(summary, { checks: (result?.checks ?? []).map(check => ({ ...check, pass: Boolean(check.pass) })),
    exceptions: runtimeExceptions,
    shots, network: page?.blocked ?? [], cleanup })
  summary.runIndex = runIndex
  summary.scenarioId = scenario.id
  summary.notes = result?.notes ?? []
  summary.contextCleanup = cleanup ?? error?.cleanup ?? { status: 'INCONCLUSIVE' }
  summary.rawFile = store.relative(store.scenarioPaths(scenario.id, runIndex).raw)
  await store.writeRaw(scenario.id, runIndex, { scenario: { id: scenario.id, title: scenario.title }, runIndex, startedAt, summary, record,
    network: { policy: page?.policy, blocked: page?.blocked ?? [], requests: page?.requests ?? [] },
    faultInjection: page?.faultEvidence ?? null, waitFailure: page?.waitFailure ?? null, cleanup: summary.contextCleanup })
  log(scenario.id + ' r' + runIndex + ': ' + summary.status + ', samples=' + summary.frames)
  return summary
}

export async function runLab(options, { environment, scenarioList, configurePage, log = console.log } = {}) {
  const store = await new ArtifactStore(options.runId).prepare()
  const list = scenarioList ?? findScenarios(options.scenario)
  const run = { runId: options.runId, startedAt: new Date().toISOString(), options: { ...options, scenario: list.map(scene => scene.id) }, scenarios: [], cleanup: [] }
  let env = environment, activePage, interrupted = false
  const signal = () => { interrupted = true; activePage?.ev('window.__ml?.cancel()').catch(() => {}) }
  process.on('SIGINT', signal)
  process.on('SIGTERM', signal)
  try {
    env ??= await ensureEnvironment({ port: options.port, devPort: options.devPort, log })
    run.env = { ...env.metadata, baseUrl: env.baseUrl, port: env.port }
    run.source = await sourceMetadata(env)
    for (const scenario of list) {
      if (interrupted) break
      const runs = []
      for (let index = 1; index <= options.repeat && !interrupted; index++) {
        const summary = await runScenarioOnce(scenario, index, env, store, { configurePage, log, onPage: page => { activePage = page } })
        runs.push(summary)
        if (summary.anomalies.some(a => a.code === 'network-blocked')) { interrupted = true; break }
      }
      run.scenarios.push({ id: scenario.id, title: scenario.title, description: scenario.description, spec: scenario.spec, runs })
    }
  } catch (error) {
    run.startupError = String(error.stack ?? error)
    run.cleanup.push(...(error.cleanup ?? []))
    log(run.startupError)
  } finally {
    if (env && !environment) run.cleanup.push(...await env.cleanup())
    if (environment) run.cleanup.push({ resource: 'outer-owned-environment', status: 'PASS', detail: 'contexts disposed per run; outer validation harness owns final server cleanup' })
    process.removeListener('SIGINT', signal)
    process.removeListener('SIGTERM', signal)
  }
  run.interrupted = interrupted
  run.integrity = await store.verify(run)
  let comparison = null
  if (options.compare && !run.startupError) {
    try { comparison = await compareRun(run, { baselineId: options.baselineId, log }) }
    catch (error) { comparison = { status: 'INCONCLUSIVE', scenarios: [], note: String(error) } }
  }
  run.comparison = comparison
  run.status = combineStatus([...run.scenarios.flatMap(scene => scene.runs.map(summary => summary.status)), run.integrity.status,
    ...run.cleanup.map(result => result.status), ...(comparison ? [comparison.status] : []),
    ...((run.startupError || interrupted || run.scenarios.length !== list.length) ? ['INCONCLUSIVE'] : [])])
  if (options.saveBaseline) {
    try {
      if (run.status !== 'PASS') throw new Error('Refusing candidate baseline for non-PASS suite')
      run.candidateBaseline = await saveRunBaseline(run, { log })
    } catch (error) { run.baselineError = String(error); run.status = combineStatus([run.status, 'INCONCLUSIVE']) }
  }
  if (options.html) {
    const shotsBase64 = new Map(), records = new Map()
    for (const scene of run.scenarios) {
      const first = scene.runs.find(summary => summary.shots.length)
      for (const shot of first?.shots ?? []) shotsBase64.set(shot.file, (await readFile(path.join(store.root, shot.file))).toString('base64'))
      for (const summary of scene.runs) records.set(scene.id + '-r' + summary.runIndex, JSON.parse(await readFile(path.join(store.root, summary.rawFile), 'utf8')))
    }
    const reportFile = await store.writeReport(renderReport(run, comparison, { shotsBase64, records }))
    // 指向本次实际生成的报告，供 open-report.cmd 打开"最新"而非历史报告。
    await writeFile(path.join(motionLabRoot, 'artifacts', 'latest-report.txt'), reportFile, 'utf8')
  }
  run.exitCode = exitCodeFor(run.status, options.accept)
  await store.writeManifest(run)
  log('MotionLab ' + run.status + ' exit=' + run.exitCode + ' ' + store.root)
  return { run, store }
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { const { run } = await runLab(parseArgs(process.argv.slice(2))); process.exitCode = run.exitCode }
  catch (error) { console.error(error); process.exitCode = 2 }
}
