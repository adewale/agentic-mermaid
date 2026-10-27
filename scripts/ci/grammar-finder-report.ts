import type { GrammarTriageResult } from '../../eval/mermaid-modern-compat/grammar-triage.ts'

export interface GrammarFinderSummary {
  seed: number
  mutationsPerFamily: number
  contractFindings: GrammarTriageResult[]
}

const block = (text: string): string => {
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(run => run[0].length + 1)))
  return `${fence}\n${text}\n${fence}`
}

/** One finite report of demonstrated failures. Previously reviewed source
 * bytes are still checked; only the recorded failure kind links to its owner.
 * Raw parser disagreements and issue/comment history never determine this. */
export function grammarFinderReport(summary: GrammarFinderSummary, runUrl: string): string {
  const findings = summary.contractFindings.filter(row => row.defects.some(defect => !defect.trackedBy))
  if (!findings.length) return ''
  let body = `This run found ${findings.length} retained input(s) with untracked grammar contract failures: ${runUrl}\n\n`
  body += `Seed: \`${summary.seed}\`; mutations per family: ${summary.mutationsPerFamily}. The run's \`grammar-finder-summary\` artifact retains all sources, canonical outputs, classifications and tracked failures. This issue covers this finite retained set; later runs do not append new inputs.\n`
  for (const row of findings) {
    const section = `\n### ${row.family}\n\n${block(JSON.stringify(row.source))}\n\n${row.defects.filter(item => !item.trackedBy).map(item => `- ${item.kind}: ${item.detail}`).join('\n')}\n\nCanonical output:\n${block(row.canonical ?? '(no structured output)')}\n`
    if (body.length + section.length > 55_000) { body += '\nFurther witnesses are retained in the artifact.\n'; break }
    body += section
  }
  return body + '\nDone when every retained failure is repaired with a regression test, or has a reviewed disposition and a scoped follow-up. A generous read alone is not a defect. Validate canonical output with pinned Mermaid, retain native meaning on reload, and diagnose/refuse source-only typed edits.\n'
}
