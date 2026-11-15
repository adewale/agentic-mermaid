import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { observe } from './worker.ts'
const args = process.argv.slice(2)
const value = (flag: string, fallback: string) => args.includes(flag) ? args[args.indexOf(flag) + 1]! : fallback
const root = resolve(value('--root', '.')), out = resolve(value('--out', '../measurements/quality'))
const features = value('--features', '').split(',').filter(Boolean)
const corpusPath = resolve(value('--corpus', '../measurements/baseline-fixed/corpus.json'))
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as Array<{ id: string; source: string; family: string }>
const verify = args.includes('--verify') ? resolve(value('--verify', '')) : undefined
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
mkdirSync(out, { recursive: true })
if (existsSync(join(out, 'protocol-0.json'))) throw Error('Refuse to overwrite quality attempt')
writeFileSync(join(out, 'corpus.json'), JSON.stringify(corpus, null, 2) + '\n')
writeFileSync(join(out, 'protocol-0.json'), JSON.stringify({ version: 3, source, features, date: new Date().toISOString(),
  mode: 'quality only; one process per configuration, no latency or memory inference from these rows',
  caches: 'engine and positioned caches disabled, text preparation enabled; compare fresh-baseline SVG bytes when --verify is supplied',
  glyphContainment: 'Raster ink bounds versus owning node bounding boxes; not full curved-shape pixel containment',
}, null, 2) + '\n')
process.env.AGENTIC_MERMAID_ELK_CACHE = '0'
process.env.AGENTIC_MERMAID_EXPERIMENTS = 'text-spans,indexed-layout'
process.env.AGENTIC_MERMAID_LAYOUT_FEATURES = features.filter(name => name !== 'fonts').join(',')
let verified = 0, different = 0
for (const item of corpus) for (const backend of ['elk', 'agentic'] as const) {
  if (backend === 'agentic' && !['flowchart', 'state', 'class', 'er', 'requirement', 'architecture'].includes(item.family)) continue
  let observation: unknown
  try { observation = await observe({ root, out: join(out, backend, 'artifacts'), features, backend, item, mode: 'quality', repetitions: 0 }) }
  catch (error) { observation = { id: item.id, backend, failure: String(error) } }
  appendFileSync(join(out, 'raw-0.jsonl'), JSON.stringify({ mode: 'quality', round: 0, source, observation }) + '\n')
  if (verify) {
    const file = item.id.replace(/[^A-Za-z0-9_-]/g, '_') + '.svg'
    const expected = join(verify, backend, 'artifacts', file), actual = join(out, backend, 'artifacts', file)
    if (existsSync(expected) && existsSync(actual)) { if (readFileSync(expected).equals(readFileSync(actual))) verified++; else different++ }
  }
  Bun.gc(true)
}
writeFileSync(join(out, 'replay.json'), JSON.stringify({ verified, different, reference: verify ?? null }) + '\n')
console.log(JSON.stringify({ out, features, verified, different }))
