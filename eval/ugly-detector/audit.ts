/**
 * Ugly-layout audit — renders every enrolled quality source in this project to
 * SVG, PNG, ASCII, and Unicode and runs the ugly-layout detectors (eval/ugly-detector/detect.ts,
 * specified by docs/design/system/ugly-layouts.md) over the RENDERED output.
 *
 *   bun run eval/ugly-detector/audit.ts            # audit, summary + hard findings
 *   bun run eval/ugly-detector/audit.ts --verbose  # also list soft findings
 *   bun run eval/ugly-detector/audit.ts --json      # machine-readable report
 *
 * Exit code is non-zero if any HARD finding is present, so it doubles as a CI
 * gate. SVG is authoritative; PNG inherits SVG structure plus a pixel sanity
 * pass; terminal outputs are fidelity-degraded glyph-grid checks.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { layoutMermaid, parseRegisteredMermaid } from '../../src/agent/index.ts'
import { renderMermaidASCIIWithMeta } from '../../src/ascii/meta.ts'
import { contactSheetScenarios } from '../visual-rubric/scenarios.ts'
import { trackedExamples } from '../heuristic-tracker/catalog.ts'
import { samples } from '../../scripts/site/samples-data.ts'
import { parseAsciiGoldenFixture } from '../../scripts/ascii-golden-fixture.ts'
import { detect, parseSvg, detectPngPixels, detectAscii, type Finding } from './detect.ts'
import { compareCodePointStrings } from '../../src/shared/deterministic-order.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const PNG_SCALE = 2

type TerminalFormat = 'ascii' | 'unicode'
export interface Diagram {
  corpus: string
  name: string
  source: string
  terminalOptions?: { paddingX: number; paddingY: number }
}

function filesUnder(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => compareCodePointStrings(a.name, b.name))
    .flatMap(entry => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? filesUnder(path, extension) : entry.name.endsWith(extension) ? [path] : []
    })
}

/** Enroll every authored eval .mmd automatically so a new repository corpus
 * cannot sit outside the quality gate merely because this roster was not
 * hand-edited. Code-defined scenarios and terminal goldens remain explicit
 * authorities with separate corpus labels. */
export function collectCorpusDiagrams(): Diagram[] {
  const out: Diagram[] = []
  for (const s of contactSheetScenarios()) out.push({ corpus: 'contact-sheet', name: s.letter, source: s.source })
  for (const e of trackedExamples()) out.push({ corpus: 'tracker', name: `${e.group}/${e.name}`, source: e.source })
  for (const s of samples) out.push({ corpus: 'samples', name: s.title, source: s.source })
  const evalRoot = join(root, 'eval')
  for (const path of filesUnder(evalRoot, '.mmd')) {
    const name = relative(evalRoot, path).replaceAll('\\', '/')
    const topLevelCorpus = name.split('/')[0]!
    out.push({
      corpus: topLevelCorpus === 'layout-compare' ? 'fixtures' : `eval-${topLevelCorpus}`,
      name,
      source: readFileSync(path, 'utf8'),
    })
  }
  for (const sub of ['ascii', 'unicode'] as const) {
    const dir = join(root, 'src', '__tests__', 'testdata', sub)
    for (const path of filesUnder(dir, '.txt')) {
      const fixture = parseAsciiGoldenFixture(readFileSync(path, 'utf8'))
      if (fixture.mermaid.trim()) out.push({
        corpus: `golden-${sub}`,
        name: relative(dir, path).replaceAll('\\', '/'),
        source: fixture.mermaid,
        terminalOptions: { paddingX: fixture.paddingX, paddingY: fixture.paddingY },
      })
    }
  }
  return out
}

interface StructuralAdmission { source: 'rendered-layout'; nodes: number; edges: number; groups: number }
export interface Result {
  d: Diagram
  format: 'svg' | 'png' | TerminalFormat
  findings: Finding[]
  error?: string
  structuralAdmission?: StructuralAdmission
  svgMarkupAdmission?: { nodes: number; edges: number }
}

