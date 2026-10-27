import type { MarkerDescriptor, ScenePoint } from '../../scene/ir.ts'

export interface MarkerContact {
  intent: 'surface-bound' | 'path-only' | 'decorative'
  attachment: 'tip' | 'tangent' | 'center' | 'envelope' | 'free-axis'
  point?: ScenePoint
}

/** Test-side family semantics, independent of the renderer's reference point.
 * A polygon's named tip is its second vertex; a diamond/lollipop is not an
 * arrow inferred from the largest coordinate. New resource meanings require
 * an explicit characterization here, rather than an inventory allow-list. */
export function markerContact(family: string, marker: MarkerDescriptor): MarkerContact {
  const geometry = marker.geometry
  const tip = (intent: MarkerContact['intent']): MarkerContact => {
    if (geometry?.kind === 'polygon' || geometry?.kind === 'polyline') {
      if (!geometry.points[1]) throw new Error(`${family}/${marker.id}: no declared tip vertex`)
      return { intent, attachment: 'tip', point: geometry.points[1] }
    }
    if (geometry?.kind === 'path' && /^[MLZ\deE+.,\s-]+$/.test(geometry.d)) {
      const coordinates = (geometry.d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
      if (coordinates.length >= 4) return { intent, attachment: 'tip', point: { x: coordinates[2]!, y: coordinates[3]! } }
    }
    throw new Error(`${family}/${marker.id}: uncharacterized tip geometry`)
  }
  switch (family) {
    case 'flowchart': case 'state': case 'c4':
      if (marker.shape === 'arrow') return tip('surface-bound')
      if (marker.shape === 'circle' || marker.shape === 'cross') return { intent: 'surface-bound', attachment: 'envelope' }
      break
    case 'eventmodeling': case 'architecture': case 'gantt': case 'ishikawa':
      if (marker.shape === 'arrow') return tip('surface-bound')
      break
    case 'class':
      if (marker.id === 'cls-lollipop' && geometry?.kind === 'circle') return { intent: 'surface-bound', attachment: 'tangent', point: { x: geometry.cx + geometry.r, y: geometry.cy } }
      if (['triangle', 'diamond', 'diamond-open', 'open-arrow'].includes(marker.shape)) return tip('surface-bound')
      break
    case 'zenuml':
    case 'sequence':
      if (marker.shape === 'cross' && marker.size) return { intent: 'path-only', attachment: 'center', point: { x: marker.size.width / 2, y: marker.size.height / 2 } }
      if (marker.shape === 'arrow' || marker.shape === 'open-arrow') return tip('path-only')
      break
    case 'journey':
      if (marker.shape === 'arrow' && marker.size) return { intent: 'path-only', attachment: 'free-axis', point: { x: marker.size.width, y: marker.size.height / 2 } }
      break
    case 'requirement':
      if (marker.id === 'requirement-arrow') return tip('surface-bound')
      if (marker.id === 'requirement-contains') return { intent: 'decorative', attachment: 'envelope' }
      break
    case 'block':
      if (marker.shape === 'arrow') return tip('surface-bound')
      if ((marker.shape === 'circle' || marker.shape === 'cross') && marker.size) return { intent: 'decorative', attachment: 'center', point: { x: marker.size.width / 2, y: marker.size.height / 2 } }
      break
  }
  throw new Error(`${family}/${marker.id}: marker contact intent has not been characterized`)
}
