// Differential layout-equivalence gate.
//
// Renders the full layout-compare corpus (the mermaid-docs corpus plus the
// fixtures in eval/layout-compare/fixtures/) to canonical, integer-rounded
// RenderedLayout geometry and asserts it is byte-identical to a committed
// baseline. This is the determinism oracle for PURE refactors: relocating the
// post-ELK passes into src/layout/passes/, reordering helpers, renaming
// internals — anything that must move zero pixels. If the geometry of any of
// the ~258 diagrams shifts by a single rounded pixel, this test fails and names
// the diagram and the first field that moved, so a regression is localised in
// one run instead of bisected.
//
// The qualitative harness in eval/layout-compare/run.ts answers "did quality
// improve or regress"; this gate answers the stricter "did anything change at
// all", which is the question a refactor must answer with "no".
//
// Regenerate after an INTENTIONAL geometry change:
//   UPDATE_LAYOUT_BASELINE=1 bun test src/__tests__/layout-equivalence.test.ts
// Review the diff and list each changed golden under src/__tests__/testdata/
// and why it changed in the PR description.

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectSamples } from '../../eval/layout-compare/run.ts'
import { layoutMermaid, parseRegisteredMermaid as parseMermaid } from '../agent/index.ts'
import { toFinite, type Finite, type RenderedLayout } from '../agent/types.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'

const BASELINE = join(import.meta.dir, 'testdata', 'layout-geometry-baseline.json')
const UPDATE = process.env.UPDATE_LAYOUT_BASELINE === '1'
const MIN_CORPUS = 258 // matches the floor the harness smoke test pins

/** What we record per diagram: the canonical geometry, or that it does not lay
 *  out (parse failure / thrown). A previously-laying-out diagram that starts
 *  failing — or vice versa — is itself a regression this gate must catch. */
type Record_ = { ok: true; layout: RenderedLayout } | { ok: false }

function geometryOf(source: string): Record_ {
  const parsed = parseMermaid(source)
  if (!parsed.ok) return { ok: false }
  try {
    return { ok: true, layout: layoutMermaid(parsed.value) }
  } catch {
    return { ok: false }
  }
}

function currentGeometry(): Map<string, Record_> {
  const out = new Map<string, Record_>()
  for (const s of collectSamples()) out.set(s.id, geometryOf(s.source))
  return out
}

/** Compare paint placement, not newly retained measurement evidence. Text
 * footprints/visibility are asserted against renderer-owned prepared text at
 * their own boundaries; adding those observations must not bless moved nodes,
 * routes, labels, identities, membership or canvas bounds in this gate. */
function geometryOnly(record: Record_ | undefined): Record_ | null {
  if (!record?.ok) return record ?? null
  // These graph projections now retain exact physical evidence for quality.
  // Keep this gate's historical integer-pixel sentinel explicit here, while
  // native families retain their existing precision (including fractional C4).
  const graph = record.layout.kind === 'flowchart' || record.layout.kind === 'state'
  const coordinate = (n: Finite): Finite => graph ? toFinite(Math.round(n)) : n
  return {
    ok: true,
    layout: {
      ...record.layout,
      nodes: record.layout.nodes.map(({ labelBounds: _bounds, labelContainer: _container, labelVisibility: _visibility, dataPosition: _data, ...node }) => ({
        ...node, x: coordinate(node.x), y: coordinate(node.y), w: coordinate(node.w), h: coordinate(node.h),
      })),
      edges: record.layout.edges.map(edge => {
        const { visibility: _visibility, ...route } = edge
        const path = route.path.map(([x, y]) => [coordinate(x), coordinate(y)] as [Finite, Finite])
        if (!route.label) return { ...route, path }
        const { bounds: _bounds, ...label } = route.label
        return { ...route, path, label: { ...label, x: coordinate(label.x), y: coordinate(label.y) } }
      }),
      groups: record.layout.groups.map(group => ({ ...group, x: coordinate(group.x), y: coordinate(group.y), w: coordinate(group.w), h: coordinate(group.h) })),
      bounds: { w: coordinate(record.layout.bounds.w), h: coordinate(record.layout.bounds.h) },
    },
  }
}

const canon = (r: Record_ | undefined): string => JSON.stringify(geometryOnly(r))

