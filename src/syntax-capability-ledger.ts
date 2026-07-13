// ============================================================================
// Mermaid syntax capability ledger.
//
// Stable feature ids come from the pinned upstream manifest. Stable dimension
// ids come from the Section A syntax contract. Family rows join those two
// authorities to the live FamilyDescriptor registry; they are a projection,
// not a second family or feature inventory.
// ============================================================================

import {
  FAMILY_CAPABILITY_COLUMNS,
  type FamilyCapability,
  type FamilyDescriptor,
} from './agent/families.ts'
import type {
  UpstreamFamilyDescriptor,
  UpstreamMermaidManifest,
  UpstreamSemanticSourceArtifact,
  UpstreamSyntaxFeature,
  UpstreamSyntaxFeatureStatus,
} from './upstream-mermaid-manifest.ts'

export const FAMILY_SYNTAX_STATES = Object.freeze([
  'native',
  'source-preserved',
  'diagnosed',
  'not-applicable',
  'absent',
] as const)

export type FamilySyntaxState = (typeof FAMILY_SYNTAX_STATES)[number]

/** Stable ids from the plan's syntax-capability contract. */
export const SYNTAX_CAPABILITY_DIMENSIONS = Object.freeze([
  { id: 'identity-routing', label: 'Identity and routing', description: 'Family identity, headers, aliases, routing, lifecycle and maturity.' },
  { id: 'document-framing', label: 'Document framing', description: 'Frontmatter, directives, comments, titles and accessibility framing.' },
  { id: 'grammar', label: 'Grammar', description: 'Statements, nesting, ordering, delimiters, optional forms and invalid-input behavior.' },
  { id: 'text', label: 'Text', description: 'Labels, Markdown/HTML/math text, escaping, Unicode, graphemes and multiline behavior.' },
  { id: 'authored-appearance', label: 'Authored appearance', description: 'Themes, classes, inline styles, link styles and family styling syntax.' },
  { id: 'semantic-identity', label: 'Semantic identity', description: 'Stable ids, domain entities, relationships, values, source maps and roles.' },
  { id: 'interaction-assets', label: 'Interaction and assets', description: 'Links, callbacks, tooltips, icons, images, registries and security behavior.' },
  { id: 'configuration', label: 'Configuration', description: 'Config keys, validation, renderer/layout selection and ineffective-key diagnostics.' },
  { id: 'processing', label: 'Processing', description: 'Detection, preservation, parsing, serialization, mutation, verification, layout and Scene lowering.' },
  { id: 'outputs', label: 'Outputs', description: 'SVG, PNG, terminal projections, accessibility, determinism and output security.' },
  { id: 'evidence', label: 'Evidence', description: 'Official provenance, executable fixtures, divergences and semantic evidence.' },
] as const)

export type SyntaxCapabilityDimensionId = (typeof SYNTAX_CAPABILITY_DIMENSIONS)[number]['id']

export interface SyntaxCapabilityEvidence {
  /** Repository-relative evidence source. */
  source: string
  /** Stable coordinate within the source (feature, descriptor claim or rule). */
  locator: string
  /** Content identity when the authority supplies one. */
  fingerprint?: string
}

export interface SyntaxFeatureCapabilityRow {
  featureId: string
  familyIds: readonly string[]
  dimensionId: SyntaxCapabilityDimensionId
  classificationRuleId: string
  state: FamilySyntaxState
  upstreamStatus: UpstreamSyntaxFeatureStatus
  artifactId: string
  fingerprint: string
  sourceSha256?: string
  /** Executable/accounting gates. `artifactId` + `fingerprint` is the exact
   * upstream source coordinate, so feature ids are not repeated here. */
  evidence: readonly string[]
  /** Required whenever the row does not make a native claim. */
  diagnostic?: string
}

