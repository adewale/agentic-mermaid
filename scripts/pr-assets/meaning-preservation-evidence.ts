// Same-input production renders at immutable revisions, for PR review only.
// bun run scripts/pr-assets/meaning-preservation-evidence.ts BASE_SHA HEAD_SHA OUT_DIR
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../..')
const [base, head, destination] = process.argv.slice(2)
if (!base || !head || !destination || ![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha))) {
  throw new Error('Expected BASE_SHA HEAD_SHA OUT_DIR, with full commit SHAs')
}
const out = resolve(destination)
mkdirSync(out, { recursive: true })
const fixtures = [
  { id: 'xychart-title', title: 'XY-chart nightly title counterexample', source: '---\ntitle: Quarterly Quarterly Quarterly Quarterly Quarterly Quarterly Quarterly Quarterly\n---\nxychart-beta\n  x-axis [n0, n1, n2]\n  y-axis 0 --> 100\n  bar [1, 2, 3]', cue: 'Inspect the complete title inside the canvas and the plot below its wrapped lines.' },
  { id: 'xychart-literal-title', title: 'Horizontal XY-chart literal title', source: 'xychart-beta horizontal\n  title "Worldwide <b>quarterly revenue by region and channel for the North American market forecast</b>"\n  x-axis [Jan, Feb, Mar]\n  y-axis 0 --> 100\n  bar [10, 20, 30]', cue: 'The title wraps without interpreting or duplicating the literal angle brackets.' },
  { id: 'timeline', title: 'Timeline milestone', source: 'timeline\n2020 : A\nTimeline redesign : Ship', cue: 'Both the Timeline redesign period and Ship event remain visible.' },
  { id: 'state', title: 'Unknown State statement', source: 'stateDiagram-v2\nA --> B\nbogus statement', cue: 'Unknown State statements produce an explicit error, preserving the honest unsupported outcome.' },
  { id: 'diamond-lr', title: 'Horizontal decision duplicates', source: 'flowchart LR\nC{Verify} -->|ok| D[View]\nC -->|warnings| D', cue: 'Both labels and distinct arrowheads are visible, without crossing routes.' },
  { id: 'diamond-td', title: 'Vertical decision duplicates', source: 'flowchart TD\nC{Verify} -->|ok| D[View]\nC -->|warnings| D', cue: 'Both labels and distinct arrowheads are visible, without crossing routes.' },
  { id: 'diamond-feeder', title: 'Decision duplicates with another feeder', source: 'flowchart TD\nC{Verify} -->|ok| D[View]\nC -->|warnings| D\nA[Start] --> D', cue: 'The two decision labels remain readable without crossing the extra feeder.' },
  { id: 'diamond-feedback', title: 'Decision duplicates with feedback', source: 'flowchart TD\nC{Verify} -->|ok| D[View]\nC -->|warnings| D\nD --> C', cue: 'The forward pair remains readable without crossing the return edge.' },
]
interface Evidence { svg?: string; png?: string; error?: string }
interface RevisionEvidence { renders: Record<string, Evidence>; classExport: string }

function renderRevision(sha: string): RevisionEvidence {
  const directory = mkdtempSync(join(tmpdir(), 'am-meaning-review-'))
  const checkout = join(directory, 'checkout')
  execFileSync('git', ['worktree', 'add', '--detach', checkout, sha], { cwd: ROOT, stdio: 'pipe' })
  try {
    symlinkSync(join(ROOT, 'node_modules'), join(checkout, 'node_modules'), 'dir')
    writeFileSync(join(checkout, 'probe.ts'), `
      import { renderMermaidSVG, renderMermaidPNG, parseRegisteredMermaid, asClass, mutate, serializeMermaid } from './src/agent/index.ts'
      const fixtures = ${JSON.stringify(fixtures)}
      const renders = {}
      for (const fixture of fixtures) {
        try {
          renders[fixture.id] = {
            svg: renderMermaidSVG(fixture.source, { security: 'strict' }),
            png: Buffer.from(renderMermaidPNG(fixture.source, { security: 'strict', background: '#ffffff' })).toString('base64'),
          }
        } catch (error) { renders[fixture.id] = { error: String(error) } }
      }
      const parsed = parseRegisteredMermaid('classDiagram\\nnamespace N {\\nclass A\\n}\\nclass B')
      if (!parsed.ok) throw new Error('Class witness did not parse')
      const diagram = asClass(parsed.value)
      if (!diagram) throw new Error('Class witness was not editable')
      const edited = mutate(diagram, { kind: 'remove_class', id: 'A' })
      if (!edited.ok) throw new Error(edited.error.message)
      console.log(JSON.stringify({ renders, classExport: serializeMermaid(edited.value) }))
    `)
    return JSON.parse(execFileSync(process.execPath, ['probe.ts'], { cwd: checkout, encoding: 'utf8' })) as RevisionEvidence
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', checkout], { cwd: ROOT, stdio: 'pipe' })
    rmSync(directory, { recursive: true, force: true })
  }
}

const revisions = { before: renderRevision(base), after: renderRevision(head) }
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rows = fixtures.map(fixture => {
  writeFileSync(join(out, `${fixture.id}.mmd`), `${fixture.source}\n`)
  const panels = (['before', 'after'] as const).map(phase => {
    const result = revisions[phase].renders[fixture.id]!
    if (result.svg && result.png) {
      writeFileSync(join(out, `${fixture.id}-${phase}.svg`), result.svg)
      writeFileSync(join(out, `${fixture.id}-${phase}.png`), Buffer.from(result.png, 'base64'))
    }
    return `<figure><figcaption>${phase}</figcaption>${result.png
      ? `<img alt="${phase}: ${esc(fixture.title)}" src="data:image/png;base64,${result.png}">`
      : `<pre>${esc(result.error ?? 'No render')}</pre>`}</figure>`
  }).join('')
  return `<section><h2>${fixture.title}</h2><p>${fixture.cue}</p><div class="pair">${panels}</div></section>`
}).join('')
for (const phase of ['before', 'after'] as const) writeFileSync(join(out, `class-export-${phase}.mmd`), revisions[phase].classExport)
writeFileSync(join(out, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Diagram meaning: before and after</title><style>body{font:16px/1.5 system-ui;margin:40px auto;padding:0 24px;max-width:1100px;color:#222;background:white}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{border-top:1px solid #ddd;margin-top:32px}figure{margin:0}figcaption{font-weight:bold}img{display:block;width:100%;height:auto}pre{white-space:pre-wrap;background:#f6f6f6;padding:16px}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>Diagram meaning: before and after</h1><p>Baseline SHA: <code>${base}</code><br>Head SHA: <code>${head}</code></p><p>Same sources, default style, strict security and bundled fonts at both revisions. Focused witnesses do not prove all-layout or cross-platform visual parity.</p>${rows}<section><h2>Class export after deleting A</h2><p>Inspect the invalid empty namespace in the baseline and the preserved class B in the candidate.</p><div class="pair"><pre>${esc(revisions.before.classExport)}</pre><pre>${esc(revisions.after.classExport)}</pre></div></section></html>`)
writeFileSync(join(out, 'receipt.json'), JSON.stringify({ base, head, bun: Bun.version, fixtures: fixtures.map(fixture => fixture.id), options: { security: 'strict', style: 'default', fonts: 'bundled' } }, null, 2) + '\n')
console.log(`Wrote immutable before/after evidence to ${out}`)
