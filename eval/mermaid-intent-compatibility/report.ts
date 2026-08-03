import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../../src/agent/families.ts'
import { compareCodePointStrings } from '../../src/shared/deterministic-order.ts'
import { loadResearchHarvest } from './harvest.ts'
import {
  INTENT_EVIDENCE_SCALE,
  MERMAID_INTENT_COMPATIBILITY_ASSESSMENTS,
  familyDemandItems,
  familyIntentScores,
  type FamilyIntentAssessment,
} from './rubric.ts'
import {
  INTENT_CATEGORIES,
  RESEARCH_FAMILIES,
  validateResearchHarvest,
  type IntentCategory,
  type ResearchFamily,
  type ResearchHarvest,
  type ResearchItem,
} from './research.ts'

const ROOT = resolve(import.meta.dir, '../..')
export const INTENT_COMPATIBILITY_REPORT_PATH = resolve(ROOT, 'docs/design/mermaid-intent-compatibility-rubric.md')

function list(items: readonly string[]): string {
  return items.map(item => `- ${item}`).join('\n')
}

function fixed(value: number): string {
  return value.toFixed(2)
}

function link(item: ResearchItem): string {
  return `[${item.repository}#${item.number}](${item.url})`
}

function topItems(items: readonly ResearchItem[], limit = 5): string {
  if (items.length === 0) return '- No matching item was retained; this is a traceability gap.'
  return items.slice(0, limit).map(item =>
    `- ${link(item)} — ${item.title} (${item.kind}, score ${fixed(item.weight.score)}, updated ${item.updatedAt.slice(0, 10)})`,
  ).join('\n')
}

interface WeightedEvidenceRow {
  issueCount: number
  pullRequestCount: number
  issueWeight: number
  pullRequestWeight: number
}

function splitEvidence(items: readonly ResearchItem[]): WeightedEvidenceRow {
  const issues = items.filter(item => item.kind === 'issue')
  const pullRequests = items.filter(item => item.kind === 'pull-request')
  return {
    issueCount: issues.length,
    pullRequestCount: pullRequests.length,
    issueWeight: issues.reduce((sum, item) => sum + item.weight.score, 0),
    pullRequestWeight: pullRequests.reduce((sum, item) => sum + item.weight.score, 0),
  }
}

function weightedByCategory(harvest: ResearchHarvest): Array<{ category: IntentCategory } & WeightedEvidenceRow> {
  return INTENT_CATEGORIES.map(category => {
    const items = harvest.items.filter(item => item.categories.includes(category))
    return { category, ...splitEvidence(items) }
  }).sort((a, b) => b.issueWeight - a.issueWeight || b.pullRequestWeight - a.pullRequestWeight || compareCodePointStrings(a.category, b.category))
}

function weightedByFamily(harvest: ResearchHarvest): Array<{ family: ResearchFamily } & WeightedEvidenceRow> {
  return RESEARCH_FAMILIES.map(family => {
    const items = harvest.items.filter(item => item.families.includes(family))
    return { family, ...splitEvidence(items) }
  }).sort((a, b) => b.issueWeight - a.issueWeight || b.pullRequestWeight - a.pullRequestWeight || compareCodePointStrings(a.family, b.family))
}

function familySummaryRow(assessment: FamilyIntentAssessment, harvest: ResearchHarvest): string {
  const demand = familyDemandItems(assessment, harvest)
  const scores = familyIntentScores(assessment, harvest)
  const evidence = splitEvidence(demand)
  return `| ${assessment.id} | ${scores.overall} | ${scores.implementation} | ${scores.demandTraceability} | ${evidence.issueCount} | ${fixed(evidence.issueWeight)} | ${evidence.pullRequestCount} | ${fixed(evidence.pullRequestWeight)} | ${assessment.decision} |`
}