export interface SyntaxFamilyDimensionCapabilityRow {
  familyId: string
  dimensionId: SyntaxCapabilityDimensionId
  registrationId?: string
  state: FamilySyntaxState
  featureCount: number
  featureStateCounts: Readonly<Record<FamilySyntaxState, number>>
  evidence: readonly SyntaxCapabilityEvidence[]
  /** Processing alone expands the descriptor's operation-level projection. */
  processing?: Readonly<Record<FamilyCapability, FamilySyntaxState>>
  /** Required whenever the aggregate row does not make a native claim. */
  diagnostic?: string
}

export interface SyntaxCapabilityLedger {
  dimensions: readonly (typeof SYNTAX_CAPABILITY_DIMENSIONS)[number][]
  families: readonly SyntaxFamilyDimensionCapabilityRow[]
  features: readonly SyntaxFeatureCapabilityRow[]
}

interface DimensionClassification {
  dimensionId: SyntaxCapabilityDimensionId
  ruleId: string
}

function subjectOf(feature: UpstreamSyntaxFeature): string {
  let subject = feature.id.startsWith(`${feature.artifact}:`)
    ? feature.id.slice(feature.artifact.length + 1)
    : feature.id
  for (const family of feature.families) {
    const prefix = `${family.toLowerCase()}-`
    if (subject.toLowerCase().startsWith(prefix)) subject = subject.slice(prefix.length)
  }
  return subject.replace(/^section:/i, '').replace(/^upstream-/i, '').toLowerCase()
}

function tokensOf(subject: string): Set<string> {
  return new Set(subject.split(/[^a-z0-9]+/).filter(Boolean))
}

function hasAny(tokens: ReadonlySet<string>, values: readonly string[]): boolean {
  return values.some(value => tokens.has(value))
}

function hasStem(tokens: ReadonlySet<string>, values: readonly string[]): boolean {
  return [...tokens].some(token => values.some(value => token.startsWith(value)))
}

/**
 * A small, ordered semantic classifier keeps dimension ownership reviewable.
 * It operates on generated feature subjects, never on a copied feature-id list.
 */
