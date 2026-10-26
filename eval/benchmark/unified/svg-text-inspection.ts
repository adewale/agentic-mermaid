/** No runtime imports, parsing, rendering, or DOM mutation.
 * Host adapters supply an independently parsed XML tree. This proves authored
 * text retention within the admitted namespaces, not CSS/paint visibility. */
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
export const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

export interface SvgInspectionText {
  kind: 'text'
  value: string
}
export interface SvgInspectionElement {
  kind: 'element'
  localName: string
  namespaceURI: string
  attributes: Record<string, string>
  children: SvgInspectionNode[]
}
export type SvgInspectionNode = SvgInspectionElement | SvgInspectionText

export const normalizeAuthoredText = (value: string): string => value.replace(/\s+/gu, ' ').trim()
const inert = new Set(['defs', 'metadata', 'title', 'desc', 'style', 'script'])
const excluded = (node: SvgInspectionElement): boolean => inert.has(node.localName.toLowerCase())

/** Decorations are admitted only around a complete authored token. Thus
 * Free matches Free(60), while C1 does not match C10. No case transformation,
 * arbitrary substring, source parsing, or output-derived expectations occur. */
export function containsAuthoredLabel(run: string, authoredLabel: string): boolean {
  const label = normalizeAuthoredText(authoredLabel)
  if (!label) return true
  const literal = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])`, 'u').test(normalizeAuthoredText(run))
}

function content(node: SvgInspectionNode, insideForeignObject: boolean, positionedLines: boolean): string {
  if (node.kind === 'text') return node.value
  if (excluded(node)) return ''
  const svg = node.namespaceURI === SVG_NAMESPACE
  const html = insideForeignObject && node.namespaceURI === XHTML_NAMESPACE
  if (!svg && !html) return ''
  if (html && node.localName.toLowerCase() === 'br') return ' '
  const foreign = insideForeignObject || (svg && node.localName === 'foreignObject')
  let previousY: number | undefined
  return node.children
    .map(child => {
      let boundary = ''
      if (positionedLines && child.kind === 'element' && child.namespaceURI === SVG_NAMESPACE && child.localName === 'tspan' && !excluded(child)) {
        const absolute = Number.parseFloat(child.attributes.y ?? ''),
          parsedDy = Number.parseFloat(child.attributes.dy ?? '0'),
          dy = Number.isFinite(parsedDy) ? parsedDy : 0,
          currentY = Number.isFinite(absolute) ? absolute : previousY === undefined ? undefined : previousY + dy
        if (child.attributes.x !== undefined && (dy !== 0 || (previousY !== undefined && currentY !== undefined && currentY !== previousY))) boundary = ' '
        previousY = currentY
      }
      return boundary + content(child, foreign, positionedLines)
    })
    .join('')
}

export interface SvgTextInspection {
  runs: string[]
  /** Maximal text containers in document order, without duplicate child runs.
   * Source-echo admission uses these, rather than joining overlapping variants. */
  primaryRuns: string[]
  missingLabels: string[]
  scope: 'namespace-aware-authored-text-retention; CSS-and-paint-visibility-unmeasured'
}

export function inspectSvgText(root: SvgInspectionElement, expectedLabels: readonly string[] = []): SvgTextInspection {
  const runs = new Set<string>(),
    primaryRuns: string[] = []
  const add = (text: string): void => {
    const normalized = normalizeAuthoredText(text)
    if (normalized) runs.add(normalized)
  }
  const visit = (node: SvgInspectionNode, insideForeignObject: boolean, insideTextContainer: boolean): void => {
    if (node.kind === 'text') {
      if (insideForeignObject) add(node.value)
      return
    }
    if (excluded(node)) return
    const svg = node.namespaceURI === SVG_NAMESPACE,
      html = insideForeignObject && node.namespaceURI === XHTML_NAMESPACE
    if (!svg && !html) return
    const foreign = insideForeignObject || (svg && node.localName === 'foreignObject'),
      container = svg && ['text', 'tspan', 'foreignObject'].includes(node.localName)
    if (container) {
      const plain = content(node, foreign, false),
        positioned = content(node, foreign, true)
      add(plain)
      add(positioned)
      if (!insideTextContainer) primaryRuns.push(normalizeAuthoredText(positioned))
    }
    for (const child of node.children) visit(child, foreign, insideTextContainer || container)
  }
  visit(root, false, false)
  return {
    runs: [...runs],
    primaryRuns,
    missingLabels: expectedLabels.filter(label => ![...runs].some(run => containsAuthoredLabel(run, label))),
    scope: 'namespace-aware-authored-text-retention; CSS-and-paint-visibility-unmeasured',
  }
}
