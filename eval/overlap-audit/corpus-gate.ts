// Overlap gate over the curated site-sample corpus: renders every sample and
// audits label/box overlaps (see ./audit.ts). Exit code is non-zero on any
// finding, so it doubles as a CI gate.
//
//   bun run eval/overlap-audit/corpus-gate.ts            # summary + findings
//   bun run eval/overlap-audit/corpus-gate.ts --json     # machine-readable
//
// Known-legitimate patterns exempted from the BOX-BOX rule (text and off-canvas
// checks still apply): sequence-diagram activation bars nest by design; and radar
// charts overlap by design — concentric graticule rings, filled curve silhouettes
// that cross each other, and vertex dots sitting on the rings are the metaphor,
// not a layout defect (analogous to how pie wedges, drawn as <path>, are already
// invisible to the circle/polygon box parser).
import { renderMermaidSVG } from '../../src/index.ts'
import { samples } from '../../scripts/site/samples-data.ts'
import { audit, type OverlapFinding } from './audit.ts'

export interface CorpusFinding { sample: string; finding: OverlapFinding }

export function auditCorpus(): { rendered: number; findings: CorpusFinding[] } {
  const findings: CorpusFinding[] = []
  let rendered = 0
  for (const s of samples) {
    const name = s.title
    const src = s.source
    if (!src) continue
    const svg = renderMermaidSVG(src)
    rendered++
    const boxExempt = /^\s*sequenceDiagram/.test(src) || /^\s*radar-beta\b/.test(src)
    for (const f of audit(svg)) {
      if (boxExempt && f.kind === 'BOX-BOX') continue
      findings.push({ sample: name, finding: f })
    }
  }
  return { rendered, findings }
}

if (import.meta.main) {
  const { rendered, findings } = auditCorpus()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ rendered, findings }, null, 2))
  } else {
    console.log(`overlap corpus gate: ${rendered} samples, ${findings.length} finding(s)`)
    for (const { sample, finding } of findings) {
      console.log(`  ${sample}: ${finding.kind} ${finding.a} vs ${finding.b} pen=${finding.pen.toFixed(1)}`)
    }
  }
  process.exit(findings.length === 0 ? 0 : 1)
}