export function classifySyntaxFeatureDimension(feature: UpstreamSyntaxFeature): DimensionClassification {
  const subject = subjectOf(feature)
  const tokens = tokensOf(subject)
  const officialTitle = feature.artifact.startsWith('official-doc:')
    && feature.families.some(family => subject === family || subject.startsWith(`${family}-diagram`))

  if (hasAny(tokens, ['frontmatter', 'directive', 'directives', 'comment', 'comments', 'title', 'acctitle', 'accdescr', 'accessibility'])) {
    return { dimensionId: 'document-framing', ruleId: 'document-framing-terms-v1' }
  }
  if (hasAny(tokens, ['classdef', 'linkstyle', 'style', 'styles', 'styling', 'theme', 'color', 'colors', 'colour', 'colours', 'fill', 'stroke', 'css', 'background', 'palette', 'font'])) {
    return { dimensionId: 'authored-appearance', ruleId: 'authored-appearance-terms-v1' }
  }
  if (hasAny(tokens, ['click', 'callback', 'callbacks', 'href', 'hyperlink', 'link', 'links', 'tooltip', 'tooltips', 'menu', 'menus', 'icon', 'icons', 'image', 'images', 'asset', 'assets', 'resource', 'resources', 'url', 'urls'])) {
    return { dimensionId: 'interaction-assets', ruleId: 'interaction-assets-terms-v1' }
  }
  if (hasAny(tokens, ['config', 'configuration', 'configure', 'setting', 'settings', 'option', 'options', 'renderer', 'getconfig', 'parallelcommits', 'showbranches', 'showcommitlabel', 'rotatecommitlabel', 'padding', 'spacing', 'margin'])) {
    return { dimensionId: 'configuration', ruleId: 'configuration-terms-v1' }
  }
  // Mermaid calls two Flowchart node shapes "data input/output". That phrase
  // names a semantic shape, not an output transport.
  if (subject.includes('input-output')) {
    return { dimensionId: 'semantic-identity', ruleId: 'input-output-shape-v1' }
  }
  if (hasAny(tokens, ['svg', 'png', 'ascii', 'output', 'outputs', 'export', 'exports', 'screenreader', 'aria'])) {
    return { dimensionId: 'outputs', ruleId: 'output-terms-v1' }
  }
  if (hasStem(tokens, ['parse', 'serializ', 'mutat', 'verif', 'layout', 'position', 'render', 'rout', 'determin', 'randomiz', 'measur', 'bound'])) {
    return { dimensionId: 'processing', ruleId: 'processing-terms-v1' }
  }
  if (hasAny(tokens, ['label', 'labels', 'text', 'quote', 'quoted', 'markdown', 'html', 'math', 'escape', 'escaped', 'unicode', 'grapheme', 'graphemes', 'multiline', 'wrap', 'wrapping', 'character', 'characters', 'newline', 'linefeed', 'word'])) {
    return { dimensionId: 'text', ruleId: 'text-terms-v1' }
  }
  if (hasAny(tokens, ['header', 'headers', 'alias', 'aliases', 'keyword', 'keywords', 'direction', 'orientation', 'dialect', 'case', 'beta', 'v2'])) {
    return { dimensionId: 'identity-routing', ruleId: 'identity-routing-terms-v1' }
  }
  if (hasAny(tokens, ['id', 'identity', 'category', 'categories', 'status', 'value', 'values', 'relationship', 'relationships', 'relation', 'relations', 'region', 'regions', 'namespace', 'namespaces', 'participant', 'participants', 'actor', 'actors', 'entity', 'entities', 'task', 'tasks', 'branch', 'branches', 'commit', 'commits', 'node', 'nodes', 'edge', 'edges', 'group', 'groups', 'service', 'services', 'class', 'classes', 'state', 'states', 'requirement', 'requirements', 'milestone', 'milestones', 'section', 'sections', 'period', 'periods', 'event', 'events', 'point', 'points', 'bar', 'bars', 'slice', 'slices', 'axis', 'legend', 'member', 'members', 'junction', 'junctions', 'attribute', 'attributes', 'message', 'messages', 'note', 'notes', 'activation', 'box', 'lane', 'lanes'])) {
    return { dimensionId: 'semantic-identity', ruleId: 'semantic-identity-terms-v1' }
  }
  if (officialTitle || hasAny(tokens, ['example', 'examples', 'documentation', 'reference', 'references', 'introduction', 'limitation', 'limitations', 'syntax', 'version', 'versions', 'deprecated', 'deprecation'])) {
    return { dimensionId: 'evidence', ruleId: officialTitle ? 'official-title-v1' : 'evidence-terms-v1' }
  }
  return { dimensionId: 'grammar', ruleId: 'grammar-default-v1' }
}

function featureState(
  feature: UpstreamSyntaxFeature,
  dimensionId: SyntaxCapabilityDimensionId,
): { state: FamilySyntaxState; diagnostic?: string } {
  if (dimensionId === 'evidence' && feature.status === 'documented') return { state: 'native' }
  switch (feature.status) {
    case 'executable':
    case 'portable':
    case 'error':
      return { state: 'native' }
    case 'documented':
      return {
        state: 'source-preserved',
        diagnostic: 'OFFICIAL_DOC_ONLY: inventoried and preserved, but this feature has no executable native claim.',
      }
    case 'divergence':
      return {
        state: 'diagnosed',
        diagnostic: `EXECUTABLE_DIVERGENCE: ${feature.reason ?? 'documented-behavior-difference'}.`,
      }
    case 'not-portable':
      return {
        state: 'not-applicable',
        diagnostic: `SOURCE_INEXPRESSIBLE: ${feature.reason ?? 'not-portable'}.`,
      }
    case 'excluded':
      if (feature.reason === 'api-internal') {
        return { state: 'not-applicable', diagnostic: 'SOURCE_INEXPRESSIBLE: upstream API-internal behavior has no authored Mermaid syntax.' }
      }
      return {
        state: 'diagnosed',
        diagnostic: `ACCOUNTED_EXCLUSION: ${feature.reason ?? 'excluded'}.`,
      }
  }
}

