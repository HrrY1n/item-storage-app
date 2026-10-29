import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { ArtifactStore, safeName, newRunId, motionLabRoot } from '../src/store.mjs'
import { availablePort, assertIdentity, cleanupResources } from '../src/env.mjs'
import { allowedRequest, createIsolatedPage } from '../src/cdp.mjs'

test('F17 names reject traversal, separators and reserved Windows paths', () => {
  for (const value of ['../x', 'x/y', 'x\\y', 'C:x', '', 'CON', '.hidden']) assert.throws(() => safeName(value))
  assert.equal(safeName('audit-01'), 'audit-01')
  assert.notEqual(newRunId(), newRunId())
})
test('F17 existing output and files are never overwritten', async () => {
  const parent = path.resolve(motionLabRoot, '../../.tmp/motion-lab-tests')
  await mkdir(parent, { recursive: true })
  const name = newRunId('store')
  const store = await new ArtifactStore(name, parent).prepare()
  await store.writeRaw('sample', 1, { sentinel: true })
  await assert.rejects(() => new ArtifactStore(name, parent).prepare(), /EEXIST/)
  await assert.rejects(() => store.writeRaw('sample', 1, { sentinel: false }), /EEXIST/)
  assert.deepEqual(JSON.parse(await readFile(store.scenarioPaths('sample').raw)), { sentinel: true })
})
test('F07 occupied unknown HTTP service is neither contacted nor reused', async () => {
  let requests = 0
  const server = createServer((req, res) => { requests++; res.end('{}') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    assert.notEqual(await availablePort(server.address().port), server.address().port)
    assert.equal(requests, 0)
    assert.equal(server.listening, true)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
test('F07 stale PID, command and creation identity are rejected', () => {
  const actual = { pid: 10, exe: 'node.exe', command: '"node.exe" owned.mjs token', created: 'today' }
  assertIdentity(actual, { pid: 10, tokens: ['owned.mjs', 'token'], created: 'today' })
  assert.throws(() => assertIdentity(actual, { pid: 11, tokens: [] }))
  assert.throws(() => assertIdentity(actual, { pid: 10, tokens: ['other.mjs'] }))
  assert.throws(() => assertIdentity(actual, { pid: 10, tokens: [], created: 'yesterday' }))
})
test('F16 all resource cleanup continues after one failure', async () => {
  let second = false
  const results = await cleanupResources([
    { name: 'first', stop() { throw new Error('expected') } },
    { name: 'second', async stop() { second = true; return 'done' } },
  ])
  assert.equal(second, true)
  assert.deepEqual(results.map(result => result.status), ['INCONCLUSIVE', 'PASS'])
})
test('network allowlist denies API, remote and wrong local ports before navigation', async () => {
  const base = 'http://127.0.0.1:5555'
  assert.equal(allowedRequest(base + '/src/main.tsx', base), true)
  for (const url of ['https://example.invalid/', base + '/api/sync/push', 'http://127.0.0.1:5556/', 'file:///C:/secret', 'ws://example.invalid/'])
    assert.equal(allowedRequest(url, base), false)
  await assert.rejects(() => createIsolatedPage(base), /ownership/)
})
