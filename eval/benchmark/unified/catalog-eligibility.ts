/** Catalog eligibility is configuration evidence, never proof of measured capability. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

interface CatalogNode {
  id: string
  relation?: string
  parent?: string
  head?: string
  runtime?: string
  outputs: string[]
  roles: string[]
  repo?: string
  notes?: string
  vsParent?: { ahead: number; behind: number }
  packages?: Array<{ registry: string; name: string; version: string }>
  benchmark?: { adapter: string; package?: string; version?: string; versionPolicy?: string; sourceAdapter?: string; sourcePin?: string; outputs?: string[] }
  benchmarkEligibility?: { classification: string; engineScope: string; adapterReview: string; reason: string }
}
interface Catalog {
  nodes: CatalogNode[]
  checkedAt?: string
}
/** A preparer must supply this explicit reviewed recipe/runtime evidence before aliasing. */
export interface CatalogArtifactAdmission {
  sourceProgramClass?: string
  artifactClass?: 'git-interpreted-source' | 'compiled-or-shipped'
  apiAdmission?: string
  revision?: string
  sourceRevision?: string
  buildRecipeId?: string
  runtimeCommandId?: string
  runtimeVersion?: string
  reviewed?: boolean
  root?: string
  executable?: string
  module?: string
  sha256?: string
  files?: Array<{ path: string; sha256: string }>
}
const normalize = (output: string) => (({ 'ascii-unicode': 'terminal', ascii: 'terminal', unicode: 'terminal', ast: 'parse', 'mermaid-text': 'source' }) as Record<string, string>)[output] ?? output
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
export function catalogNodeEligibility(node: CatalogNode) {
  const outputs = [...new Set([...node.outputs, ...(node.benchmark?.outputs ?? [])].map(normalize))],
    configuredOutputs = new Set((node.benchmark?.outputs ?? []).map(normalize))
  const relation = node.relation ?? 'unclassified',
    ahead = node.vsParent?.ahead,
    behind = node.vsParent?.behind
  const classification =
    node.benchmarkEligibility?.classification ??
    (relation === 'binding' ? 'runtime-binding' : relation === 'port' ? 'port-implementation' : relation === 'fork' ? (Number(ahead) > 0 ? 'diverged-fork' : behind === 0 ? 'same-parent-source-head' : 'historical-upstream-revision') : relation === 'root' ? 'language-reference' : 'independently-rooted-implementation')
  const engineScope = node.benchmarkEligibility?.engineScope ?? (relation === 'binding' ? 'shared-engine-runtime-variant' : relation === 'fork' ? 'lineage-related-implementation' : 'implementation-candidate')
  const reason =
    node.benchmarkEligibility?.reason ??
    `Catalog records ${relation} lineage, ${node.runtime ?? 'unreviewed runtime'}, and ${outputs.join(', ')} outputs. ${node.benchmark ? 'An adapter is configured; actual execution/admission is reported separately.' : 'No adapter has been admitted; applicability is unmeasured, not globally not-applicable.'}`
  return {
    id: node.id,
    classification,
    engineScope,
    reason,
    roles: node.roles,
    runtime: node.runtime ?? null,
    state: node.benchmark ? 'configured-awaiting-run-evidence' : 'unmeasured-adapter-gap',
    adapterReview: node.benchmarkEligibility?.adapterReview ?? 'unreviewed',
    operations: outputs.map(output => ({
      output,
      operation: output === 'parse' ? 'parse' : output === 'diagnostics' ? 'validate' : output === 'source' ? 'format-or-serialize' : output === 'react-flow' ? 'convert' : 'render',
      configured: configuredOutputs.has(output),
      state: configuredOutputs.has(output) ? 'configured-not-yet-qualified' : 'declared-unmeasured',
      reason: configuredOutputs.has(output) ? 'Actual API/format/family admission and timings require the benchmark result; configuration is not a pass.' : 'Catalog declares this operation but no output binding is configured; missing coverage is not a zero score.',
    })),
    acquisition: node.benchmark?.package
      ? { kind: 'npm', package: node.benchmark.package, version: node.benchmark.version ?? node.packages?.find(pkg => pkg.name === node.benchmark!.package)?.version ?? null, versionPolicy: node.benchmark.versionPolicy ?? 'runner-policy-explicit-in-run' }
      : { kind: node.benchmark?.adapter === 'agentic' ? 'local-candidate' : 'pinned-source-or-distribution', repo: node.repo ?? null, sourcePin: node.benchmark?.sourcePin ?? node.head ?? null },
    benchmark: node.benchmark ?? null,
  }
}
function candidateGroupKey(node: CatalogNode): string | undefined {
  if (node.benchmark?.adapter !== 'extra-source' || !node.benchmark.sourcePin || !/^[a-f0-9]{40}$/.test(node.benchmark.sourcePin) || !node.benchmark.sourceAdapter) return undefined
  // Identical complete Git commit objects plus the same requested build/public invocation recipe.
  return JSON.stringify([node.benchmark.sourcePin, node.benchmark.sourceAdapter, [...new Set((node.benchmark.outputs ?? []).map(normalize))].sort()])
}
function admittedIdentity(node: CatalogNode, artifact: CatalogArtifactAdmission | undefined) {
  if (artifact?.artifactClass === 'git-interpreted-source' || artifact?.sourceProgramClass === 'git-interpreted-source') throw Error('Interpreted source uses Git object identity and cannot alias from interpreter bytes')
  if (artifact?.apiAdmission === 'deferred-browser') throw Error('Public browser protocol admission is still deferred')
  if (!artifact?.reviewed || !artifact.buildRecipeId || !artifact.runtimeCommandId || !artifact.runtimeVersion) throw Error('Reviewed build/runtime recipe evidence is missing')
  if ((artifact.sourceRevision ?? artifact.revision) !== node.benchmark?.sourcePin) throw Error('Actual artifact revision differs from the complete Git pin')
  const entry = artifact.executable ?? artifact.module
  if (!entry || /\.(?:tsx?|rs|go|py)$/.test(entry) || !artifact.sha256 || !existsSync(entry) || hash(entry) !== artifact.sha256) throw Error('Actual compiled/distributed entry digest is absent or mismatched')
  const files = (artifact.files ?? [])
    .map(file => {
      if (!existsSync(file.path) || hash(file.path) !== file.sha256) throw Error('Artifact closure digest is mismatched: ' + file.path)
      return { path: relative(artifact.root ?? dirname(entry), realpathSync(file.path)), sha256: file.sha256 }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  return { sourceRevision: artifact.sourceRevision ?? artifact.revision, buildRecipeId: artifact.buildRecipeId, runtimeCommandId: artifact.runtimeCommandId, runtimeVersion: artifact.runtimeVersion, entrySha256: artifact.sha256, files }
}
export function createCatalogEligibility(catalog: Catalog, artifacts: Record<string, CatalogArtifactAdmission> = {}) {
  const nodes = catalog.nodes.map(catalogNodeEligibility)
  if (new Set(nodes.map(node => node.id)).size !== nodes.length) throw Error('Catalog IDs are not unique')
  const groups = new Map<string, CatalogNode[]>()
  for (const node of catalog.nodes) {
    const key = candidateGroupKey(node)
    if (key) groups.set(key, [...(groups.get(key) ?? []), node])
  }
  const equivalenceGroups = [...groups.values()]
    .filter(group => group.length > 1)
    .map(group => {
      const evidence = group.map(node => {
        try {
          return { id: node.id, admitted: true, identity: admittedIdentity(node, artifacts[node.id]), entryPath: realpathSync((artifacts[node.id]!.executable ?? artifacts[node.id]!.module)!) }
        } catch (error) {
          return { id: node.id, admitted: false, error: String(error) }
        }
      })
      const verified = evidence.every(entry => entry.admitted) && evidence.every(entry => JSON.stringify('identity' in entry ? entry.identity : null) === JSON.stringify('identity' in evidence[0]! ? evidence[0]!.identity : null))
      return {
        sourcePin: group[0]!.benchmark!.sourcePin,
        sourceAdapter: group[0]!.benchmark!.sourceAdapter,
        outputs: group[0]!.benchmark!.outputs,
        members: group.map(node => node.id),
        canonicalCandidate: group[0]!.id,
        status: verified ? 'verified-artifact-equivalence' : 'candidate-only-no-evidence-reuse',
        evidence,
        aliases: verified ? group.slice(1).map(node => ({ id: node.id, evidenceFrom: group[0]!.id })) : [],
        policy: 'Never alias from root sharing, ahead/behind counts, names or Git pin alone. Reuse requires actual entry/closure byte admission plus identical reviewed build/runtime recipes, runtime versions and output protocols.',
      }
    })
  const forkNodes = catalog.nodes.filter(node => node.relation === 'fork'),
    zeroAhead = forkNodes.filter(node => node.vsParent?.ahead === 0)
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    catalogCheckedAt: catalog.checkedAt ?? null,
    summary: {
      catalogNodes: nodes.length,
      configuredNodes: nodes.filter(node => node.benchmark).length,
      candidateAdaptersAwaitingApiArtifactAttempt: nodes.filter(node => node.adapterReview.startsWith('candidate-')).length,
      existingAdapters: nodes.filter(node => node.adapterReview.startsWith('existing-adapter')).length,
      declaredOperationsWithoutOutputBinding: nodes.reduce((count, node) => count + node.operations.filter(operation => !operation.configured).length, 0),
      adapterGaps: nodes.filter(node => !node.benchmark).length,
      zeroAheadForks: zeroAhead.length,
      recordedExactParentHeadForks: zeroAhead.filter(node => node.vsParent?.behind === 0).length,
      historicalZeroAheadForks: zeroAhead.filter(node => Number(node.vsParent?.behind) > 0).length,
      candidateEquivalenceGroups: equivalenceGroups.length,
      verifiedEquivalenceGroups: equivalenceGroups.filter(group => group.status === 'verified-artifact-equivalence').length,
    },
    nodes,
    equivalenceGroups,
    policy:
      'All catalog nodes receive per-operation eligibility. Missing adapters or unknown APIs remain unmeasured until actual attempts; no private host/credentials/runtime blockers are invented. Configuration does not establish correctness, executable availability, full family support, or a valid rank. Bindings and exact artifact aliases do not become new independent engines. Historical revisions remain measurable with explicit version scope. Converter, source and diagnostics cohorts stay separate from renderer speed.',
  }
}
export function writeCatalogEligibility(catalogPath: string, out: string, artifactPath?: string) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Catalog,
    artifacts = artifactPath ? (JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, CatalogArtifactAdmission>) : {}
  const result = createCatalogEligibility(catalog, artifacts)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({ ...result, sources: { catalog: resolve(catalogPath), admittedArtifacts: artifactPath ? resolve(artifactPath) : null } }, null, 2))
  return result
}
if (import.meta.main) {
  const values = new Map<string, string>()
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index]!,
      value = process.argv[index + 1]
    if (!['--catalog', '--out', '--artifacts'].includes(name) || !value || value.startsWith('--') || values.has(name)) throw Error('Usage: catalog-eligibility.ts --catalog FILE --out FILE [--artifacts ADMITTED_MANIFEST]')
    values.set(name, value)
  }
  if (!values.has('--catalog') || !values.has('--out')) throw Error('Both --catalog and --out are required')
  const result = writeCatalogEligibility(values.get('--catalog')!, values.get('--out')!, values.get('--artifacts'))
  console.log(JSON.stringify(result.summary))
}
