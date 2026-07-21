import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const PUBLIC = join(ROOT, 'website', 'public')
const originArg = process.argv.find(argument => argument.startsWith('--origin='))?.slice('--origin='.length)
const CANONICAL_ORIGIN = 'https://agentic-mermaid.dev'
const origin = (originArg || process.env.AM_SITE_ORIGIN || CANONICAL_ORIGIN).replace(/\/$/, '')

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function essence(response: Response) {
  return response.headers.get('content-type')?.split(';', 1).at(0)?.trim().toLowerCase() || ''
}
function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}
async function live(path: string, expectedType: string, immutable = false) {
  const response = await fetch(origin + path, { headers: { 'cache-control': 'no-cache' } })
  requireCondition(response.status === 200, `${path}: expected 200, got ${response.status}`)
  requireCondition(essence(response) === expectedType, `${path}: expected ${expectedType}, got ${essence(response)}`)
  requireCondition(!response.headers.has('set-cookie'), `${path}: Set-Cookie is forbidden`)
  if (immutable) requireCondition(response.headers.get('cache-control') === 'public, max-age=31536000, immutable', `${path}: expected immutable caching`)
  return response
}

const localIndex = readFileSync(join(PUBLIC, 'examples', 'index.html'), 'utf8')
const expectedAssets = Array.from(localIndex.matchAll(/(?:href|src)="\/(examples-[a-f0-9]{12}\.(?:css|js))"|data-example-fragment="\/(examples\/fragments\/(?:style-palette|corpus)-[a-f0-9]{12}\.html)"/g))
  .map(match => match[1] || match[2])
  .filter((asset): asset is string => Boolean(asset))
  .sort()
requireCondition(expectedAssets.length === 4, `local Examples index exposes ${expectedAssets.length} hashed assets, expected 4`)

const indexResponse = await live('/examples/', 'text/html')
const liveIndex = await indexResponse.text()
for (const asset of expectedAssets) requireCondition(liveIndex.includes(`/${asset}`), `/examples/: missing ${asset}`)
requireCondition(!liveIndex.includes('<article class="example-sample" id="style-palette-flowchart"'), '/examples/: Style × Palette payload is eager')
requireCondition(!liveIndex.includes('<article class="example-sample" id="rich-agentic-mermaid"'), '/examples/: corpus payload is eager')

for (const route of ['/examples/style-palette/', '/examples/corpus/']) {
  const response = await live(route, 'text/html')
  const html = await response.text()
  requireCondition(html.includes(`<link rel="canonical" href="${CANONICAL_ORIGIN}${route}">`), `${route}: canonical metadata mismatch`)
  requireCondition(html.includes('<article class="example-sample"'), `${route}: missing server-rendered examples`)
}

for (const asset of expectedAssets) {
  const path = `/${asset}`
  const expectedType = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html'
  const response = await live(path, expectedType, true)
  if (asset.includes('/fragments/')) requireCondition(response.headers.get('x-robots-tag') === 'noindex, nofollow', `${path}: missing X-Robots-Tag`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const local = new Uint8Array(readFileSync(join(PUBLIC, asset)))
  requireCondition(bytes.byteLength === local.byteLength && digest(bytes) === digest(local), `${path}: live bytes differ from local output`)
  requireCondition(asset.includes(digest(bytes).slice(0, 12)), `${path}: filename digest mismatch`)
  const head = await fetch(origin + path, { method: 'HEAD', headers: { 'cache-control': 'no-cache' } })
  requireCondition(head.status === 200 && essence(head) === expectedType, `${path} HEAD: status/MIME mismatch`)
  requireCondition(head.headers.get('cache-control') === 'public, max-age=31536000, immutable', `${path} HEAD: expected immutable caching`)
  requireCondition((await head.arrayBuffer()).byteLength === 0, `${path} HEAD returned a body`)
}

for (const missingPath of [
  '/examples-000000000000.js',
  '/examples-000000000000.css',
  '/examples/fragments/corpus-000000000000.html',
]) {
  const response = await fetch(origin + missingPath, { headers: { 'cache-control': 'no-cache' } })
  requireCondition(response.status !== 200, `${missingPath}: nonexistent hash returned 200`)
  requireCondition(!response.headers.get('cache-control')?.includes('immutable'), `${missingPath}: nonexistent hash is immutable`)
}
console.log(`Verified live standalone/deferred Examples delivery at ${origin}; deployed commit identity is a separate attestation`)
