/** A small, renderer-independent vocabulary for declaring Scene support. */

export const CORE_SCENE_PRIMITIVES = [
  'document',
  'text',
  'shape',
  'container',
  'connector',
  'marker',
  'data-mark',
] as const

export type CoreScenePrimitive = (typeof CORE_SCENE_PRIMITIVES)[number]

export type ScenePrimitive = CoreScenePrimitive | `${string}:${string}`

export interface EssentialScenePrimitiveOperation {
  readonly primitive: CoreScenePrimitive
  readonly operation: 'render' | 'serialize'
}

/** One authority for the minimum operation that makes each core primitive
 * usable by a selected Scene backend. */
export const ESSENTIAL_SCENE_PRIMITIVE_OPERATIONS: readonly EssentialScenePrimitiveOperation[] = Object.freeze(
  CORE_SCENE_PRIMITIVES.map(primitive => Object.freeze({
    primitive,
    operation: primitive === 'document' ? 'serialize' as const : 'render' as const,
  })),
)

export function essentialScenePrimitiveOperation(
  primitive: CoreScenePrimitive,
): EssentialScenePrimitiveOperation['operation'] {
  return primitive === 'document' ? 'serialize' : 'render'
}

export const CORE_SCENE_OPERATIONS = [
  'measure',
  'layout',
  'bounds',
  'hit-test',
  'render',
  'accessibility',
  'terminal-project',
  'serialize',
] as const

export type CoreSceneOperation = (typeof CORE_SCENE_OPERATIONS)[number]

export type SceneOperation = CoreSceneOperation | `${string}:${string}`

export const CORE_SCENE_FEATURES = [
  'geometry',
  'paint',
  'stroke',
  'transform',
  'identity',
  'relation',
  'labels',
  'markers',
  'resources',
  'interaction',
  'topology',
  'subpaths',
  'closedness',
  'bend-radius',
  'endpoints',
  'direction',
  'hit-geometry',
  'stroke-opacity',
  'stroke-cap',
  'stroke-join',
  'stroke-miter',
  'dash-array',
  'dash-offset',
  'dash-restart',
  'path-length',
  'paint-order',
  'compositing',
  'non-scaling-stroke',
  'marker-orientation',
  'marker-overflow',
] as const

export type CoreSceneFeature = (typeof CORE_SCENE_FEATURES)[number]

export type SceneFeature = CoreSceneFeature | `${string}:${string}`

export interface EssentialScenePrimitiveCapability {
  readonly primitive: CoreScenePrimitive
  readonly feature: CoreSceneFeature
  readonly operation: CoreSceneOperation
}

const detailedConnectorFeatures = [
  'transform', 'topology', 'subpaths', 'closedness', 'bend-radius', 'stroke-opacity', 'stroke-cap', 'stroke-join',
  'stroke-miter', 'dash-array', 'dash-offset', 'dash-restart', 'path-length',
  'paint-order', 'compositing', 'non-scaling-stroke', 'marker-orientation', 'marker-overflow',
] as const satisfies readonly CoreSceneFeature[]

/** Minimum feature-level contract required before a backend can truthfully
 * accept a family that emits a primitive. This is intentionally stricter than
 * checking that any claim exists for a primitive/operation pair: geometry
 * support alone must not silently discard paint, identity, markers, relation,
 * accessibility, or hit semantics. */

