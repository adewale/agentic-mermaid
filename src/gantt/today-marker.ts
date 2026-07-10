// ============================================================================
// todayMarker style sanitization (family-elevation-plan §Gantt item 3).
//
// Mermaid's `todayMarker <css-ish payload>` directive carries comma-separated
// `prop:value` declarations (e.g. `stroke-width:5px,stroke:#0f0,opacity:0.5`)
// that upstream applies verbatim to the today line. Here the payload is
// parsed with the flowchart parser's own parseStyleProps (one style grammar,
// two consumers) and filtered twice before it can land in a style="" attr:
//
//   1. property whitelist — only line-paint properties are wired
//      (GANTT_TODAY_MARKER_STYLE_PROPS); anything else is REPORTED, not
//      silently dropped: verify names it via INEFFECTIVE_CONFIG
//      (`todayMarker.<prop>`).
//   2. value sanitation — the quadrant COLOR_RE approach: word chars, hex,
//      functional color forms; no quotes, semicolons, angle brackets, or
//      colons, so a payload can never escape the attribute or smuggle a
//      fetchable url()/data: reference. Rejected values drop the whole
//      declaration (and are reported like unwired ones).
// ============================================================================

import { parseStyleProps } from '../parser.ts'

/** Wired todayMarker payload properties (everything else lints). */
export const GANTT_TODAY_MARKER_STYLE_PROPS = ['stroke', 'stroke-width', 'opacity', 'stroke-dasharray'] as const

// Same character policy as quadrant point styles (src/quadrant/point-style.ts
// COLOR_RE): the value lands inside style="" — allow hex/named colors,
// numbers with units, rgb()/hsl() functional forms; forbid quotes, `;`,
// `<`, `>`, `:` (kills url(data:…) and attribute breakouts).
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
  const props = parseStyleProps(payload)
  for (const [rawKey, value] of Object.entries(props)) {
    const prop = rawKey.toLowerCase()
    if (!(GANTT_TODAY_MARKER_STYLE_PROPS as readonly string[]).includes(prop) || !SAFE_VALUE_RE.test(value)) {
      ignored.push(prop)
      continue
    }
    applied.push([prop, value])
  }
  return { applied, ignored }
}

/** The exact `style` attribute value for the today line ('' = no attribute). */
export function todayMarkerStyleAttr(style: GanttTodayMarkerStyle): string {
  return style.applied.map(([prop, value]) => `${prop}:${value}`).join(';')
}
