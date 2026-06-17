import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { layoutMermaid, parseMermaid, verifyMermaid } from '../agent/index.ts'

interface BenchCase {
  id: string
  family: string
  source: string
  upstream: { repo: string; files: string[]; blocks: string[] }
  assertions: {
    minNodes?: number
    minEdges?: number
    minGroups?: number
    labelsContain?: string[]
  }
}

interface Exclusion {
  id: string
  families: string[]
  reason: string
  summary: string
}

const ROOT = process.cwd()
const cases = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-upstream-suite-bench/cases.json'), 'utf8')) as BenchCase[]
const exclusions = JSON.parse(readFileSync(join(ROOT, 'eval/mermaid-upstream-suite-bench/exclusions.json'), 'utf8')) as Exclusion[]
const documentedReasons = new Set(['api-internal'])

function layoutLabels(layout: ReturnType<typeof layoutMermaid>): string[] {
  const labels: string[] = []
  for (const n of layout.nodes) if (n.label) labels.push(n.label)
  for (const e of layout.edges) if (e.label?.text) labels.push(e.label.text)
  for (const g of layout.groups) if (g.label) labels.push(g.label)
  return labels
}

describe('BUILD-20 Mermaid upstream parser/DB seed bench', () => {
  it('has a portable upstream-derived seed case for every renderable built-in family', () => {
    const covered = new Set(cases.map(c => c.family))
    const renderable = BUILTIN_FAMILY_METADATA.map(f => f.id)
    expect(renderable.length).toBeGreaterThan(0)
    for (const family of renderable) expect(covered.has(family)).toBe(true)
  })

  it('records upstream provenance and uses documented exclusion reasons', () => {
    for (const c of cases) {
      expect(c.id).toMatch(/^[a-z0-9-]+$/)
      expect(c.upstream.repo).toBe('mermaid-js/mermaid')
      expect(c.upstream.files.length).toBeGreaterThan(0)
      expect(c.upstream.blocks.length).toBeGreaterThan(0)
    }
    for (const e of exclusions) {
      expect(documentedReasons.has(e.reason)).toBe(true)
      expect(e.summary.length).toBeGreaterThan(20)
      expect(e.families.length).toBeGreaterThan(0)
    }
  })

  for (const c of cases) {
    it(`${c.id} parses, verifies, and lays out via public APIs`, () => {
      const parsed = parseMermaid(c.source)
      expect(parsed.ok, parsed.ok ? '' : parsed.error.map(e => e.message).join('; ')).toBe(true)
      if (!parsed.ok) return
      expect(String(parsed.value.kind)).toBe(c.family)

      const verification = verifyMermaid(parsed.value)
      expect(verification.ok, JSON.stringify(verification.warnings)).toBe(true)

      const layout = layoutMermaid(parsed.value)
      if (c.assertions.minNodes !== undefined) expect(layout.nodes.length).toBeGreaterThanOrEqual(c.assertions.minNodes)
      if (c.assertions.minEdges !== undefined) expect(layout.edges.length).toBeGreaterThanOrEqual(c.assertions.minEdges)
      if (c.assertions.minGroups !== undefined) expect(layout.groups.length).toBeGreaterThanOrEqual(c.assertions.minGroups)

      const labels = layoutLabels(layout).join('\n')
      for (const label of c.assertions.labelsContain ?? []) expect(labels).toContain(label)
    })
  }
})