export const ESSENTIAL_SCENE_PRIMITIVE_CAPABILITIES: readonly EssentialScenePrimitiveCapability[] = Object.freeze(([
  ['document', 'serialize', ['identity', 'resources']],
  ['document', 'accessibility', ['interaction']],
  ['text', 'render', ['geometry', 'paint']],
  ['text', 'accessibility', ['labels']],
  ['text', 'serialize', ['identity']],
  ['shape', 'render', ['geometry', 'paint']],
  ['shape', 'serialize', ['identity']],
  ['container', 'render', ['geometry', 'paint']],
  ['container', 'serialize', ['identity']],
  ['connector', 'render', ['geometry', 'stroke', ...detailedConnectorFeatures]],
  ['connector', 'serialize', ['endpoints', 'direction']],
  ['connector', 'render', ['labels']],
  ['connector', 'accessibility', ['labels']],
  ['connector', 'render', ['markers']],
  ['connector', 'accessibility', ['relation']],
  ['connector', 'hit-test', ['interaction', 'hit-geometry']],
  ['connector', 'serialize', ['identity']],
  ['marker', 'render', ['geometry', 'paint']],
  ['marker', 'serialize', ['identity']],
  ['data-mark', 'render', ['geometry', 'paint']],
  ['data-mark', 'serialize', ['identity']],
] as const satisfies readonly (readonly [CoreScenePrimitive, CoreSceneOperation, readonly CoreSceneFeature[]])[])
  .flatMap(([primitive, operation, features]) => features.map(feature => Object.freeze({ primitive, feature, operation }))))

export const PRIMITIVE_REALIZATIONS = [
  'native',
  'emulated',
  'projected',
  'lossy',
  'unsupported',
] as const

export type PrimitiveRealization = (typeof PRIMITIVE_REALIZATIONS)[number]

import type { SceneNode } from './ir.ts'

/**
 * Project a concrete Scene node onto the stable primitive vocabulary. Document
 * nodes are document-level serialization; marker
 * resources are an additional marker primitive; quantitative shapes are also
 * data marks. Keeping this projection here prevents conformance/report code
 * from growing its own family-specific classifiers.
 */
export function sceneNodePrimitives(node: SceneNode): readonly CoreScenePrimitive[] {
  switch (node.kind) {
    case 'text': return ['text']
    case 'shape': return node.channels?.value === undefined ? ['shape'] : ['shape', 'data-mark']
    case 'group': return ['container']
    case 'connector': return ['connector']
    case 'document': return node.markerResources?.length ? ['document', 'marker'] : ['document']
  }
}

export interface PrimitiveCapabilityClaim {
  /** Stable implementation/backend identifier, e.g. `svg:rough`. */
  target: string
  primitive: ScenePrimitive
  feature: SceneFeature
  operation: SceneOperation
  realization: PrimitiveRealization
  /** Human-readable proof, test name, or contract reference. */
  evidence?: string
  /** Required explanation for an observable limitation. */
  diagnostic?: string
}

/**
 * Canonical capability projection for the three graphical Scene backends.
 * The crisp backend serializes authored marks natively. Sketch backends keep
 * semantic/identity carriers native while re-realizing visual geometry and
 * paint; marker artwork remains a typed projection by design.
 */
