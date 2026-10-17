// Same-input production renders at immutable revisions, for PR review only.
// bun run scripts/pr-assets/meaning-preservation-evidence.ts BASE_SHA HEAD_SHA OUT_DIR
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { RenderOptions } from '../../src/types.ts'
import { getFamily, knownBuiltinFamilies } from '../../src/agent/families.ts'

const ROOT = resolve(import.meta.dir, '../..')
const [base, head, destination] = process.argv.slice(2)
if (!base || !head || !destination || ![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha))) {
  throw new Error('Expected BASE_SHA HEAD_SHA OUT_DIR, with full commit SHAs')
}
const out = resolve(destination)
mkdirSync(out, { recursive: true })
interface Fixture { id: string; title: string; source: string; cue: string; renderOptions?: RenderOptions }
const sequenceSpanSource = 'sequenceDiagram\nparticipant A\nparticipant B\nparticipant C\nA->>C: Label across B\nactivate B\nA->>C: Begin work\nA->>C: Label across active B\ndeactivate B'
const fixtures: Fixture[] = [
  { id: 'sequence-label-span', title: 'Sequence labels crossing a middle lifeline and activation', source: sequenceSpanSource, cue: 'Inspect B behind the first and final labels: structural ink should leave their measured areas, while the lifeline and activation remain visible above and below. The middle message begins the activation.' },
  { id: 'sequence-label-nested-surfaces', title: 'Sequence multiline numbered bidirectional label over nested colors', source: 'sequenceDiagram\nparticipant A\nparticipant B\nparticipant C\nrect rgba(30,90,150,0.25)\nrect rgb(25,45,65)\nactivate B\nA->>C: Begin work\nautonumber 10.5 0.25\nA<<-->>C: Numbered span<br/>across active B<br/>on the inner surface\ndeactivate B\nend\nend', cue: 'Inspect all label lines, the 10.5 prefix and both arrowheads. The gap through B should reveal the inner authored surface, without a page-colored patch; the outer translucent band is a color control.' },
  { id: 'sequence-label-transparent', title: 'Sequence label gaps on a transparent canvas', source: sequenceSpanSource, renderOptions: { transparent: true }, cue: 'Inspect the gaps over the checkerboard: removing lifeline and activation ink should preserve canvas transparency. The checkerboard belongs only to this review page; the PNG uses an explicitly transparent raster background.' },
  { id: 'sequence-label-sketch', title: 'Sequence label gaps with the hand-drawn style', source: sequenceSpanSource, renderOptions: { style: 'hand-drawn', seed: 17 }, cue: 'Inspect the first and final labels with a fixed sketch seed. This is a check of one styled backend; it does not establish parity across every look.' },
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
const fixtureOptions = Object.fromEntries(fixtures.map(fixture => {
  const svg = { security: 'strict' as const, ...fixture.renderOptions }
  return [fixture.id, { svg, png: { ...svg, background: svg.transparent ? '#00000000' : '#ffffff' } }]
}))
const terminalFixtures = [
  ...knownBuiltinFamilies().flatMap(id => {
    const source = getFamily(id)?.example
    return source ? [{ id: `terminal-${id}`, source, cue: 'Compare labels, native marks and structure; the JSON sidecars show exact ownership separately.' }] : []
  }),
  { id: 'terminal-sequence-boundaries', source: 'sequenceDiagram\nparticipant A\nparticipant B\nloop outer\nNote over A,B: Owned inside\nA->>B: work\nend\nNote over A,B: After close\nopt empty sibling\nend\nautonumber 10 2\nB->>A: numbered\nautonumber off\nA->>B: hidden\nautonumber\nB->>A: resumes', cue: 'The post-close note is outside the loop, empty siblings keep their own bounds, and numbering resumes the shared counter.' },
  { id: 'terminal-class-ports', source: 'classDiagram\nclass A {\n +String name\n +run() void\n}\nclass B\nA "1" --> "*" B : complete relation\nA --> A : self\nA --> B : parallel', cue: 'Inspect both cardinalities, every complete label, the self loop and separate physical ports.' },
  { id: 'terminal-zero-pie', source: 'pie showData\n title Zero values\n "Still present" : 0\n "Also present" : 0', cue: 'The baseline is honestly empty. The new output preserves zero labels and values without inventing positive bars.' },
  { id: 'terminal-xy-baseline', source: 'xychart-beta\n x-axis [A, B, C]\n y-axis 1 --> 14\n bar [1, 6.5, 14]', cue: 'The authored minimum-valued bar has zero length; ticks, marks and baseline use the same quantizer.' },
  { id: 'terminal-xy-mixed-coverage', source: 'xychart-beta\n x-axis [A, B, C, D]\n y-axis 0 --> 100\n bar [20, 50, 80, 40]\n line [20, 90, 30, 70]', cue: 'Bars retain their full numeric coverage. The line is visible outside bars and explicitly occluded behind them; compare the exact cell spans in the metadata.' },
  { id: 'terminal-xy-horizontal-coverage', source: 'xychart-beta horizontal\n x-axis [A, B, C, D]\n y-axis 0 --> 100\n bar [22.5, 52.5, 82.5, 42.5]\n line [20, 90, 30, 70]', cue: 'The horizontal form preserves half-cell bar endpoints using the same opaque-mark policy.' },
  { id: "terminal-class-namespace-headers", source: "classDiagram\ndirection LR\nnamespace Alpha[\"First<br/>complete header\"] {\n class A\n}\nnamespace Beta[\"Second<br/>complete header\"] {\n class B\n}\nA --> B : edge", cue: "Both complete namespace headers clear sibling envelopes and the owned relationship." },
  { id: "terminal-sequence-central-markers", source: "sequenceDiagram\nA->>()B: central end\nB() ->>A: central start\nA() <<->>()B: both ends\nA->>()A: self end", cue: "Inspect central circles at every authored endpoint, including the self message." },
  { id: "terminal-container-cycle", source: "flowchart TD\nsubgraph G[Group]\n subgraph H[Inner]\n A[Member]\n end\nend\nB[External] --> G\nG --> B", cue: "Both reciprocal relationships survive a component without an initial root. A baseline error is retained honestly." },
  { id: "terminal-gantt-task-identities", source: "gantt\ndateFormat YYYY-MM-DD\nFirst :2024-01-01, 1d\nSecond :task-0, 2024-01-03, 1d\nclick task-0 href \"https://example.com\"", cue: "The task-0 owned spans identify only Second; the anonymous task has its own stable identity." },
  { id: "terminal-sankey-policy", source: "---\nconfig:\n sankey:\n  linkColor: \"#ff0000\"\n---\nsankey-beta\nSource,Target,2\nSource,Target,1", cue: "Static link paint reaches the owned bars. Parallel adjacency regions retain their endpoints and distinct identities." },
  { id: 'terminal-tall-frame', source: 'flowchart LR\nsubgraph S["One<br>Two<br>Three<br>Four<br>Five"]\n A[Node]\nend', cue: 'Every header line is complete and clears the node; neither wrapping nor composition rewrites source.' },
  { id: 'terminal-reflected-text-footprint', source: 'flowchart BT\nA["ab<br>x"] --> B[Other]', cue: 'The reflected card retains both ragged lines, ab and x. Text and its opaque footprint move together without reversing reading order.' },
]
interface Evidence { svg?: string; png?: string; error?: string }
interface TerminalEvidence { ascii?: string; html?: string; meta?: unknown; error?: string }
interface RevisionEvidence { renders: Record<string, Evidence>; terminals: Record<string, TerminalEvidence>; classExport: string }

function renderRevision(sha: string): RevisionEvidence {
  const directory = mkdtempSync(join(tmpdir(), 'am-meaning-review-'))
  const checkout = join(directory, 'checkout')
  execFileSync('git', ['worktree', 'add', '--detach', checkout, sha], { cwd: ROOT, stdio: 'pipe' })
  try {
    symlinkSync(join(ROOT, 'node_modules'), join(checkout, 'node_modules'), 'dir')
    writeFileSync(join(checkout, 'probe.ts'), `
      import { writeFileSync } from 'node:fs'
      import { renderMermaidSVG, renderMermaidPNG, parseRegisteredMermaid, asClass, mutate, serializeMermaid } from './src/agent/index.ts'
      import { renderMermaidASCIIWithMeta } from './src/ascii/meta.ts'
      const fixtures = ${JSON.stringify(fixtures)}
      const fixtureOptions = ${JSON.stringify(fixtureOptions)}
      const renders = {}
      const terminals = {}
      for (const fixture of fixtures) {
        try {
          renders[fixture.id] = {
            svg: renderMermaidSVG(fixture.source, fixtureOptions[fixture.id].svg),
            png: Buffer.from(renderMermaidPNG(fixture.source, fixtureOptions[fixture.id].png)).toString('base64'),
          }
        } catch (error) { renders[fixture.id] = { error: String(error) } }
      }
      for (const fixture of ${JSON.stringify(terminalFixtures)}) {
        try {
          const plain = renderMermaidASCIIWithMeta(fixture.source, { colorMode: 'none', useAscii: true })
          const colored = renderMermaidASCIIWithMeta(fixture.source, { colorMode: 'html', useAscii: false })
          const failure = [...plain.warnings, ...colored.warnings].find(warning => warning.code === 'ASCII_RENDER_FAILED')
          terminals[fixture.id] = { ascii: plain.ascii, html: colored.ascii, ...(failure ? { error: failure.message } : {}), meta: { ascii: plain.regions, unicode: colored.regions, warnings: colored.warnings } }
        } catch (error) { terminals[fixture.id] = { error: String(error) } }
      }
      const parsed = parseRegisteredMermaid('classDiagram\\nnamespace N {\\nclass A\\n}\\nclass B')
      if (!parsed.ok) throw new Error('Class witness did not parse')
      const diagram = asClass(parsed.value)
      if (!diagram) throw new Error('Class witness was not editable')
      const edited = mutate(diagram, { kind: 'remove_class', id: 'A' })
      if (!edited.ok) throw new Error(edited.error.message)
      writeFileSync('probe-result.json', JSON.stringify({ renders, terminals, classExport: serializeMermaid(edited.value) }))
    `)
    execFileSync(process.execPath, ['probe.ts'], { cwd: checkout, stdio: 'pipe' })
    return JSON.parse(readFileSync(join(checkout, 'probe-result.json'), 'utf8')) as RevisionEvidence
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
    return `<figure${fixture.renderOptions?.transparent ? ' class="transparent"' : ''}><figcaption>${phase}</figcaption>${result.png
      ? `<img alt="${phase}: ${esc(fixture.title)}" src="data:image/png;base64,${result.png}">`
      : `<pre>${esc(result.error ?? 'No render')}</pre>`}</figure>`
  }).join('')
  const optionsCaption = fixture.renderOptions ? `<p>Render options at both revisions: <code>${esc(JSON.stringify(fixture.renderOptions))}</code>.</p>` : ''
  return `<section><h2>${fixture.title}</h2><p>${fixture.cue}</p>${optionsCaption}<div class="pair">${panels}</div></section>`
}).join('')
const terminalRows = terminalFixtures.map(fixture => {
  writeFileSync(join(out, `${fixture.id}.mmd`), `${fixture.source}\n`)
  const panels = (['before', 'after'] as const).map(phase => {
    const result = revisions[phase].terminals[fixture.id]!
    writeFileSync(join(out, `${fixture.id}-${phase}.txt`), result.ascii ?? result.error ?? 'No output')
    writeFileSync(join(out, `${fixture.id}-${phase}-meta.json`), JSON.stringify(result.meta ?? result.error, null, 2))
    return `<figure><figcaption>${phase}</figcaption><pre class="terminal">${result.error ? esc(result.error) : result.html ?? 'Empty output'}</pre></figure>`
  }).join('')
  return `<section><h2>${fixture.id}</h2><p>${esc(fixture.cue)}</p><div class="pair">${panels}</div></section>`
}).join('')
for (const phase of ['before', 'after'] as const) writeFileSync(join(out, `class-export-${phase}.mmd`), revisions[phase].classExport)
writeFileSync(join(out, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Diagram meaning: before and after</title><style>body{font:16px/1.5 system-ui;margin:40px auto;padding:0 24px;max-width:1100px;color:#222;background:white}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}section{border-top:1px solid #ddd;margin-top:32px}figure{margin:0}figcaption{font-weight:bold}img{display:block;width:100%;height:auto}figure.transparent img{background-color:white;background-image:conic-gradient(#ddd 25%,transparent 0 50%,#ddd 0 75%,transparent 0);background-size:16px 16px}pre{white-space:pre-wrap;background:#f6f6f6;padding:16px}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>Diagram meaning: before and after</h1><p>Baseline SHA: <code>${base}</code><br>Head SHA: <code>${head}</code></p><p>Same sources and render options at both revisions, with strict security and bundled PNG fonts. Default style and opaque PNGs use a white background unless a fixture states otherwise; explicit options are shown beside that fixture and recorded in receipt.json. Focused witnesses do not prove all-layout or cross-platform visual parity.</p>${rows}<section><h2>Class export after deleting A</h2><p>Compare the serialized result after deleting A: class B should remain and the empty namespace should be omitted.</p><div class="pair"><pre>${esc(revisions.before.classExport)}</pre><pre>${esc(revisions.after.classExport)}</pre></div></section></html>`)
writeFileSync(join(out, 'terminal-review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Terminal composition review</title><style>body{font:16px/1.5 system-ui;margin:32px;color:#222;background:white}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{min-width:0;margin:0}pre.terminal{white-space:pre;overflow:auto;font:12px/1.3 Menlo,Consolas,monospace;background:#f7f7f7;padding:12px}section{border-top:1px solid #ddd;margin-top:24px}</style><h1>Terminal composition: same input before and after</h1><p>Baseline SHA: ${base}<br>Head SHA: ${head}<br>Bun: ${Bun.version}</p><p>Production ASCII text files and exact metadata accompany every pair. Browser monospace/font coverage is a visual limitation; independent owned-cell and grapheme tests establish logical geometry and encoding parity.</p>${terminalRows}</html>`)
writeFileSync(join(out, 'receipt.json'), JSON.stringify({ base, head, bun: Bun.version, fixtures: fixtures.map(fixture => fixture.id), terminalFixtures: terminalFixtures.map(fixture => fixture.id), terminalOptions: { ascii: { colorMode: 'none', useAscii: true }, unicode: { colorMode: 'html', useAscii: false } }, options: { security: 'strict', style: 'default unless fixtureOptions overrides it', fonts: 'bundled' }, fixtureOptions }, null, 2) + '\n')
console.log(`Wrote immutable before/after evidence to ${out}`)
