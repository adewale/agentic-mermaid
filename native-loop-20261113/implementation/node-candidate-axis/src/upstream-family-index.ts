import rawIndex from './upstream-mermaid-family-index.json'
import { compareCodePointStrings } from './shared/deterministic-order.ts'

export type AgenticHeaderStatus = 'native' | 'unsupported' | 'inventory-only'

export interface UpstreamHeaderDescriptor {
  value: string
  agenticStatus: AgenticHeaderStatus
}

export interface UpstreamFamilyDescriptor {
  id: string
  headers: UpstreamHeaderDescriptor[]
}

/** Header routing for every public family of the pinned Mermaid version,
 * written by scripts/generate-upstream-family-index.ts. */
export interface UpstreamMermaidFamilyIndex {
  schemaVersion: 2
  provenance: {
    version: string
  }
  families: UpstreamFamilyDescriptor[]
}

export interface UpstreamHeaderMatch {
  family: UpstreamFamilyDescriptor
  header: UpstreamHeaderDescriptor
}

export const UPSTREAM_MERMAID_FAMILY_INDEX = rawIndex as UpstreamMermaidFamilyIndex

function normalizeFirstLine(firstLine: string): string {
  return (firstLine.split(';')[0] ?? '').trim().toLowerCase()
}

function headerMatches(line: string, authoredHeader: string): boolean {
  const header = authoredHeader.trim().toLowerCase()
  if (line === header) return true
  if (!line.startsWith(header)) return false
  const next = line[header.length]
  return next !== undefined && /[\s:]/.test(next)
}

/** Longest-header-first lookup prevents an alias prefix claiming a dialect. */
export function findUpstreamFamilyByHeader(
  firstLine: string,
  index: Pick<UpstreamMermaidFamilyIndex, 'families'> = UPSTREAM_MERMAID_FAMILY_INDEX,
): UpstreamHeaderMatch | null {
  const line = normalizeFirstLine(firstLine)
  const candidates = index.families
    .flatMap(family => family.headers.map(header => ({ family, header })))
    .sort((a, b) => b.header.value.length - a.header.value.length || compareCodePointStrings(a.family.id, b.family.id))
  return candidates.find(candidate => headerMatches(line, candidate.header.value)) ?? null
}
