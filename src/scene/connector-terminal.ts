/** Canonical terminal projection of one already-normalized connector.
 *
 * Constructors and admission validation both call this function so derived
 * terminal semantics have one authority.
 */

import type {
  ConnectorEndpoints,
  ConnectorEndpointAnchor,
  ConnectorGeometry,
  ConnectorHitGeometry,
  ConnectorLabelDescriptor,
  ConnectorMark,
  ConnectorRelationship,
  ConnectorRoute,
  ConnectorStroke,
  ConnectorTerminalProjection,
  ConnectorTerminalStrokeLoss,
  MarkerDescriptor,
  SceneTransform,
} from './ir.ts'
import {
  connectorEndpointMarkerAnchors,
  connectorMidpointMarkerAnchors,
} from './connector-geometry.ts'

export interface ConnectorTerminalProjectionInput {
  readonly geometry: ConnectorGeometry
  readonly lineStyle: ConnectorMark['lineStyle']
  readonly endpoints: ConnectorEndpoints
  readonly relationship: ConnectorRelationship
  readonly route: ConnectorRoute
  readonly stroke: ConnectorStroke
  readonly markers: {
    readonly start?: MarkerDescriptor
    readonly mid: readonly MarkerDescriptor[]
    readonly end?: MarkerDescriptor
  }
  readonly labels: readonly ConnectorLabelDescriptor[]
  readonly hit: ConnectorHitGeometry
  readonly transform?: SceneTransform
  readonly additionalDiagnostics?: readonly string[]
}

/** Frozen first-party data still has Object.prototype. A deferred consumer
 * must not turn a later prototype addition into new captured input. The eager
 * path deliberately keeps its existing ordinary-property behavior. */
function optional<T extends object, K extends keyof T>(value: T, key: K, ownPropertiesOnly: boolean): T[K] | undefined {
  return !ownPropertiesOnly || Object.hasOwn(value, key) ? value[key] : undefined
}

function terminalMarker(marker: MarkerDescriptor | undefined, ownPropertiesOnly: boolean): MarkerDescriptor | undefined {
  return marker ? {
    ...marker,
    ...(optional(marker, 'geometry', ownPropertiesOnly) ? { geometry: optional(marker, 'geometry', ownPropertiesOnly) } : {}),
    ...(optional(marker, 'size', ownPropertiesOnly) ? { size: { ...optional(marker, 'size', ownPropertiesOnly)! } } : {}),
    ...(optional(marker, 'viewBox', ownPropertiesOnly) ? { viewBox: { ...optional(marker, 'viewBox', ownPropertiesOnly)! } } : {}),
    ...(optional(marker, 'ref', ownPropertiesOnly) ? { ref: { ...optional(marker, 'ref', ownPropertiesOnly)! } } : {}),
    ...(optional(marker, 'bounds', ownPropertiesOnly) ? { bounds: { ...optional(marker, 'bounds', ownPropertiesOnly)! } } : {}),
    ...(optional(marker, 'paint', ownPropertiesOnly) ? { paint: { ...optional(marker, 'paint', ownPropertiesOnly)! } } : {}),
  } : undefined
}

function terminalEndpoint(endpoint: ConnectorEndpointAnchor, ownPropertiesOnly: boolean): ConnectorEndpointAnchor {
  const owner = optional(endpoint, 'owner', ownPropertiesOnly)
  const point = optional(endpoint, 'point', ownPropertiesOnly)
  return {
    ...endpoint,
    ...(owner ? { owner: { ...owner } } : {}),
    ...(point ? { point: { ...point } } : {}),
  }
}

