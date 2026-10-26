import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../../../src/agent/families.ts'
import { buildBalancedPortfolio } from '../../mermaid-family-portfolio/build.ts'
import { reviewedUpstreamCases } from '../../mermaid-upstream-suite-bench/cases.ts'
import { releaseBenchCases } from '../release-bench-cases.ts'
import type { UnifiedWorkload } from './types.ts'

export interface WorkloadAssertions {
  expectStructured?: boolean
  renderError?: string
  nodeCount?: number
  edgeCount?: number
  groupCount?: number
  minNodes?: number
  minEdges?: number
  minGroups?: number
  labelsContain?: readonly string[]
}
export interface WorkloadEvidence {
  assertions?: WorkloadAssertions
  reference?: Record<string, unknown>
  expected?: Record<string, unknown>
  diagnosticOnly?: boolean
  parserOnly?: boolean
  emptyDiagramExpected?: boolean
  labelsContainScope?: 'layout'
  origins: string[]
}

const ROOT = resolve(import.meta.dir, '../../..')
const evidence = new Map<string, WorkloadEvidence>()
const cache = new Map<string, UnifiedWorkload[]>()
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const object = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/** Existing stimulus owners are retained; feature tags identify scopes, not a
 * claim that one fixture proves every construct belonging to that family. */
