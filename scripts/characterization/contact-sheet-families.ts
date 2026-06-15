// ============================================================================
// All-families contact-sheet generator.
//
// Produces docs/layout-characterization/contact-sheet-families.md: one
// canonical example per diagram FAMILY (renderer), so the characterisation
// effort visibly spans every renderer, not just the grid flowchart engine.
//
// The flowchart/state grid engine is characterised in depth in contact-sheet.md
// + properties.md; this sheet maps the breadth across the other renderers and
// records each family's layout strategy and signature invariant.
//
// Approval artifact: re-run, review the diff, commit. Changes no source code.
// ============================================================================

import { renderMermaidASCII } from '../../src/ascii/index.ts'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Family {
  id: string
  title: string
  /** The layout strategy this renderer uses (from src/ascii/index.ts). */
  strategy: string
  /** Its distinctive, load-bearing characterisation (observational). */
  signature: string
  /** Which universal invariants hold (verified empirically). */
  invariants: { total: boolean; deterministic: boolean; noDiagonals: boolean; rectangular: boolean }
  source: string
}

const FAMILIES: Family[] = [
  {
    id: 'flowchart',
    title: 'Flowchart',
    strategy: 'Grid placement + A* orthogonal edge routing (src/ascii/grid.ts).',
    signature: 'Layered: forward edges go downstream; orthogonal; deterministic. Characterised in depth in contact-sheet.md + properties.md.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: true },
    source: 'graph TD\n  A --> B\n  A --> C\n  B --> D\n  C --> D',
  },
  {
    id: 'state',
    title: 'State diagram',
    strategy: 'Same grid + A* pipeline as flowcharts (src/ascii/index.ts).',
    signature: '[*] renders as start/end markers; states are rounded boxes; otherwise identical to flowchart contract.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: true },
    source: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> Idle\n  Running --> [*]',
  },
  {
    id: 'sequence',
    title: 'Sequence diagram',
    strategy: 'Column-based timeline layout (src/ascii/sequence.ts).',
    signature: 'One vertical lifeline per participant, evenly spaced; messages stack top-to-bottom in source order. Rectangular.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: true },
    source: 'sequenceDiagram\n  Alice->>Bob: Request\n  Bob->>DB: Query\n  DB-->>Bob: Rows\n  Bob-->>Alice: Response',
  },
  {
    id: 'class',
    title: 'Class diagram',
    strategy: 'Level-based UML layout (src/ascii/class-diagram.ts).',
    signature: 'Each class is a compartment box (name / members); relationship arrows carry UML arrowheads. Rectangular.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: true },
    source: 'classDiagram\n  class Animal {\n    +String name\n    +eat() void\n  }\n  Animal <|-- Dog\n  Animal <|-- Cat',
  },
  {
    id: 'er',
    title: 'ER diagram',
    strategy: 'Grid layout with crow\'s-foot notation (src/ascii/er-diagram.ts).',
    signature: 'Entities are boxes; relationship endpoints render cardinality (||, o{, |{) as crow\'s-foot glyphs. Rectangular.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: true },
    source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains',
  },
  {
    id: 'timeline',
    title: 'Timeline',
    strategy: 'Chronological outline with grouped milestones (src/ascii/timeline.ts).',
    signature: 'Periods listed in source order, grouped under sections; an outline, not a routed graph. Ragged rows.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: false },
    source: 'timeline\n  title Project\n  section Phase 1\n    2021 : Kickoff\n    2022 : Beta\n  section Phase 2\n    2023 : GA',
  },
  {
    id: 'journey',
    title: 'User journey',
    strategy: 'Scored task lists with actor annotations (src/ascii/journey.ts).',
    signature: 'Tasks grouped by section with a 1-5 score and actor initials; an annotated list. Ragged rows.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: false },
    source: 'journey\n  title My Day\n  section Morning\n    Wake up: 3: Me\n    Commute: 1: Me\n  section Work\n    Code: 5: Me, Team',
  },
  {
    id: 'xychart',
    title: 'XY chart',
    strategy: 'Cartesian plot of series over labelled axes (src/ascii/xychart.ts).',
    signature: 'Bars/lines plotted against monotonic axes using block glyphs (never `/`\\`). Ragged rows.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: false },
    source: 'xychart-beta\n  title "Revenue"\n  x-axis [jan, feb, mar, apr]\n  y-axis "USD" 0 --> 100\n  bar [20, 45, 60, 90]\n  line [30, 40, 55, 80]',
  },
  {
    id: 'pie',
    title: 'Pie chart',
    strategy: 'Proportional slice rendering (src/ascii/pie.ts).',
    signature: 'Each slice is sized in proportion to its share of the total; values shown alongside. Ragged rows.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: false },
    source: 'pie title Pets\n  "Dogs" : 45\n  "Cats" : 35\n  "Birds" : 20',
  },
  {
    id: 'quadrant',
    title: 'Quadrant chart',
    strategy: '2-D scatter into four labelled quadrants (src/ascii/quadrant.ts).',
    signature: 'Points placed by (x,y) in [0,1]² on a 2×2 grid with axis labels; a scatter plot. Ragged rows.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: false },
    source: 'quadrantChart\n  title Reach vs Effort\n  x-axis Low Reach --> High Reach\n  y-axis Low Effort --> High Effort\n  "Feature A": [0.3, 0.6]\n  "Feature B": [0.7, 0.2]',
  },
  {
    id: 'architecture',
    title: 'Architecture diagram',
    strategy: 'Projected graph layout over the grid engine (src/ascii/architecture.ts).',
    signature: 'Services grouped into nested boxes with iconography; edges routed between ports. Ragged rows.',
    invariants: { total: true, deterministic: true, noDiagonals: true, rectangular: false },
    source: 'architecture-beta\n  group api(cloud)[API]\n  service db(database)[Database] in api\n  service server(server)[Server] in api\n  db:L -- R:server',
  },
]