function inspectRenderedLayout(source: string): { admission?: StructuralAdmission; findings: Finding[]; error?: string } {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) return { findings: [], error: parsed.error.map(error => error.message).join('; ') }
  let layout: ReturnType<typeof layoutMermaid>
  try {
    layout = layoutMermaid(parsed.value)
  } catch (error) {
    return { findings: [], error: String(error) }
  }
  if (layout.nodes.length === 0 && layout.edges.length === 0 && layout.groups.length === 0) {
    return { findings: [], error: `${parsed.value.kind} produced no structural layout evidence` }
  }
  const findings: Finding[] = []
  const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)
  for (const node of layout.nodes) {
    if (![node.x, node.y, node.w, node.h].every(finite) || Number(node.w) < 0 || Number(node.h) < 0) {
      findings.push({ kind: 'invalid-layout-geometry', severity: 'hard', detail: `${node.id} has non-finite or negative bounds` })
    }
  }
  for (const edge of layout.edges) {
    if (edge.path.length < 2 || edge.path.some(point => !finite(point[0]) || !finite(point[1]))) {
      findings.push({ kind: 'invalid-layout-geometry', severity: 'hard', detail: `${edge.id} has an invalid rendered path` })
    }
  }
  for (const group of layout.groups) {
    if (![group.x, group.y, group.w, group.h].every(finite) || Number(group.w) < 0 || Number(group.h) < 0) {
      findings.push({ kind: 'invalid-layout-geometry', severity: 'hard', detail: `${group.id} has non-finite or negative bounds` })
    }
  }
  return {
    admission: { source: 'rendered-layout', nodes: layout.nodes.length, edges: layout.edges.length, groups: layout.groups.length },
    findings,
  }
}

export function auditOne(d: Diagram): Result[] {
  const res: Result[] = []
  // Every registered family admits its renderer-owned RenderedLayout for
  // family-generic finite/path/shared-label checks. The SVG parser adds deeper
  // mark-level checks where the markup carries the flowchart node/edge shape.
  const structure = inspectRenderedLayout(d.source)
  let svg = ''
  let markup = { nodes: 0, edges: 0 }
  let svgError: string | undefined = structure.error
  let svgFindings = [...structure.findings]
  try {
    svg = renderMermaidSVG(d.source, { embedFontImport: false })
    const parsedSvg = parseSvg(svg)
    markup = { nodes: parsedSvg.nodes.length, edges: parsedSvg.edges.length }
    svgFindings = [...svgFindings, ...detect(parsedSvg)]
  } catch (error) {
    const renderError = String(error)
    svgError = svgError ? `${svgError}; ${renderError}` : renderError
  }
  res.push({
    d,
    format: 'svg',
    findings: svgFindings,
    ...(svgError ? { error: svgError } : {}),
    ...(structure.admission ? { structuralAdmission: structure.admission } : {}),
    svgMarkupAdmission: markup,
  })

  // PNG (raster of the SVG: inherit structural findings + pixel sanity pass)
  if (svg) {
    try {
      const img = new Resvg(svg, { background: 'white', fitTo: { mode: 'zoom', value: PNG_SCALE } }).render()
      const nodes = parseSvg(svg).nodes
      const pixel = detectPngPixels({ data: img.pixels, width: img.width, height: img.height }, nodes, PNG_SCALE)
      res.push({
        d,
        format: 'png',
        findings: [...svgFindings, ...pixel],
        ...(structure.admission ? { structuralAdmission: structure.admission } : {}),
        svgMarkupAdmission: markup,
      })
    } catch (e) { res.push({ d, format: 'png', findings: [], error: String(e) }) }
  } else {
    res.push({ d, format: 'png', findings: [], error: 'SVG render unavailable; PNG audit could not run' })
  }
  // Terminal projections are separate contracts: plain ASCII and Unicode must
  // both be exercised rather than reporting the Unicode default as "ASCII".
  for (const format of ['ascii', 'unicode'] as const) {
    try {
      const { ascii, regions, warnings } = renderMermaidASCIIWithMeta(d.source, {
        ...d.terminalOptions,
        useAscii: format === 'ascii',
      })
      const failure = warnings.find(warning => warning.code === 'ASCII_RENDER_FAILED')
      if (failure) res.push({ d, format, findings: [], error: failure.message })
      else if (!ascii.trim()) res.push({ d, format, findings: [], error: 'Terminal renderer returned empty output without a failure diagnostic' })
      else res.push({ d, format, findings: detectAscii(ascii, regions, { useAscii: format === 'ascii' }) })
    } catch (e) { res.push({ d, format, findings: [], error: String(e) }) }
  }
  return res
}

