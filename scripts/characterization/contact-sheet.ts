// ============================================================================
// Contact-sheet generator for the ASCII grid layout algorithm.
//
// Produces docs/layout-characterization/contact-sheet.md: the minimum set of
// worked examples that, together, exercise every load-bearing decision in the
// hand-written grid + A* layout (src/ascii/grid.ts, pathfinder.ts,
// edge-routing.ts, edge-bundling.ts).
//
// This is an APPROVAL artifact: re-run it (`bun run scripts/characterization/
// contact-sheet.ts`) after an intended layout change, eyeball the diff, and
// commit. A surprising diff is a regression; an expected diff is the new
// golden. See docs/layout-characterization/README.md.
//
// It changes NO implementation code — it only reads the public renderer.
// ============================================================================

import { renderMermaidASCII } from '../../src/ascii/index.ts'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Example {
  id: string
  title: string
  /** The one behaviour this example isolates. */
  characterises: string
  /** Where that behaviour lives in the source. */
  anchor: string
  source: string
}

// Each example isolates ONE phenomenon. Ordered from the degenerate base case
// outward to the heuristics that only fire on specific topologies.
const EXAMPLES: Example[] = [
  {
    id: '01-single-node',
    title: 'Single node (base case)',
    characterises:
      'A node is a 3×3 grid block sized to its label; the canvas is the box plus border. No edges, no routing.',
    anchor: 'grid.ts reserveSpotInGrid / setColumnWidth; draw.ts drawBox',
    source: 'graph TD\n  A[Start]',
  },
  {
    id: '02-chain-td',
    title: 'Linear chain, top-down',
    characterises:
      'Layer assignment along the flow axis: each child sits one level (stride 4) below its parent; one node per layer.',
    anchor: 'grid.ts:539 childLevel = gc.y + 4',
    source: 'graph TD\n  A --> B --> C',
  },
  {
    id: '03-chain-lr',
    title: 'Linear chain, left-right (transpose of TD)',
    characterises:
      'Direction duality: LR is the x/y transpose of the identical placement code; flow axis becomes x.',
    anchor: 'grid.ts:496-571 (x↔y swap)',
    source: 'graph LR\n  A --> B --> C',
  },
  {
    id: '04-chain-bt',
    title: 'Linear chain, bottom-up',
    characterises:
      'BT is laid out as TD, then the finished canvas is flipped vertically and arrow glyphs are remapped (v↔^).',
    anchor: 'index.ts:179-194; canvas.ts flipCanvasVertically',
    source: 'graph BT\n  A --> B --> C',
  },
  {
    id: '05-fan-out',
    title: 'Fan-out from one source',
    characterises:
      'Sibling edges sharing a source are bundled onto a shared trunk that splits at a single junction row.',
    anchor: 'edge-bundling.ts analyzeEdgeBundles / processBundles (TD only)',
    source: 'graph TD\n  A --> B\n  A --> C\n  A --> D',
  },
  {
    id: '06-fan-in',
    title: 'Fan-in to one target',
    characterises:
      'Edges sharing a target merge into one trunk; fan-in targets align under their parent group (in-degree heuristic).',
    anchor: 'grid.ts:478-492 inDegree; grid.ts:555-563',
    source: 'graph TD\n  B --> A\n  C --> A\n  D --> A',
  },
  {
    id: '07-branch-merge',
    title: 'Branch then merge (diamond)',
    characterises:
      'A node that is both a fan-out target and a fan-in source: split, two parallel layers, rejoin without crossing.',
    anchor: 'grid.ts createMapping multi-pass placement',
    source: 'graph TD\n  A --> B\n  A --> C\n  B --> D\n  C --> D',
  },
  {
    id: '08-feedback-cycle',
    title: 'Feedback cycle (back edge)',
    characterises:
      'The forward path stays straight; the cycle-closing edge is routed back around by A* as a detour, not a diagonal.',
    anchor: 'pathfinder.ts getPath; grid.ts:582 multi-pass safety break',
    source: 'graph LR\n  A --> B --> C\n  C --> A',
  },
  {
    id: '09-self-loop',
    title: 'Self-loop',
    characterises:
      'A node pointing at itself routes a small loop off one side; self-loops are excluded from fan-in degree.',
    anchor: 'edge-routing.ts selfReferenceDirection; grid.ts:487',
    source: 'graph TD\n  A --> A\n  A --> B',
  },
  {
    id: '10-parallel-edges',
    title: 'Parallel edges into a target',
    characterises:
      'Two independent roots feeding one target are placed contiguously and share the merge trunk (no crossed trunks).',
    anchor: 'grid.ts:455-470 root grouping by shared first-target',
    source: 'graph TD\n  A --> C\n  B --> C',
  },
  {
    id: '11-edge-labels',
    title: 'Edge labels on a fan-out',
    characterises:
      'Labelled edges cannot bundle; the label lands on a per-sibling branch segment and widens that column.',
    anchor: 'edge-routing.ts determineLabelLine; grid.ts shareSiblingEdgeTrunks',
    source: 'graph LR\n  A -->|yes| B\n  A -->|no| C',
  },
  {
    id: '12-node-shapes',
    title: 'Node shapes',
    characterises:
      'Shape-aware sizing: diamond/round/circle change the box glyphs and grid dimensions but keep the 3×3 invariant and orthogonal routing.',
    anchor: 'shapes/* getShapeDimensions; grid.ts setColumnWidth',
    source:
      'graph LR\n  A[Rect] --> B(Round)\n  B --> C{Decision}\n  C --> D((Circle))',
  },
  {
    id: '13-subgraph',
    title: 'Subgraph (bounding box)',
    characterises:
      'A subgraph draws a labelled box whose bounds contain every member node; edges cross the border cleanly.',
    anchor: 'grid.ts calculateSubgraphBoundingBoxes; offsetDrawingForSubgraphs',
    source:
      'graph TD\n  A --> B\n  subgraph G [Group]\n    B --> C\n  end\n  C --> D',
  },
  {
    id: '14-subgraph-direction',
    title: 'Subgraph with direction override',
    characterises:
      'A subgraph can override the flow direction (LR inside TD); the override applies only to edges internal to it.',
    anchor: 'grid.ts:533-537 effectiveDir; converter.ts:196-199',
    source:
      'graph TD\n  A --> B\n  subgraph G [Inner]\n    direction LR\n    B --> C --> E\n  end\n  E --> D',
  },
  {
    id: '15-disconnected',
    title: 'Disconnected components',
    characterises:
      'Multiple roots / components are laid out side by side; each is an independent placement pass.',
    anchor: 'grid.ts root detection + multi-pass placement',
    source: 'graph TD\n  A --> B\n  C --> D',
  },
  {
    id: '16-state-markers',
    title: 'State diagram start/end',
    characterises:
      'State diagrams reuse the flowchart pipeline; [*] becomes start/end markers and states render as rounded boxes.',
    anchor: 'index.ts flowchart pipeline (state shares it); shapes/state.ts',
    source:
      'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> [*]',
  },
]

