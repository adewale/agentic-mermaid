import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { knownStyles } from '../src/index.ts'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'

interface Spec { source: string; style?: string }
const [mode, ...args] = process.argv.slice(2)
let corpus: Spec[]
let output: string
if (mode === 'families' && args[0]) {
  output = args[0]
  corpus = BUILTIN_FAMILY_METADATA.flatMap(family => {
    let source = readFileSync(resolve(import.meta.dir, '..', 'eval/layout-compare/fixtures', `${family.id}-basic.mmd`), 'utf8')
    // The default Sankey fixture uses gradients, explicitly outside version 1.
    // Exercise its solid-color mode; refusal of gradients has its own unit test.
    if (family.id === 'sankey') source = `---\nconfig:\n  sankey:\n    linkColor: source\n---\n${source}`
    return [undefined, ...knownStyles()].map(style => ({ source, ...(style ? { style } : {}) }))
  })
} else if (mode === 'rayner' && args[0] && args[1]) {
  output = args[1]
  const files = new Bun.Glob('**/*.snapshots/*.json').scanSync({ cwd: resolve(args[0], 'scenes'), absolute: true })
  const unique = new Map<string, Spec>()
  for (const file of [...files].sort()) {
    if (file.endsWith('/index.json')) continue
    const spec = JSON.parse(readFileSync(file, 'utf8')).spec as Spec
    unique.set(JSON.stringify(spec), spec)
  }
  corpus = [...unique.values()]
} else {
  throw new Error('usage: resolved-scene-corpus.ts families output.json | rayner /path/to/rayner output.json')
}
writeFileSync(output, JSON.stringify(corpus, null, 2) + '\n')
console.log(`${corpus.length} diagrams → ${output}`)