function main(): void {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose'), asJson = args.includes('--json')
  const diagrams = collectCorpusDiagrams()
  const all: Result[] = []
  for (const d of diagrams) all.push(...auditOne(d))

  const hard = all.flatMap(r => r.findings.filter(f => f.severity === 'hard').map(f => ({ r, f })))
  const soft = all.flatMap(r => r.findings.filter(f => f.severity === 'soft').map(f => ({ r, f })))
  const errors = all.filter(r => r.error)
  const svgResults = all.filter(result => result.format === 'svg')
  const coverage = {
    renderedLayoutStructural: svgResults.filter(result => result.structuralAdmission).length,
    svgMarkupStructural: svgResults.filter(result => (result.svgMarkupAdmission?.nodes ?? 0) + (result.svgMarkupAdmission?.edges ?? 0) > 0).length,
  }

  if (asJson) {
    console.log(JSON.stringify({
      diagrams: diagrams.length, audits: all.length, coverage,
      hard: hard.map(({ r, f }) => ({ corpus: r.d.corpus, name: r.d.name, format: r.format, ...f })),
      soft: soft.map(({ r, f }) => ({ corpus: r.d.corpus, name: r.d.name, format: r.format, ...f })),
      errors: errors.map(r => ({ corpus: r.d.corpus, name: r.d.name, format: r.format, error: r.error })),
    }, null, 2))
    process.exit(hard.length || errors.length ? 1 : 0)
  }

  // Per-corpus × per-format summary table.
  const corpusNames = [...new Set(diagrams.map(d => d.corpus))]
  console.log('Ugly-layout audit — rendered SVG / PNG / ASCII / Unicode')
  console.log('(SVG authoritative; PNG = SVG structure + pixel sanity; terminal projections = display-cell grids)\n')
  console.log('corpus'.padEnd(16), 'diagrams'.padStart(9), '  hard(svg/png/ascii/unicode)   soft   render-err')
  for (const c of corpusNames) {
    const ds = diagrams.filter(d => d.corpus === c)
    const rs = all.filter(r => r.d.corpus === c)
    const h = (fmt: string) => rs.filter(r => r.format === fmt).reduce((a, r) => a + r.findings.filter(f => f.severity === 'hard').length, 0)
    const s = rs.reduce((a, r) => a + r.findings.filter(f => f.severity === 'soft').length, 0)
    const err = rs.filter(r => r.error).length
    console.log(c.padEnd(16), String(ds.length).padStart(9), `   ${h('svg')} / ${h('png')} / ${h('ascii')} / ${h('unicode')}`.padEnd(30), String(s).padStart(4), String(err).padStart(10))
  }
  console.log('—'.repeat(64))
  console.log(`${diagrams.length} diagrams · ${all.length} format-audits · ${hard.length} HARD · ${soft.length} soft · ${errors.length} render-errors`)
  console.log(`structural admission: ${coverage.renderedLayoutStructural}/${diagrams.length} renderer layouts; ${coverage.svgMarkupStructural}/${diagrams.length} SVG markup adapters\n`)

  if (hard.length) {
    console.log('HARD findings (a finished render must have zero):')
    for (const { r, f } of hard) console.log(`  [${r.d.corpus}/${r.d.name}] (${r.format}) ${f.kind}: ${f.detail}`)
  } else {
    console.log('✓ no hard ugly-layout defects in any rendered diagram')
  }
  if (verbose && soft.length) {
    console.log('\nSoft findings (minimized in good layouts):')
    for (const { r, f } of soft) console.log(`  [${r.d.corpus}/${r.d.name}] (${r.format}) ${f.kind}: ${f.detail}`)
  }
  if (errors.length) {
    console.log(`\nRender errors (diagram type unsupported by a renderer — not a layout defect):`)
    const byErr = new Map<string, number>()
    for (const r of errors) { const k = `${r.format}: ${r.error!.split('\n')[0]!.slice(0, 70)}`; byErr.set(k, (byErr.get(k) ?? 0) + 1) }
    for (const [k, n] of byErr) console.log(`  ×${n}  ${k}`)
  }
  process.exit(hard.length || errors.length ? 1 : 0)
}

if (import.meta.main) main()
