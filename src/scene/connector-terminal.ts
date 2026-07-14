/** Canonical terminal projection of one already-normalized connector.
 *
 * Constructors and admission validation both call this function so the
 * compatibility copies carried by ConnectorMark cannot acquire independent
 * semantics.
 */

import type {
  ConnectorEndpoints,
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

function terminalMarker(marker: MarkerDescriptor | undefined): MarkerDescriptor | undefined {
  return marker ? {
    ...marker,
    ...(marker.geometry ? { geometry: marker.geometry } : {}),
    ...(marker.size ? { size: { ...marker.size } } : {}),
    ...(marker.viewBox ? { viewBox: { ...marker.viewBox } } : {}),
    ...(marker.ref ? { ref: { ...marker.ref } } : {}),
    ...(marker.bounds ? { bounds: { ...marker.bounds } } : {}),
    ...(marker.paint ? { paint: { ...marker.paint } } : {}),
  } : undefined
}

export function connectorTerminalStrokeLosses(
  route: ConnectorRoute,
  stroke: ConnectorStroke,
): ConnectorTerminalStrokeLoss[] {
  const losses: ConnectorTerminalStrokeLoss[] = [
    'continuous-geometry',
    'stroke-width',
    'stroke-cap',
    'stroke-join',
  ]
  if (route.bendRadius > 0) losses.push('bend-radius')
  if (stroke.opacity !== undefined) losses.push('stroke-opacity')
  if (stroke.lineJoin === 'miter' || stroke.lineJoin === 'miter-clip') losses.push('stroke-miter')
  if (stroke.dash) losses.push('dash-pattern')
  if (stroke.dash?.offset !== undefined) losses.push('dash-offset')
  if (stroke.pathLength !== undefined) losses.push('path-length')
  if (stroke.paintOrder !== undefined) losses.push('paint-order')
  if (stroke.nonScaling) losses.push('non-scaling-stroke')
  return losses
}

export function deriveConnectorTerminalProjection(
  input: ConnectorTerminalProjectionInput,
): ConnectorTerminalProjection {
  const strokeLosses = connectorTerminalStrokeLosses(input.route, input.stroke)
  const endpointMarkerAnchors = connectorEndpointMarkerAnchors(input.geometry, input.route.closed)
  const midpointMarkerAnchors = connectorMidpointMarkerAnchors(input.geometry, input.route.closed)
  const markerPlacements = {
    start: input.markers.start ? endpointMarkerAnchors.starts.map(anchor => ({
      markerId: input.markers.start!.id, point: { ...anchor.point }, contourIndex: anchor.contourIndex,
    })) : [],
    mid: input.markers.mid.length === 0 ? [] : midpointMarkerAnchors.map((anchor, index) => ({
      markerId: (input.markers.mid.length === 1 ? input.markers.mid[0] : input.markers.mid[index])!.id,
      point: { ...anchor.point },
      contourIndex: anchor.contourIndex,
    })),
    end: input.markers.end ? endpointMarkerAnchors.ends.map(anchor => ({
      markerId: input.markers.end!.id, point: { ...anchor.point }, contourIndex: anchor.contourIndex,
    })) : [],
  }
  return {
    realization: input.lineStyle === 'invisible' ? 'unsupported' : 'projected',
    topology: input.geometry.kind,
    geometry: input.geometry,
    direction: input.relationship.direction,
    relationship: input.relationship.kind,
    markers: {
      ...(input.markers.start ? { start: terminalMarker(input.markers.start) } : {}),
      mid: input.markers.mid.map(marker => terminalMarker(marker)!),
      ...(input.markers.end ? { end: terminalMarker(input.markers.end) } : {}),
    },
    markerPlacements,
    endpoints: {
      ...input.endpoints,
      ...(input.endpoints.start ? { start: { ...input.endpoints.start, ...(input.endpoints.start.point ? { point: { ...input.endpoints.start.point } } : {}) } } : {}),
      ...(input.endpoints.end ? { end: { ...input.endpoints.end, ...(input.endpoints.end.point ? { point: { ...input.endpoints.end.point } } : {}) } } : {}),
    },
    route: {
      ownership: input.route.ownership,
      closed: input.route.closed,
      bendRadius: input.route.bendRadius,
      contours: input.route.contours.map(contour => ({
        ...contour,
        start: { ...contour.start },
        end: { ...contour.end },
        ...(contour.startTangent ? { startTangent: { ...contour.startTangent } } : {}),
        ...(contour.endTangent ? { endTangent: { ...contour.endTangent } } : {}),
      })),
      ...(input.route.startTangent ? { startTangent: { ...input.route.startTangent } } : {}),
      ...(input.route.endTangent ? { endTangent: { ...input.route.endTangent } } : {}),
      labelAnchors: input.route.labelAnchors.map(anchor => ({ ...anchor })),
    },
    stroke: {
      ...input.stroke,
      ...(input.stroke.dash ? { dash: { ...input.stroke.dash, array: Array.isArray(input.stroke.dash.array) ? [...input.stroke.dash.array] : input.stroke.dash.array } } : {}),
    },
    hit: { ...input.hit, geometry: input.hit.geometry },
    ...(input.transform ? { transform: { ...input.transform } } : {}),
    labels: input.labels.map(label => ({
      ...label,
      ...(label.anchor ? { anchor: { ...label.anchor } } : {}),
      ...(label.bounds ? { bounds: { ...label.bounds } } : {}),
      ...(label.halo ? { halo: { ...label.halo } } : {}),
      ...(label.paint ? { paint: { ...label.paint } } : {}),
      ...(label.visual ? { visual: { ...label.visual } } : {}),
    })),
    lineStyle: input.lineStyle,
    strokeLosses,
    diagnostics: [
      input.lineStyle === 'invisible'
        ? 'This connector affects layout but is intentionally absent from terminal output.'
        : `The terminal grid preserves connector semantics while projecting continuous stroke fields: ${strokeLosses.join(', ')}.`,
      ...(input.additionalDiagnostics ?? []),
    ],
  }
}
