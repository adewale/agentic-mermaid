import rawManifest from '../docs/project/upstream-mermaid-manifest.json'

export { findUpstreamFamilyByHeader } from './upstream-family-index.ts'
export type { UpstreamHeaderMatch } from './upstream-family-index.ts'

export type UpstreamFamilyMaturity = 'stable' | 'beta' | 'experimental'
export type UpstreamFamilySource = 'core' | 'external-first-party'
export type AgenticHeaderStatus = 'native' | 'unsupported' | 'inventory-only'

export interface UpstreamHeaderDescriptor {
  value: string
  agenticStatus: AgenticHeaderStatus
}

export interface UpstreamOfficialSyntaxPage {
  path: string
  url: string
  artifact: string
}

export type UpstreamLifecycleDeclaration =
  | { status: 'declared'; version: string; evidence: 'official-title' }
  | { status: 'not-declared' }

export interface UpstreamFamilyLifecycle {
  introduction: UpstreamLifecycleDeclaration
  deprecation: UpstreamLifecycleDeclaration
}

export interface UpstreamFamilyDescriptor {
  id: string
  label: string
  source: UpstreamFamilySource
  maturity: UpstreamFamilyMaturity
  upstreamDetectorIds: string[]
  headers: UpstreamHeaderDescriptor[]
  officialSyntaxPage: UpstreamOfficialSyntaxPage
  lifecycle: UpstreamFamilyLifecycle
}

export interface UpstreamWatchEntry {
  id: string
  kind: 'pseudo' | 'internal'
  headers: string[]
}

export type UpstreamSurfaceId = 'detectors' | 'configuration' | 'themes' | 'grammar'

export interface UpstreamSurfaceSnapshot {
  id: UpstreamSurfaceId
  /** Installed package-relative files included in this dimension. */
  files: string[]
  sha256: string
}

export interface UpstreamSemanticSourceArtifact {
  id: string
  kind: 'examples' | 'syntax-features' | 'official-doc' | 'accounting' | 'config-schema' | 'theme-schema'
  scope: 'repository' | 'installed-package'
  path: string
  sha256: string
  upstreamRevision?: string
}

export type UpstreamSyntaxFeatureStatus =
  | 'executable'
  | 'excluded'
  | 'divergence'
  | 'portable'
  | 'error'
  | 'not-portable'
  | 'documented'

export interface UpstreamSyntaxFeature {
  id: string
  artifact: string
  families: string[]
  status: UpstreamSyntaxFeatureStatus
  fingerprint: string
  reason?: string
  sourceSha256?: string
}

export interface UpstreamSyntaxExample {
  id: string
  family: string
  origin: string
  index: number
  sourceSha256: string
  artifacts: string[]
  officialDocs?: string
}

export interface UpstreamConfigKey {
  id: string
  type: string
  optional: boolean
}

export interface UpstreamThemeVariable {
  id: string
  type: string
  defaultSha256: string
}

export interface UpstreamSemanticInventory {
  sourceArtifacts: UpstreamSemanticSourceArtifact[]
  syntaxFeatures: UpstreamSyntaxFeature[]
  examples: UpstreamSyntaxExample[]
  configKeys: UpstreamConfigKey[]
  themeVariables: UpstreamThemeVariable[]
}

export interface UpstreamMermaidManifest {
  schemaVersion: 4
  provenance: {
    package: 'mermaid'
    version: string
    repository: string
    tag: string
    commit: string
    npmIntegrity: string
    packageJsonSha256: string
    inventorySha256: string
    inputs: string[]
  }
  families: UpstreamFamilyDescriptor[]
  watchEntries: UpstreamWatchEntry[]
  surfaces: UpstreamSurfaceSnapshot[]
  semanticInventory: UpstreamSemanticInventory
}

/** Pinned public upstream inventory; it is not a native-support claim. */
export const UPSTREAM_MERMAID_MANIFEST = rawManifest as UpstreamMermaidManifest

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/** Stable hash input; provenance hashes are intentionally outside themselves. */
export function canonicalUpstreamInventory(manifest: UpstreamMermaidManifest = UPSTREAM_MERMAID_MANIFEST): string {
  return canonicalJson({
    schemaVersion: manifest.schemaVersion,
    families: manifest.families,
    watchEntries: manifest.watchEntries,
    surfaces: manifest.surfaces,
    semanticInventory: manifest.semanticInventory,
  })
}