const U = { colorMode: 'none' } as const // default unicode (canonical output)

function tick(b: boolean): string { return b ? '✓' : '·' }

export function build(): string {
  const out: string[] = []
  out.push('# Contact sheet — all renderers (families)')
  out.push('')
  out.push('> Generated by `scripts/characterization/contact-sheet-families.ts`. Do not edit by hand.')
  out.push('')
  out.push('One canonical example per diagram **family** (renderer). The flowchart and')
  out.push('state families share the grid + A\\* engine characterised in depth in')
  out.push('[`contact-sheet.md`](./contact-sheet.md) and [`properties.md`](./properties.md);')
  out.push('every other family has its own renderer. This sheet records the breadth and')
  out.push('each family\'s layout strategy, signature invariant, and which universal')
  out.push('invariants hold (verified empirically).')
  out.push('')
  out.push('## Universal-invariant coverage matrix')
  out.push('')
  out.push('| Family | Total | Deterministic | No diagonals | Rectangular |')
  out.push('|--------|:-----:|:-------------:|:------------:|:-----------:|')
  for (const f of FAMILIES) {
    const i = f.invariants
    out.push(`| [${f.title}](#${f.id}) | ${tick(i.total)} | ${tick(i.deterministic)} | ${tick(i.noDiagonals)} | ${tick(i.rectangular)} |`)
  }
  out.push('')
  out.push('**Total** and **Deterministic** hold for every renderer (the bedrock contract;')
  out.push('also pinned across the 243-entry docs corpus by `ascii-determinism.test.ts`).')
  out.push('**No diagonals** holds for every renderer. **Rectangular** (all rows one width)')
  out.push('holds only for the box/graph families; the chart and list families emit ragged')
  out.push('rows by design.')
  out.push('')
  for (const f of FAMILIES) {
    out.push(`## <a id="${f.id}"></a>${f.title}`)
    out.push('')
    out.push(`**Layout strategy:** ${f.strategy}`)
    out.push('')
    out.push(`**Signature invariant:** ${f.signature}`)
    out.push('')
    out.push('Source:')
    out.push('')
    out.push('```mermaid')
    out.push(f.source)
    out.push('```')
    out.push('')
    out.push('Rendered:')
    out.push('')
    out.push('```')
    out.push(renderMermaidASCII(f.source, U).replace(/[ \t]+$/gm, '').replace(/\n+$/g, ''))
    out.push('```')
    out.push('')
  }
  return out.join('\n')
}

export const OUTPUT_PATH = join(import.meta.dir, '..', '..', 'docs', 'layout-characterization', 'contact-sheet-families.md')

function writeOrCheck(): void {
  const content = build()
  if (process.argv.includes('--check')) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, 'utf8') : ''
    if (current !== content) {
      // eslint-disable-next-line no-console
      console.error(`${OUTPUT_PATH} is out of date; run scripts/characterization/contact-sheet-families.ts`)
      process.exitCode = 1
      return
    }
    // eslint-disable-next-line no-console
    console.log(`checked ${OUTPUT_PATH} (${FAMILIES.length} families)`)
    return
  }

  writeFileSync(OUTPUT_PATH, content)
  // eslint-disable-next-line no-console
  console.log(`wrote ${OUTPUT_PATH} (${FAMILIES.length} families)`)
}

if (import.meta.main) writeOrCheck()
