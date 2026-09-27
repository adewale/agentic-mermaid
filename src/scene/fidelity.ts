// ============================================================================
// Scene fidelity checker — asserts a mark's semantic fields agree with its
// crisp serialization, so styled backends can trust the geometry they redraw.
//
// Test-only oracle (driven by scene-fidelity.test.ts across the corpus): it
// parses the crisp strings we ourselves emit — a stable, owned format — and
// returns human-readable problems instead of throwing, so one run reports
// every divergence in a lowering.
// ============================================================================

import type { Geometry, SceneDoc, SceneNode, SceneTransform } from './ir.ts'
import { hasDomSvgIdentityRole } from './identity.ts'
import { sceneNodeSerialization } from './serialization.ts'

/** Parse the top-level SVG elements out of a crisp chunk (self-closed or
 *  paired), ignoring nested content. Good enough for our own emitters. */
export function topLevelElements(crisp: string): Array<{ tag: string; attrs: Map<string, string> }> {
  const out: Array<{ tag: string; attrs: Map<string, string> }> = []
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][\w:.-]*="[^"]*")*)\s*\/?>/g
  let depth = 0
  let m: RegExpExecArray | null
  const closeRe = /<\/([a-zA-Z][a-zA-Z0-9-]*)>/g
  // Walk open/self-close/close tags in order, tracking depth.
  const tokens: Array<{ index: number; kind: 'open' | 'self' | 'close'; tag: string; attrs?: Map<string, string> }> = []
  while ((m = re.exec(crisp)) !== null) {
    const attrs = new Map<string, string>()
    for (const am of m[2]!.matchAll(/([a-zA-Z_:][\w:.-]*)="([^"]*)"/g)) attrs.set(am[1]!, am[2]!)
    tokens.push({ index: m.index, kind: m[0]!.endsWith('/>') ? 'self' : 'open', tag: m[1]!, attrs })
  }
  while ((m = closeRe.exec(crisp)) !== null) tokens.push({ index: m.index, kind: 'close', tag: m[1]! })
  tokens.sort((a, b) => a.index - b.index)
  for (const t of tokens) {
    if (t.kind === 'self') {
      if (depth === 0) out.push({ tag: t.tag, attrs: t.attrs! })
    } else if (t.kind === 'open') {
      if (depth === 0) out.push({ tag: t.tag, attrs: t.attrs! })
      depth++
    } else {
      depth--
    }
  }
  return out
}

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function geometryProblems(geom: Geometry, els: Array<{ tag: string; attrs: Map<string, string> }>, path: string, problems: string[]): number {
  // Returns how many elements this geometry consumed.
  const el = els[0]
  const want = (tag: string) => {
    if (!el) { problems.push(`${path}: expected <${tag}>, crisp has no element`); return undefined }
    if (el.tag !== tag) { problems.push(`${path}: expected <${tag}>, crisp has <${el.tag}>`); return undefined }
    return el
  }
  const eq = (field: string, semantic: number | string | undefined, attr: string | undefined) => {
    if (semantic === undefined) return
    const parsed = num(attr)
    const numericallyEquivalent = typeof semantic === 'number'
      && parsed !== undefined
      && Math.abs(parsed - semantic) <= Number.EPSILON * 8 * Math.max(1, Math.abs(parsed), Math.abs(semantic))
    if (String(semantic) !== attr && !numericallyEquivalent) {
      problems.push(`${path}.${field}: semantic ${semantic} != crisp ${attr}`)
    }
  }
  switch (geom.kind) {
    case 'rect': {
      const e = want('rect'); if (!e) return 1
      eq('x', geom.x, e.attrs.get('x')); eq('y', geom.y, e.attrs.get('y'))
      eq('width', geom.width, e.attrs.get('width')); eq('height', geom.height, e.attrs.get('height'))
      if (geom.rx !== undefined) eq('rx', geom.rx, e.attrs.get('rx'))
      return 1
    }
    case 'circle': {
      const e = want('circle'); if (!e) return 1
      eq('cx', geom.cx, e.attrs.get('cx')); eq('cy', geom.cy, e.attrs.get('cy')); eq('r', geom.r, e.attrs.get('r'))
      return 1
    }
    case 'ellipse': {
      const e = want('ellipse'); if (!e) return 1
      eq('cx', geom.cx, e.attrs.get('cx')); eq('cy', geom.cy, e.attrs.get('cy'))
      eq('rx', geom.rx, e.attrs.get('rx')); eq('ry', geom.ry, e.attrs.get('ry'))
      return 1
    }
    case 'line': {
      const e = want('line'); if (!e) return 1
      eq('x1', geom.x1, e.attrs.get('x1')); eq('y1', geom.y1, e.attrs.get('y1'))
      eq('x2', geom.x2, e.attrs.get('x2')); eq('y2', geom.y2, e.attrs.get('y2'))
      return 1
    }
    case 'polygon':
    case 'polyline': {
      const e = want(geom.kind); if (!e) return 1
      const expected = geom.points.map(p => `${p.x},${p.y}`).join(' ')
      if (e.attrs.get('points') !== expected) {
        problems.push(`${path}.points: semantic "${expected.slice(0, 60)}" != crisp "${(e.attrs.get('points') ?? '').slice(0, 60)}"`)
      }
      return 1
    }
    case 'path': {
      const e = want('path'); if (!e) return 1
      if (e.attrs.get('d') !== geom.d) {
        problems.push(`${path}.d: semantic "${geom.d.slice(0, 60)}" != crisp "${(e.attrs.get('d') ?? '').slice(0, 60)}"`)
      }
      return 1
    }
    case 'compound': {
      let consumed = 0
      for (let i = 0; i < geom.children.length; i++) {
        consumed += geometryProblems(geom.children[i]!, els.slice(consumed), `${path}.children[${i}]`, problems)
      }
      return consumed
    }
  }
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

/** Parse only the wrappers emitted by Timeline's literal-text renderer. This
 * keeps extra elements and attributes from being hidden by text comparison. */
function timelineLiteralText(serialized: string): string | undefined {
  const outer = /^<text\b([^<>]*)>([\s\S]*)<\/text>$/.exec(serialized)
  if (!outer) return undefined
  if (!/^(?:\s+(?:x|y|class|text-anchor|font-size|font-weight|data-literal-text|font-family|letter-spacing|dy|data-id|data-role|aria-label|role)="[^"<>]*")+$/.test(outer[1]!)) return undefined
  const inner = outer[2]!
  if (!inner.includes('<')) return inner.includes('>') ? undefined : unescapeXml(inner)
  const spans = /<tspan x="([^"]+)" dy="([^"]+)">([^<>]*)<\/tspan>/g
  const lines: string[] = []
  let cursor = 0
  for (const match of inner.matchAll(spans)) {
    if (match.index !== cursor || !Number.isFinite(Number(match[1])) || !Number.isFinite(Number(match[2]))) return undefined
    lines.push(unescapeXml(match[3]!))
    cursor += match[0].length
  }
  return cursor === inner.length && lines.length > 0 ? lines.join('\n') : undefined
}

function parsedTransform(value: string | undefined): SceneTransform | undefined {
  if (!value) return undefined
  const match = /^rotate\(\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*\)$/.exec(value)
  if (!match) return undefined
  const [angle, cx, cy] = match.slice(1).map(Number)
  if (![angle, cx, cy].every(Number.isFinite)) return undefined
  return { kind: 'rotate', angle: angle!, cx: cx!, cy: cy! }
}

function transformProblems(node: SceneNode, attrs: Map<string, string> | undefined, path: string, problems: string[]): void {
  const raw = attrs?.get('transform')
  const crisp = parsedTransform(raw)
  if (raw && !crisp) {
    problems.push(`${path}(${node.kind}:${node.id}).transform: unsupported crisp transform ${raw}`)
    return
  }
  if (!node.transform && crisp) {
    problems.push(`${path}(${node.kind}:${node.id}).transform: crisp rotation is missing from semantic fields`)
    return
  }
  if (node.transform && !crisp) {
    problems.push(`${path}(${node.kind}:${node.id}).transform: semantic rotation is missing from crisp SVG`)
    return
  }
  if (node.transform && crisp && (node.transform.kind !== crisp.kind || node.transform.angle !== crisp.angle || node.transform.cx !== crisp.cx || node.transform.cy !== crisp.cy)) {
    problems.push(`${path}(${node.kind}:${node.id}).transform: semantic ${JSON.stringify(node.transform)} != crisp ${JSON.stringify(crisp)}`)
  }
}

export function nodeProblems(node: SceneNode, path: string, problems: string[]): void {
  const serialized = sceneNodeSerialization(node)
  if (node.kind !== 'document') {
    const first = topLevelElements(node.kind === 'group' ? node.open : serialized)[0]
    transformProblems(node, first?.attrs, path, problems)
    if (serialized !== '' && hasDomSvgIdentityRole(node.role)) {
      if (!node.identity) problems.push(`${path}(${node.kind}:${node.id}): missing typed identity`)
      if (!first) problems.push(`${path}(${node.kind}:${node.id}): no SVG element for identity`)
      if (first && node.identity) {
        const domId = first.attrs.get('data-id') === undefined ? undefined : unescapeXml(first.attrs.get('data-id')!)
        const domRole = first.attrs.get('data-role')
        if (domId !== node.identity.id) problems.push(`${path}(${node.kind}:${node.id}): data-id ${domId} != typed ${node.identity.id}`)
        if (domRole !== node.identity.role) problems.push(`${path}(${node.kind}:${node.id}): data-role ${domRole} != typed ${node.identity.role}`)
      }
    }
    if (first && node.accessibility) {
      const aria = unescapeXml(first.attrs.get('aria-label') ?? '')
      if (aria !== node.accessibility.label) problems.push(`${path}(${node.kind}:${node.id}): aria-label ${aria} != typed ${node.accessibility.label}`)
      if (first.attrs.get('role') !== node.accessibility.role) problems.push(`${path}(${node.kind}:${node.id}): ARIA role drift`)
    }
  }
  switch (node.kind) {
    case 'shape': {
      const els = topLevelElements(serialized)
      geometryProblems(node.geometry, els, `${path}(shape:${node.id})`, problems)
      return
    }
    case 'connector': {
      return
    }
    case 'text': {
      if (serialized === '') { problems.push(`${path}(text:${node.id}): empty crisp`); return }
      const els = topLevelElements(serialized)
      const el = els.find(e => e.tag === 'text')
      if (!el) { problems.push(`${path}(text:${node.id}): crisp has no <text>`); return }
      const fs = el.attrs.get('font-size')
      if (fs !== undefined && num(fs) !== node.fontSize) {
        problems.push(`${path}(text:${node.id}).fontSize: semantic ${node.fontSize} != crisp ${fs}`)
      }
      // Text geometry: semantic x/y/anchor must match the drawn attributes.
      // Every emitter anchors <text> at the semantic point and applies
      // baseline shifts via dy/tspans, so x/y compare exactly (0.5px rounding
      // slack); a missing text-anchor attribute means SVG's default 'start'.
      // This closes the drift class where a lowering claimed one label
      // position while the crisp drew another (quadrant point labels, 2026-07).
      const anchor = el.attrs.get('text-anchor') ?? 'start'
      const wantAnchor = node.anchor ?? 'start'
      if (anchor !== wantAnchor) {
        problems.push(`${path}(text:${node.id}).anchor: semantic ${wantAnchor} != crisp ${anchor}`)
      }
      const tx = num(el.attrs.get('x'))
      if (tx !== undefined && Math.abs(tx - node.x) > 0.5) {
        problems.push(`${path}(text:${node.id}).x: semantic ${node.x} != crisp ${tx}`)
      }
      const ty = num(el.attrs.get('y'))
      if (ty !== undefined && Math.abs(ty - node.y) > 0.5) {
        problems.push(`${path}(text:${node.id}).y: semantic ${node.y} != crisp ${ty}`)
      }
      // The semantic text must appear in the crisp chunk. Both sides are
      // normalized the way the text emitter normalizes labels (markdown
      // backticks, <b>/<i>/<u>/<s> emphasis tags, whitespace), so formatted
      // labels don't false-positive.
      // Crisp contains owned SVG tags, while Pie and Timeline may contain
      // literal angle-bracket text that the emitter escapes as entities.
      // Preserve those owned literal projections; other families keep their
      // established formatting normalization and diagnostics.
      const hasStyledTspan = /<tspan\b[^>]*(?:font-weight="bold"|font-style="italic"|text-decoration=)/.test(serialized)
      const timelineTextMark = /class="timeline-(?:title|section-label|period-text|event-text)"/.test(serialized)
      const timelineText = timelineTextMark ? timelineLiteralText(serialized) : undefined
      if (timelineTextMark) {
        if (timelineText === undefined) {
          problems.push(`${path}(text:${node.id}): unexpected markup in Timeline crisp`)
          return
        }
      }
      const literalPieText = !hasStyledTspan && (
        (node.role === 'legend' && serialized.includes('class="pie-legend-text"'))
        || (node.role === 'title' && serialized.includes('class="pie-title"')
          && /&lt;|&gt;/.test(serialized))
      )
      const literalTimelineText = timelineTextMark
      const normalize = (s: string, fromSvg: boolean) => (fromSvg ? unescapeXml(s
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
      ) : literalPieText || literalTimelineText ? s : s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
        .replace(/[`*_]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (node.role === 'member') {
        // Class members are literal source text, not emphasis markup. Compare
        // their entire visible string so a lost type argument (including
        // <b>/<i>/<u>/<s>) cannot be hidden by the first-token check.
        const memberText = (s: string) => unescapeXml(s.replace(/<[^>]+>/g, ''))
          .replace(/\s+/g, ' ')
          .trim()
        const wantText = node.text.replace(/\s+/g, ' ').trim()
        if (memberText(serialized) !== wantText) {
          problems.push(`${path}(text:${node.id}): member text "${wantText.slice(0, 40)}" not found in crisp`)
        }
      } else if (literalTimelineText) {
        // This path is literal authored text, not HTML formatting. Only the
        // owned <text>/<tspan> wrappers may occur; compare the complete
        // decoded contents, including punctuation and semantic line breaks.
        if (timelineText !== node.text) {
          problems.push(`${path}(text:${node.id}): literal text "${node.text.slice(0, 40)}" not found in crisp`)
        }
      } else {
        const wantText = normalize(node.text, false)
        if (wantText && !normalize(serialized, true).includes(wantText.split(' ')[0]!)) {
          problems.push(`${path}(text:${node.id}): text "${wantText.slice(0, 40)}" not found in crisp`)
        }
      }
      return
    }
    case 'group': {
      if (!serialized.startsWith(node.open)) problems.push(`${path}(group:${node.id}): crisp does not start with open tag`)
      if (!serialized.endsWith(node.close)) problems.push(`${path}(group:${node.id}): crisp does not end with close tag`)
      node.children.forEach((child, i) => nodeProblems(child.node, `${path}/${i}`, problems))
      return
    }
    case 'document': {
      if (node.element === 'title' || node.element === 'description') {
        const tag = node.element === 'title' ? 'title' : 'desc'
        if (!serialized.startsWith(`<${tag}`) || !serialized.endsWith(`</${tag}>`)) problems.push(`${path}(doc-mark:${node.id}): malformed ${tag}`)
        if (node.text !== undefined && !unescapeXml(serialized).includes(node.text)) problems.push(`${path}(doc-mark:${node.id}): text drift`)
      }
      return
    }
  }
}

/** Validate a whole SceneDoc. Returns [] when every mark is faithful. */
export function sceneFidelityProblems(doc: SceneDoc): string[] {
  const problems: string[] = []
  doc.parts.forEach((part, i) => nodeProblems(part, `parts[${i}]`, problems))
  return problems
}
