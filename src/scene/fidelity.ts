import { decodeXML } from 'entities'
// ============================================================================
// Scene fidelity checker — asserts a mark's semantic fields agree with its
// written serialization, so styled backends can trust the geometry they redraw.
//
// The writer (svg-writer.ts) draws every shape, text and connector from its
// fields, so no render path runs this check. It is the tests' independent
// oracle for the writer over the cross-family corpus: it parses the SVG we
// ourselves emit — a stable, owned format — and returns human-readable problems
// instead of throwing, so one run reports every divergence in a lowering.
// ============================================================================

import type { Geometry, SceneDoc, SceneNode, SceneOwner, TextMark } from './ir.ts'
import { hasDomSvgIdentityRole } from './identity.ts'
import { sceneNodeSerialization } from './serialization.ts'
import { breakLineTags, displayText } from '../multiline-utils.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'
import { hasMarkerCss } from '../output-security.ts'
import { parseSvgTransform, transformMatrix } from './transforms.ts'

/** Parse the top-level SVG elements out of a crisp chunk (self-closed or
 *  paired), ignoring nested content. Good enough for our own emitters. */
export function topLevelElements(crisp: string): Array<{ tag: string; attrs: Map<string, string> }> {
  const out: Array<{ tag: string; attrs: Map<string, string> }> = []
  let depth = 0
  let m: RegExpExecArray | null
  const closeRe = /<\/([a-zA-Z][a-zA-Z0-9-]*)>/g
  // Walk open/self-close/close tags in order, tracking depth.
  const tokens: Array<{ index: number; kind: 'open' | 'self' | 'close'; tag: string; attrs?: Map<string, string> }> = []
  for (const tag of scanSvgStartTags(crisp)) {
    const attrs = new Map(tag.attributes.map(attribute => [attribute.name, attribute.value]))
    tokens.push({ index: tag.start, kind: tag.selfClosing ? 'self' : 'open', tag: tag.name, attrs })
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

// The SVG writer retains twelve significant digits. Compare geometry values
// independently of their spelling, keeping command order and token counts.
function near(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b)
    && Math.abs(a - b) <= 5e-12 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE)
}

