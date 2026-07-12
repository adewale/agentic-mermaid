// Label/box overlap gate (2026-07 audit). Labels were a measurement blind spot:
// no rubric metric checked label-label or label-box occlusion in ANY family, and
// the curated corpus itself carried collisions in five families (architecture
// edge-label pairs, quadrant point labels, gantt compact rows, state reciprocal
// pills, flowchart feedback pills). The corpus gate is HARD (zero findings); the
// fuzz ratchets pin the measured residual on adversarial-density inputs so it
// can only shrink — the residual cases are geometrically over-packed (several
// oversized labels in one corridor), documented in eval/overlap-audit.
import { describe, test, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { audit } from '../../eval/overlap-audit/audit.ts'
import { gen } from '../../eval/overlap-audit/generators.ts'
import { auditCorpus } from '../../eval/overlap-audit/corpus-gate.ts'

describe('label overlap gate', () => {
  test('curated corpus renders with zero overlap findings', () => {
    const { rendered, findings } = auditCorpus()
    expect(rendered).toBeGreaterThan(100)
    expect(findings.map(f => `${f.sample}: ${f.finding.kind} ${f.finding.a} vs ${f.finding.b}`)).toEqual([])
  })

  test('arbitrary-angle text remains visible to the overlap oracle', () => {
    const svg = `<svg viewBox="0 0 200 120">
      <g data-id="rotated"><text x="50" y="50" font-size="12" transform="rotate(45 50 50)">Rotated history label</text></g>
      <g data-id="plain"><text x="55" y="55" font-size="12">conflict</text></g>
    </svg>`
    expect(audit(svg)).toContainEqual(expect.objectContaining({ kind: 'TEXT-TEXT' }))
  })

  // Deterministic fuzz smoke (hash-seeded, 40 cases per family — the deep
  // sweep is eval/overlap-audit/fuzz.ts). Ceilings are the measured level at
  // the time the gate landed; lowering them requires a fix, raising them
  // requires a documented decision.
  const CEILINGS: Record<string, number> = {
    flowchart: 10, state: 12, sequence: 0, class: 0, er: 0, timeline: 0,
    gantt: 0, journey: 0, architecture: 1, xychart: 0, pie: 0, quadrant: 11,
    mindmap: 0, gitgraph: 0,
  }
  for (const [fam, g] of Object.entries(gen)) {
    test(`${fam}: fuzz affected-case count within ratchet (≤${CEILINGS[fam]})`, () => {
      let hit = 0
      for (let i = 0; i < 40; i++) {
        let findings
        try {
          const f = audit(renderMermaidSVG(g(i)))
          findings = fam === 'sequence' ? f.filter(x => x.kind !== 'BOX-BOX') : f
        } catch { hit++; continue }
        if (findings.length) hit++
      }
      expect(hit).toBeLessThanOrEqual(CEILINGS[fam]!)
    })
  }
})
