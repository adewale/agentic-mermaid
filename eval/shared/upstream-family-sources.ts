import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const policy = JSON.parse(readFileSync(new URL('../../docs/project/upstream-mermaid-policy.json', import.meta.url), 'utf8')) as {
  families: Array<{ id: string; source: 'core' | 'external-first-party' }>
}
const directories: Record<string, string> = { gitgraph: 'git', journey: 'user-journey', quadrant: 'quadrant-chart' }

export const externalFirstPartyFamilies = policy.families.filter(family => family.source === 'external-first-party').map(family => family.id)

/** Family classification is authoritative for package ownership. A first-party
 * plugin lives in its actual sibling package, not an invented core directory.
 * Missing/unreviewed source remains an execution error, never an empty suite. */
export function upstreamFamilySourceDirectory(upstream: string, family: string): string {
  const metadata = policy.families.find(item => item.id === family)
  if (!metadata) throw new Error(`No reviewed upstream source metadata for ${family}`)
  if (metadata.source === 'external-first-party') return join(upstream, 'packages', `mermaid-${family}`, 'src')
  if (metadata.source === 'core') return join(upstream, 'packages/mermaid/src/diagrams', directories[family] ?? family)
  throw new Error(`Unreviewed upstream source classification for ${family}`)
}
