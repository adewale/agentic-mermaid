/**
 * Ugly-layout audit — renders every diagram corpus in this project to SVG, PNG
 * and ASCII and runs the ugly-layout detectors (eval/ugly-detector/detect.ts,
 * specified by docs/design/ugly-layouts.md) over the RENDERED output.
 *
 *   bun run eval/ugly-detector/audit.ts            # audit, summary + hard findings
 *   bun run eval/ugly-detector/audit.ts --verbose  # also list soft findings
 *   bun run eval/ugly-detector/audit.ts --json      # machine-readable report
 *
 * Exit code is non-zero if any HARD finding is present, so it doubles as a CI
 * gate. SVG is authoritative; PNG inherits SVG structure plus a pixel sanity
 * pass; ASCII is the fidelity-degraded glyph-grid check.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidASCIIWithMeta } from '../../src/ascii/meta.ts'
import { contactSheetScenarios } from '../visual-rubric/scenarios.ts'
import { trackedExamples } from '../heuristic-tracker/catalog.ts'
import { samples } from '../../scripts/site/samples-data.ts'
import { detectSvg, parseSvg, detectPngPixels, detectAscii, type Finding } from './detect.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const PNG_SCALE = 2

interface Diagram { corpus: string; name: string; source: string }

/** Source above the final line that is exactly `---` (golden-fixture format). */
function goldenSource(text: string): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.trim() === '---') return lines.slice(0, i).join('\n')
  return ''
}

function corpora(): Diagram[] {
  const out: Diagram[] = []
  for (const s of contactSheetScenarios()) out.push({ corpus: 'contact-sheet', name: s.letter, source: s.source })
  for (const e of trackedExamples()) out.push({ corpus: 'tracker', name: `${e.group}/${e.name}`, source: e.source })
  for (const s of samples) out.push({ corpus: 'samples', name: s.title, source: s.source })
  const fixDir = join(root, 'eval', 'layout-compare', 'fixtures')
  for (const f of readdirSync(fixDir).filter(f => f.endsWith('.mmd')))
    out.push({ corpus: 'fixtures', name: f, source: readFileSync(join(fixDir, f), 'utf8') })
  for (const sub of ['ascii', 'unicode']) {
    const dir = join(root, 'src', '__tests__', 'testdata', sub)
    for (const f of readdirSync(dir).filter(f => f.endsWith('.txt'))) {
      const src = goldenSource(readFileSync(join(dir, f), 'utf8'))
      if (src.trim()) out.push({ corpus: `golden-${sub}`, name: f, source: src })
    }
  }
  return out
}

interface Result { d: Diagram; format: 'svg' | 'png' | 'ascii'; findings: Finding[]; error?: string }

function auditOne(d: Diagram): Result[] {
  const res: Result[] = []
  // SVG (authoritative)
  let svg = ''
  try {
    svg = renderMermaidSVG(d.source, { embedFontImport: false })
    res.push({ d, format: 'svg', findings: detectSvg(svg) })
  } catch (e) { res.push({ d, format: 'svg', findings: [], error: String(e) }) }
  // PNG (raster of the SVG: inherit SVG findings + pixel sanity pass)
  if (svg) {
    try {
      const img = new Resvg(svg, { background: 'white', fitTo: { mode: 'zoom', value: PNG_SCALE } }).render()
      const nodes = parseSvg(svg).nodes
      const pixel = detectPngPixels({ data: img.pixels, width: img.width, height: img.height }, nodes, PNG_SCALE)
      res.push({ d, format: 'png', findings: [...detectSvg(svg), ...pixel] })
    } catch (e) { res.push({ d, format: 'png', findings: [], error: String(e) }) }
  }
  // ASCII (glyph grid)
  try {
    const { ascii, regions } = renderMermaidASCIIWithMeta(d.source)
    res.push({ d, format: 'ascii', findings: detectAscii(ascii, regions) })
  } catch (e) { res.push({ d, format: 'ascii', findings: [], error: String(e) }) }
  return res
}

function main(): void {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose'), asJson = args.includes('--json')
  const diagrams = corpora()
  const all: Result[] = []
  for (const d of diagrams) all.push(...auditOne(d))

  const hard = all.flatMap(r => r.findings.filter(f => f.severity === 'hard').map(f => ({ r, f })))
  const soft = all.flatMap(r => r.findings.filter(f => f.severity === 'soft').map(f => ({ r, f })))
  const errors = all.filter(r => r.error)

  if (asJson) {
    console.log(JSON.stringify({
      diagrams: diagrams.length, audits: all.length,
      hard: hard.map(({ r, f }) => ({ corpus: r.d.corpus, name: r.d.name, format: r.format, ...f })),
      soft: soft.map(({ r, f }) => ({ corpus: r.d.corpus, name: r.d.name, format: r.format, ...f })),
      errors: errors.map(r => ({ corpus: r.d.corpus, name: r.d.name, format: r.format, error: r.error })),
    }, null, 2))
    process.exit(hard.length ? 1 : 0)
  }

  // Per-corpus × per-format summary table.
  const corpusNames = [...new Set(diagrams.map(d => d.corpus))]
  console.log('Ugly-layout audit — rendered SVG / PNG / ASCII')
  console.log('(SVG authoritative; PNG = SVG structure + pixel sanity; ASCII = glyph grid)\n')
  console.log('corpus'.padEnd(16), 'diagrams'.padStart(9), '  hard(svg/png/ascii)   soft   render-err')
  for (const c of corpusNames) {
    const ds = diagrams.filter(d => d.corpus === c)
    const rs = all.filter(r => r.d.corpus === c)
    const h = (fmt: string) => rs.filter(r => r.format === fmt).reduce((a, r) => a + r.findings.filter(f => f.severity === 'hard').length, 0)
    const s = rs.reduce((a, r) => a + r.findings.filter(f => f.severity === 'soft').length, 0)
    const err = rs.filter(r => r.error).length
    console.log(c.padEnd(16), String(ds.length).padStart(9), `   ${h('svg')} / ${h('png')} / ${h('ascii')}`.padEnd(20), String(s).padStart(4), String(err).padStart(10))
  }
  console.log('—'.repeat(64))
  console.log(`${diagrams.length} diagrams · ${all.length} format-audits · ${hard.length} HARD · ${soft.length} soft · ${errors.length} render-errors\n`)

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
  process.exit(hard.length ? 1 : 0)
}

main()
