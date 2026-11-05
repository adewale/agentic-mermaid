/** Separate retained-memory lane; never run concurrently with paired latency. */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { cpus, platform, release } from 'node:os'
import { pathToFileURL } from 'node:url'
import { variants } from './configs.ts'
import type { RenderOptions } from '../../src/types.ts'
import { assertLocalMeasurement } from '../trident/prepare.ts'

assertLocalMeasurement()

if (process.argv.includes('--child')) {
  const input = JSON.parse(readFileSync(0, 'utf8')) as { root: string; mode: string; features: string[]; backend: 'elk' | 'agentic'; item: { id: string; source: string } }
  const png = input.mode.startsWith('png')
  const beforeImport = process.memoryUsage(), begin = performance.now()
  const api = await import(pathToFileURL(join(input.root, png ? 'dist/agent.js' : 'dist/index.js')).href)
  const renderer = png ? api.createMermaidPNGRenderer() : api.createMermaidRenderer()
  const importMs = performance.now() - begin, afterImport = process.memoryUsage()
  const options: RenderOptions = { security: 'strict', embedFontImport: false,
    ...(input.features.includes('fonts') ? { fontMetrics: 'bundled-inter' } : {}),
    graphLayout: { backend: input.backend, fallback: input.backend === 'agentic' ? 'elk' : 'none',
      ...(input.features.includes('elk-order') && input.backend === 'elk' || input.features.includes('ports') && input.backend === 'agentic' ? { quality: 'balanced' } : {}),
      ...(input.features.includes('wrap') ? { viewport: { width: 800, height: 600 } } : {}),
    },
  }
  let held: { svg?: string; png?: Uint8Array; receipt: unknown } | undefined, sink = 0, failure: string | undefined
  const render = () => {
    held = png ? renderer.renderMermaidPNGWithReceipt(input.item.source, options) : renderer.renderMermaidSVGWithReceipt(input.item.source, options)
    if (held!.png) {
      for (const byte of held!.png) sink = (sink + byte) >>> 0
      sink ^= JSON.stringify(held!.receipt).length
    } else sink ^= JSON.stringify(held).length
  }
  const first = performance.now()
  try { render() } catch (error) { failure = String(error) }
  const firstMs = performance.now() - first, outputHeld = process.memoryUsage()
  if (!failure) try { for (let i = 0; i < (png ? 4 : 12); i++) render() } catch (error) { failure = String(error) }
  const warmedOutputHeld = process.memoryUsage()
  Bun.gc(true)
  const heldAfterGc = process.memoryUsage()
  held = undefined
  Bun.gc(true)
  const releasedAfterGc = process.memoryUsage()
  console.log(JSON.stringify({ id: input.item.id, backend: input.backend, features: input.features, failure, importMs, firstMs,
    beforeImport, afterImport, outputHeld, warmedOutputHeld, heldAfterGc, releasedAfterGc, resourceUsage: process.resourceUsage(), sink }))
} else {
  const args = process.argv.slice(2)
  const value = (flag: string, fallback: string) => args.includes(flag) ? args[args.indexOf(flag) + 1]! : fallback
  const baseline = resolve(value('--baseline', '../baseline')), head = resolve(value('--head', '../cache-stage'))
  const out = resolve(value('--out', '../measurements/warm-memory'))
  const corpus = JSON.parse(readFileSync(resolve(value('--corpus', '../measurements/baseline-fixed/corpus.json')), 'utf8')) as Array<{ id: string; family: string; source: string }>
  const revision = (root: string) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  mkdirSync(out, { recursive: true })
  if (existsSync(join(out, 'protocol.json'))) throw Error('Refuse to overwrite warmed memory attempt')
  const memoryCohort = ['campaign/digits', 'regression/mfa-login', 'contact-sheet/L', 'scaling/64']
  const pngCohort = ['campaign/digits', 'regression/mfa-login', 'contact-sheet/L']
  writeFileSync(join(out, 'protocol.json'), JSON.stringify({ version: 1, baseline: revision(baseline), head: revision(head), harnessRevision: revision(resolve(import.meta.dir, '../..')),
    date: new Date().toISOString(), bun: Bun.version, environment: { os: platform() + ' ' + release(), cpu: cpus()[0]?.model }, variants, rounds: 3,
    modes: ['memory-warm', 'png-memory-warm'], memoryCohort, pngCohort,
    method: 'Additional lane declared after the initial campaign revealed the cache penalty. Same frozen corpus and controls; fresh default-cache children, first render then 12 additional SVG / 4 additional PNG calls matching latency invocation counts. Fully consumed output, then held/released GC snapshots. No PNG dimension-inspection Buffer is retained. Product caches/modules remain alive. Not cache saturation.',
    uncertainty: 'Observed A/A controls plus 3% practical floor; no repeat-until-win. Keep separate from first-call memory and latency lanes.' }, null, 2) + '\n')
  for (const mode of ['memory-warm', 'png-memory-warm']) for (let round = 0; round < 3; round++) {
    for (const item of corpus.filter(item => (mode.startsWith('png') ? pngCohort : memoryCohort).includes(item.id))) for (const backend of ['elk', 'agentic'] as const) {
      const rotated = [...variants.slice(round), ...variants.slice(0, round)]
      for (const variant of [{ id: 'baseline', features: [], phase: 'control-before' }, ...rotated.map(v => ({ ...v, phase: 'feature' })), { id: 'baseline', features: [], phase: 'control-after' }]) {
        const root = variant.id === 'baseline' ? baseline : head, begin = performance.now()
        const result = spawnSync(process.execPath, [import.meta.path, '--child'], { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
          input: JSON.stringify({ root, mode, item, backend, features: variant.features }),
          env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: '1', AGENTIC_MERMAID_EXPERIMENTS: 'text-spans,indexed-layout,position-cache', AGENTIC_MERMAID_LAYOUT_FEATURES: variant.features.filter(f => f !== 'fonts').join(',') },
        })
        let observation: unknown
        try { observation = JSON.parse(result.stdout.trim().split('\n').at(-1)!) } catch { observation = { failure: String(result.error ?? result.stderr ?? result.stdout) } }
        appendFileSync(join(out, 'raw.jsonl'), JSON.stringify({ mode, round, phase: variant.phase, variant: variant.id, id: item.id, backend, elapsedMs: performance.now() - begin, status: result.status, observation, stderr: result.stderr || undefined }) + '\n')
      }
    }
    console.log(`${mode}: round ${round + 1}/3`)
  }
}
