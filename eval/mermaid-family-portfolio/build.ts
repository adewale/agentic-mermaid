import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../../src/agent/families.ts'

export const FAMILY_QUOTA = 4

export interface PortfolioEntry {
  family: string
  source: string
  origin: string
  sourceClass: 'upstream-docs' | 'layout-fixture' | 'skill-fixture' | 'family-corpus' | 'registry-example'
}

function compareCodePoints(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0 }

function readSource(repo: string, path: string): string {
  return readFileSync(join(repo, path), 'utf8').trim()
}

function addCandidate(target: Map<string, PortfolioEntry[]>, entry: PortfolioEntry): void {
  const family = target.get(entry.family) ?? []
  if (!family.some(candidate => candidate.source === entry.source)) family.push(entry)
  target.set(entry.family, family)
}

export function buildBalancedPortfolio(repo: string): PortfolioEntry[] {
  const candidates = new Map<string, PortfolioEntry[]>()
  for (const family of BUILTIN_FAMILY_METADATA.map(entry => entry.id)) candidates.set(family, [])

  const docs = JSON.parse(readFileSync(join(repo, 'eval/mermaid-docs-corpus/corpus.json'), 'utf8')) as Array<{ family: string; source: string; origin: string; index: number }>
  const docsByFamily = new Map<string, typeof docs>()
  for (const entry of docs) docsByFamily.set(entry.family, [...(docsByFamily.get(entry.family) ?? []), entry])
  for (const family of BUILTIN_FAMILY_METADATA.map(entry => entry.id)) {
    for (const entry of (docsByFamily.get(family) ?? []).slice(0, 2)) {
      addCandidate(candidates, { family, source: entry.source, origin: `eval/mermaid-docs-corpus/${entry.origin}#${entry.index}`, sourceClass: 'upstream-docs' })
    }
  }

  for (const family of BUILTIN_FAMILY_METADATA.map(entry => entry.id)) {
    const path = `eval/layout-compare/fixtures/${family}-basic.mmd`
    if (existsSync(join(repo, path))) addCandidate(candidates, { family, source: readSource(repo, path), origin: path, sourceClass: 'layout-fixture' })
  }

  const skillFixtureRoot = join(repo, 'skill-evals/fixtures')
  for (const family of BUILTIN_FAMILY_METADATA.map(entry => entry.id)) {
    const directory = readdirSync(skillFixtureRoot).sort(compareCodePoints).find(name => name.startsWith(`${family}-`))
    if (!directory) continue
    const path = `skill-evals/fixtures/${directory}/input.mmd`
    addCandidate(candidates, { family, source: readSource(repo, path), origin: path, sourceClass: 'skill-fixture' })
  }

  const familyManifestPath = join(repo, 'eval/mindmap-gitgraph-content-corpus/manifest.json')
  const familyManifest = JSON.parse(readFileSync(familyManifestPath, 'utf8')) as { cases: Array<{ family: string; file: string }> }
  for (const entry of familyManifest.cases) {
    const path = `eval/mindmap-gitgraph-content-corpus/${entry.file}`
    addCandidate(candidates, { family: entry.family, source: readSource(repo, path), origin: path, sourceClass: 'family-corpus' })
  }

  const radar = JSON.parse(readFileSync(join(repo, 'eval/mermaid-radar-bench/harvest.json'), 'utf8')) as { examples: Array<{ id: string; source: string }> }
  for (const entry of radar.examples) addCandidate(candidates, { family: 'radar', source: entry.source.trim(), origin: `eval/mermaid-radar-bench/harvest.json#${entry.id}`, sourceClass: 'family-corpus' })

  for (const family of BUILTIN_FAMILY_METADATA) {
    addCandidate(candidates, { family: family.id, source: family.example.trim(), origin: `src/agent/families.ts#${family.id}`, sourceClass: 'registry-example' })
    addCandidate(candidates, { family: family.id, source: family.editorExample.trim(), origin: `src/agent/families.ts#${family.editorExampleId}`, sourceClass: 'registry-example' })
  }

  const portfolio: PortfolioEntry[] = []
  for (const family of BUILTIN_FAMILY_METADATA.map(entry => entry.id).sort(compareCodePoints)) {
    const available = candidates.get(family) ?? []
    if (available.length < FAMILY_QUOTA) throw new Error(`${family} has only ${available.length} distinct candidates; quota is ${FAMILY_QUOTA}`)
    portfolio.push(...available.slice(0, FAMILY_QUOTA))
  }
  return portfolio
}

export function portfolioProvenance(portfolio: PortfolioEntry[]): object {
  const familyCounts: Record<string, number> = {}
  const sourceClassCounts: Record<string, number> = {}
  for (const entry of portfolio) {
    familyCounts[entry.family] = (familyCounts[entry.family] ?? 0) + 1
    sourceClassCounts[entry.sourceClass] = (sourceClassCounts[entry.sourceClass] ?? 0) + 1
  }
  return {
    schemaVersion: 1,
    policy: { familyQuota: FAMILY_QUOTA, selection: 'registry-exact, provenance-diverse, deterministic first candidates by source class' },
    entries: portfolio.length,
    familyCounts: Object.fromEntries(Object.entries(familyCounts).sort(([a], [b]) => compareCodePoints(a, b))),
    sourceClassCounts: Object.fromEntries(Object.entries(sourceClassCounts).sort(([a], [b]) => compareCodePoints(a, b))),
    inputs: [
      'eval/mermaid-docs-corpus/corpus.json',
      'eval/layout-compare/fixtures',
      'skill-evals/fixtures',
      'eval/mindmap-gitgraph-content-corpus/manifest.json',
      'eval/mermaid-radar-bench/harvest.json',
      'src/agent/families.ts',
    ],
  }
}

if (import.meta.main) {
  const repo = join(import.meta.dir, '../..')
  const portfolio = buildBalancedPortfolio(repo)
  const outputs = [
    [join(import.meta.dir, 'corpus.json'), `${JSON.stringify(portfolio, null, 2)}\n`],
    [join(import.meta.dir, 'provenance.json'), `${JSON.stringify(portfolioProvenance(portfolio), null, 2)}\n`],
  ] as const
  const check = process.argv.includes('--check')
  for (const [path, content] of outputs) {
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== content) throw new Error(`${relative(repo, path)} is stale; run bun run eval:family-portfolio`)
    } else writeFileSync(path, content)
  }
  console.log(`${check ? 'Verified' : 'Wrote'} ${portfolio.length} examples (${FAMILY_QUOTA} × ${BUILTIN_FAMILY_METADATA.length} registered families)`)
}