export function graphicalBackendCapabilityClaims(
  target: `backend:${string}`,
  mode: 'crisp' | 'sketch',
  sketchKind: 'rough' | 'hybrid' = 'rough',
): readonly PrimitiveCapabilityClaim[] {
  const visual = mode === 'crisp' ? 'native' as const : 'emulated' as const
  const markerVisual = mode === 'crisp' ? 'native' as const : 'projected' as const
  // One claim-keyed executable matrix exercises every cell against the real
  // backend. Individual historical tests are useful characterization, but a
  // file that happens to mention RoughBackend is not evidence for Hybrid or
  // for an unrelated primitive.
  const evidence = 'src/__tests__/backend-capability-conformance.test.ts'
  const connectorRealization = (feature: CoreSceneFeature): Pick<PrimitiveCapabilityClaim, 'realization' | 'diagnostic'> => {
    if (mode === 'crisp') return { realization: 'native' }
    if (feature === 'geometry' || feature === 'topology') return {
      realization: 'lossy',
      diagnostic: 'The exact authored path remains as an invisible semantic carrier, but arbitrary curves are flattened to typed routed contours for the visible sketch.',
    }
    if (feature === 'closedness') return {
      realization: 'lossy',
      diagnostic: 'Sketch shafts are rebuilt from routed geometry and do not preserve explicit closed-subpath semantics.',
    }
    if (feature === 'bend-radius') return {
      realization: 'lossy',
      diagnostic: 'The authored rounded carrier remains exact, but the visible sketch follows its routed polyline and cannot preserve the continuous bend radius.',
    }
    if (feature === 'dash-restart') return {
      realization: 'lossy',
      diagnostic: 'A rough stroke may contain multiple generated stroke subpaths, so SVG dash restart boundaries can differ.',
    }
    if (feature === 'path-length') return {
      realization: 'lossy',
      diagnostic: 'One pathLength value spans generated stroke subpaths, so a sketch cannot retain one authored path calibration exactly.',
    }
    if (sketchKind === 'hybrid' && (feature === 'stroke-cap' || feature === 'stroke-join' || feature === 'stroke-miter' || feature === 'non-scaling-stroke')) {
      return {
        realization: 'lossy',
        diagnostic: `Freehand ribbon geometry cannot preserve authored ${feature} semantics; dashed Hybrid connectors fall back to the faithful rough projection.`,
      }
    }
    if (feature === 'marker-orientation' || feature === 'marker-overflow') return {
      realization: 'projected',
      diagnostic: 'Marker geometry, orientation, and overflow remain in the typed marker projection instead of being sketched.',
    }
    return { realization: 'emulated' }
  }

  const claim = (primitive: CoreScenePrimitive, feature: CoreSceneFeature, operation: CoreSceneOperation,
    realization: PrimitiveRealization | Pick<PrimitiveCapabilityClaim, 'realization' | 'diagnostic'> = 'native'): PrimitiveCapabilityClaim => ({
      target, primitive, feature, operation, ...(typeof realization === 'string' ? { realization } : realization), evidence,
    })
  const claims: PrimitiveCapabilityClaim[] = [
    claim('document', 'identity', 'serialize'),
    claim('document', 'resources', 'serialize'),
    claim('document', 'interaction', 'accessibility'),
    claim('text', 'geometry', 'render'),
    claim('text', 'paint', 'render'),
    claim('text', 'labels', 'accessibility'),
    claim('text', 'identity', 'serialize'),
    claim('shape', 'geometry', 'render', visual),
    claim('shape', 'paint', 'render', visual),
    claim('shape', 'identity', 'serialize'),
    // Group wrappers are not redrawn by sketch backends. Their transform and
    // paint cascade are preserved natively while eligible children are
    // independently re-realized.
    claim('container', 'geometry', 'render'),
    claim('container', 'paint', 'render'),
    claim('container', 'identity', 'serialize'),
    claim('connector', 'geometry', 'render', connectorRealization('geometry')),
    claim('connector', 'stroke', 'render', visual),
    ...detailedConnectorFeatures.map(feature => claim('connector', feature, 'render', connectorRealization(feature))),
    claim('connector', 'relation', 'accessibility'),
    claim('connector', 'endpoints', 'serialize'),
    claim('connector', 'direction', 'serialize'),
    claim('connector', 'labels', 'render'),
    claim('connector', 'labels', 'accessibility'),
    claim('connector', 'markers', 'render', markerVisual),
    claim('connector', 'interaction', 'hit-test'),
    claim('connector', 'hit-geometry', 'hit-test'),
    claim('connector', 'identity', 'serialize'),
    claim('marker', 'geometry', 'render', markerVisual),
    claim('marker', 'paint', 'render', markerVisual),
    claim('marker', 'identity', 'serialize'),
    claim('data-mark', 'geometry', 'render', visual),
    claim('data-mark', 'paint', 'render', visual),
    claim('data-mark', 'identity', 'serialize'),
  ]
  const validation = validatePrimitiveCapabilities(claims)
  if (!validation.valid) throw new Error(`Invalid graphical backend capability contract: ${validation.diagnostics.join('; ')}`)
  return Object.freeze(claims.map(claim => Object.freeze({ ...claim })))
}

