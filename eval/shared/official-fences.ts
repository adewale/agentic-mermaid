// Distinct examples from the pinned official syntax pages, shared by the
// conformance test and release gate. The external scorecard also inventories
// every occurrence, including duplicate fences and the mixed examples page.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const UPSTREAM_DOCS = join(ROOT, 'skills', 'agentic-mermaid-diagram-workflow', 'references', 'upstream')

export interface OfficialFence {
  id: string
  family: string
  source: string
}

export interface OfficialOccurrence extends OfficialFence {
  file: string
  line: number
  fence: string
  /** The existing distinct-example ID, when enrolled in the release gate. */
  releaseId?: string
}

/** Full external inventory, including duplicates and the mixed examples page.
 * Hash only the fetched upstream documents, not our generated manifest. */
export function officialCorpusInventory() {
  const policy = JSON.parse(readFileSync(join(ROOT, 'docs/project/upstream-mermaid-policy.json'), 'utf8')) as {
    pin: { version: string; commit: string }
    officialSyntaxPages: Record<string, string>
  }
  const families = new Map(Object.entries(policy.officialSyntaxPages).map(([family, file]) => [file, family]))
  const occurrences: OfficialOccurrence[] = []
  const pages = readdirSync(UPSTREAM_DOCS).filter(file => file.endsWith('.md')).sort().map(file => {
    const bytes = readFileSync(join(UPSTREAM_DOCS, file))
    const markdown = bytes.toString('utf8')
    const distinct = extractMermaidFences(markdown)
    const family = families.get(file) ?? file.replace(/\.md$/, '')
    const start = occurrences.length
    for (const match of markdown.matchAll(/^```(mermaid(?:-example)?)[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*$/gm)) {
      const source = match[2]!
      const line = markdown.slice(0, match.index).split('\n').length
      const index = distinct.indexOf(source.trim())
      occurrences.push({ id: `docs/syntax/${file}:${line}`, family, source, file, line, fence: match[1]!, ...(families.has(file) && index >= 0 ? { releaseId: `${family}:official-syntax/${file}#${index}` } : {}) })
    }
    return { file, family, sha256: createHash('sha256').update(bytes).digest('hex'), occurrences: occurrences.length - start, distinct: distinct.length, releaseGate: families.has(file) }
  })
  return {
    upstream: { repository: 'mermaid-js/mermaid', ...policy.pin },
    occurrenceCount: occurrences.length,
    distinctCount: new Set(occurrences.map(input => input.source.trim())).size,
    releaseInputCount: pages.filter(page => page.releaseGate).reduce((n, page) => n + page.distinct, 0),
    exclusions: pages.filter(page => !page.releaseGate).map(page => ({ file: page.file, occurrences: page.occurrences, reason: 'Outside the reviewed family/page mapping; retained in the complete browser scorecard.' })),
    pages,
    occurrences,
  }
}

/** Distinct Mermaid fences of a markdown page in first-occurrence order. */
function extractMermaidFences(markdown: string): string[] {
  const sources: string[] = []
  for (const match of markdown.matchAll(/^```mermaid(?:-example)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```[^\S\r\n]*$/gm)) {
    const source = match[1]!.trim()
    if (source && !sources.includes(source)) sources.push(source)
  }
  return sources
}

/** Distinct page examples, named `<family>:official-syntax/<page>#<index>`. */
export function extractOfficialCorpus(): OfficialFence[] {
  /** The reviewed family -> official syntax page mapping. */
  const officialPages = Object.entries((JSON.parse(readFileSync(join(ROOT, 'docs', 'project', 'upstream-mermaid-policy.json'), 'utf8')) as {
    officialSyntaxPages: Record<string, string>
  }).officialSyntaxPages)
  return officialPages.flatMap(([family, file]) =>
    extractMermaidFences(readFileSync(join(UPSTREAM_DOCS, file), 'utf8'))
      .map((source, index) => ({ id: `${family}:official-syntax/${file}#${index}`, family, source })))
}