export interface UpstreamManifestChange {
  id: string
  fields: string[]
}

export interface UpstreamManifestDiff {
  fromVersion: string
  toVersion: string
  addedFamilies: string[]
  removedFamilies: string[]
  changedFamilies: UpstreamManifestChange[]
  addedWatchEntries: string[]
  removedWatchEntries: string[]
  changedWatchEntries: UpstreamManifestChange[]
  addedSurfaces: string[]
  removedSurfaces: string[]
  changedSurfaces: UpstreamManifestChange[]
  addedSemanticSources: string[]
  removedSemanticSources: string[]
  changedSemanticSources: UpstreamManifestChange[]
  addedSyntaxFeatures: string[]
  removedSyntaxFeatures: string[]
  changedSyntaxFeatures: UpstreamManifestChange[]
  addedExamples: string[]
  removedExamples: string[]
  changedExamples: UpstreamManifestChange[]
  addedConfigKeys: string[]
  removedConfigKeys: string[]
  changedConfigKeys: UpstreamManifestChange[]
  addedThemeVariables: string[]
  removedThemeVariables: string[]
  changedThemeVariables: UpstreamManifestChange[]
}

function changedFields<T extends { id: string }>(before: T, after: T): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  keys.delete('id')
  return Array.from(keys)
    .sort()
    .filter(key => canonicalJson((before as Record<string, unknown>)[key]) !== canonicalJson((after as Record<string, unknown>)[key]))
}

function diffEntries<T extends { id: string }>(before: T[], after: T[]): {
  added: string[]
  removed: string[]
  changed: UpstreamManifestChange[]
} {
  const left = new Map(before.map(entry => [entry.id, entry]))
  const right = new Map(after.map(entry => [entry.id, entry]))
  const added = Array.from(right.keys()).filter(id => !left.has(id)).sort()
  const removed = Array.from(left.keys()).filter(id => !right.has(id)).sort()
  const changed = Array.from(left.keys())
    .filter(id => right.has(id))
    .sort()
    .map(id => ({ id, fields: changedFields(left.get(id)!, right.get(id)!) }))
    .filter(change => change.fields.length > 0)
  return { added, removed, changed }
}

/** Deterministic review surface for dependency upgrades. */
export function diffUpstreamMermaidManifests(
  before: UpstreamMermaidManifest,
  after: UpstreamMermaidManifest,
): UpstreamManifestDiff {
  const families = diffEntries(before.families, after.families)
  const watch = diffEntries(before.watchEntries, after.watchEntries)
  const surfaces = diffEntries(before.surfaces, after.surfaces)
  const semanticSources = diffEntries(before.semanticInventory.sourceArtifacts, after.semanticInventory.sourceArtifacts)
  const syntaxFeatures = diffEntries(before.semanticInventory.syntaxFeatures, after.semanticInventory.syntaxFeatures)
  const examples = diffEntries(before.semanticInventory.examples, after.semanticInventory.examples)
  const configKeys = diffEntries(before.semanticInventory.configKeys, after.semanticInventory.configKeys)
  const themeVariables = diffEntries(before.semanticInventory.themeVariables, after.semanticInventory.themeVariables)
  return {
    fromVersion: before.provenance.version,
    toVersion: after.provenance.version,
    addedFamilies: families.added,
    removedFamilies: families.removed,
    changedFamilies: families.changed,
    addedWatchEntries: watch.added,
    removedWatchEntries: watch.removed,
    changedWatchEntries: watch.changed,
    addedSurfaces: surfaces.added,
    removedSurfaces: surfaces.removed,
    changedSurfaces: surfaces.changed,
    addedSemanticSources: semanticSources.added,
    removedSemanticSources: semanticSources.removed,
    changedSemanticSources: semanticSources.changed,
    addedSyntaxFeatures: syntaxFeatures.added,
    removedSyntaxFeatures: syntaxFeatures.removed,
    changedSyntaxFeatures: syntaxFeatures.changed,
    addedExamples: examples.added,
    removedExamples: examples.removed,
    changedExamples: examples.changed,
    addedConfigKeys: configKeys.added,
    removedConfigKeys: configKeys.removed,
    changedConfigKeys: configKeys.changed,
    addedThemeVariables: themeVariables.added,
    removedThemeVariables: themeVariables.removed,
    changedThemeVariables: themeVariables.changed,
  }
}