const ARTIFACT_EXECUTION_GATES: Readonly<Record<string, string>> = Object.freeze({
  'suite-cases': 'src/__tests__/mermaid-upstream-suite-bench.test.ts',
  'suite-exclusions': 'src/__tests__/mermaid-upstream-suite-bench.test.ts',
  'gantt-cases': 'src/__tests__/gantt-upstream-bench.test.ts',
  'gantt-exclusions': 'src/__tests__/gantt-upstream-bench.test.ts',
  'mindmap-gitgraph-blocks': 'src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts',
})

function featureRows(manifest: UpstreamMermaidManifest): SyntaxFeatureCapabilityRow[] {
  const artifacts = new Map(manifest.semanticInventory.sourceArtifacts.map(artifact => [artifact.id, artifact]))
  return manifest.semanticInventory.syntaxFeatures.map(feature => {
    const classification = classifySyntaxFeatureDimension(feature)
    const claim = featureState(feature, classification.dimensionId)
    const artifact = artifacts.get(feature.artifact)
    if (!artifact) throw new Error(`Syntax feature ${feature.id} references missing artifact ${feature.artifact}`)
    const gates = ARTIFACT_EXECUTION_GATES[feature.artifact]
      ? [ARTIFACT_EXECUTION_GATES[feature.artifact]!]
      : [
          'src/__tests__/upstream-family-manifest.test.ts',
          'src/__tests__/property-all-families-fuzz.test.ts',
        ]
    return {
      featureId: feature.id,
      familyIds: [...feature.families],
      dimensionId: classification.dimensionId,
      classificationRuleId: classification.ruleId,
      state: claim.state,
      upstreamStatus: feature.status,
      artifactId: feature.artifact,
      fingerprint: feature.fingerprint,
      ...(feature.sourceSha256 ? { sourceSha256: feature.sourceSha256 } : {}),
      evidence: gates,
      ...(claim.diagnostic ? { diagnostic: claim.diagnostic } : {}),
    }
  })
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase()
}

function descriptorForFamily(
  family: UpstreamFamilyDescriptor,
  descriptors: readonly FamilyDescriptor[],
): FamilyDescriptor | undefined {
  const headers = new Set(family.headers.map(header => normalizedHeader(header.value)))
  return descriptors.find(descriptor => descriptor.headers.some(header => headers.has(normalizedHeader(header))))
}

function evidenceForClaims(
  descriptor: FamilyDescriptor,
  capabilities: readonly FamilyCapability[],
): SyntaxCapabilityEvidence[] {
  return descriptor.capabilityEvidence
    .filter(claim => capabilities.includes(claim.capability))
    .flatMap(claim => claim.evidence.map(source => ({
      source,
      locator: `${descriptor.identity.id}/${claim.capability}`,
    })))
}

function descriptorState(descriptor: FamilyDescriptor, capability: FamilyCapability): FamilySyntaxState {
  const state = descriptor.capabilityEvidence.find(claim => claim.capability === capability)?.state ?? 'absent'
  // An absent descriptor hook is not allowed to become an unaccounted syntax
  // cell: public operations must reject it through the family diagnostic path.
  return state === 'absent' ? 'diagnosed' : state
}

function processingProjection(descriptor?: FamilyDescriptor): Readonly<Record<FamilyCapability, FamilySyntaxState>> {
  if (!descriptor) {
    return Object.freeze({
      detection: 'diagnosed',
      'source-preservation': 'source-preserved',
      parse: 'diagnosed',
      serialize: 'source-preserved',
      mutation: 'diagnosed',
      verify: 'diagnosed',
      layout: 'diagnosed',
      scene: 'diagnosed',
      svg: 'diagnosed',
      terminal: 'diagnosed',
    })
  }
  return Object.freeze(Object.fromEntries(FAMILY_CAPABILITY_COLUMNS.map(capability => [
    capability,
    descriptorState(descriptor, capability),
  ])) as Record<FamilyCapability, FamilySyntaxState>)
}

