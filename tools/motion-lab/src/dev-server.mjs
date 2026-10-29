import { createServer } from 'vite'
import { repoRoot, sourceFingerprint } from './env.mjs'

const [portArg, nonce] = process.argv.slice(2)
if (!Number.isInteger(Number(portArg)) || !nonce) throw new Error('Missing owned server identity')
const csp = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
const server = await createServer({
  root: repoRoot, cacheDir: repoRoot + '/node_modules/.cache/motion-lab-vite',
  server: { host: '127.0.0.1', port: Number(portArg), strictPort: true, hmr: false,
    headers: { 'Content-Security-Policy': csp },
    watch: { ignored: ['**/tools/motion-lab/artifacts/**', '**/tools/motion-lab/reports/**'] } },
  plugins: [{
    name: 'motion-lab-owned-source',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__motionlab/identity') return next()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ nonce, pid: process.pid, root: process.cwd(), fingerprint: await sourceFingerprint() }))
      })
    },
  }],
})
await server.listen()
process.on('message', async message => { if (message === 'stop') { await server.close(); process.exit(0) } })
process.once('disconnect', async () => { await server.close(); process.exit(0) })
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0) })
