// ============================================================================
// Mark constructors — the only way family lowerings build scene nodes.
//
// Each constructor takes semantic fields plus the crisp SVG string the old
// emitter produced (the template literal moves into the lowering call site
// unchanged, so the byte stream cannot drift). group() is the exception: it
// *builds* its crisp from open/close/children with the same indent/join rules
// the string renderers used, so wrapper composition stays byte-exact while
// styled backends re-compose restyled children.
//
// scene-fidelity.test.ts closes the loop: it parses every crisp element and
// asserts the semantic fields agree, so a lowering cannot lie about geometry.
// ============================================================================

import type {
  ConnectorMark, GroupMark, Geometry, MarkPaint, MarkerRef, PreludeMark,
  RawMark, SceneNode, SceneRole, SemanticChannels, ShapeMark, TextMark,
} from './ir.ts'
import type { DiagramColors } from '../theme.ts'

export function shape(fields: {
  id: string
  role: SceneRole
  geometry: Geometry
  paint: MarkPaint
  channels?: SemanticChannels
}, crisp: string): ShapeMark {
  return { kind: 'shape', crisp, ...fields }
}

export function connector(fields: {
  id: string
  role: SceneRole
  geometry: ConnectorMark['geometry']
  lineStyle: ConnectorMark['lineStyle']
  paint: MarkPaint
  startMarker?: MarkerRef
  endMarker?: MarkerRef
  channels?: SemanticChannels
}, crisp: string): ConnectorMark {
  return { kind: 'connector', crisp, ...fields }
}

export function text(fields: {
  id: string
  role: SceneRole
  text: string
  x: number
  y: number
  fontSize: number
  anchor: TextMark['anchor']
  paint: MarkPaint
  channels?: SemanticChannels
}, crisp: string): TextMark {
  return { kind: 'text', crisp, ...fields }
}

export function raw(fields: {
  id: string
  role: SceneRole
  channels?: SemanticChannels
}, crisp: string): RawMark {
  return { kind: 'raw', crisp, ...fields }
}

/** Indent every line of a serialized chunk by `n` spaces — the same transform
 *  the string renderers applied via `'  ' + s.replace(/\n/g, '\n  ')`. */
export function indentLines(s: string, n: number): string {
  if (n <= 0 || s === '') return s
  const pad = ' '.repeat(n)
  return pad + s.replace(/\n/g, `\n${pad}`)
}

export function group(fields: {
  id: string
  role: SceneRole
  open: string
  close: string
  children: Array<{ node: SceneNode; indent: number }>
  join?: string
  channels?: SemanticChannels
}, opts: { skipEmptyChildren?: boolean } = {}): GroupMark {
  const join = fields.join ?? '\n'
  const segments: string[] = [fields.open]
  for (const child of fields.children) {
    if (opts.skipEmptyChildren && child.node.crisp === '') continue
    segments.push(indentLines(child.node.crisp, child.indent))
  }
  segments.push(fields.close)
  return {
    kind: 'group',
    crisp: segments.join(join),
    id: fields.id,
    role: fields.role,
    open: fields.open,
    close: fields.close,
    children: fields.children,
    join,
    channels: fields.channels,
  }
}

export function prelude(fields: {
  id: string
  width: number
  height: number
  colors: DiagramColors
  transparent: boolean
  font: string
  hasMonoFont: boolean
  extraCss?: string
}, crisp: string): PreludeMark {
  return {
    kind: 'prelude',
    crisp,
    id: fields.id,
    role: 'prelude',
    prelude: {
      width: fields.width,
      height: fields.height,
      colors: fields.colors,
      transparent: fields.transparent,
      font: fields.font,
      hasMonoFont: fields.hasMonoFont,
      extraCss: fields.extraCss ?? '',
    },
  }
}