function sameNumericPayload(a: string, b: string): boolean {
  const number = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g
  const left = a.match(number) ?? [], right = b.match(number) ?? []
  return a.replace(number, '#').replace(/[\s,]/g, '') === b.replace(number, '#').replace(/[\s,]/g, '')
    && left.length === right.length && left.every((value, index) => near(Number(value), Number(right[index])))
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
      && near(parsed, semantic)
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
      if (!sameNumericPayload(expected, e.attrs.get('points') ?? '')) {
        problems.push(`${path}.points: semantic "${expected.slice(0, 60)}" != crisp "${(e.attrs.get('points') ?? '').slice(0, 60)}"`)
      }
      return 1
    }
    case 'path': {
      const e = want('path'); if (!e) return 1
      if (!sameNumericPayload(geom.d, e.attrs.get('d') ?? '')) {
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
  return decodeXML(s)
}

/** Parse only the wrappers emitted by Timeline's literal-text renderer. This
 * keeps extra elements and attributes from being hidden by text comparison. */
function timelineLiteralText(serialized: string): string | undefined {
  const outer = /^<text\b([^<>]*)>([\s\S]*)<\/text>$/.exec(serialized)
  if (!outer) return undefined
  const attributes = /^(?:\s+(?:x|y|class|text-anchor|dominant-baseline|font-size|font-weight|font-style|text-decoration|font-family|letter-spacing|dy|fill|fill-opacity|stroke|stroke-opacity|stroke-width|stroke-linejoin|paint-order|opacity|data-[a-z-]+|aria-label|aria-hidden|role|textLength|lengthAdjust|xml:space)="[^"<>]*")*\s*$/
  if (!attributes.test(outer[1]!)) return undefined
  let result = ''
  let cursor = 0
  let depth = 0
  let line = 0
  const inner = outer[2]!
  for (const tag of inner.matchAll(/<[^>]*>/g)) {
    result += unescapeXml(inner.slice(cursor, tag.index))
    if (tag[0] === '</tspan>') {
      if (--depth < 0) return undefined
    } else {
      const span = /^<tspan\b([^<>]*)>$/.exec(tag[0])
      if (!span || !attributes.test(span[1]!)) return undefined
      if (/\b(?:font-weight|font-style|font-size|font-family|text-decoration)=/.test(span[1]!)) return undefined
      if (/\bdy=/.test(span[1]!) && !/data-text-fragment=/.test(span[1]!)) {
        if (line++ > 0) result += '\n'
      }
      depth++
    }
    cursor = tag.index! + tag[0].length
  }
  result += unescapeXml(inner.slice(cursor))
  return depth === 0 ? result : undefined
}

function transformProblems(node: SceneNode, attrs: Map<string, string> | undefined, path: string, problems: string[]): void {
  const raw = attrs?.get('transform')
  const crisp = raw ? parseSvgTransform(raw) : undefined
  if (raw && !crisp) {
    problems.push(`${path}(${node.kind}:${node.id}).transform: unsupported crisp transform ${raw}`)
    return
  }
  if (!!node.transform !== !!crisp) {
    problems.push(`${path}(${node.kind}:${node.id}).transform: typed transform and SVG transform disagree`)
    return
  }
  if (node.transform && crisp) {
    const semantic = transformMatrix(node.transform)
    if (semantic.some((value, index) => Math.abs(value - crisp[index]!) > 1e-9 * Math.max(1, Math.abs(value), Math.abs(crisp[index]!)))) {
      problems.push(`${path}(${node.kind}:${node.id}).transform: semantic ${JSON.stringify(node.transform)} != crisp ${raw}`)
    }
  }
}

/** The owned text format has line wrappers, positioned shaping fragments and
 * style-only descendants. Bind each to the retained lines, without measuring
 * again or interpreting the authored display source a second time. */
function preparedTextPlacementProblems(node: TextMark, serialized: string, path: string, problems: string[]): void {
  const block = node.block
  if (!block || node.measurement !== 'prepared') return
  const fail = (message: string) => problems.push(`${path}(text:${node.id}).placement: ${message}`)
  const textTags = scanSvgStartTags(serialized).filter(tag => tag.name === 'text')
  const textEnd = textTags[0] && serialized.indexOf('</text>', textTags[0].end)
  if (textTags.length !== 1 || textEnd === undefined || textEnd < 0) { fail('prepared text must have one complete text wrapper'); return }
  // Some legacy label chunks retain their pill background beside the text.
  serialized = serialized.slice(textTags[0]!.start, textEnd + '</text>'.length)
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.5
  const length = (value: string | undefined, fallback = 0): number => {
    if (value === undefined) return fallback
    const match = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(px|em)?$/.exec(value)
    return match ? Number(match[1]) * (match[2] === 'em' ? block.fontSize : 1) : Number.NaN
  }
  const expected = block.lineBlocks.map(line => line.runs.map(run => run.text).join(''))
  // textLayout.offsetY places the first line's centre; the written position is
  // its alphabetic baseline, or its centre or top under a middle, central or
  // hanging dominant baseline.
  const firstLineCentre = node.dominantBaseline === 'hanging' ? block.lineHeight / 2
    : node.dominantBaseline === 'middle' || node.dominantBaseline === 'central' ? 0
      : -block.fontSize * 0.35
  const firstBaseline = node.y + (node.textLayout?.offsetY ?? 0) - (expected.length - 1) * block.lineHeight / 2 - firstLineCentre
  const baseline = (line: number) => firstBaseline + line * block.lineHeight
  type Frame = { tag: string; line: number; fragment: boolean; text: string; x?: number; width?: number; anchor?: string; weight: number; italic: boolean }
  const stack: Frame[] = []
  const spanAttributes = new Set(['x', 'y', 'dx', 'dy', 'text-anchor', 'textLength', 'lengthAdjust', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-decoration', 'letter-spacing', 'fill', 'data-text-fragment', 'data-font-metrics', 'xml:space'])
  const lines = expected.map(() => '')
  const fragments = expected.map(() => 0)
  const runs = expected.map(() => ({ index: 0, offset: 0 }))
  let wrappers = 0, directText = false, y = node.y, cursor = 0
  const starts = scanSvgStartTags(serialized)
  const tokens = [
    ...starts.map(tag => ({ start: tag.start, end: tag.end, tag })),
    ...[...serialized.matchAll(/<\/(text|tspan)\s*>/g)].map(match => ({ start: match.index!, end: match.index! + match[0].length, tag: undefined })),
  ].sort((a, b) => a.start - b.start)
  const append = (end: number) => {
    const text = unescapeXml(serialized.slice(cursor, end))
    const frame = stack.at(-1)
    if (!frame) { if (text.trim()) fail('text occurs outside its owned wrapper'); return }
    if (frame.line >= lines.length) return
    if (text.length && !close(y, baseline(frame.line))) fail(`line ${frame.line} has a different baseline from its retained block`)
    const position = runs[frame.line]!
    let remaining = text.length
    while (remaining > 0) {
      const run = block.lineBlocks[frame.line]!.runs[position.index]
      if (!run) break
      if (frame.weight !== (run.bold ? 700 : block.fontWeight) && frame.weight !== (run.bold ? Math.max(700, block.fontWeight) : block.fontWeight)) fail('a descendant changes the retained run weight')
      if (frame.italic !== run.italic) fail('a descendant changes the retained run font style')
      const take = Math.min(remaining, run.text.length - position.offset)
      position.offset += take; remaining -= take
      if (position.offset === run.text.length) { position.index++; position.offset = 0 }
    }
    lines[frame.line] += text
    for (const ancestor of stack) if (ancestor.fragment) ancestor.text += text
    if (stack.length === 1 && text.length) directText = true
  }
  for (const token of tokens) {
    append(token.start)
    cursor = token.end
    if (!token.tag) {
      const frame = stack.pop()
      if (frame?.fragment && frame.line < expected.length) {
        const line = block.lineBlocks[frame.line]!
        const width = frame.width ?? (frame.text === expected[frame.line] ? line.width : Number.NaN)
        const x = frame.x! - (frame.anchor === 'middle' ? width / 2 : frame.anchor === 'end' ? width : 0)
        const start = node.x - (node.anchor === 'middle' ? line.width / 2 : node.anchor === 'end' ? line.width : 0)
        if (!Number.isFinite(x) || !Number.isFinite(width) || width < 0 || frame.text.trim() && width <= Number.EPSILON * Math.max(1, line.width) || x < start - 0.5 || x + width > start + line.width + 0.5) fail('a positioned fragment escapes its retained line band')
        if (line.fragments) {
          const retained = line.fragments[fragments[frame.line]!]
          if (!retained || frame.text !== retained.text || frame.anchor !== 'start' ||
            Math.abs(frame.x! - (start + line.originX + retained.x)) > 1e-6 ||
            frame.width === undefined || Math.abs(frame.width - Math.max(0, retained.width)) > 1e-6) fail('a positioned fragment differs from its retained ordered allocation')
          fragments[frame.line] = fragments[frame.line]! + 1
        }
      }
      continue
    }
    const tag = token.tag
    if (tag.name !== 'text' && tag.name !== 'tspan') { fail(`unsupported <${tag.name}> inside prepared text`); continue }
    const attrs = new Map(tag.attributes.map(attribute => [attribute.name, unescapeXml(attribute.value)]))
    if (['writing-mode', 'word-spacing', 'text-orientation', 'baseline-shift', 'rotate'].some(name => attrs.has(name))) fail('unsupported text placement override')
    const parent = stack.at(-1)
    const fragment = attrs.has('data-text-fragment')
    const positioned = ['x', 'y', 'dx', 'dy'].some(name => attrs.has(name))
    const wrapper = tag.name === 'tspan' && !fragment && stack.length === 1 && attrs.has('x') && (attrs.has('y') || attrs.has('dy'))
    const line = wrapper ? wrappers++ : parent?.line ?? 0
    const lineBlock = block.lineBlocks[line]
    if (attrs.has('y')) y = length(attrs.get('y'))
    y += length(attrs.get('dy'))
    const anchor = attrs.get('text-anchor') ?? (fragment ? parent?.anchor : undefined) ?? node.anchor
    const x = length(attrs.get('x'), node.x) + length(attrs.get('dx'))
    if (tag.name === 'text') {
      if (stack.length || !close(x, node.x) || !close(length(attrs.get('y'), node.y), node.y) || length(attrs.get('dx')) !== 0) fail('outer coordinates differ from the retained text anchor')
    } else {
      if ([...attrs.keys()].some(name => !spanAttributes.has(name))) fail('a descendant introduces unsupported text placement')
      if (attrs.has('font-size') && length(attrs.get('font-size')) !== block.fontSize) fail('a descendant changes the retained font size')
      if (attrs.has('font-family') && attrs.get('font-family') !== block.fontFamily) fail('a descendant changes the retained font family')
      if (fragment) {
        if (attrs.get('data-text-fragment') !== 'true' || !attrs.has('x') || !['start', 'middle', 'end'].includes(anchor)) fail('a shaping fragment has unsupported positioning')
        if (length(attrs.get('dy')) !== 0 || parent?.fragment) fail('a shaping fragment introduces an unsupported baseline advance')
        if (attrs.has('letter-spacing') && length(attrs.get('letter-spacing')) !== (attrs.has('textLength') ? 0 : block.letterSpacing)) fail('a shaping fragment changes its retained tracking')
      } else if (parent?.fragment && parent.width !== undefined) fail('a fitted fragment contains a descendant that bypasses its retained fitting')
      else if (wrapper) {
        if (!close(x, node.x) || anchor !== node.anchor || attrs.has('dx')) fail('a line wrapper changes its retained x or anchor')
      } else if (positioned || attrs.has('text-anchor') || attrs.has('textLength') || attrs.has('lengthAdjust')) fail('a style span introduces unchecked placement')
    }
    if ((wrapper || fragment) && lineBlock && !close(y, baseline(line))) fail(`line ${line} has a different baseline from its retained block`)
    if (attrs.has('textLength')) {
      const width = length(attrs.get('textLength'))
      if (!Number.isFinite(width) || width < 0 || !lineBlock || width > lineBlock.width + 0.5 || (tag.name === 'text' && expected.length !== 1)) fail('textLength exceeds its retained line')
      if (attrs.get('lengthAdjust') !== 'spacingAndGlyphs') fail('textLength has no bounded glyph fitting policy')
      if (!fragment && lineBlock && Math.abs(width - lineBlock.width) > 1e-6 * Math.max(1, lineBlock.width)) fail('textLength differs from its retained line width')
      const allocation = lineBlock?.fragments?.[fragments[line] ?? 0]
      if (fragment && (!allocation || allocation.text.trim() && width <= Number.EPSILON * Math.max(1, lineBlock?.width ?? 1))) fail('a fitted fragment has no retained allocation')
    }
    if (attrs.has('lengthAdjust') && !attrs.has('textLength')) fail('lengthAdjust has no retained fitted width')
    if (!fragment && attrs.has('letter-spacing') && length(attrs.get('letter-spacing')) !== block.letterSpacing) fail('a descendant changes retained tracking')
    const rawWeight = attrs.get('font-weight')
    const weight = rawWeight === undefined ? parent?.weight ?? block.fontWeight : rawWeight === 'bold' ? 700 : rawWeight === 'normal' ? 400 : length(rawWeight)
    const fontStyle = attrs.get('font-style')
    if (fontStyle !== undefined && fontStyle !== 'normal' && fontStyle !== 'italic') fail('unsupported retained font style')
    const italic = fontStyle === undefined ? parent?.italic ?? false : fontStyle === 'italic'
    const frame: Frame = { tag: tag.name, line, fragment, text: '', x, anchor, weight, italic, ...(attrs.has('textLength') ? { width: length(attrs.get('textLength')) } : {}) }
    if (!tag.selfClosing) stack.push(frame)
  }
  append(serialized.length)
  if (stack.length) fail('prepared text wrappers are incomplete')
  if ((wrappers || 1) !== expected.length || wrappers && directText) fail('emitted line wrappers differ from the retained line count')
  for (let line = 0; line < expected.length; line++) if (lines[line] !== expected[line]) fail(`line ${line} differs from its retained displayed text`)
  block.lineBlocks.forEach((line, index) => {
    if (line.fragments && fragments[index] !== line.fragments.length) fail(`line ${index} differs from its retained fragment count`)
  })
}

export function nodeProblems(node: SceneNode, path: string, problems: string[], enclosing?: SceneOwner): void {
  const serialized = sceneNodeSerialization(node)
  if (node.kind !== 'document') {
    const first = topLevelElements(node.kind === 'group' ? node.open : serialized)[0]
    transformProblems(node, first?.attrs, path, problems)
    if (serialized !== '' && hasDomSvgIdentityRole(node.role)) {
      const ownedSurface = node.kind === 'shape' && node.owner !== undefined && enclosing !== undefined && node.role === enclosing.role && node.owner.id === enclosing.id && node.owner.role === enclosing.role
      if (!node.identity && !ownedSurface) problems.push(`${path}(${node.kind}:${node.id}): missing typed identity`)
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
      if (node.lineStyle === 'invisible' && serialized === '') return
      const carriers = topLevelElements(serialized).filter(element => ['line', 'polyline', 'path'].includes(element.tag))
      if (carriers.length !== 1) {
        problems.push(`${path}(connector:${node.id}): expected one SVG marker carrier`)
        return
      }
      const attrs = carriers[0]!.attrs
      geometryProblems(node.route.geometry, carriers, `${path}(connector:${node.id})`, problems)
      const tags = scanSvgStartTags(serialized)
      for (const position of ['start', 'mid', 'end'] as const) {
        const marker = position === 'mid' ? node.markers.mid[0] : node.markers[position]
        const expected = marker ? `url(#${marker.id})` : undefined
        const raw = attrs.get(`marker-${position}`)
        const actual = raw === undefined ? undefined : unescapeXml(raw)
        const references = tags.flatMap(tag => tag.attributes.filter(attribute => attribute.name === `marker-${position}`))
        if (actual !== expected || references.length !== (marker ? 1 : 0)) {
          problems.push(`${path}(connector:${node.id}).marker-${position}: typed ${expected} != SVG ${actual} (${references.length} references)`)
        }
      }
      for (const tag of tags) {
        for (const attribute of tag.attributes) {
          if (attribute.name === 'marker' || (attribute.name === 'style' && hasMarkerCss(decodedSvgAttributeValue(tag, 'style') ?? ''))) {
            problems.push(`${path}(connector:${node.id}): SVG shorthand/CSS bypasses typed markers`)
          }
        }
      }
      return
    }
    case 'text': {
      if (serialized === '') { problems.push(`${path}(text:${node.id}): empty crisp`); return }
      const els = topLevelElements(serialized)
      const el = els.find(e => e.tag === 'text')
      if (!el) { problems.push(`${path}(text:${node.id}): crisp has no <text>`); return }
      const fs = el.attrs.get('font-size')
      if (fs !== undefined && !near(num(fs) ?? Number.NaN, node.fontSize)) {
        problems.push(`${path}(text:${node.id}).fontSize: semantic ${node.fontSize} != crisp ${fs}`)
      }
      for (const [attribute, field] of [['font-weight', 'fontWeight'], ['letter-spacing', 'letterSpacing']] as const) {
        const actual = el.attrs.get(attribute)
        const expected = node.block?.[field] ?? node[field]
        if (actual !== undefined && expected !== undefined) {
          const numeric = attribute === 'font-weight'
            ? actual === 'normal' ? 400 : actual === 'bold' ? 700 : num(actual)
            : actual === 'normal' ? 0 : num(actual.replace(/px$/, ''))
          if (!near(numeric ?? Number.NaN, expected)) problems.push(`${path}(text:${node.id}).${field}: retained ${expected} != crisp ${actual}`)
        }
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
      // compared as the characters they show, read through the one display
      // interpretation (displayText): an emitter draws the formatting tags
      // either as styled runs or, in literal contexts (Pie, Timeline, Gantt,
      // XYChart, GitGraph), as text, so both sides drop them; any other
      // tag-like text (`a<c>d`) is text on both sides. Line breaks, markdown
      // markers and whitespace runs compare as one space.
      const timelineTextMark = /class="timeline-(?:title|section-label|period-text|event-text)"/.test(serialized)
      const timelineText = timelineTextMark ? timelineLiteralText(serialized) : undefined
      if (timelineTextMark) {
        if (timelineText === undefined) {
          problems.push(`${path}(text:${node.id}): unexpected markup in Timeline crisp`)
          return
        }
      }
      const literalTimelineText = timelineTextMark
      const shown = (s: string) => displayText(breakLineTags(s))
        .replace(/[`*_]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      // Crisp markup is the emitter's own SVG elements; authored text in it is
      // entity-escaped, so dropping the elements leaves exactly the drawn text.
      const drawn = (svg: string) => shown(unescapeXml(svg.replace(/<[^>]+>/g, '')))
      preparedTextPlacementProblems(node, serialized, path, problems)
      if (node.block) {
        const actualBlockText = unescapeXml(serialized.replace(/<tspan\b(?![^>]*\bdata-text-fragment=)[^>]*\s(?:x|dy)="[^"]*"[^>]*>/g, '\n').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
        if (node.block.lineBlocks.map(line => line.runs.map(run => run.text).join('')).join(' ').replace(/\s+/g, ' ').trim() !== actualBlockText) problems.push(`${path}(text:${node.id}).block: retained prepared text differs from actual SVG`)
      }
      if (node.prepared) {
        const expected = (node.preparedLines ? node.preparedLines.map(line => line.map(run => run.text).join('')).join('\n') : displayText(node.text, node.display)).replace(/\s+/g, ' ').trim()
        const actual = unescapeXml(serialized
          .replace(/<tspan\b(?![^>]*\bdata-text-fragment=)[^>]*\s(?:x|dy)="[^"]*"[^>]*>/g, '\n')
          .replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
        if (actual !== expected) problems.push(`${path}(text:${node.id}): prepared text "${expected.slice(0, 40)}" differs from crisp "${actual.slice(0, 40)}"`)
      } else if (node.role === 'member') {
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
        const wantText = shown(node.text)
        if (wantText && !drawn(serialized).includes(wantText.split(' ')[0]!)) {
          problems.push(`${path}(text:${node.id}): text "${wantText.slice(0, 40)}" not found in crisp`)
        }
      }
      return
    }
    case 'group': {
      if (!serialized.startsWith(node.open)) problems.push(`${path}(group:${node.id}): crisp does not start with open tag`)
      if (!serialized.endsWith(node.close)) problems.push(`${path}(group:${node.id}): crisp does not end with close tag`)
      const subject = hasDomSvgIdentityRole(node.role) ? node.identity?.role === node.role ? { id: node.identity.id, role: node.role } : undefined : enclosing
      node.children.forEach((child, i) => nodeProblems(child.node, `${path}/${i}`, problems, subject))
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