/** Claim-keyed contract for the typed Scene -> terminal evidence adapter.
 * The projection preserves exact source semantics for family terminal
 * renderers and receipts; continuous visual fields remain explicitly lossy on
 * a character grid. */
export function terminalConnectorCapabilityClaims(
  target: `terminal:${string}` = 'terminal:projection',
): readonly PrimitiveCapabilityClaim[] {
  const evidence = 'src/__tests__/terminal-projection-security.test.ts'
  const lossy = new Set<CoreSceneFeature>([
    'geometry', 'paint', 'stroke', 'transform', 'bend-radius',
    'stroke-opacity', 'stroke-cap', 'stroke-join', 'stroke-miter',
    'dash-array', 'dash-offset', 'dash-restart', 'path-length', 'paint-order', 'compositing',
    'non-scaling-stroke', 'marker-orientation', 'marker-overflow',
  ])
  const features = [
    'identity', 'relation', 'endpoints', 'direction', 'labels', 'markers',
    'geometry', 'topology', 'subpaths', 'closedness', 'bend-radius',
    'interaction', 'hit-geometry', 'stroke', 'transform', 'stroke-opacity',
    'stroke-cap', 'stroke-join', 'stroke-miter', 'dash-array', 'dash-offset',
    'dash-restart', 'path-length', 'paint-order', 'compositing', 'non-scaling-stroke',
    'marker-orientation', 'marker-overflow',
  ] as const satisfies readonly CoreSceneFeature[]
  const claims: PrimitiveCapabilityClaim[] = features.map(feature => ({
    target,
    primitive: 'connector',
    feature,
    operation: 'terminal-project',
    realization: lossy.has(feature) ? 'lossy' : 'projected',
    evidence,
    ...(lossy.has(feature) ? {
      diagnostic: `Terminal cells cannot render continuous connector ${feature}; the exact typed value remains in terminal projection evidence.`,
    } : {}),
  }))
  const validation = validatePrimitiveCapabilities(claims)
  if (!validation.valid) throw new Error(`Invalid terminal connector capability contract: ${validation.diagnostics.join('; ')}`)
  return Object.freeze(claims.map(claim => Object.freeze({ ...claim })))
}

export interface CapabilityValidationResult {
  valid: boolean
  diagnostics: readonly string[]
}

export function primitiveCapabilityClaimKey(claim: PrimitiveCapabilityClaim): string {
  return [claim.target, claim.primitive, claim.feature, claim.operation].join('\u0000')
}

/** Validate one immutable per-call capability manifest. */
export function validatePrimitiveCapabilities(
  claims: readonly PrimitiveCapabilityClaim[],
): CapabilityValidationResult {
  const diagnostics: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < claims.length; index++) {
    const claim = claims[index]!
    const key = primitiveCapabilityClaimKey(claim)
    if (seen.has(key)) diagnostics.push(`claim[${index}]: duplicate target/primitive/feature/operation`)
    seen.add(key)
    if (claim.target.trim() === '') diagnostics.push(`claim[${index}]: target must not be empty`)
    if (claim.primitive.trim() === '') diagnostics.push(`claim[${index}]: primitive must not be empty`)
    if (claim.feature.trim() === '') diagnostics.push(`claim[${index}]: feature must not be empty`)
    if (claim.operation.trim() === '') diagnostics.push(`claim[${index}]: operation must not be empty`)
    if (!PRIMITIVE_REALIZATIONS.includes(claim.realization)) diagnostics.push(`claim[${index}]: invalid realization ${String(claim.realization)}`)
    if ((claim.realization === 'lossy' || claim.realization === 'unsupported') && !claim.diagnostic?.trim()) {
      diagnostics.push(`claim[${index}]: ${claim.realization} realization requires a diagnostic`)
    }
  }
  return { valid: diagnostics.length === 0, diagnostics }
}
