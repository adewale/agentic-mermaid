import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { buildBalancedPortfolio, FAMILY_QUOTA, portfolioProvenance } from '../../eval/mermaid-family-portfolio/build.ts'

const REPO = join(import.meta.dir, '../..')

test('balanced portfolio is registry-exact, quota-exact, parseable, and fresh', () => {
  const committed = JSON.parse(readFileSync(join(REPO, 'eval/mermaid-family-portfolio/corpus.json'), 'utf8'))
  const generated = buildBalancedPortfolio(REPO)
  expect(committed).toEqual(generated)
  expect(JSON.parse(readFileSync(join(REPO, 'eval/mermaid-family-portfolio/provenance.json'), 'utf8'))).toEqual(portfolioProvenance(generated))
  expect(generated).toHaveLength(BUILTIN_FAMILY_METADATA.length * FAMILY_QUOTA)

  const counts = new Map<string, number>()
  for (const entry of generated) {
    counts.set(entry.family, (counts.get(entry.family) ?? 0) + 1)
    const parsed = parseRegisteredMermaid(entry.source)
    expect({ origin: entry.origin, parsed: parsed.ok }).toEqual({ origin: entry.origin, parsed: true })
    if (!parsed.ok) continue
    const reparsed = parseRegisteredMermaid(serializeMermaid(parsed.value))
    expect({ origin: entry.origin, reparsed: reparsed.ok }).toEqual({ origin: entry.origin, reparsed: true })
  }
  expect([...counts.keys()].sort()).toEqual(BUILTIN_FAMILY_METADATA.map(entry => entry.id).sort())
  for (const [family, count] of counts) expect({ family, count }).toEqual({ family, count: FAMILY_QUOTA })
})