function render(source: string): string {
  return renderMermaidASCII(source, { colorMode: 'none', useAscii: true })
}

function build(): string {
  const lines: string[] = []
  lines.push('# Contact sheet — ASCII grid layout algorithm')
  lines.push('')
  lines.push(
    '> Generated by `scripts/characterization/contact-sheet.ts`. Do not edit by hand —',
  )
  lines.push(
    '> re-run the generator and review the diff (approval-test workflow).',
  )
  lines.push('')
  lines.push(
    'These are the **minimum set of worked examples** that together exercise every',
  )
  lines.push(
    'load-bearing decision in the hand-written grid + A\\* layout. Each example',
  )
  lines.push(
    'isolates one behaviour. Output is shown in ASCII mode (`useAscii: true`) so the',
  )
  lines.push('structure is legible in plain text. See `properties.md` for the')
  lines.push('property catalogue these examples motivate, and `README.md` for context.')
  lines.push('')
  lines.push('| # | Example | Characterises |')
  lines.push('|---|---------|---------------|')
  for (const ex of EXAMPLES) {
    lines.push(`| ${ex.id.split('-')[0]} | [${ex.title}](#${ex.id}) | ${ex.characterises.split(';')[0]} |`)
  }
  lines.push('')
  for (const ex of EXAMPLES) {
    lines.push(`## <a id="${ex.id}"></a>${ex.id.split('-')[0]}. ${ex.title}`)
    lines.push('')
    lines.push(`**Characterises:** ${ex.characterises}`)
    lines.push('')
    lines.push(`**Code:** \`${ex.anchor}\``)
    lines.push('')
    lines.push('Source:')
    lines.push('')
    lines.push('```mermaid')
    lines.push(ex.source)
    lines.push('```')
    lines.push('')
    lines.push('Rendered:')
    lines.push('')
    lines.push('```')
    lines.push(render(ex.source).replace(/\s+$/g, ''))
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

const out = join(import.meta.dir, '..', '..', 'docs', 'layout-characterization', 'contact-sheet.md')
writeFileSync(out, build())
// eslint-disable-next-line no-console
console.log(`wrote ${out} (${EXAMPLES.length} examples)`)
