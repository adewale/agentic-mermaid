import { createInlineColorAttributeResolverForVariables, SVG_STYLE_DECLARATIONS } from '../theme.ts'
import { isHexColor, tryParseCssColor } from '../shared/color-math.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import { isRetainedPixelText } from '../shared/prepared-text.ts'
import { escapeXml } from '../multiline-utils.ts'
import { isWellFormedSvgText } from '../output-security.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { decodedSvgAttributeValue, scanSvgStartTags, type SvgStartTagToken } from '../svg-structure.ts'
import type { ConnectorMark, DocumentMark, MarkerDescriptor, SceneDoc, SceneNode, TextMark } from './ir.ts'
import { serializeMarkerResource } from './marker-resources.ts'
import { parseSvgTransform, transformMatrix } from './transforms.ts'

type Header = Pick<SceneDoc, 'width' | 'height' | 'colors'>
type Pay = (operations: number) => boolean
export type EmissionColorResolver = (value: string) => string | undefined

/** Check actual document bytes against the existing writer's closed context.
 * Collection belongs to the admission/write traversal; only these retained
 * fragments are checked once the same transaction supplies its header. */
export function createEmissionContext(pay: Pay, options: { resources?: boolean } = {}) {
  let uncertain = false, finished = false
  let hasMarkedConnector = false, hasRingConnector = false, fractionalCircleContext = true
  let documentPosition: 'before' | 'inside' | 'after' = 'before'
  let needsVariables = false, needsDerivedVariables = false, canonicalStyles = 0, roots = 0
  const documents: Array<{ node: DocumentMark; svg: string }> = []
  const groups: Array<Extract<SceneNode, { kind: 'group' }>> = []
  const references: MarkerDescriptor[] = []
  const markerIds = new Set<string>()
  const resources = new Map<string, string>()
  const rootVariables = new Set<string>()
  const rootPaintVariables = new Map<string, string>()
  const ownValue = (value: object, name: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  }
  const reserve = (count: number): boolean => {
    if (finished || !Number.isSafeInteger(count) || count < 0 || !pay(count)) { uncertain = true; return false }
    return true
  }
  const unsupportedFractionalLeaf = Symbol('unsupported-fractional-leaf')
  // The fractional ring slice reuses the checked canonical document context.
  // Its disjoint text bounds additionally need correspondence with this write,
  // rather than a promise made by a caller's prepared-text metadata.
  const ringTextWrite = (node: TextMark, svg: string): boolean => {
    if (!reserve(svg.length * 8 + 128)) return false
    const own = (value: object, name: string): unknown => {
      if (!reserve(4)) return unsupportedFractionalLeaf
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      return descriptor ? 'value' in descriptor ? descriptor.value : unsupportedFractionalLeaf : name in value ? unsupportedFractionalLeaf : undefined
    }
    const block = own(node, 'block') as TextMark['block']
    if (!block || typeof block !== 'object' || !isRetainedPixelText(block)
      || own(node, 'measurement') !== 'prepared' || block.monospace || block.letterSpacing !== 0
      || block.lineBlocks.length !== 1 || block.lines.length !== 1 || block.lineBlocks[0]!.fragments
      || block.fontFamily !== undefined && block.fontFamily !== 'Inter'
      || own(node, 'text') !== block.text || !reserve(block.text.length * 8 + 8) || /[^\x20-\x7e]/.test(block.text)
      || own(node, 'transform') !== undefined || own(node, 'spans') !== undefined
      || own(node, 'fontStyle') !== undefined || own(node, 'textDecoration') !== undefined
      || own(node, 'dominantBaseline') !== undefined) return false
    const layout = own(node, 'textLayout') as TextMark['textLayout']
    if (!layout || own(layout, 'width') !== block.width || own(layout, 'height') !== block.height
      || own(layout, 'offsetY') !== 0 || block.lineBlocks[0]!.width !== block.width) return false
    const x = own(node, 'x'), y = own(node, 'y'), size = own(node, 'fontSize')
    const weight = own(node, 'fontWeight') ?? block.fontWeight
    const shift = own(node, 'baselineShift') ?? 0.35, spacing = own(node, 'letterSpacing') ?? 0
    if (size !== block.fontSize || weight !== block.fontWeight || shift !== 0.35 || spacing !== 0) return false
    const numeric = [x, y, size, weight, block.fontSize * 0.35]
    if (!numeric.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6
      && Number(formatSvgNumber(value)) === value)) return false
    // The actual fitted advance can normalize an arithmetic tail. Later text
    // enclosures add three outward ticks, including this one-tick projection;
    // the exact ring/body contact comparisons receive no such allowance.
    if (!Number.isFinite(block.width) || block.width < 0 || block.width > 1e6
      || Math.abs(Number(formatSvgNumber(block.width)) - block.width) > 1 / 2000) return false
    const tags = scanSvgStartTags(svg), tag = tags[0]
    if (tags.length !== 1 || !tag || tag.name !== 'text' || tag.start !== 0
      || svg.slice(tag.end) !== `${escapeXml(block.text)}</text>`) return false
    const expected: Record<string, string | undefined> = {
      x: formatSvgNumber(x as number), y: formatSvgNumber(y as number), 'font-size': formatSvgNumber(size as number),
      'font-weight': formatSvgNumber(weight as number), 'text-anchor': own(node, 'anchor') as string,
      dy: formatSvgNumber(block.fontSize * 0.35), textLength: formatSvgNumber(block.width),
      lengthAdjust: 'spacingAndGlyphs', 'font-family': block.fontFamily,
      'data-prepared-text': 'true', 'data-font-metrics': 'deterministic-fit',
    }
    const names = new Set<string>()
    for (const attribute of tag.attributes) {
      if (!reserve(attribute.name.length + attribute.value.length + 4) || names.has(attribute.name)) return false
      names.add(attribute.name)
      if (Object.hasOwn(expected, attribute.name)) {
        if (decodedSvgAttributeValue(tag, attribute.name) !== expected[attribute.name]) return false
      } else if (!['fill', 'id', 'role', 'class', 'xml:space'].includes(attribute.name)
        && !attribute.name.startsWith('data-') && !attribute.name.startsWith('aria-')) return false
    }
    if (decodedSvgAttributeValue(tag, 'class')?.split(/\s+/).includes('mono')) return false
    return Object.entries(expected).every(([name, value]) => decodedSvgAttributeValue(tag, name) === value)
  }
  const variableUse = (value: string): void => {
    if (value.includes('var(')) needsVariables = true
    if (value.includes('var(--_')) needsDerivedVariables = true
  }
  const canonicalStyle = (body: string, header: Header): boolean => {
    const font = safeCssFontFamily(header.colors.font ?? 'Inter')
    if (!font) return false
    const fallback = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(font) ? `'${font}'` : font
    let cursor = 0
    const consume = (literal: string): boolean => {
      if (!body.startsWith(literal, cursor)) return false
      cursor += literal.length
      return true
    }
    if (!consume('\n') || !consume(SVG_STYLE_DECLARATIONS.fontPrefix) || !consume(fallback)
      || !consume(SVG_STYLE_DECLARATIONS.fontSuffix) || !consume('\n')) return false
    if (body.startsWith(SVG_STYLE_DECLARATIONS.mono, cursor)
      && (!consume(SVG_STYLE_DECLARATIONS.mono) || !consume('\n'))) return false
    return consume('  svg {') && consume(SVG_STYLE_DECLARATIONS.derived) && consume('\n  }\n') && cursor === body.length
  }
  const rootMatches = (svg: string, root: SvgStartTagToken, header: Header): boolean => {
    if (root.selfClosing || decodedSvgAttributeValue(root, 'xmlns') !== 'http://www.w3.org/2000/svg') return false
    const width = formatSvgNumber(header.width), height = formatSvgNumber(header.height)
    if (decodedSvgAttributeValue(root, 'width') !== width || decodedSvgAttributeValue(root, 'height') !== height) return false
    const viewBox = decodedSvgAttributeValue(root, 'viewBox')
    if (viewBox !== undefined && viewBox !== `0 0 ${width} ${height}`) return false
    if (decodedSvgAttributeValue(root, 'class')?.split(/\s+/).includes('mono')) return false
    const names = new Set<string>()
    let cursor = root.start + 4
    for (const attribute of root.attributes) {
      if (!['xmlns', 'width', 'height', 'viewBox', 'style', 'role', 'class'].includes(attribute.name)
        && !attribute.name.startsWith('data-') && !attribute.name.startsWith('aria-')) return false
      if (names.has(attribute.name) || !/^[ \t\r\n]+$/.test(svg.slice(cursor, attribute.nameStart))
        || svg.slice(attribute.nameStart, attribute.valueStart) !== `${attribute.name}=${attribute.quote}`) return false
      names.add(attribute.name)
      cursor = attribute.valueEnd + 1
    }
    if (!/^[ \t\r\n]*>$/.test(svg.slice(cursor, root.end))) return false
    const style = decodedSvgAttributeValue(root, 'style')
    if (style === undefined) return true
    const hasEntities = root.attributes.find(attribute => attribute.name === 'style')!.value.includes('&')
    const seen = new Set<string>()
    for (const declaration of style.split(';')) {
      if (!declaration.trim()) continue
      const colon = declaration.indexOf(':')
      if (colon < 0) return false
      const name = declaration.slice(0, colon).trim(), value = declaration.slice(colon + 1).trim()
      if (seen.has(name)) return false
      seen.add(name)
      if (name === 'background' && value === 'var(--bg)') continue
      if (name === '--font') {
        if (value !== safeCssFontFamily(header.colors.font)) return false
        continue
      }
      const key = name.slice(2)
      if (['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'].some(field => `--${field}` === name)) {
        if (ownValue(header.colors, key) !== value) return false
        // Optional non-hex paints come from the served root definitions, not
        // the fixed palette. Preserve their raw CSS meaning across finalizing.
        if (hasEntities && key !== 'bg' && key !== 'fg' && !isHexColor(value)) return false
        if (!hasEntities) rootPaintVariables.set(key, value)
      } else {
        // The finalizer reads raw CSS contexts. Entity-encoded definitions
        // cannot borrow their XML-decoded interpretation as served paint.
        if (!/^--[A-Za-z][\w-]*$/.test(name) || key.startsWith('_') || hasEntities
          || value !== 'none' && !tryParseCssColor(value)) return false
        rootPaintVariables.set(key, value)
      }
    }
    for (const name of seen) rootVariables.add(name)
    return true
  }
  const rootPreludeMatches = (svg: string, tags: readonly SvgStartTagToken[], header: Header): boolean => {
    const root = tags[0]
    if (!root || root.name !== 'svg' || !/^[ \t\r\n]*$/.test(svg.slice(0, root.start))
      || !rootMatches(svg, root, header)) return false
    let cursor = root.end
    for (const tag of tags) {
      if (tag === root) continue
      if (!['title', 'desc', 'style'].includes(tag.name) || tag.start < cursor
        || !isWellFormedSvgText(svg.slice(cursor, tag.start))
        || !/^[ \t\r\n]*(?:>|\/>)$/.test(svg.slice(tag.start + tag.name.length + 1, tag.end))) return false
      if (tag.selfClosing) {
        if (tag.name === 'style') return false
        cursor = tag.end
        continue
      }
      const end = svg.indexOf('<', tag.end), closeEnd = svg.indexOf('>', end)
      if (end < 0 || closeEnd < 0 || !svg.startsWith(`</${tag.name}`, end)
        || !/^[ \t\r\n]*>$/.test(svg.slice(end + tag.name.length + 2, closeEnd + 1))
        || tag.name !== 'style' && !isWellFormedSvgText(svg.slice(tag.end, end))) return false
      cursor = closeEnd + 1
    }
    return isWellFormedSvgText(svg.slice(cursor))
  }
  const readDefinitions = (svg: string, tags: readonly SvgStartTagToken[]): void => {
    const outer = tags[0]
    if (!outer || outer.name !== 'defs' || outer.selfClosing || outer.attributes.length
      || !/^[ \t\r\n]*$/.test(svg.slice(0, outer.start))) { uncertain = true; return }
    let cursor = outer.end, markerEnd = -1
    for (const tag of tags) {
      if (tag === outer) continue
      if (tag.name !== 'marker') {
        if (tag.start >= markerEnd || !['circle', 'ellipse', 'line', 'rect', 'polygon', 'polyline', 'path'].includes(tag.name)) uncertain = true
        continue
      }
      if (tag.start < markerEnd) { uncertain = true; continue }
      const id = decodedSvgAttributeValue(tag, 'id'), end = svg.indexOf('</marker>', tag.end)
      if (end < 0) { uncertain = true; return }
      if (!id || resources.has(id) || !/^[ \t\r\n]*$/.test(svg.slice(cursor, tag.start))) { uncertain = true; continue }
      markerEnd = end + 9
      cursor = markerEnd
      resources.set(id, svg.slice(tag.start, markerEnd).replace(/(^|\n)[ \t]+(?=<)/g, '$1'))
    }
    if (!/^[ \t\r\n]*<\/defs>[ \t\r\n]*$/.test(svg.slice(cursor))) uncertain = true
  }
  const markupCost = (value: unknown, depth = 0): number | undefined => {
    if (!reserve(1) || depth > 64) return undefined
    if (typeof value === 'string') return value.length * 6 + 2
    if (typeof value === 'number') return 32
    if (!value || typeof value !== 'object') return 8
    if (!reserve(1)) return undefined
    const keys = Object.getOwnPropertyNames(value)
    if (!reserve(keys.length)) return undefined
    let cost = 64
    for (const key of keys) {
      if (!reserve(3)) return undefined
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) return undefined
      const child = markupCost(descriptor.value, depth + 1)
      if (child === undefined) return undefined
      cost += key.length + 16 + child
      if (!Number.isSafeInteger(cost)) return undefined
    }
    return cost
  }
  const same = (left: unknown, right: unknown): boolean => {
    if (!reserve(1)) return false
    if (typeof left === 'string' && typeof right === 'string') return reserve(left.length + right.length) && left === right
    if (left === right) return true
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || !reserve(2)) return false
    const keys = Object.getOwnPropertyNames(left), other = Object.getOwnPropertyNames(right)
    if (!reserve(keys.length + other.length) || keys.length !== other.length) return false
    for (const key of keys) {
      if (!reserve(3)) return false
      const a = Object.getOwnPropertyDescriptor(left, key), b = Object.getOwnPropertyDescriptor(right, key)
      if (!a || !b || !('value' in a) || !('value' in b) || a.enumerable !== b.enumerable || !same(a.value, b.value)) return false
    }
    return true
  }
  return {
    document(node: DocumentMark, svg: string): void {
      if (!reserve(3)) return
      if (node.element === 'open') {
        if (documentPosition !== 'before') uncertain = true
        documentPosition = 'inside'
      } else if (node.element === 'close') {
        if (documentPosition !== 'inside' || svg !== '</svg>') uncertain = true
        documentPosition = 'after'
      } else if (documentPosition !== 'inside') uncertain = true
      documents.push({ node, svg })
    },
    connector(node: ConnectorMark): void {
      if (!reserve(3)) return
      if (node.lineStyle === 'invisible' || !node.markers.start && !node.markers.end && node.markers.mid.length === 0) return
      hasMarkedConnector = true
      if (documentPosition !== 'inside') uncertain = true
      if (!reserve(node.stroke.color.length * 2 + 4)) return
      variableUse(node.stroke.color)
      if (!reserve(node.markers.mid.length * 2 + 4)) return
      const reference = (marker: MarkerDescriptor | undefined): void => {
        if (!marker) return
        const id = ownValue(marker, 'id')
        if (typeof id !== 'string') { uncertain = true; return }
        if (!reserve(id.length * 2 + 4)) return
        markerIds.add(id)
        if (options.resources !== false) { references.push(marker); return }
        for (const field of ['fill', 'stroke'] as const) {
          const value = marker.paint?.[field]
          if (value !== undefined && reserve(value.length * 2 + 2)) variableUse(value)
        }
      }
      reference(node.markers.start)
      for (const marker of node.markers.mid) reference(marker)
      reference(node.markers.end)
    },
    /** Call only for an owned captured leaf. A hint requests an actual write;
     * it grants no geometry or paint authority by itself. */
    hint(node: SceneNode): boolean {
      if (!reserve(2)) return false
      if (node.kind === 'connector') {
        const reference = (marker: MarkerDescriptor | undefined): void => {
          if (!marker || !reserve(4)) return
          if (marker.geometry?.kind === 'circle' && marker.paint?.fill === 'none') hasRingConnector = true
        }
        reference(node.markers.start)
        for (const marker of node.markers.mid) { if (!reserve(1)) break; reference(marker) }
        reference(node.markers.end)
      }
      return hasRingConnector && node.kind !== 'document' && node.kind !== 'group'
    },
    /** Observe the fragment from this same captured leaf's actual write. */
    leaf(node: SceneNode, svg: string): void {
      if (!hasRingConnector || node.kind === 'document' || node.kind === 'group') return
      if (node.kind === 'text') {
        if (!ringTextWrite(node, svg)) fractionalCircleContext = false
      } else {
        if (!reserve(svg.length * 8 + 32)) { fractionalCircleContext = false; return }
        const tags = scanSvgStartTags(svg)
        if (tags.length !== 1 || decodedSvgAttributeValue(tags[0]!, 'transform') !== undefined) fractionalCircleContext = false
      }
    },
    invalidateFractionalCircle(): void { fractionalCircleContext = false },
    group(shell: Extract<SceneNode, { kind: 'group' }>): void {
      if (reserve(2)) groups.push(shell)
    },
    finish(header: Header): { readonly uncertain: boolean; readonly fractionalCircleContext: boolean; readonly resolveColor?: EmissionColorResolver } {
      if (finished) return Object.freeze({ uncertain: true, fractionalCircleContext: false })
      // This new obligation belongs to actual marker-bearing occurrences.
      // Other charts retain their existing proof scope; this is not evidence
      // that their unrelated styles, resources or responsive units are closed.
      if (!hasMarkedConnector) {
        finished = true
        return Object.freeze({ uncertain: false, fractionalCircleContext: false })
      }
      const font = ownValue(header.colors, 'font')
      if (!reserve(typeof font === 'string' ? font.length * 4 + 16 : 16)) {
        finished = true
        return Object.freeze({ uncertain: true, fractionalCircleContext: false })
      }
      for (const { node, svg } of documents) {
        if (!reserve(svg.length * 8 + 128)) break
        if (svg.includes('<?') || svg.includes('<!')) { uncertain = true; continue }
        const tags = scanSvgStartTags(svg)
        if (node.element !== 'definitions') for (const tag of tags) {
          const id = decodedSvgAttributeValue(tag, 'id')
          if (id !== undefined && markerIds.has(id)) uncertain = true
        }
        if (node.element === 'open') {
          if (++roots > 1) uncertain = true
          // The existing fragment reservation pays these exact token/text
          // spans; the shared scanner remains the only markup inventory.
          if (!rootPreludeMatches(svg, tags, header)) uncertain = true
        }
        let styleEnd = -1
        for (const tag of tags) {
          if (tag.name !== 'style') continue
          if (tag.start < styleEnd) { uncertain = true; continue }
          const end = svg.indexOf('</style>', tag.end)
          if (end < 0) { uncertain = true; break }
          styleEnd = end + 8
          if (tag.selfClosing || tag.attributes.length || end < 0 || !canonicalStyle(svg.slice(tag.end, end), header)) uncertain = true
          else { canonicalStyles++; needsVariables = true }
        }
        if (options.resources === false) continue
        if (node.element === 'definitions') readDefinitions(svg, tags)
        if (node.markerResources) {
          if (!reserve(node.markerResources.length * 2)) break
          for (const marker of node.markerResources) references.push(marker)
        }
      }
      for (const shell of groups) {
        const svg = shell.open
        if (!reserve(svg.length * 8 + 64)) break
        const tags = scanSvgStartTags(svg), tag = tags[0]
        // Only the new fractional proof needs a complete inert shell. Native
        // captures these fields; Scene's private hint gate runs before finish.
        // Generic/default Scene writes never set hasRingConnector.
        if (hasRingConnector && fractionalCircleContext) {
          if (!reserve(12)) break
          const open = Object.getOwnPropertyDescriptor(shell, 'open')
          const close = Object.getOwnPropertyDescriptor(shell, 'close')
          const join = Object.getOwnPropertyDescriptor(shell, 'join')
          if (!open || !('value' in open) || typeof open.value !== 'string'
            || !close || !('value' in close) || typeof close.value !== 'string'
            || !join || !('value' in join) || typeof join.value !== 'string') fractionalCircleContext = false
          else {
            if (!reserve(svg.length * 2 + close.value.length + join.value.length + 16)) break
            if (open.value !== svg || tags.length !== 1 || !tag || tag.name !== 'g' || tag.selfClosing
              || /[^\t\n\r ]/.test(svg.slice(0, tag.start)) || /[^\t\n\r ]/.test(svg.slice(tag.end))
              || close.value !== '</g>' || /[^\t\n\r ]/.test(join.value)) fractionalCircleContext = false
          }
        }
        if (!tag || tag.name !== 'g' || decodedSvgAttributeValue(tag, 'style') !== undefined
          || decodedSvgAttributeValue(tag, 'opacity') !== shell.paint?.opacity
          || decodedSvgAttributeValue(tag, 'fill') !== undefined || shell.paint?.fill !== undefined
          || tag.attributes.some(attribute => attribute.name === 'id')
          || decodedSvgAttributeValue(tag, 'class')?.split(/\s+/).includes('mono')) uncertain = true
        if (!tag) continue
        const names = new Set<string>()
        for (const attribute of tag.attributes) {
          if (names.has(attribute.name) || !/^(?:class|data-[a-z0-9-]+|role|aria-[a-z]+|tabindex|pointer-events|transform|opacity)$/.test(attribute.name)) uncertain = true
          names.add(attribute.name)
        }
        const raw = decodedSvgAttributeValue(tag, 'transform')
        if (raw !== undefined) fractionalCircleContext = false
        if (raw === undefined) {
          if (shell.transform !== undefined) uncertain = true
        } else {
          const actual = parseSvgTransform(raw), typed = shell.transform && transformMatrix(shell.transform)
          if (formatSvgNumericAttribute('transform', raw) !== raw || !actual || !typed
            || !actual.every((value, index) => Number.isFinite(value) && Number.isFinite(typed[index]) && value === typed[index])) uncertain = true
        }
      }
      if (options.resources !== false) {
        const checked = new Map<string, MarkerDescriptor>()
        for (const marker of references) {
          if (!reserve(3)) break
          const prior = checked.get(marker.id)
          if (prior) {
            if (!same(prior, marker)) uncertain = true
            continue
          }
          const cost = markupCost(marker)
          if (cost === undefined || !reserve(cost * 2)) { uncertain = true; break }
          try {
            const expected = serializeMarkerResource(marker, { indent: 0 }).replace(/(^|\n)[ \t]+(?=<)/g, '$1')
            if (!reserve(expected.length * 3)) break
            variableUse(expected)
            if (resources.get(marker.id) !== expected) uncertain = true
            else checked.set(marker.id, marker)
          } catch { uncertain = true }
        }
        if (!reserve(1) || checked.size !== resources.size) uncertain = true
      }
      if (needsVariables) for (const name of ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'] as const) {
        if (!reserve(2)) break
        if (ownValue(header.colors, name) !== undefined && !rootVariables.has(`--${name}`)) uncertain = true
      }
      if (roots !== 1 || documentPosition !== 'after') uncertain = true
      if (needsDerivedVariables && canonicalStyles === 0) uncertain = true
      let resolveColor: EmissionColorResolver | undefined
      if (!uncertain) {
        // Pay definition string sizes separately from the abstract per-context
        // palette setup weight below. That weight is not a CPU-operation bound;
        // the theme kernel's existing contrast-search limits remain unchanged.
        for (const [name, value] of rootPaintVariables) {
          if (!reserve(name.length + value.length + 4)) break
        }
        if (!uncertain && reserve(4096 + rootPaintVariables.size * 4)) {
          resolveColor = createInlineColorAttributeResolverForVariables(header.colors, rootPaintVariables)
          if (!resolveColor) uncertain = true
        }
      }
      finished = true
      return Object.freeze({ uncertain,
        fractionalCircleContext: hasRingConnector && fractionalCircleContext && !uncertain && (font === undefined || font === 'Inter'),
        ...(resolveColor ? { resolveColor } : {}) })
    },
  }
}
