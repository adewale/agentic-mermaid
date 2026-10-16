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
  { id: 'sequence-created-empty-child', title: 'Sequence created actor inside a frame with an empty child', source: 'sequenceDiagram\nparticipant A\nNote over A: before\nloop Outer\ncreate actor C as New\nA->>C: spawn\nloop Empty\nend\nend\nNote over A: after', cue: 'The Outer frame clears the before note, contains the full created actor, and reserves a separate empty child below the creation row.' },
  { id: 'sequence-self-empty-section', title: 'Sequence self-message followed by an empty alternative', source: 'sequenceDiagram\nparticipant A\nNote over A: before\nalt Next\nA->>A: self\nelse EmptySection\nend\nNote over A: after', cue: 'The reserved frame top clears the before note; the empty alternative divider follows the self-message and stays inside its frame.' },
  { id: 'sequence-note-only-rect', title: 'Sequence note-only background below actor headers', source: 'sequenceDiagram\nparticipant A\nrect rgba(0,0,0,0.1)\nNote over A: inside\nend\nNote over A: outside', cue: 'The background begins below the participant header, contains its note with declared padding, and ends before the outside note.' },
  { id: 'sequence-empty-sections', title: 'Sequence empty children in distinct alternative sections', source: 'sequenceDiagram\nparticipant A\nparticipant B\nalt First\nloop C1\nend\nelse Second\nloop C2\nend\nelse Third\nloop C3\nend\nend\nNote over A: outside', cue: 'Each empty child stays in its authored branch; the dividers clear the header, preceding children and their labels.' },
  { id: 'sequence-note-closure', title: 'Sequence note after a closed fragment', source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop inside\nA->>B: hi\nNote over B: inside note\nend\nNote over B: outside note\nA->>B: done', cue: 'The inside note stays within its loop; the outside note begins below the closing frame.' },
  { id: 'sequence-nested-closures', title: 'Sequence notes between nested closures', source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop Outer\nloop Inner\nA->>B: hi\nNote over B: inner owned\nend\nNote over B: outer owned\nend\nNote over B: outside both\nA->>B: done', cue: 'Each note belongs to its authored scope: inner, outer, then outside both frames.' },
  { id: 'sequence-sibling-leading-note', title: 'Sequence sibling fragment with a leading note', source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop First\nA->>B: hi\nNote over B: inside first\nend\nNote over B: between\nopt Second\nNote over B: leading second\nA->>B: next\nend\nNote over B: outside second', cue: 'The between note clears both sibling frames; the Second header reserves space above its leading note.' },
  { id: 'sequence-note-only', title: 'Sequence fragment containing only a note', source: 'sequenceDiagram\nparticipant A\nloop L\nNote over A: inside\nend\nNote over A: outside', cue: 'The note-only loop contains its inside note and ends before the outside note, without requiring a message.' },
  { id: 'sequence-created-icon', title: 'Sequence created actor with a multiline label', source: 'sequenceDiagram\nparticipant A\nloop Spawn\ncreate actor C as Support<br/>Engineer<br/>On call\nA->>C: spawn\nNote over A: owned created note\nend\nNote over C: outside created note\nC->>A: ready', cue: 'The Spawn frame contains the created actor and its full label; the following outside note clears the frame.' },
  { id: 'sequence-self-loop', title: 'Sequence self-message and long fragment header', source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop A very long block header that must remain within the enclosing fragment\nA->>A: This very long self message should have clear space before B\nend\nA->>B: done', cue: 'The self-message clears B, its return arrow clears the loop bottom, and the full header fits inside the frame and canvas.' },
  { id: 'sequence-empty-frames', title: 'Sequence nested empty frames between notes', source: 'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: first\nNote over A: before\nloop Outer\nloop Inner\nend\nend\nNote over A: after\nB->>A: last', cue: 'Both empty frames remain visible between the before and after notes, without capturing either neighboring message.' },
  { id: 'sequence-final-note-branch', title: 'Sequence final branch containing only a note', source: 'sequenceDiagram\nparticipant A\nparticipant B\nalt First\nNote over A: intro\nA->>B: work\nelse Second\nNote over A: second branch\nend\nNote over B: outside', cue: 'The Second divider follows the intro note and work message; its note clears the section label and the outside note clears the frame.' },
  { id: 'sequence-five-line-message', title: 'Sequence five-line message inside a loop', source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop Work\nA->>B: one<br/>two<br/>three<br/>four<br/>five\nend', cue: 'All five message lines remain inside the loop, below its header and above the arrow shaft.' },
  { id: 'sequence-corpus-26', title: 'Corpus sequence 26: nested parallel fragments', source: 'sequenceDiagram\n    par Alice to Bob\n        Alice->>Bob: Go help John\n    and Alice to John\n        Alice->>John: I want this done today\n        par John to Charlie\n            John->>Charlie: Can we do this today?\n        and John to Diana\n            John->>Diana: Can you help us today?\n        end\n    end', cue: 'Inspect both parallel frames, their headers and bottom clearance as unused closing-tail space is removed.' },
  { id: 'sequence-corpus-30', title: 'Corpus sequence 30: nested backgrounds with a leading note', source: 'sequenceDiagram\n    participant Alice\n    participant John\n\n    rect rgb(191, 223, 255)\n    note right of Alice: Alice calls John.\n    Alice->>+John: Hello John, how are you?\n    rect rgb(200, 150, 255)\n    Alice->>+John: John, can you hear me?\n    John-->>-Alice: Hi Alice, I can hear you!\n    end\n    John-->>-Alice: I feel great!\n    end\n    Alice ->>+ John: Did you want to go to the game tonight?\n    John -->>- Alice: Yeah! See you there.', cue: 'Inspect the leading note, nested background boundaries and following messages when duplicate leading-header space is removed.' },
  { id: 'timeline', title: 'Timeline milestone', source: 'timeline\n2020 : A\nTimeline redesign : Ship', cue: 'Both the Timeline redesign period and Ship event remain visible.' },
  { id: 'state', title: 'Unknown State statement', source: 'stateDiagram-v2\nA --> B\nbogus statement', cue: 'Compare how each revision reports the unknown statement, including any explicit diagnostic.' },
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
writeFileSync(join(out, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Diagram meaning: before and after</title><style>body{font:16px/1.5 system-ui;margin:40px auto;padding:0 24px;max-width:1100px;color:#222;background:white}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{border-top:1px solid #ddd;margin-top:32px}figure{margin:0}figcaption{font-weight:bold}img{display:block;width:100%;height:auto}pre{white-space:pre-wrap;background:#f6f6f6;padding:16px}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>Diagram meaning: before and after</h1><p>Baseline SHA: <code>${base}</code><br>Head SHA: <code>${head}</code></p><p>Same sources, default style, strict security and bundled fonts at both revisions. Focused witnesses do not prove all-layout or cross-platform visual parity.</p>${rows}<section><h2>Class export after deleting A</h2><p>Compare the serialized result after deleting A: class B should remain and the empty namespace should be omitted.</p><div class="pair"><pre>${esc(revisions.before.classExport)}</pre><pre>${esc(revisions.after.classExport)}</pre></div></section></html>`)
writeFileSync(join(out, 'receipt.json'), JSON.stringify({ base, head, bun: Bun.version, fixtures: fixtures.map(fixture => fixture.id), options: { security: 'strict', style: 'default', fonts: 'bundled' } }, null, 2) + '\n')
console.log(`Wrote immutable before/after evidence to ${out}`)
