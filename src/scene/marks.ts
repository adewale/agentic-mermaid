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
import { ensureSvgIdentity, semanticIdentityForSvg } from './identity.ts'
import { ensureSvgAccessibility, relationAccessibilityForSvg } from './accessibility.ts'

export function shape(fields: {
  id: string
  role: SceneRole
  geometry: Geometry
  paint: MarkPaint
  channels?: SemanticChannels
}, crisp: string): ShapeMark {
  const identity = semanticIdentityForSvg(crisp, fields)
  const accessibility = relationAccessibilityForSvg(crisp, identity)
  const decorated = ensureSvgAccessibility(ensureSvgIdentity(crisp, identity), accessibility)
  return { kind: 'shape', crisp: decorated, identity, accessibility, ...fields }
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
  const identity = semanticIdentityForSvg(crisp, fields)
  const accessibility = relationAccessibilityForSvg(crisp, identity)
  const decorated = ensureSvgAccessibility(ensureSvgIdentity(crisp, identity), accessibility)
  return { kind: 'connector', crisp: decorated, identity, accessibility, ...fields }
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
  const identity = semanticIdentityForSvg(crisp, fields)
  const accessibility = relationAccessibilityForSvg(crisp, identity)
  const decorated = ensureSvgAccessibility(ensureSvgIdentity(crisp, identity), accessibility)
  return { kind: 'text', crisp: decorated, identity, accessibility, ...fields }
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
}): GroupMark {
  const join = fields.join ?? '\n'
  const identity = semanticIdentityForSvg(fields.open, fields)
  const accessibility = relationAccessibilityForSvg(fields.open, identity)
  const open = ensureSvgAccessibility(ensureSvgIdentity(fields.open, identity), accessibility)
  const segments: string[] = [open]
  for (const child of fields.children) {
    segments.push(indentLines(child.node.crisp, child.indent))
  }
  segments.push(fields.close)
  return {
    kind: 'group',
    crisp: segments.join(join),
    id: fields.id,
    role: fields.role,
    open,
    close: fields.close,
    children: fields.children,
    join,
    channels: fields.channels,
    identity,
    accessibility,
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
