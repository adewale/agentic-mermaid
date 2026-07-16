import { decodeXML } from 'entities'
import { graphemes } from './shared/graphemes.ts'
import { measureFormattedTextWidth, measureMonospaceTextWidth } from './text-metrics.ts'

function presentationAttribute(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]
}

function attribute(attrs: string, name: string): string | undefined {
  // Inline style has CSS precedence over a presentation attribute.
  const style = presentationAttribute(attrs, 'style')
  const styled = style?.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim()
  return styled ?? presentationAttribute(attrs, name)
}

function numericAttribute(attrs: string, name: string, fallback: number): number {
  const parsed = Number.parseFloat(attribute(attrs, name) ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Resolve the CSS font-weight spellings emitted by formatted tspans. */
function fontWeightAttribute(attrs: string, fallback: number): number {
  const value = attribute(attrs, 'font-weight')?.trim().toLowerCase()
  if (value === undefined) return fallback
  if (value === 'normal') return 400
  if (value === 'bold') return 700
  if (value === 'bolder') {
    if (fallback < 350) return 400
    if (fallback < 550) return 700
    return 900
  }
  if (value === 'lighter') {
    if (fallback < 550) return 100
    if (fallback < 750) return 400
    return 700
  }
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function hasMonoClass(attrs: string): boolean {
  return /\bclass\s*=\s*(["'])[^"']*\bmono\b/i.test(attrs)
    || /(?:^|[,\s])monospace(?:[,\s]|$)/i.test(attribute(attrs, 'font-family') ?? '')
}

interface InheritedTextMetrics {
  readonly size: number
  readonly weight: number
  readonly letterSpacing: number
  readonly mono: boolean
}

interface XmlTextNode {
  readonly kind: 'text-node'
  readonly raw: string
}

interface XmlElement {
  readonly kind: 'element'
  readonly name: string
  readonly attrs: string
  readonly openEnd: number
  closeStart: number
  readonly children: Array<XmlElement | XmlTextNode>
}

function scanTagEnd(xml: string, start: number): number {
  let quote = ''
  for (let index = start + 1; index < xml.length; index++) {
    const char = xml[index]!
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '>') return index
  }
  return -1
}

/** A lossless lexical XML walk. It records source offsets and never reserializes
 * content; malformed markup is left for the later SVG security authority. */
function scanXml(svg: string): XmlElement[] | null {
  const roots: XmlElement[] = []
  const stack: XmlElement[] = []
  let cursor = 0
  while (cursor < svg.length) {
    const lt = svg.indexOf('<', cursor)
    if (lt < 0) {
      if (stack.length > 0 && cursor < svg.length) stack[stack.length - 1]!.children.push({ kind: 'text-node', raw: svg.slice(cursor) })
      cursor = svg.length
      break
    }
    if (stack.length > 0 && lt > cursor) stack[stack.length - 1]!.children.push({ kind: 'text-node', raw: svg.slice(cursor, lt) })
    if (svg.startsWith('<!--', lt)) {
      const end = svg.indexOf('-->', lt + 4)
      if (end < 0) return null
      cursor = end + 3
      continue
    }
    const gt = scanTagEnd(svg, lt)
    if (gt < 0) return null
    const raw = svg.slice(lt, gt + 1)
    if (/^<\?/.test(raw) || /^<!/.test(raw)) { cursor = gt + 1; continue }
    const closing = raw.match(/^<\/\s*([\w:-]+)\s*>$/)
    if (closing) {
      const element = stack.pop()
      if (!element || element.name !== closing[1]!.toLowerCase()) return null
      element.closeStart = lt
      cursor = gt + 1
      continue
    }
    const opening = raw.match(/^<\s*([\w:-]+)([\s\S]*?)(\/?)>$/)
    if (!opening) return null
    const element: XmlElement = {
      kind: 'element',
      name: opening[1]!.toLowerCase(),
      attrs: opening[2]!,
      openEnd: gt + 1,
      closeStart: gt + 1,
      children: [],
    }
    if (stack.length > 0) stack[stack.length - 1]!.children.push(element)
    else roots.push(element)
    if (opening[3] !== '/') stack.push(element)
    cursor = gt + 1
  }
  return stack.length === 0 ? roots : null
}

function childElements(element: XmlElement): XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.kind === 'element')
}

function resolveMetrics(parent: InheritedTextMetrics, element: XmlElement): InheritedTextMetrics {
  const namedBold = element.name === 'b' || element.name === 'strong'
  return {
    size: numericAttribute(element.attrs, 'font-size', parent.size),
    weight: namedBold ? Math.max(700, fontWeightAttribute(element.attrs, parent.weight)) : fontWeightAttribute(element.attrs, parent.weight),
    letterSpacing: numericAttribute(element.attrs, 'letter-spacing', parent.letterSpacing),
    mono: parent.mono || hasMonoClass(element.attrs),
  }
}

function hasAttribute(attrs: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*=`, 'i').test(attrs)
}

function startsPositionedAdvance(element: XmlElement): boolean {
  return element.name === 'tspan' && ['x', 'y', 'dx', 'dy'].some(name => hasAttribute(element.attrs, name))
}

function hasPositionedDescendant(element: XmlElement): boolean {
  return childElements(element).some(child => startsPositionedAdvance(child) || hasPositionedDescendant(child))
}

interface MeasuredRun {
  readonly text: string
  readonly metrics: InheritedTextMetrics
}

function collectRuns(
  owner: XmlElement,
  inherited: InheritedTextMetrics,
): { runs: MeasuredRun[]; blocked: boolean } {
  const runs: MeasuredRun[] = []
  let blocked = false
  const visit = (element: XmlElement, parent: InheritedTextMetrics, isOwner: boolean) => {
    const metrics = resolveMetrics(parent, element)
    if (!isOwner && startsPositionedAdvance(element)) return
    if (!isOwner && hasAttribute(element.attrs, 'textLength')) { blocked = true; return }
    for (const child of element.children) {
      if (child.kind === 'text-node') {
        const text = decodeXML(child.raw)
        if (text.length > 0) runs.push({ text, metrics })
      } else visit(child, metrics, false)
    }
  }
  visit(owner, inherited, true)
  return { runs, blocked }
}

function measuredAdvance(runs: readonly MeasuredRun[]): number | null {
  const painted = runs.filter(run => run.text.length > 0)
  if (painted.length === 0 || painted.every(run => run.text.trim().length === 0)) return null
  let width = 0
  let previousClusters = 0
  let previousSpacing = 0
  for (const run of painted) {
    if (!(run.metrics.size > 0)) return null
    const clusters = graphemes(run.text).length
    if (previousClusters > 0 && clusters > 0) width += previousSpacing
    width += run.metrics.mono
      ? measureMonospaceTextWidth(run.text, run.metrics.size, run.metrics.letterSpacing)
      : measureFormattedTextWidth(run.text, run.metrics.size, run.metrics.weight, run.metrics.letterSpacing)
    previousClusters = clusters
    previousSpacing = run.metrics.letterSpacing
  }
  return Math.round(width * 1000) / 1000
}

interface SourceEdit { readonly offset: number; readonly text: string }

/**
 * Force every continuous painted SVG text advance to the deterministic width
 * used by layout. A positioned tspan (x/y/dx/dy) starts an independent line;
 * formatting-only descendants contribute inherited metrics to their owner.
 * Existing emitter-owned textLength remains authoritative.
 *
 * `fontStack` is retained for compatibility with the former unknown-font-only
 * postpass; projection is deliberately family-independent.
 */
export function fitUncalibratedSvgText(svg: string, _fontStack: string): string {
  const roots = scanXml(svg)
  if (!roots) return svg
  const edits: SourceEdit[] = []
  const base: InheritedTextMetrics = { size: 0, weight: 400, letterSpacing: 0, mono: false }

  const visitTextTree = (element: XmlElement, inherited: InheritedTextMetrics, insideText: boolean) => {
    const metrics = resolveMetrics(inherited, element)
    const isTextRoot = element.name === 'text' && !insideText
    const isOwner = isTextRoot || (insideText && startsPositionedAdvance(element))
    const emitterOwned = isOwner && hasAttribute(element.attrs, 'textLength')
    if (emitterOwned) return
    // A parent textLength would also scale independently positioned lines.
    // Fit those line tspans instead; mixed formatting without positioning is
    // one continuous parent-owned advance.
    if (isOwner && !(isTextRoot && hasPositionedDescendant(element))) {
      const collected = collectRuns(element, inherited)
      const width = collected.blocked ? null : measuredAdvance(collected.runs)
      if (width !== null) {
        edits.push({
          offset: element.openEnd - 1,
          text: ` textLength="${width}" lengthAdjust="spacingAndGlyphs" data-font-metrics="deterministic-fit"`,
        })
      }
    }
    const nextInside = insideText || isTextRoot
    for (const child of childElements(element)) visitTextTree(child, metrics, nextInside)
  }
  for (const root of roots) visitTextTree(root, base, false)

  let projected = svg
  for (const edit of edits.sort((a, b) => b.offset - a.offset)) {
    projected = projected.slice(0, edit.offset) + edit.text + projected.slice(edit.offset)
  }
  return projected
}
