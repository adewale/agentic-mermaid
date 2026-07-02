// Overlap fuzz across every renderable family: deterministic hash-seeded
// generators (./generators.ts) rendered to SVG and audited for label/box
// overlaps (./audit.ts). No RNG — the same N always checks the same cases.
//
//   bun run eval/overlap-audit/fuzz.ts             # 120 cases/family, summary
//   N=500 bun run eval/overlap-audit/fuzz.ts       # deeper sweep
//   bun run eval/overlap-audit/fuzz.ts --verbose   # per-case findings
import { renderMermaidSVG } from '../../src/index.ts'
import { audit } from './audit.ts'
import { gen } from './generators.ts'

const N = Number(process.env.N ?? 120)
const verbose = process.argv.includes('--verbose')
let totalAffected = 0
console.log(`overlap fuzz: ${N} cases per family`)
for (const [fam, g] of Object.entries(gen)) {
  let affected = 0, crashed = 0
  const kinds: Record<string, number> = {}
  let worst: { seed: number; findings: number } | undefined
  for (let i = 0; i < N; i++) {
    let findings
    try {
      const f = audit(renderMermaidSVG(g(i)))
      findings = fam === 'sequence' ? f.filter(x => x.kind !== 'BOX-BOX') : f
    } catch { crashed++; continue }
    if (findings.length === 0) continue
    affected++
    for (const k of new Set(findings.map(x => x.kind))) kinds[k] = (kinds[k] ?? 0) + 1
    if (!worst || findings.length > worst.findings) worst = { seed: i, findings: findings.length }
    if (verbose) console.log(`  ${fam} seed=${i}: ${findings.slice(0, 3).map(x => `${x.kind} ${x.a} vs ${x.b}`).join('; ')}`)
  }
  totalAffected += affected
  console.log(`${fam.padEnd(13)} affected=${String(affected).padStart(3)}/${N} (${Math.round(affected / N * 100)}%)${crashed ? ` crashed=${crashed}` : ''} ${JSON.stringify(kinds)}${worst ? ` worst seed=${worst.seed} (${worst.findings})` : ''}`)
}
process.exit(totalAffected === 0 ? 0 : 1)
