import pins from './tool-versions.json' with { type: 'json' }

export interface BenchmarkToolVersion {
  tool: string
  version: string
  source: string
  /** Explicit candidate/baseline targets are separate version comparisons. */
  variant?: string
}

export const benchmarkToolPins = pins.tools
const aliases: Record<string, string> = { agentic: 'adewale/agentic-mermaid', pele: 'obsidianmd/pele', 'npm:pele': 'obsidianmd/pele', mermaid: 'mermaid-js/mermaid', 'npm:mermaid': 'mermaid-js/mermaid', 'agentic-mermaid': 'adewale/agentic-mermaid' }
export const canonicalBenchmarkTool = (tool: string) => {
  const name = tool.startsWith('npm:') ? tool.slice(4) : tool
  const normalized = name.includes('/') && !name.startsWith('@') ? name.toLowerCase() : name
  return aliases[normalized] ?? (pins.aliases as Record<string, string>)[normalized] ?? Object.entries(pins.tools).find(([, pin]) => pin.package === normalized)?.[0] ?? normalized
}

/** Admission/report policy, deliberately outside measured producer closures. */
export function assertBenchmarkToolVersion(tool: string, version: string, source: string): void {
  const canonical = canonicalBenchmarkTool(tool)
  if (typeof version !== 'string' || !version.trim() || version !== version.trim()) throw Error(`Missing artifact version for ${canonical} in ${source}`)
  const expected = (pins.tools as Record<string, { version: string }>)[canonical]?.version
  if (expected && version !== expected) throw Error(`Benchmark set requires ${canonical} ${expected}; ${source} supplied ${version}`)
}

export function assertBenchmarkSetVersions(claims: readonly BenchmarkToolVersion[]): BenchmarkToolVersion[] {
  const selected = new Map<string, BenchmarkToolVersion>()
  for (const claim of claims) {
    if (!claim.tool?.trim() || !claim.source?.trim()) throw Error('Benchmark tool version needs an owning tool and source')
    const tool = canonicalBenchmarkTool(claim.tool)
    assertBenchmarkToolVersion(tool, claim.version, claim.source)
    const variant = claim.variant === 'candidate' || claim.variant === 'default' ? undefined : claim.variant
    const key = JSON.stringify([tool, variant ?? null])
    const previous = selected.get(key)
    if (previous && previous.version !== claim.version) throw Error(`Mixed tool versions in one benchmark set: ${tool} ${previous.version} (${previous.source}) versus ${claim.version} (${claim.source})`)
    if (!previous) selected.set(key, { ...claim, tool, variant })
  }
  return [...selected.values()]
}