export function connectorTerminalStrokeLosses(
  route: ConnectorRoute,
  stroke: ConnectorStroke,
  ownPropertiesOnly = false,
): ConnectorTerminalStrokeLoss[] {
  const losses: ConnectorTerminalStrokeLoss[] = [
    'continuous-geometry',
    'stroke-width',
    'stroke-cap',
    'stroke-join',
  ]
  if (route.bendRadius > 0) losses.push('bend-radius')
  if (optional(stroke, 'opacity', ownPropertiesOnly) !== undefined) losses.push('stroke-opacity')
  if (stroke.lineJoin === 'miter' || stroke.lineJoin === 'miter-clip') losses.push('stroke-miter')
  if (optional(stroke, 'dash', ownPropertiesOnly)) losses.push('dash-pattern')
  const dash = optional(stroke, 'dash', ownPropertiesOnly)
  if (dash && optional(dash, 'offset', ownPropertiesOnly) !== undefined) losses.push('dash-offset')
  if (optional(stroke, 'pathLength', ownPropertiesOnly) !== undefined) losses.push('path-length')
  if (optional(stroke, 'paintOrder', ownPropertiesOnly) !== undefined) losses.push('paint-order')
  if (/^url\(#[A-Za-z_][A-Za-z0-9_.:-]*\)$/.test(stroke.color)) losses.push('gradient-paint')
  if (optional(stroke, 'mixBlendMode', ownPropertiesOnly) !== undefined && optional(stroke, 'mixBlendMode', ownPropertiesOnly) !== 'normal') losses.push('mix-blend-mode')
  if (optional(stroke, 'nonScaling', ownPropertiesOnly)) losses.push('non-scaling-stroke')
  return losses
}

export function deriveConnectorTerminalProjection(
  input: ConnectorTerminalProjectionInput,
  ownPropertiesOnly = false,
): ConnectorTerminalProjection {
  // Deferred inputs are deliberately restricted to line/polyline geometry.
  // Path helpers also inspect optional contour metadata, and path derivation
  // must stay eager to preserve its validation/error boundary.
  if (ownPropertiesOnly && input.geometry.kind === 'path') throw new TypeError('Deferred terminal projections require line or polyline geometry')
  const strokeLosses = connectorTerminalStrokeLosses(input.route, input.stroke, ownPropertiesOnly)
  const endpointMarkerAnchors = connectorEndpointMarkerAnchors(input.geometry, input.route.closed)
  const midpointMarkerAnchors = connectorMidpointMarkerAnchors(input.geometry, input.route.closed)
  const dash = optional(input.stroke, 'dash', ownPropertiesOnly)
  const markerPlacements = {
    start: optional(input.markers, 'start', ownPropertiesOnly) ? endpointMarkerAnchors.starts.map(anchor => ({
      markerId: optional(input.markers, 'start', ownPropertiesOnly)!.id, point: { ...anchor.point }, contourIndex: anchor.contourIndex,
    })) : [],
    mid: input.markers.mid.length === 0 ? [] : midpointMarkerAnchors.map((anchor, index) => ({
      markerId: (input.markers.mid.length === 1 ? input.markers.mid[0] : input.markers.mid[index])!.id,
      point: { ...anchor.point },
      contourIndex: anchor.contourIndex,
    })),
    end: optional(input.markers, 'end', ownPropertiesOnly) ? endpointMarkerAnchors.ends.map(anchor => ({
      markerId: optional(input.markers, 'end', ownPropertiesOnly)!.id, point: { ...anchor.point }, contourIndex: anchor.contourIndex,
    })) : [],
  }
  return {
    realization: input.lineStyle === 'invisible' ? 'unsupported' : 'projected',
    topology: input.geometry.kind,
    geometry: input.geometry,
    direction: input.relationship.direction,
    relationship: input.relationship.kind,
    markers: {
      ...(optional(input.markers, 'start', ownPropertiesOnly) ? { start: terminalMarker(optional(input.markers, 'start', ownPropertiesOnly), ownPropertiesOnly) } : {}),
      mid: input.markers.mid.map(marker => terminalMarker(marker, ownPropertiesOnly)!),
      ...(optional(input.markers, 'end', ownPropertiesOnly) ? { end: terminalMarker(optional(input.markers, 'end', ownPropertiesOnly), ownPropertiesOnly) } : {}),
    },
    markerPlacements,
    endpoints: {
      ...input.endpoints,
      ...(optional(input.endpoints, 'start', ownPropertiesOnly) ? { start: terminalEndpoint(optional(input.endpoints, 'start', ownPropertiesOnly)!, ownPropertiesOnly) } : {}),
      ...(optional(input.endpoints, 'end', ownPropertiesOnly) ? { end: terminalEndpoint(optional(input.endpoints, 'end', ownPropertiesOnly)!, ownPropertiesOnly) } : {}),
    },
    route: {
      ownership: input.route.ownership,
      closed: input.route.closed,
      bendRadius: input.route.bendRadius,
      contours: input.route.contours.map(contour => ({
        ...contour,
        start: { ...contour.start },
        end: { ...contour.end },
        ...(optional(contour, 'startTangent', ownPropertiesOnly) ? { startTangent: { ...optional(contour, 'startTangent', ownPropertiesOnly)! } } : {}),
        ...(optional(contour, 'endTangent', ownPropertiesOnly) ? { endTangent: { ...optional(contour, 'endTangent', ownPropertiesOnly)! } } : {}),
      })),
      ...(optional(input.route, 'startTangent', ownPropertiesOnly) ? { startTangent: { ...optional(input.route, 'startTangent', ownPropertiesOnly)! } } : {}),
      ...(optional(input.route, 'endTangent', ownPropertiesOnly) ? { endTangent: { ...optional(input.route, 'endTangent', ownPropertiesOnly)! } } : {}),
      labelAnchors: input.route.labelAnchors.map(anchor => ({ ...anchor })),
    },
    stroke: {
      ...input.stroke,
      ...(dash ? { dash: { ...dash, array: Array.isArray(dash.array) ? [...dash.array] : dash.array } } : {}),
    },
    hit: { ...input.hit, geometry: input.hit.geometry },
    ...(optional(input, 'transform', ownPropertiesOnly) ? { transform: { ...optional(input, 'transform', ownPropertiesOnly)! } } : {}),
    labels: input.labels.map(label => ({
      ...label,
      ...(optional(label, 'anchor', ownPropertiesOnly) ? { anchor: { ...optional(label, 'anchor', ownPropertiesOnly)! } } : {}),
      ...(optional(label, 'bounds', ownPropertiesOnly) ? { bounds: { ...optional(label, 'bounds', ownPropertiesOnly)! } } : {}),
      ...(optional(label, 'halo', ownPropertiesOnly) ? { halo: { ...optional(label, 'halo', ownPropertiesOnly)! } } : {}),
      ...(optional(label, 'paint', ownPropertiesOnly) ? { paint: { ...optional(label, 'paint', ownPropertiesOnly)! } } : {}),
      ...(optional(label, 'visual', ownPropertiesOnly) ? { visual: { ...optional(label, 'visual', ownPropertiesOnly)! } } : {}),
    })),
    lineStyle: input.lineStyle,
    strokeLosses,
    diagnostics: [
      input.lineStyle === 'invisible'
        ? 'This connector affects layout but is intentionally absent from terminal output.'
        : `The terminal grid preserves connector semantics while projecting continuous stroke fields: ${strokeLosses.join(', ')}.`,
      ...(optional(input, 'additionalDiagnostics', ownPropertiesOnly) ?? []),
    ],
  }
}