function collect(profile: 'smoke' | 'full', includeDiagnostics: boolean): UnifiedWorkload[] {
  const key = `${profile}:${includeDiagnostics}`
  const previous = cache.get(key)
  if (previous) return previous
  const workloads: UnifiedWorkload[] = []
  const familyIds = new Set<string>(BUILTIN_FAMILY_METADATA.map(family => family.id))
  const add = (workload: UnifiedWorkload, details: Omit<WorkloadEvidence, 'origins'> = {}): void => {
    if (!familyIds.has(workload.family)) return
    evidence.set(workload.id, { ...details, origins: [workload.provenance] })
    if (!details.diagnosticOnly || includeDiagnostics) workloads.push(workload)
  }
  for (const family of BUILTIN_FAMILY_METADATA)
    add({
      id: `registry:${family.id}`,
      family: family.id,
      source: family.example,
      features: ['canonical-family-routing', 'canonical-source-lifecycle'],
      provenance: `src/agent/families.ts#${family.id}.example`,
    })
  if (profile === 'full') {
    for (const family of BUILTIN_FAMILY_METADATA)
      add({
        id: `editor:${family.id}`,
        family: family.id,
        source: family.editorExample,
        features: ['representative-editor-features', family.editorExampleId],
        provenance: `src/agent/families.ts#${family.editorExampleId}`,
      })
    buildBalancedPortfolio(ROOT).forEach((entry, index) =>
      add({
        id: `portfolio:${entry.family}:${index}`,
        family: entry.family,
        source: entry.source,
        features: ['balanced-family-portfolio', entry.sourceClass],
        provenance: entry.origin,
      }),
    )
    for (const entry of releaseBenchCases())
      add({
        id: `scaling:${entry.id}`,
        family: entry.family,
        source: entry.source,
        features: ['scaling', entry.id],
        provenance: `eval/benchmark/release-bench-cases.ts#${entry.id}`,
        ...(entry.expectedSvgLabels ? { expectedLabels: entry.expectedSvgLabels } : {}),
      })
    const directory = resolve(ROOT, 'eval')
    for (const name of readdirSync(directory).sort()) {
      if (!/^mermaid-.*-bench$/.test(name)) continue
      const file = resolve(directory, name, 'cases.json')
      if (!existsSync(file)) continue
      const entries = name === 'mermaid-upstream-suite-bench' ? reviewedUpstreamCases(ROOT) : read(file)
      if (!Array.isArray(entries)) continue
      for (const [index, raw] of entries.entries()) {
        const entry = object(raw)
        if (typeof entry.source !== 'string') continue
        const family = typeof entry.family === 'string' ? entry.family : name.slice('mermaid-'.length, -'-bench'.length)
        if (!familyIds.has(family)) continue
        const declared = object(entry.assertions)
        const assertions = Array.isArray(entry.assertions) || typeof entry.assertions !== 'object' ? undefined : (declared as WorkloadAssertions)
        const reference = object(entry.reference)
        const expected = object(entry.expect)
        const diagnosticOnly = reference.ok === false || typeof assertions?.renderError === 'string' || typeof expected.error === 'string' || expected.kind === 'error'
        const snapshot = object(reference.snapshot)
        const data = object(snapshot.data)
        const emptyDiagramExpected = (assertions?.nodeCount === 0 && assertions.edgeCount === 0 && assertions.groupCount === 0) || (Array.isArray(data.getPacket) && data.getPacket.length === 0) || (expected.kind === 'schedule' && Array.isArray(expected.tasks) && expected.tasks.length === 0)
        const parserOnly = expected.kind === 'parse'
        const id = typeof entry.id === 'string' ? entry.id : String(index)
        add(
          {
            id: `corpus:${name}:${id}`,
            family,
            source: entry.source,
            features: ['harvested-family-feature', id, ...Object.keys(expected).map(field => `expected:${field}`), ...Object.keys(declared).map(field => `asserted:${field}`)],
            provenance: `eval/${name}/cases.json#${id}`,
          },
          { ...(assertions ? { assertions } : {}), ...(Object.keys(reference).length ? { reference } : {}), ...(Object.keys(expected).length ? { expected } : {}), diagnosticOnly, parserOnly, emptyDiagramExpected, ...(assertions?.labelsContain ? { labelsContainScope: 'layout' as const } : {}) },
        )
      }
    }
    const probes = read(resolve(directory, 'mermaid-modern-compat/authored-probes.json'))
    if (Array.isArray(probes))
      for (const raw of probes) {
        const entry = object(raw)
        if (typeof entry.family !== 'string' || typeof entry.source !== 'string' || typeof entry.id !== 'string') continue
        add({
          id: `authored:${entry.id}`,
          family: entry.family,
          source: entry.source,
          features: ['modern-authored-regression', entry.id],
          provenance: `eval/mermaid-modern-compat/authored-probes.json#${entry.id}`,
          ...(Array.isArray(entry.expectedSvgLabels) ? { expectedLabels: entry.expectedSvgLabels as string[] } : {}),
        })
      }
  }
  // Every functionality owner keeps its own case id and independent
  // assertions, even when another owner uses identical source bytes. Only
  // performance enrollment deduplicates inputs, to avoid duplicate weighting.
  if (includeDiagnostics) {
    cache.set(key, workloads)
    return workloads
  }
  const distinct = new Map<string, UnifiedWorkload>()
  for (const workload of workloads) {
    const identity = JSON.stringify([workload.family, workload.source])
    const prior = distinct.get(identity)
    if (!prior) {
      distinct.set(identity, workload)
      continue
    }
    prior.features = [...new Set([...prior.features, ...workload.features])]
    prior.provenance += `; ${workload.provenance}`
    if (workload.expectedLabels) prior.expectedLabels = [...new Set([...(prior.expectedLabels ?? []), ...workload.expectedLabels])]
  }
  const result = [...distinct.values()]
  cache.set(key, result)
  return result
}

/** Positive render cohorts used identically by library/CLI/MCP/browser peers. */
export function unifiedWorkloads(profile: 'smoke' | 'full'): UnifiedWorkload[] {
  return collect(profile, false)
}

/** The feature suite retains expected-negative/reference-rejected diagnostics. */
export function familyFeatureWorkloads(profile: 'smoke' | 'full'): UnifiedWorkload[] {
  return collect(profile, true)
}

export function getWorkloadEvidence(id: string): WorkloadEvidence | undefined {
  return evidence.get(id)
}
export function getWorkloadAssertions(id: string): WorkloadAssertions | undefined {
  return evidence.get(id)?.assertions
}