function combineStates(states: readonly FamilySyntaxState[]): FamilySyntaxState {
  if (states.includes('absent')) return 'absent'
  if (states.includes('diagnosed')) return 'diagnosed'
  if (states.includes('source-preserved')) return 'source-preserved'
  if (states.includes('native')) return 'native'
  return 'not-applicable'
}

function emptyStateCounts(): Record<FamilySyntaxState, number> {
  return { native: 0, 'source-preserved': 0, diagnosed: 0, 'not-applicable': 0, absent: 0 }
}

interface FamilyDimensionBaseline {
  state: FamilySyntaxState
  evidence: SyntaxCapabilityEvidence[]
  diagnostic?: string
  processing?: Readonly<Record<FamilyCapability, FamilySyntaxState>>
}

function officialEvidence(
  family: UpstreamFamilyDescriptor | undefined,
  artifacts: ReadonlyMap<string, UpstreamSemanticSourceArtifact>,
  dimensionId: SyntaxCapabilityDimensionId,
): SyntaxCapabilityEvidence[] {
  if (!family) return []
  const artifact = artifacts.get(family.officialSyntaxPage.artifact)
  return artifact
    ? [{ source: artifact.path, locator: `${family.id}/${dimensionId}`, fingerprint: artifact.sha256 }]
    : []
}

function baselineForDimension(
  family: UpstreamFamilyDescriptor | undefined,
  descriptor: FamilyDescriptor | undefined,
  dimensionId: SyntaxCapabilityDimensionId,
  featureCount: number,
  artifacts: ReadonlyMap<string, UpstreamSemanticSourceArtifact>,
): FamilyDimensionBaseline {
  const upstreamEvidence = officialEvidence(family, artifacts, dimensionId)
  const noDescriptor = (): FamilyDimensionBaseline => ({
    state: dimensionId === 'outputs' || dimensionId === 'processing' || dimensionId === 'identity-routing'
      ? 'diagnosed'
      : dimensionId === 'evidence'
        ? 'native'
        : featureCount === 0
          ? 'not-applicable'
          : 'source-preserved',
    evidence: upstreamEvidence.length > 0
      ? upstreamEvidence
      : [{ source: 'src/__tests__/upstream-family-manifest.test.ts', locator: `${family?.id ?? 'unknown'}/${dimensionId}` }],
    diagnostic: dimensionId === 'evidence'
      ? undefined
      : featureCount === 0 && !['outputs', 'processing', 'identity-routing'].includes(dimensionId)
        ? 'NO_PINNED_FEATURE: the pinned manifest assigns no feature to this dimension for the family.'
        : 'UNREGISTERED_FAMILY: source is inventoried and preserved; unavailable operations are diagnosed.',
    ...(dimensionId === 'processing' ? { processing: processingProjection() } : {}),
  })
  if (!descriptor) return noDescriptor()

  const byDimension: Record<SyntaxCapabilityDimensionId, readonly FamilyCapability[]> = {
    'identity-routing': ['detection'],
    'document-framing': ['source-preservation', 'parse'],
    grammar: ['parse', 'serialize'],
    text: ['parse', 'serialize'],
    'authored-appearance': ['source-preservation', 'serialize'],
    'semantic-identity': ['parse', 'serialize', 'verify'],
    'interaction-assets': ['source-preservation', 'verify'],
    configuration: ['parse', 'verify'],
    processing: FAMILY_CAPABILITY_COLUMNS,
    outputs: ['svg', 'terminal'],
    evidence: FAMILY_CAPABILITY_COLUMNS,
  }
  const capabilities = byDimension[dimensionId]
  const descriptorEvidence = evidenceForClaims(descriptor, capabilities)
  const evidence = [...upstreamEvidence, ...descriptorEvidence]

  if (dimensionId === 'evidence') return { state: 'native', evidence }
  if (featureCount === 0 && ['text', 'authored-appearance', 'interaction-assets'].includes(dimensionId)) {
    return {
      state: 'not-applicable',
      evidence,
      diagnostic: 'NO_PINNED_FEATURE: the pinned manifest assigns no feature to this dimension for the family.',
    }
  }
  if (dimensionId === 'configuration') {
    if (!descriptor.config && featureCount === 0) {
      return { state: 'not-applicable', evidence, diagnostic: 'NO_CONFIG_SURFACE: this family declares no config section or pinned config feature.' }
    }
    if (descriptor.config?.noopKeys?.length) {
      return {
        state: 'diagnosed',
        evidence,
        diagnostic: `INEFFECTIVE_CONFIG_KEYS: ${descriptor.config.noopKeys.join(', ')}.`,
      }
    }
  }
  if (dimensionId === 'processing') {
    const processing = processingProjection(descriptor)
    const state = combineStates(Object.values(processing))
    return {
      state,
      evidence,
      processing,
      ...(state === 'native' ? {} : { diagnostic: 'PROCESSING_PROJECTION: one or more descriptor operations are preserved or diagnosed rather than native.' }),
    }
  }
  const states = capabilities.map(capability => descriptorState(descriptor, capability))
  const state = combineStates(states)
  return {
    state,
    evidence,
    ...(state === 'native' ? {} : { diagnostic: `DESCRIPTOR_PROJECTION: ${capabilities.join(', ')} is ${state}.` }),
  }
}

