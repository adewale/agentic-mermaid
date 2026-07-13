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
  'closedness',
  'stroke-opacity',
  'stroke-cap',
  'stroke-join',
  'stroke-miter',
  'dash-array',
  'dash-offset',
  'dash-restart',
  'path-length',
  'paint-order',
  'non-scaling-stroke',
  'marker-orientation',
] as const

export type CoreSceneFeature = (typeof CORE_SCENE_FEATURES)[number]

export type SceneFeature = CoreSceneFeature | `${string}:${string}`

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
 * Project a concrete Scene node onto the stable primitive vocabulary. Raw,
 * prelude, and document nodes are document-level serialization; marker
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
    case 'raw':
    case 'prelude':
      return ['document']
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
 * paint; marker artwork remains a crisp projection by design.
 */
export function graphicalBackendCapabilityClaims(
  target: `backend:${string}`,
  mode: 'crisp' | 'sketch',
  sketchKind: 'rough' | 'hybrid' = 'rough',
): readonly PrimitiveCapabilityClaim[] {
  const visual = mode === 'crisp' ? 'native' as const : 'emulated' as const
  const markerVisual = mode === 'crisp' ? 'native' as const : 'projected' as const
  const evidence = mode === 'crisp'
    ? 'src/__tests__/svg-equivalence.test.ts'
    : 'src/__tests__/styled-backend-paint.test.ts'
  const connectorEvidence = 'src/__tests__/scene-connector-contract.test.ts'
  const connectorRealization = (feature: CoreSceneFeature): Pick<PrimitiveCapabilityClaim, 'realization' | 'diagnostic'> => {
    if (mode === 'crisp') return { realization: 'native' }
    if (feature === 'closedness') return {
      realization: 'lossy',
      diagnostic: 'Sketch shafts are rebuilt from routed geometry and do not preserve explicit closed-subpath semantics.',
    }
    if (feature === 'dash-restart') return {
      realization: 'lossy',
      diagnostic: 'A rough stroke may serialize as multiple paths, so SVG dash restart boundaries can differ.',
    }
    if (feature === 'path-length') return {
      realization: 'lossy',
      diagnostic: 'pathLength is copied to generated paths, but a multi-path sketch cannot retain one authored path calibration exactly.',
    }
    if (sketchKind === 'hybrid' && (feature === 'stroke-cap' || feature === 'stroke-join' || feature === 'stroke-miter' || feature === 'non-scaling-stroke')) {
      return {
        realization: 'lossy',
        diagnostic: `Freehand ribbon geometry cannot preserve authored ${feature} semantics; dashed Hybrid connectors fall back to the faithful rough projection.`,
      }
    }
    if (feature === 'marker-orientation') return {
      realization: 'projected',
      diagnostic: 'Marker geometry and orientation remain on the typed crisp carrier instead of being sketched.',
    }
    return { realization: 'emulated' }
  }
  const detailedConnectorFeatures = [
    'topology', 'closedness', 'stroke-opacity', 'stroke-cap', 'stroke-join',
    'stroke-miter', 'dash-array', 'dash-offset', 'dash-restart', 'path-length',
    'paint-order', 'non-scaling-stroke', 'marker-orientation',
  ] as const satisfies readonly CoreSceneFeature[]
  const claims: PrimitiveCapabilityClaim[] = [
    { target, primitive: 'document', feature: 'identity', operation: 'serialize', realization: 'native', evidence },
    { target, primitive: 'document', feature: 'resources', operation: 'serialize', realization: 'native', evidence: 'src/__tests__/renderer-security.test.ts' },
    { target, primitive: 'document', feature: 'interaction', operation: 'accessibility', realization: 'native', evidence: 'src/__tests__/svg-a11y-conformance.test.ts' },
    { target, primitive: 'text', feature: 'geometry', operation: 'render', realization: 'native', evidence },
    { target, primitive: 'text', feature: 'paint', operation: 'render', realization: 'native', evidence },
    { target, primitive: 'text', feature: 'labels', operation: 'accessibility', realization: 'native', evidence: 'src/__tests__/svg-a11y-conformance.test.ts' },
    { target, primitive: 'text', feature: 'identity', operation: 'serialize', realization: 'native', evidence },
    { target, primitive: 'shape', feature: 'geometry', operation: 'render', realization: visual, evidence },
    { target, primitive: 'shape', feature: 'paint', operation: 'render', realization: visual, evidence },
    { target, primitive: 'shape', feature: 'identity', operation: 'serialize', realization: 'native', evidence: 'src/__tests__/scene-transform.test.ts' },
    { target, primitive: 'container', feature: 'geometry', operation: 'render', realization: visual, evidence },
    { target, primitive: 'container', feature: 'paint', operation: 'render', realization: visual, evidence },
    { target, primitive: 'container', feature: 'identity', operation: 'serialize', realization: 'native', evidence: 'src/__tests__/scene-transform.test.ts' },
    { target, primitive: 'connector', feature: 'geometry', operation: 'render', realization: visual, evidence: connectorEvidence },
    { target, primitive: 'connector', feature: 'stroke', operation: 'render', realization: visual, evidence: connectorEvidence },
    ...detailedConnectorFeatures.map(feature => ({
      target,
      primitive: 'connector' as const,
      feature,
      operation: 'render' as const,
      ...connectorRealization(feature),
      evidence: connectorEvidence,
    })),
    { target, primitive: 'connector', feature: 'relation', operation: 'accessibility', realization: 'native', evidence: 'src/__tests__/accessibility-relation-palette.test.ts' },
    { target, primitive: 'connector', feature: 'markers', operation: 'render', realization: markerVisual, evidence: connectorEvidence },
    { target, primitive: 'connector', feature: 'interaction', operation: 'hit-test', realization: 'native', evidence: connectorEvidence },
    { target, primitive: 'connector', feature: 'identity', operation: 'serialize', realization: 'native', evidence: connectorEvidence },
    { target, primitive: 'marker', feature: 'geometry', operation: 'render', realization: markerVisual, evidence: connectorEvidence },
    { target, primitive: 'marker', feature: 'paint', operation: 'render', realization: markerVisual, evidence: connectorEvidence },
    { target, primitive: 'marker', feature: 'identity', operation: 'serialize', realization: 'native', evidence: connectorEvidence },
    { target, primitive: 'data-mark', feature: 'geometry', operation: 'render', realization: visual, evidence },
    { target, primitive: 'data-mark', feature: 'paint', operation: 'render', realization: visual, evidence },
    { target, primitive: 'data-mark', feature: 'identity', operation: 'serialize', realization: 'native', evidence },
  ]
  const validation = validatePrimitiveCapabilities(claims)
  if (!validation.valid) throw new Error(`Invalid graphical backend capability contract: ${validation.diagnostics.join('; ')}`)
  return Object.freeze(claims.map(claim => Object.freeze({ ...claim })))
}

export interface CapabilityValidationResult {
  valid: boolean
  diagnostics: readonly string[]
}

function claimKey(claim: PrimitiveCapabilityClaim): string {
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
    const key = claimKey(claim)
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