export function validateUpstreamMermaidManifest(manifest: UpstreamMermaidManifest = UPSTREAM_MERMAID_MANIFEST): string[] {
  const errors: string[] = []
  if (manifest.schemaVersion !== 4) errors.push('unsupported schemaVersion')
  const ids = manifest.families.map(family => family.id)
  if (new Set(ids).size !== ids.length) errors.push('family ids are not unique')
  const headers = manifest.families.flatMap(family => family.headers.map(header => header.value.toLowerCase()))
  if (new Set(headers).size !== headers.length) errors.push('public headers are not unique')
  const watchIds = manifest.watchEntries.map(entry => entry.id)
  if (new Set(watchIds).size !== watchIds.length) errors.push('watch entry ids are not unique')
  const surfaceIds = manifest.surfaces.map(entry => entry.id)
  if (new Set(surfaceIds).size !== surfaceIds.length) errors.push('surface ids are not unique')
  if (surfaceIds.join(',') !== ['detectors', 'configuration', 'themes', 'grammar'].join(',')) errors.push('surface inventory is incomplete or out of order')
  for (const surface of manifest.surfaces) {
    if (!/^[0-9a-f]{64}$/.test(surface.sha256) || /^0+$/.test(surface.sha256)) errors.push(`surface ${surface.id} sha256 is invalid`)
    if (surface.files.length === 0 || new Set(surface.files).size !== surface.files.length || [...surface.files].sort().join('\0') !== surface.files.join('\0')) {
      errors.push(`surface ${surface.id} files are empty, duplicated, or unsorted`)
    }
  }
  const semantic = manifest.semanticInventory
  if (!semantic) {
    errors.push('semantic inventory is missing')
  } else {
    const groups: Array<[string, Array<{ id: string }>]> = [
      ['semantic source', semantic.sourceArtifacts],
      ['syntax feature', semantic.syntaxFeatures],
      ['example', semantic.examples],
      ['config key', semantic.configKeys],
      ['theme variable', semantic.themeVariables],
    ]
    for (const [label, entries] of groups) {
      const entryIds = entries.map(entry => entry.id)
      if (entryIds.length === 0) errors.push(`${label} inventory is empty`)
      if (new Set(entryIds).size !== entryIds.length) errors.push(`${label} ids are not unique`)
      if ([...entryIds].sort().join('\0') !== entryIds.join('\0')) errors.push(`${label} ids are not sorted`)
    }
    const artifactsById = new Map(semantic.sourceArtifacts.map(artifact => [artifact.id, artifact]))
    const knownFamilyIds = new Set(manifest.families.map(family => family.id))
    const syntaxStatuses = new Set(['executable', 'excluded', 'divergence', 'portable', 'error', 'not-portable', 'documented'])
    const artifactKinds = new Set(['examples', 'syntax-features', 'official-doc', 'accounting', 'config-schema', 'theme-schema'])
    for (const artifact of semantic.sourceArtifacts) {
      if (!/^[0-9a-f]{64}$/.test(artifact.sha256) || /^0+$/.test(artifact.sha256)) errors.push(`semantic source ${artifact.id} sha256 is invalid`)
      if (!artifact.path.trim()) errors.push(`semantic source ${artifact.id} path is empty`)
      if (!artifactKinds.has(artifact.kind)) errors.push(`semantic source ${artifact.id} kind is invalid`)
      if (artifact.kind === 'official-doc' && !/^[0-9a-f]{40}$/.test(artifact.upstreamRevision ?? '')) errors.push(`semantic source ${artifact.id} upstreamRevision is invalid`)
    }
    const lifecycleDeclarationIsValid = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false
      const declaration = value as Partial<UpstreamLifecycleDeclaration> & { version?: unknown; evidence?: unknown }
      return declaration.status === 'not-declared'
        || (declaration.status === 'declared'
          && typeof declaration.version === 'string'
          && /^\d+\.\d+(?:\.\d+)?$/.test(declaration.version)
          && declaration.evidence === 'official-title')
    }
    for (const family of manifest.families) {
      const page = family.officialSyntaxPage
      const artifact = page && artifactsById.get(page.artifact)
      if (!page?.path.trim() || !/^https:\/\/mermaid\.ai\/open-source\/syntax\/.+\.html$/.test(page.url) || artifact?.kind !== 'official-doc' || artifact.path !== page.path) {
        errors.push(`family ${family.id} has invalid official syntax page`)
      }
      if (!family.lifecycle
        || !lifecycleDeclarationIsValid(family.lifecycle.introduction)
        || !lifecycleDeclarationIsValid(family.lifecycle.deprecation)) {
        errors.push(`family ${family.id} has invalid lifecycle accounting`)
      }
    }
    for (const feature of semantic.syntaxFeatures) {
      if (!['syntax-features', 'official-doc'].includes(artifactsById.get(feature.artifact)?.kind ?? '')) errors.push(`syntax feature ${feature.id} references invalid artifact`)
      if (feature.families.length === 0 || new Set(feature.families).size !== feature.families.length || [...feature.families].sort().join('\0') !== feature.families.join('\0') || feature.families.some(family => !knownFamilyIds.has(family))) errors.push(`syntax feature ${feature.id} has invalid families`)
      if (!syntaxStatuses.has(feature.status)) errors.push(`syntax feature ${feature.id} has invalid status`)
      if (!/^[0-9a-f]{64}$/.test(feature.fingerprint)) errors.push(`syntax feature ${feature.id} fingerprint is invalid`)
      if (feature.sourceSha256 && !/^[0-9a-f]{64}$/.test(feature.sourceSha256)) errors.push(`syntax feature ${feature.id} sourceSha256 is invalid`)
    }
    for (const example of semantic.examples) {
      if (!/^[0-9a-f]{64}$/.test(example.sourceSha256)) errors.push(`example ${example.id} sourceSha256 is invalid`)
      if (!knownFamilyIds.has(example.family)) errors.push(`example ${example.id} has unknown family`)
      if (example.artifacts.length === 0 || new Set(example.artifacts).size !== example.artifacts.length || [...example.artifacts].sort().join('\0') !== example.artifacts.join('\0') || example.artifacts.some(artifact => !['examples', 'official-doc'].includes(artifactsById.get(artifact)?.kind ?? ''))) errors.push(`example ${example.id} has invalid artifacts`)
      if (!Number.isInteger(example.index) || example.index < 0) errors.push(`example ${example.id} index is invalid`)
    }
    const documentedFeatureFamilies = new Set(semantic.syntaxFeatures
      .filter(feature => artifactsById.get(feature.artifact)?.kind === 'official-doc')
      .flatMap(feature => feature.families))
    const officialExampleFamilies = new Set(semantic.examples
      .filter(example => example.artifacts.some(artifact => artifactsById.get(artifact)?.kind === 'official-doc'))
      .map(example => example.family))
    for (const family of manifest.families) {
      if (!documentedFeatureFamilies.has(family.id)) errors.push(`family ${family.id} has no official syntax features`)
      if (!officialExampleFamilies.has(family.id)) errors.push(`family ${family.id} has no official examples`)
    }
    for (const key of semantic.configKeys) {
      if (!key.type.trim()) errors.push(`config key ${key.id} has empty type`)
    }
    for (const variable of semantic.themeVariables) {
      if (!variable.type.trim()) errors.push(`theme variable ${variable.id} has empty type`)
      if (!/^[0-9a-f]{64}$/.test(variable.defaultSha256)) errors.push(`theme variable ${variable.id} defaultSha256 is invalid`)
    }
  }
  if (manifest.provenance.tag !== `mermaid@${manifest.provenance.version}`) errors.push('provenance tag does not match version')
  if (!/^[0-9a-f]{40}$/.test(manifest.provenance.commit)) errors.push('provenance commit is not a full Git SHA')
  if (!/^[0-9a-f]{64}$/.test(manifest.provenance.packageJsonSha256) || /^0+$/.test(manifest.provenance.packageJsonSha256)) errors.push('packageJsonSha256 is invalid')
  if (!/^[0-9a-f]{64}$/.test(manifest.provenance.inventorySha256) || /^0+$/.test(manifest.provenance.inventorySha256)) errors.push('inventorySha256 is invalid')
  return errors
}
