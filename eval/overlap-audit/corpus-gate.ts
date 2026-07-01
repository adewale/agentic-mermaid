// Overlap gate over the curated site-sample corpus: renders every sample and
// audits label/box overlaps (see ./audit.ts). Exit code is non-zero on any
// finding, so it doubles as a CI gate.
//
//   bun run eval/overlap-audit/corpus-gate.ts            # summary + findings
//   bun run eval/overlap-audit/corpus-gate.ts --json     # machine-readable
//
// Known-legitimate pattern exempted: sequence-diagram activation bars nest by
// design, so BOX-BOX findings between plain primitives are skipped for
// sequenceDiagram sources (text checks still apply).
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
    const isSequence = /^\s*sequenceDiagram/.test(src)
    for (const f of audit(svg)) {
      if (isSequence && f.kind === 'BOX-BOX') continue
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
