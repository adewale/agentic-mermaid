import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { resolveBuildGitSha } from '../../website/build-provenance.ts'

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]! : null
}
export function driverRevision() {
  const git = (args: string[]) => execFileSync('git', args, { cwd: resolve(import.meta.dir, '../..'), encoding: 'utf8' }).trim()
  return resolveBuildGitSha({ head: git(['rev-parse', 'HEAD']), status: git(['status', '--porcelain=v1', '--untracked-files=normal']) })
}
export function benchmarkOptions(allowed: string[], required: string[]) {
  const result = new Map<string, string>()
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]!, value = process.argv[i + 1]
    if (!allowed.includes(key) || !value || value.startsWith('--') || result.has(key)) throw new Error(`Invalid option ${key}`)
    result.set(key, value)
  }
  for (const key of required) if (!result.has(key)) throw new Error(`Provide ${key}`)
  return result
}
export function positiveOption(options: Map<string, string>, key: string, fallback: number) {
  const value = Number(options.get(key) ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`)
  return value
}
/** Local, uncompressed transfer. Network shaping is deliberately outside this diagnostic. */
export async function benchmarkHost(roots: Record<string, string>, virtual: Record<string, string> = {}, inline = false) {
  const fetched = new Set<string>()
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    let bytes: string | Buffer | undefined = virtual[pathname]
    if (bytes === undefined) for (const [prefix, root] of Object.entries(roots)) {
      if (!pathname.startsWith(prefix)) continue
      const relative = pathname.slice(prefix.length)
      const file = resolve(root, './' + relative + (pathname.endsWith('/') ? 'index.html' : ''))
      if (file.startsWith(resolve(root) + sep) && existsSync(file)) {
        bytes = readFileSync(file); fetched.add(file)
      }
      break
    }
    if (bytes === undefined) { res.writeHead(404).end(); return }
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(pathname)] ?? 'text/html')
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${inline ? " 'unsafe-inline'" : ''}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'`)
    res.end(bytes)
  })
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, fetched,
    close: () => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())) }
}