function detail(assessment: FamilyIntentAssessment, harvest: ResearchHarvest): string {
  const demand = familyDemandItems(assessment, harvest)
  const scores = familyIntentScores(assessment, harvest)
  const score = assessment.scores
  return `## ${assessment.id}\n\n` +
    `Intent compatibility: **${scores.overall}/100**; implementation evidence: **${scores.implementation}/100**; demand traceability: **${scores.demandTraceability}/4**; decision: **${assessment.decision}**.\n\n` +
    `Contract: ${assessment.contract}\n\n` +
    `| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |\n` +
    `|---|---:|---:|---:|---:|---:|\n` +
    `| Evidence level (0–4) | ${score.syntaxAcceptance} | ${score.semanticPreservation} | ${score.communicativeEquivalence} | ${score.noSilentLoss} | ${scores.demandTraceability} |\n\n` +
    `Facts AM must preserve:\n\n${list(assessment.preservedFacts)}\n\n` +
    `Presentation freedom:\n\n${list(assessment.presentationFreedom)}\n\n` +
    `Known intent risks:\n\n${list(assessment.knownRisks)}\n\n` +
    `Next actions:\n\n${list(assessment.actions)}\n\n` +
    `Executable evidence:\n\n${list(assessment.evidence.map(path => `\`${path}\``))}\n\n` +
    `Highest-weight matching user evidence (${demand.length} matching items):\n\n${topItems(demand)}\n`
}

export function renderIntentCompatibilityReport(harvest: ResearchHarvest): string {
  validateResearchHarvest(harvest)
  const scale = Object.entries(INTENT_EVIDENCE_SCALE).map(([score, meaning]) => `- **${score}** — ${meaning}`).join('\n')
  const familyRows = MERMAID_INTENT_COMPATIBILITY_ASSESSMENTS.map(assessment => familySummaryRow(assessment, harvest)).join('\n')
  const categoryRows = weightedByCategory(harvest).map(row => `| ${row.category} | ${row.issueCount} | ${fixed(row.issueWeight)} | ${row.pullRequestCount} | ${fixed(row.pullRequestWeight)} |`).join('\n')
  const familyDemand = weightedByFamily(harvest)
  const familyRowsResearch = familyDemand.slice(0, 24).map(row => `| ${row.family} | ${row.issueCount} | ${fixed(row.issueWeight)} | ${row.pullRequestCount} | ${fixed(row.pullRequestWeight)} |`).join('\n')
  const builtInFamilies = new Set<string>(BUILTIN_FAMILY_METADATA.map(family => family.id))
  const unsupportedFamilies = new Set<ResearchFamily>(
    RESEARCH_FAMILIES.filter(family => family !== 'cross-cutting' && !builtInFamilies.has(family)),
  )
  const unsupportedItems = harvest.items
    .filter(item => item.families.some(family => unsupportedFamilies.has(family)))
    .sort((a, b) => b.weight.score - a.weight.score || compareCodePointStrings(a.url, b.url))
  const repositoryCoverage = harvest.repositories.map(repository =>
    `- [${repository.repository}](${repository.url}): ${repository.issueCount} issues and ${repository.pullRequestCount} pull requests.`,
  ).join('\n')
  const details = MERMAID_INTENT_COMPATIBILITY_ASSESSMENTS.map(assessment => detail(assessment, harvest)).join('\n')

  return `# Mermaid intent-compatibility rubric\n\n` +
    `Generated from eval/mermaid-intent-compatibility/rubric.ts and the frozen GitHub harvest ${harvest.contentDigest.slice(0, 12)}. Do not hand-edit this report.\n\n` +
    `## North-star contract\n\n` +
    `Agentic Mermaid is not trying to become Mermaid. Given Mermaid syntax, it must preserve what the author meant and communicate the same facts. Layout, routing, typography, paint, collision handling, accessibility, determinism, and terminal projection may improve independently when those changes do not alter meaning.\n\n` +
    `The primary dimensions are syntax acceptance, semantic preservation, communicative equivalence, no silent loss, and demand traceability. Visual similarity is a secondary migration/familiarity audit in docs/design/mermaid-renderer-fidelity-rubric.md; it is not included in the intent score.\n\n` +
    `## Evidence scale\n\n${scale}\n\n` +
    `Scores measure executable evidence maturity, not aesthetic taste. Demand traceability is derived rather than assigned: 0 for no matching items, 1 for fewer than 3, 2 for 3–9 or one-sided evidence, and 3 for at least 10 items with at least three records from each repository and at least three issues and pull requests. Level 4 is reserved for GitHub items that are individually bound to minimized executable fixtures.\n\n` +
    `## GitHub demand research\n\n` +
    `Captured ${harvest.capturedAt} using ${harvest.collector}. ${harvest.collectionBoundary}\n\n` +
    `${repositoryCoverage}\n\n` +
    `Popularity is 1 + ln(1 + engagement), where engagement combines item reactions, comments, distinct participants, and PR reviews. Recency uses a ${harvest.weighting.activityHalfLifeDays}-day activity half-life with a ${harvest.weighting.recencyFloor} floor so durable older needs are never erased. Issues use multiplier ${harvest.weighting.issueMultiplier}; open PRs ${harvest.weighting.pullRequestMultiplier}; merged PRs ${harvest.weighting.mergedPullRequestMultiplier}; bot-authored items ${harvest.weighting.botMultiplier}. The final item score is popularity × recency × kind × actor. Issues remain demand evidence; PRs remain implementation evidence even when shown in one ranking.\n\n` +
    `Classification is deterministic keyword/label routing. Family routing uses titles and labels first, then falls back to bodies only when the headline has no family signal; intent categories use the full title/label/body text. It can miss euphemisms and produce legitimate multi-family matches; URLs and body digests are retained so important results can be manually audited without making an opaque model the authority.\n\n` +
    `### Demand and implementation supply by intent category\n\n| Category | Issues | Weighted demand | PRs | Weighted supply |\n|---|---:|---:|---:|---:|\n${categoryRows}\n\n` +
    `### Demand and implementation supply by diagram family\n\n| Family | Issues | Weighted demand | PRs | Weighted supply |\n|---|---:|---:|---:|---:|\n${familyRowsResearch}\n\n` +
    `### Highest-weight unsupported-family evidence\n\n${topItems(unsupportedItems, 12)}\n\n` +
    `## Built-in family result\n\n` +
    `| Family | Intent /100 | Implementation /100 | Demand trace /4 | Issues | Weighted demand | PRs | Weighted supply | Decision |\n` +
    `|---|---:|---:|---:|---:|---:|---:|---:|---|\n${familyRows}\n\n` +
    `## How this is operational\n\n` +
    `1. Run bun run intent:github:refresh to recrawl both repositories and replace the normalized harvest.\n` +
    `2. Run bun run intent:families to regenerate this report.\n` +
    `3. Run bun run intent:families:check in CI. It rejects missing families, invalid contracts/scores, missing evidence files, stale or tampered research, changed weighting, and report drift.\n` +
    `4. Convert high-weight items into minimized tests. Once individual issue/PR URLs are attached to those fixtures, raise demand traceability to level 4.\n` +
    `5. Revisit the harvest at least every ${120} days; the offline check deliberately expires old evidence.\n\n` +
    details
}

export function checkIntentCompatibilityReport(): void {
  const harvest = loadResearchHarvest()
  const expected = renderIntentCompatibilityReport(harvest)
  if (!existsSync(INTENT_COMPATIBILITY_REPORT_PATH) || readFileSync(INTENT_COMPATIBILITY_REPORT_PATH, 'utf8') !== expected) {
    throw new Error('docs/design/mermaid-intent-compatibility-rubric.md is stale; run bun run intent:families')
  }
}

if (import.meta.main) {
  if (process.argv.includes('--check')) checkIntentCompatibilityReport()
  else writeFileSync(INTENT_COMPATIBILITY_REPORT_PATH, renderIntentCompatibilityReport(loadResearchHarvest()))
}
