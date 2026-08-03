import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FIDELITY_SCORE_SCALE,
  MERMAID_FAMILY_FIDELITY_ASSESSMENTS,
  familyFidelityScores,
  type FamilyFidelityAssessment,
} from './rubric.ts'

const ROOT = resolve(import.meta.dir, '../..')
export const FAMILY_FIDELITY_REPORT_PATH = resolve(ROOT, 'docs/design/mermaid-renderer-fidelity-rubric.md')

function list(items: readonly string[]): string {
  return items.map(item => `- ${item}`).join('\n')
}

function scoreCells(assessment: FamilyFidelityAssessment): string {
  const scores = familyFidelityScores(assessment)
  return `| ${assessment.id} | ${scores.visual} | ${scores.quality} | ${assessment.dependencyDecision} | ${assessment.upstreamLibraries.join('; ')} |`
}

function detail(assessment: FamilyFidelityAssessment): string {
  const visual = assessment.scores.visual
  const quality = assessment.scores.quality
  const scores = familyFidelityScores(assessment)
  return `## ${assessment.id}\n\n` +
    `Visual familiarity: **${scores.visual}/100**; artifact quality: **${scores.quality}/100**; dependency decision: **${assessment.dependencyDecision}**.\n\n` +
    `Upstream engine: ${assessment.upstreamEngine}\n\n` +
    `Agentic engine: ${assessment.agenticEngine}\n\n` +
    `Decision: ${assessment.decision}\n\n` +
    `| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |\n` +
    `|---|---:|---:|---:|---:|---:|\n` +
    `| Score (0–4) | ${visual.layoutGeometry} | ${visual.routingTopology} | ${visual.paintStyling} | ${visual.labelsTypography} | ${visual.upstreamDifferential} |\n\n` +
    `| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |\n` +
    `|---|---:|---:|---:|---:|---:|\n` +
    `| Score (0–4) | ${quality.correctnessCoverage} | ${quality.robustness} | ${quality.determinism} | ${quality.semanticsAccessibility} | ${quality.configurationParity} |\n\n` +
    `Strengths:\n\n${list(assessment.strengths)}\n\n` +
    `Known gaps:\n\n${list(assessment.gaps)}\n\n` +
    `Next actions:\n\n${list(assessment.actions)}\n\n` +
    `Evidence:\n\n${list([
      ...assessment.upstreamEvidence.map(item => `Mermaid 11.16 source map \`${item.sourceMap}\` → \`${item.source}\``),
      ...assessment.agenticEvidence.map(path => `Agentic \`${path}\``),
    ])}\n`
}

export function renderFamilyFidelityReport(): string {
  const scale = Object.entries(FIDELITY_SCORE_SCALE).map(([score, meaning]) => `- **${score}** — ${meaning}`).join('\n')
  const table = MERMAID_FAMILY_FIDELITY_ASSESSMENTS.map(scoreCells).join('\n')
  const details = MERMAID_FAMILY_FIDELITY_ASSESSMENTS.map(detail).join('\n')
  return `# Secondary Mermaid visual-familiarity audit\n\n` +
    `Generated from \`eval/mermaid-family-fidelity/rubric.ts\` against the pinned Mermaid 11.16.0 package. Do not hand-edit this report.\n\n` +
    `## Claim boundary\n\n` +
    `This is a secondary migration/familiarity audit, not Agentic Mermaid's product objective. The primary contract is **Mermaid intent compatibility** in \`docs/design/mermaid-intent-compatibility-rubric.md\`: accept Mermaid syntax, preserve the author's facts, communicate the same relationships, and never lose unsupported intent silently. A different or improved layout is allowed.\n\n` +
    `This audit still separates visual familiarity from Agentic artifact quality. Internal Scene consistency, clean geometry, deterministic output, accessibility, or an attractive screenshot can raise artifact quality; none of those facts alone proves that the result looks like Mermaid. A 100 visual score requires same-engine or pinned differential evidence for every visual dimension, but no visual score overrides the intent contract.\n\n` +
    `Scores are evidence maturity, not aesthetic taste:\n\n${scale}\n\n` +
    `The five familiarity dimensions are layout geometry, routing/topology, paint/style, labels/typography, and upstream differential evidence. The five quality dimensions are correctness coverage, robustness, determinism, semantics/accessibility, and configuration parity. Each axis is averaged and scaled to 100; the two axes are never blended, and neither is blended into intent compatibility.\n\n` +
    `## Cross-family result\n\n` +
    `| Family | Visual familiarity /100 | Artifact quality /100 | Library decision | Mermaid library provenance |\n` +
    `|---|---:|---:|---|---|\n${table}\n\n` +
    `## How to repeat the assessment\n\n` +
    `1. Keep Mermaid pinned and record its renderer source plus library imports from the installed source maps.\n` +
    `2. Use a construct-stratified corpus: minimal syntax, official examples, dense/long-label stress, every direction/alignment, styling, and degenerate values.\n` +
    `3. Enforce the separate intent-compatibility contract first, then compare normalized geometry, topology/routes, paint resources, and label bounds. Raster similarity is supplementary because fonts and antialiasing can hide or exaggerate structural differences.\n` +
    `4. Score only the evidence that is checked continuously. A golden produced by Agentic is not an upstream oracle.\n` +
    `5. Record Agentic robustness improvements separately when they intentionally diverge from Mermaid.\n` +
    `6. Re-run \`bun run fidelity:families:check\`; a new family, missing source evidence, stale generated report, invalid score, or empty action list must fail.\n\n` +
    `## Library-adoption summary\n\n` +
    `These are engineering candidates, not instructions to copy Mermaid. Adopt a library only when it improves semantic correctness or maintainability without weakening Agentic's intent, determinism, safety, and accessibility contracts.\n\n` +
    `- **Pending family enrollment:** Sankey is not a built-in on this base. Evaluate \`d3-sankey\` behind the typed Scene adapter when Sankey is enrolled; do not claim adoption from an unmerged implementation.\n` +
    `- **Evaluate behind an adapter/oracle:** Architecture (Cytoscape/fCOSE), Mindmap (Cytoscape/Cose-Bilkent), XY chart (D3 scales/shapes), and Pie (D3 pie/arc).\n` +
    `- **Retain custom/ELK:** Flowchart, State, Class, ER, Sequence, Timeline, Journey, Quadrant, Gantt, GitGraph, and Radar. These either have deliberate product contracts, use an equally custom upstream layout, or gain too little from swapping a primitive. Differential tests are still required.\n\n` +
    details
}

export function checkFamilyFidelityReport(): void {
  const expected = renderFamilyFidelityReport()
  if (!existsSync(FAMILY_FIDELITY_REPORT_PATH) || readFileSync(FAMILY_FIDELITY_REPORT_PATH, 'utf8') !== expected) {
    throw new Error('docs/design/mermaid-renderer-fidelity-rubric.md is stale; run bun run fidelity:families')
  }
}

if (import.meta.main) {
  if (process.argv.includes('--check')) checkFamilyFidelityReport()
  else writeFileSync(FAMILY_FIDELITY_REPORT_PATH, renderFamilyFidelityReport())
}
