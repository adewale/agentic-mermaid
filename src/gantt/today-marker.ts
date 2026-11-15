// ============================================================================
// todayMarker style sanitization (family-elevation-plan §Gantt item 3).
//
// Mermaid's `todayMarker <css-ish payload>` directive carries comma-separated
// `prop:value` declarations (e.g. `stroke-width:5px,stroke:#0f0,opacity:0.5`)
// that upstream applies verbatim to the today line. Here the payload is
// parsed with the shared parseStyleProps the flowchart parser uses, then
// checked before it can land in the line's paint:
//
//   1. property whitelist — only line-paint properties are wired
//      (GANTT_TODAY_MARKER_STYLE_PROPS); anything else is REPORTED, not
//      silently dropped: verify names it via INEFFECTIVE_CONFIG
//      (`todayMarker.<prop>`).
//   2. color admission — the effective stroke must be a drawable authored
//      color, with the same named refusal as other source style directives.
//   3. value sanitation — non-color line properties retain their bounded
//      character policy; rejected values are reported like unwired ones.
// ============================================================================

import { checkedAuthoredStyle, parseStyleProps } from '../shared/style-props.ts'

/** Wired todayMarker payload properties (everything else lints). */
export const GANTT_TODAY_MARKER_STYLE_PROPS = ['stroke', 'stroke-width', 'opacity', 'stroke-dasharray'] as const

// Non-color line properties retain their existing character policy. Quotes,
// context terminators, and fetchable data references cannot reach attributes.
const SAFE_VALUE_RE = /^[#\w][\w#(),.%\s/-]*$/

export interface GanttTodayMarkerStyle {
  /** Whitelisted, sanitized declarations in payload order. */
  applied: Array<[prop: string, value: string]>
  /** Properties present in the payload but not wired (or value-rejected) —
   *  surfaced by verify as INEFFECTIVE_CONFIG `todayMarker.<prop>`. */
  ignored: string[]
}

export function parseTodayMarkerStyle(payload: string): GanttTodayMarkerStyle {
  const applied: Array<[string, string]> = []
  const ignored: string[] = []
  // SVG and terminal projection both select the last case-insensitive
  // property. Validate that effective paint, not a shadowed declaration.
  const props = parseStyleProps(payload, { caseInsensitive: true })
  checkedAuthoredStyle(props.stroke === undefined ? {} : { stroke: props.stroke }, 'todayMarker')
  for (const [prop, value] of Object.entries(props)) {
    if (!(GANTT_TODAY_MARKER_STYLE_PROPS as readonly string[]).includes(prop) || (prop !== 'stroke' && !SAFE_VALUE_RE.test(value))) {
      ignored.push(prop)
      continue
    }
    applied.push([prop, value])
  }
  return { applied, ignored }
}