function dedupeEvidence(values: readonly SyntaxCapabilityEvidence[]): SyntaxCapabilityEvidence[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const key = `${value.source}\0${value.locator}\0${value.fingerprint ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function familyDimensionRows(
  manifest: UpstreamMermaidManifest,
  descriptors: readonly FamilyDescriptor[],
  features: readonly SyntaxFeatureCapabilityRow[],
): SyntaxFamilyDimensionCapabilityRow[] {
  const artifacts = new Map(manifest.semanticInventory.sourceArtifacts.map(artifact => [artifact.id, artifact]))
  const matched = new Set<string>()
  const families: Array<{ id: string; upstream?: UpstreamFamilyDescriptor; descriptor?: FamilyDescriptor }> =
    manifest.families.map(upstream => {
      const descriptor = descriptorForFamily(upstream, descriptors)
      if (descriptor) matched.add(descriptor.id)
      return { id: upstream.id, upstream, descriptor }
    })
  for (const descriptor of descriptors.filter(candidate => !matched.has(candidate.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    families.push({ id: descriptor.id, descriptor })
  }

  return families.flatMap(family => SYNTAX_CAPABILITY_DIMENSIONS.map(dimension => {
    const classified = features.filter(feature =>
      feature.dimensionId === dimension.id && feature.familyIds.includes(family.id))
    const featureStateCounts = emptyStateCounts()
    for (const feature of classified) featureStateCounts[feature.state] += 1
    const baseline = baselineForDimension(
      family.upstream,
      family.descriptor,
      dimension.id,
      classified.length,
      artifacts,
    )
    const state = combineStates([baseline.state, ...classified.map(feature => feature.state)])
    const artifactEvidence = [...new Set(classified.map(feature => feature.artifactId))]
      .map(artifactId => artifacts.get(artifactId))
      .filter((artifact): artifact is UpstreamSemanticSourceArtifact => artifact !== undefined)
      .map(artifact => ({
        source: artifact.path,
        locator: `${family.id}/${dimension.id}/features`,
        fingerprint: artifact.sha256,
      }))
    const diagnostic = state === 'native'
      ? undefined
      : [
          baseline.diagnostic,
          `FEATURE_STATES: native=${featureStateCounts.native}, source-preserved=${featureStateCounts['source-preserved']}, diagnosed=${featureStateCounts.diagnosed}, not-applicable=${featureStateCounts['not-applicable']}.`,
        ].filter(Boolean).join(' ')
    return {
      familyId: family.id,
      dimensionId: dimension.id,
      ...(family.descriptor ? { registrationId: family.descriptor.id } : {}),
      state,
      featureCount: classified.length,
      featureStateCounts,
      evidence: dedupeEvidence([...baseline.evidence, ...artifactEvidence]),
      ...(baseline.processing ? { processing: baseline.processing } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    }
  }))
}

/** Build the exact ledger projection for a pinned manifest and live descriptors. */
export function createSyntaxCapabilityLedger(
  manifest: UpstreamMermaidManifest,
  descriptors: readonly FamilyDescriptor[],
): SyntaxCapabilityLedger {
  const features = featureRows(manifest)
  return {
    dimensions: SYNTAX_CAPABILITY_DIMENSIONS.map(dimension => ({ ...dimension })),
    families: familyDimensionRows(manifest, descriptors, features),
    features,
  }
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

/** Focused completeness/absence checks used by the generated Section A report. */
export function validateSyntaxCapabilityLedger(
  ledger: SyntaxCapabilityLedger,
  manifest: UpstreamMermaidManifest,
  expectedFamilyIds: readonly string[],
): string[] {
  const diagnostics: string[] = []
  const expectedDimensionIds = SYNTAX_CAPABILITY_DIMENSIONS.map(dimension => dimension.id)
  const dimensionIds = ledger.dimensions.map(dimension => dimension.id)
  if (JSON.stringify(ledger.dimensions) !== JSON.stringify(SYNTAX_CAPABILITY_DIMENSIONS)
    || JSON.stringify(dimensionIds) !== JSON.stringify(expectedDimensionIds)) {
    diagnostics.push('syntax capability dimensions are missing, duplicated, or out of order')
  }

  const familyCoordinates = ledger.families.map(row => `${row.familyId}\0${row.dimensionId}`)
  const expectedCoordinates = expectedFamilyIds.flatMap(familyId =>
    expectedDimensionIds.map(dimensionId => `${familyId}\0${dimensionId}`))
  if (!unique(familyCoordinates)) diagnostics.push('syntax family/dimension coordinates are not unique')
  const missingFamilyCoordinates = expectedCoordinates.filter(coordinate => !familyCoordinates.includes(coordinate))
  const extraFamilyCoordinates = familyCoordinates.filter(coordinate => !expectedCoordinates.includes(coordinate))
  if (missingFamilyCoordinates.length > 0) diagnostics.push(`syntax family/dimension rows are missing: ${missingFamilyCoordinates.length}`)
  if (extraFamilyCoordinates.length > 0) diagnostics.push(`syntax family/dimension rows are unexpected: ${extraFamilyCoordinates.length}`)
  if (missingFamilyCoordinates.length === 0 && extraFamilyCoordinates.length === 0
    && JSON.stringify(familyCoordinates) !== JSON.stringify(expectedCoordinates)) {
    diagnostics.push('syntax family/dimension rows are out of order')
  }
  for (const row of ledger.families) {
    if (!FAMILY_SYNTAX_STATES.includes(row.state)) diagnostics.push(`syntax family ${row.familyId}/${row.dimensionId} has invalid state`)
    if (row.state === 'absent') diagnostics.push(`syntax family ${row.familyId}/${row.dimensionId} is absent`)
    if (row.evidence.length === 0 || row.evidence.some(evidence => !evidence.source || !evidence.locator)) {
      diagnostics.push(`syntax family ${row.familyId}/${row.dimensionId} lacks concrete evidence`)
    }
    if (row.state !== 'native' && !row.diagnostic?.trim()) diagnostics.push(`syntax family ${row.familyId}/${row.dimensionId} lacks a diagnostic`)
    if (row.featureStateCounts.absent !== 0) diagnostics.push(`syntax family ${row.familyId}/${row.dimensionId} contains absent feature classifications`)
    if (Object.values(row.featureStateCounts).reduce((sum, count) => sum + count, 0) !== row.featureCount) {
      diagnostics.push(`syntax family ${row.familyId}/${row.dimensionId} feature counts are stale`)
    }
    const classified = ledger.features.filter(feature =>
      feature.familyIds.includes(row.familyId) && feature.dimensionId === row.dimensionId)
    const expectedStateCounts = emptyStateCounts()
    for (const feature of classified) expectedStateCounts[feature.state] += 1
    if (row.featureCount !== classified.length
      || JSON.stringify(row.featureStateCounts) !== JSON.stringify(expectedStateCounts)) {
      diagnostics.push(`syntax family ${row.familyId}/${row.dimensionId} does not summarize its feature rows`)
    }
    if (row.dimensionId === 'processing') {
      if (!row.processing || JSON.stringify(Object.keys(row.processing)) !== JSON.stringify(FAMILY_CAPABILITY_COLUMNS)) {
        diagnostics.push(`syntax family ${row.familyId}/processing lacks the complete operation projection`)
      } else if (Object.values(row.processing).includes('absent')) {
        diagnostics.push(`syntax family ${row.familyId}/processing contains an absent operation`)
      }
    } else if (row.processing) {
      diagnostics.push(`syntax family ${row.familyId}/${row.dimensionId} has an unexpected processing projection`)
    }
  }

  const featureIds = ledger.features.map(row => row.featureId)
  const expectedFeatureIds = manifest.semanticInventory.syntaxFeatures.map(feature => feature.id)
  if (!unique(featureIds)) diagnostics.push('syntax feature classifications are not unique')
  const missingFeatureIds = expectedFeatureIds.filter(featureId => !featureIds.includes(featureId))
  const extraFeatureIds = featureIds.filter(featureId => !expectedFeatureIds.includes(featureId))
  if (missingFeatureIds.length > 0) diagnostics.push(`syntax feature classifications are missing: ${missingFeatureIds.length}`)
  if (extraFeatureIds.length > 0) diagnostics.push(`syntax feature classifications are unexpected: ${extraFeatureIds.length}`)
  if (missingFeatureIds.length === 0 && extraFeatureIds.length === 0
    && JSON.stringify(featureIds) !== JSON.stringify(expectedFeatureIds)) {
    diagnostics.push('syntax feature classifications are out of order')
  }
  const artifacts = new Map(manifest.semanticInventory.sourceArtifacts.map(artifact => [artifact.id, artifact]))
  const features = new Map(manifest.semanticInventory.syntaxFeatures.map(feature => [feature.id, feature]))
  for (const row of ledger.features) {
    const feature = features.get(row.featureId)
    if (!feature) continue
    const classification = classifySyntaxFeatureDimension(feature)
    const expectedState = featureState(feature, classification.dimensionId).state
    if (row.dimensionId !== classification.dimensionId || row.classificationRuleId !== classification.ruleId) {
      diagnostics.push(`syntax feature ${row.featureId} has a stale dimension classification`)
    }
    if (row.state !== expectedState) diagnostics.push(`syntax feature ${row.featureId} has a stale state classification`)
    if (row.state === 'absent') diagnostics.push(`syntax feature ${row.featureId} is absent`)
    if (!FAMILY_SYNTAX_STATES.includes(row.state)) diagnostics.push(`syntax feature ${row.featureId} has invalid state`)
    if (row.state !== 'native' && !row.diagnostic?.trim()) diagnostics.push(`syntax feature ${row.featureId} lacks a diagnostic`)
    if (JSON.stringify(row.familyIds) !== JSON.stringify(feature.families)
      || row.upstreamStatus !== feature.status
      || row.artifactId !== feature.artifact
      || row.fingerprint !== feature.fingerprint
      || row.sourceSha256 !== feature.sourceSha256) {
      diagnostics.push(`syntax feature ${row.featureId} is stale against the pinned manifest`)
    }
    const artifact = artifacts.get(row.artifactId)
    if (!artifact || row.evidence.length === 0 || row.evidence.some(source => !source.trim())) {
      diagnostics.push(`syntax feature ${row.featureId} lacks concrete upstream evidence`)
    }
    if (row.familyIds.some(familyId => !expectedFamilyIds.includes(familyId))) {
      diagnostics.push(`syntax feature ${row.featureId} references an unknown family`)
    }
  }
  return diagnostics
}
