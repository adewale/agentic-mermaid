import { createHash } from 'node:crypto'
import manifestJson from '../../website/source/assets/fonts/inter/manifest.json'
import { WEBSITE_INTER_UNICODE_RANGES, type WebsiteInterSubsetManifest } from './website-font-subsets.ts'

const manifest = manifestJson as unknown as WebsiteInterSubsetManifest
const originArg = process.argv.find(argument => argument.startsWith('--origin='))?.slice('--origin='.length)
const origin = (originArg || process.env.AM_SITE_ORIGIN || 'https://agentic-mermaid.dev').replace(/\/$/, '')

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function validateFontHeaders(response: Response, label: string) {
  requireCondition(response.status === 200, `${label}: expected 200, got ${response.status}`)
  requireCondition(response.headers.get('content-type')?.split(';', 1).at(0)?.trim().toLowerCase() === 'font/woff2', `${label}: expected font/woff2`)
  requireCondition(response.headers.get('cache-control') === 'public, max-age=31536000, immutable', `${label}: expected immutable Cache-Control`)
  requireCondition(!response.headers.has('set-cookie'), `${label}: Set-Cookie is forbidden`)
}

const stylesResponse = await fetch(`${origin}/styles.css`, { headers: { 'cache-control': 'no-cache' } })
requireCondition(stylesResponse.status === 200, `styles.css: expected 200, got ${stylesResponse.status}`)
requireCondition(stylesResponse.headers.get('content-type')?.split(';', 1).at(0)?.trim().toLowerCase() === 'text/css', 'styles.css: expected text/css')
const styles = await stylesResponse.text()
const referenced = Array.from(styles.matchAll(/\/fonts\/(Inter-[A-Za-z]+\.subset-[a-f0-9]{12}\.woff2)/g), match => match[1]!).sort()
requireCondition(JSON.stringify(referenced) === JSON.stringify(manifest.outputs.map(output => output.file).sort()), 'styles.css: live Inter subset URL set differs from manifest')

for (const output of manifest.outputs) {
  const subsetSource = `src: url('/fonts/${output.file}') format('woff2');`
  const fullSource = `src: url('/fonts/${output.source}') format('truetype');`
  requireCondition(styles.includes(subsetSource), `${output.file}: missing subset declaration`)
  requireCondition(styles.includes(fullSource), `${output.source}: missing unrestricted fallback declaration`)
  requireCondition(styles.includes(`unicode-range: ${WEBSITE_INTER_UNICODE_RANGES.join(', ')};`), `${output.file}: missing Unicode range`)
  const url = `${origin}/fonts/${output.file}`
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  validateFontHeaders(response, output.file)
  const bytes = new Uint8Array(await response.arrayBuffer())
  requireCondition(Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'wOF2', `${output.file}: invalid WOFF2 magic`)
  requireCondition(bytes.byteLength === output.bytes, `${output.file}: ${bytes.byteLength} != ${output.bytes} bytes`)
  requireCondition(createHash('sha256').update(bytes).digest('hex') === output.sha256, `${output.file}: SHA-256 mismatch`)
  const head = await fetch(url, { method: 'HEAD', headers: { 'cache-control': 'no-cache' } })
  validateFontHeaders(head, `${output.file} HEAD`)
  requireCondition((await head.arrayBuffer()).byteLength === 0, `${output.file} HEAD returned a body`)
}

const nonexistent = manifest.outputs[0]!.file.replace(/subset-[a-f0-9]{12}/, 'subset-000000000000')
const missing = await fetch(`${origin}/fonts/${nonexistent}`, { headers: { 'cache-control': 'no-cache' } })
requireCondition(missing.status !== 200, `${nonexistent}: nonexistent hashed font returned 200`)
requireCondition(!missing.headers.get('cache-control')?.includes('immutable'), `${nonexistent}: nonexistent hashed font is immutable`)
console.log(`Verified ${manifest.outputs.length} live content-addressed Inter subsets at ${origin}; deployed commit identity is a separate attestation`)