/** Serialise one entry per line (id → compact record) so a geometry change
 *  shows up as a surgical one-line git diff, and so golden review localises to
 *  the exact diagram that moved. Sorted by id for a stable, corpus-order-
 *  independent file. */
function serializeBaseline(m: Map<string, Record_>): string {
  const entries = [...m.entries()].sort((a, b) => compareCodePointStrings(a[0], b[0]))
  return '{\n' + entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(geometryOnly(v))}`).join(',\n') + '\n}\n'
}

function loadBaseline(): Record<string, Record_> {
  return JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, Record_>
}

/** A short, actionable description of the FIRST divergence in a sample. */
function describeDiff(id: string, base: Record_ | undefined, cur: Record_ | undefined): string {
  base = geometryOnly(base) ?? undefined
  cur = geometryOnly(cur) ?? undefined
  if (!base) return `${id}: NEW (absent from baseline)`
  if (!cur) return `${id}: REMOVED (dropped from corpus)`
  if (base.ok !== cur.ok) return `${id}: lays-out ${base.ok} → ${cur.ok}`
  if (!base.ok || !cur.ok) return `${id}: differs`
  const b = base.layout,
    c = cur.layout
  if (b.kind !== c.kind) return `${id}: kind ${b.kind} → ${c.kind}`
  if (b.bounds.w !== c.bounds.w || b.bounds.h !== c.bounds.h) return `${id}: bounds ${b.bounds.w}×${b.bounds.h} → ${c.bounds.w}×${c.bounds.h}`
  if (b.nodes.length !== c.nodes.length) return `${id}: node count ${b.nodes.length} → ${c.nodes.length}`
  if (b.edges.length !== c.edges.length) return `${id}: edge count ${b.edges.length} → ${c.edges.length}`
  if (b.groups.length !== c.groups.length) return `${id}: group count ${b.groups.length} → ${c.groups.length}`
  for (let i = 0; i < c.nodes.length; i++) {
    if (JSON.stringify(b.nodes[i]) !== JSON.stringify(c.nodes[i])) {
      const bn = b.nodes[i]!,
        cn = c.nodes[i]!
      return `${id}: node ${cn.id} {x:${bn.x},y:${bn.y},w:${bn.w},h:${bn.h}} → {x:${cn.x},y:${cn.y},w:${cn.w},h:${cn.h}}`
    }
  }
  for (let i = 0; i < c.edges.length; i++) {
    if (JSON.stringify(b.edges[i]) !== JSON.stringify(c.edges[i])) return `${id}: edge ${c.edges[i]!.id} path/label changed`
  }
  for (let i = 0; i < c.groups.length; i++) {
    if (JSON.stringify(b.groups[i]) !== JSON.stringify(c.groups[i])) return `${id}: group ${c.groups[i]!.id} changed`
  }
  return `${id}: differs (geometry-equal but serialisation differs)`
}

describe('layout-equivalence gate', () => {
  test('corpus is non-trivially large (guards against the sample set silently emptying)', () => {
    expect(collectSamples().length).toBeGreaterThanOrEqual(MIN_CORPUS)
  })

  test('every corpus diagram is byte-identical to the committed geometry baseline', () => {
    const current = currentGeometry()

    if (UPDATE) {
      writeFileSync(BASELINE, serializeBaseline(current))
      console.log(`[layout-equivalence] wrote baseline: ${current.size} diagrams`)
      return
    }

    expect(existsSync(BASELINE)).toBe(true)
    const baseline = loadBaseline()

    const diffs: string[] = []
    for (const [id, cur] of current) {
      if (canon(baseline[id]) !== canon(cur)) diffs.push(describeDiff(id, baseline[id], cur))
    }
    for (const id of Object.keys(baseline)) {
      if (!current.has(id)) diffs.push(describeDiff(id, baseline[id], undefined))
    }

    if (diffs.length > 0) {
      const shown = diffs.slice(0, 25).join('\n  ')
      const more = diffs.length > 25 ? `\n  …and ${diffs.length - 25} more` : ''
      throw new Error(`${diffs.length} of ${current.size} diagram(s) diverged from the geometry baseline:\n  ${shown}${more}\n\n` + `If intentional: UPDATE_LAYOUT_BASELINE=1 bun test src/__tests__/layout-equivalence.test.ts, ` + `review the golden diff, and list each changed golden and why in the PR description.`)
    }
  })
})
