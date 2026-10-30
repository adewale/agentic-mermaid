import { createInlineColorAttributeResolverForVariables, SVG_STYLE_DECLARATIONS } from '../theme.ts'
import { isHexColor, tryParseCssColor } from '../shared/color-math.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import { isRetainedPixelText } from '../shared/prepared-text.ts'
import { escapeXml } from '../multiline-utils.ts'
import { isWellFormedSvgText } from '../output-security.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { decodedSvgAttributeValue, scanSvgStartTags, scanSvgStartTagsFresh, type SvgStartTagToken } from '../svg-structure.ts'
import type { ConnectorMark, DocumentMark, MarkerDescriptor, SceneDoc, SceneNode, TextMark } from './ir.ts'
import { serializeMarkerResource } from './marker-resources.ts'
import { parseSvgTransform, transformMatrix, type AffineMatrix } from './transforms.ts'
import { writtenLeafContextOf } from './svg-writer.ts'

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
  const texts: Array<{ node: TextMark; svg: string }> = []
  const leaves: Array<{ node: SceneNode; svg: string }> = []
  const groups: Array<Extract<SceneNode, { kind: 'group' }>> = []
  type NativeGroup = { readonly svg: string; readonly tags: readonly SvgStartTagToken[]; readonly opacity: string | undefined; readonly transform: string | undefined; readonly matrix: AffineMatrix | undefined }
  const nativeGroups = new WeakMap<Extract<SceneNode, { kind: 'group' }>, NativeGroup>()
  let hasNativeGroups = false
  const references: MarkerDescriptor[] = []
  const markerIds = new Set<string>()
  const resources = new Map<string, string>()
  const rootVariables = new Set<string>()
  const rootPaintVariables = new Map<string, string>()
  const ownValue = (value: object, name: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
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
    const own = (value: object, name: string): unknown => {
      if (!reserve(4)) return unsupportedFractionalLeaf
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      return descriptor ? Object.hasOwn(descriptor, 'value') ? descriptor.value : unsupportedFractionalLeaf : name in value ? unsupportedFractionalLeaf : undefined
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
    if (![x, y].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6
      && Math.abs(Number(formatSvgNumber(value)) - value) <= 1 / 2000)) return false
    const numeric = [size, weight]
    if (!numeric.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6
      && Number(formatSvgNumber(value)) === value)) return false
    const baseline = block.fontSize * 0.35, dy = formatSvgNumber(baseline), servedBaseline = Number(dy)
    if (!Number.isFinite(baseline) || Math.abs(baseline) > 1e6 || !Number.isFinite(servedBaseline)
      || Math.abs(servedBaseline) > 1e6 || Math.abs(servedBaseline - baseline) > 1 / 2000) return false
    // Served position, baseline and fitted advance can normalize arithmetic
    // tails. Two outward ticks cover their combined projection at either text
    // edge; a third covers bounds arithmetic. Exact body contact gets no margin.
    if (!Number.isFinite(block.width) || block.width < 0 || block.width > 1e6
      || Math.abs(Number(formatSvgNumber(block.width)) - block.width) > 1 / 2000) return false
    // Only an active precision domain inspects this occurrence's actual
    // fragment. Prepay the two bounded lexical passes before locating quotes.
    if (!reserve(svg.length * 2 + 8) || !svg.startsWith('<text ')) return false
    const attributes: Record<string, string> = Object.create(null)
    const attribute = / ([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"<]*)"/y
    let cursor = 5
    while (svg[cursor] !== '>') {
      attribute.lastIndex = cursor
      const match = attribute.exec(svg)
      if (!match) return false
      const name = match[1]!, raw = match[2]!
      // The actual writer uses escapeAttr: one canonical-escape/character
      // pass replaces generic XML validation and decoding. Prepay it, plus
      // name classification and duplicate/record custody, before checking.
      if (!reserve(name.length * 2 + raw.length + 8) || Object.hasOwn(attributes, name)
        || !/^(?:[^&<>"\0-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]|&(?:amp|lt|gt|quot|#39|#9|#10|#13);)*$/u.test(raw)) return false
      if (!['x', 'y', 'dy', 'textLength', 'lengthAdjust', 'font-size', 'font-weight', 'text-anchor', 'font-family',
        'fill', 'id', 'role', 'class', 'xml:space'].includes(name) && !name.startsWith('data-') && !name.startsWith('aria-')) return false
      // Only canonical whitespace references can introduce class separators;
      // other escaped entities cannot spell letters or whitespace in "mono".
      if (name === 'class' && (!reserve(raw.length + 8) || raw.split(/(?:\s|&#(?:9|10|13);)+/).includes('mono'))) return false
      attributes[name] = raw
      cursor = attribute.lastIndex
    }
    const content = escapeXml(block.text), close = cursor + 1 + content.length
    if (!reserve(content.length * 2 + 16) || svg.slice(cursor + 1, close) !== content || svg.slice(close) !== '</text>'
      || attributes['data-prepared-text'] !== 'true' || attributes['data-font-metrics'] !== 'deterministic-fit'
      || attributes.lengthAdjust !== 'spacingAndGlyphs'
      || attributes['xml:space'] !== undefined && attributes['xml:space'] !== 'preserve') return false
    if (!reserve(block.text.length + 8) || /(?:^ | $| {2})/.test(block.text) && attributes['xml:space'] !== 'preserve') return false
    const expected: Record<string, string | undefined> = {
      x: formatSvgNumber(x as number), y: formatSvgNumber(y as number), 'font-size': formatSvgNumber(size as number),
      'font-weight': formatSvgNumber(weight as number), 'text-anchor': own(node, 'anchor') as string,
      dy, textLength: formatSvgNumber(block.width), 'font-family': block.fontFamily,
    }
    for (const [name, value] of Object.entries(expected)) {
      const served = attributes[name]
      if (!reserve(name.length + (value?.length ?? 0) + (served?.length ?? 0) + 4) || served !== value) return false
    }
    return true
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
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined
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
      if (!a || !b || !Object.hasOwn(a, 'value') || !Object.hasOwn(b, 'value') || a.enumerable !== b.enumerable || !same(a.value, b.value)) return false
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
          const geometry = marker.geometry
          if (geometry?.kind === 'circle' && marker.paint?.fill === 'none') hasRingConnector = true
          else if (geometry?.kind === 'compound' && reserve(8) && geometry.children.length === 2
            && geometry.children[0]?.kind === 'line' && geometry.children[1]?.kind === 'line') hasRingConnector = true
        }
        reference(node.markers.start)
        for (const marker of node.markers.mid) { if (!reserve(1)) break; reference(marker) }
        reference(node.markers.end)
      }
      if (node.kind === 'shape' && reserve(4)) {
        const geometry = ownValue(node, 'geometry')
        if (geometry && typeof geometry === 'object' && ownValue(geometry, 'kind') === 'compound' && reserve(32)) {
          const children = ownValue(geometry, 'children')
          if (Array.isArray(children) && ownValue(children, 'length') === 5
            && ['rect', 'line', 'line', 'ellipse', 'ellipse'].every((kind, index) => {
              const child = ownValue(children, String(index))
              return !!child && typeof child === 'object' && ownValue(child, 'kind') === kind
            })) hasRingConnector = true
        }
      }
      // Text can precede the first eligible body. Retain its actual write,
      // but scan it only if this transaction enters the new proof domain.
      return node.kind === 'text' || hasRingConnector && node.kind !== 'document' && node.kind !== 'group'
    },
    /** Observe only an admitted owned leaf's actual write. The writer's
     * private receipt closes its structure and actual transform emission;
     * it grants no geometry authority. A later leaf can activate this domain. */
    leaf(node: SceneNode, svg: string): void {
      if (!reserve(2)) return
      if (node.kind === 'text') texts.push({ node, svg })
      else if (node.kind !== 'document' && node.kind !== 'group') leaves.push({ node, svg })
    },
    invalidateFractionalCircle(): void { fractionalCircleContext = false },
    group(shell: Extract<SceneNode, { kind: 'group' }>): void {
      if (reserve(2)) groups.push(shell)
    },
    /** Native already owns this immutable shell. Perform its eager checks
     * once, retaining fresh lexical data privately for the final context. */
    nativeGroup(shell: Extract<SceneNode, { kind: 'group' }>): { readonly uncertain: boolean; readonly matrix: AffineMatrix | undefined } | undefined {
      if (!reserve(2)) return undefined
      groups.push(shell)
      hasNativeGroups = true
      if (!reserve(4)) return undefined
      const open = Object.getOwnPropertyDescriptor(shell, 'open')
      const pinned = !!open && Object.hasOwn(open, 'value') && typeof open.value === 'string' && !open.writable && !open.configurable && !Object.isExtensible(shell)
      const svg = pinned ? open.value as string : shell.open
      if (!reserve(svg.length * 8 + 28)) return undefined
      const tags = scanSvgStartTagsFresh(svg), tag = tags[0]
      const result = (invalid: boolean, matrix: AffineMatrix | undefined) => Object.freeze(Object.assign(Object.create(null), { uncertain: invalid, matrix }))
      if (!tag || tag.name !== 'g') return result(true, undefined)
      const opacity = decodedSvgAttributeValue(tag, 'opacity')
      const invalidPaint = opacity !== shell.paint?.opacity || shell.paint?.fill !== undefined || decodedSvgAttributeValue(tag, 'style') !== undefined
      const transform = decodedSvgAttributeValue(tag, 'transform')
      const matrix = transform === undefined ? undefined : parseSvgTransform(transform)
      const invalid = invalidPaint || transform !== undefined && !matrix
      const frozenMatrix = matrix && Object.freeze(matrix)
      // Only an own pinned string can bind retained tokens to later checks.
      // Foreign/mutable records keep their original deferred context path.
      if (!invalid && pinned) {
        nativeGroups.set(shell, { svg, tags, opacity, transform, matrix: frozenMatrix })
      }
      return result(invalid, frozenMatrix)
    },
    finish(header: Header): { readonly uncertain: boolean; readonly fractionalCircleContext: boolean; readonly resolveColor: EmissionColorResolver | undefined } {
      if (finished) return Object.freeze({ uncertain: true, fractionalCircleContext: false, resolveColor: undefined })
      // This new obligation belongs to actual marker-bearing occurrences.
      // Other charts retain their existing proof scope; this is not evidence
      // that their unrelated styles, resources or responsive units are closed.
      if (!hasMarkedConnector) {
        finished = true
        return Object.freeze({ uncertain: false, fractionalCircleContext: false, resolveColor: undefined })
      }
      const font = ownValue(header.colors, 'font')
      if (!reserve(typeof font === 'string' ? font.length * 4 + 16 : 16)) {
        finished = true
        return Object.freeze({ uncertain: true, fractionalCircleContext: false, resolveColor: undefined })
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
        let retained: NativeGroup | undefined
        if (hasNativeGroups) {
          if (!reserve(2)) break
          retained = nativeGroups.get(shell)
        }
        const svg = retained ? retained.svg : shell.open
        if (!reserve((retained ? 0 : svg.length * 8) + 64)) break
        const tags = retained ? retained.tags : scanSvgStartTags(svg), tag = tags[0]
        if (retained && tag) {
          // The removed pass included these remaining variable checks too.
          // Pay their actual attribute queries, name grammar and value scans;
          // Native's opacity/style/transform decoding and matrix are reused.
          if (!reserve(tag.attributes.length * 20 + 8)) break
          let paid = true
          for (const attribute of tag.attributes) {
            if (!reserve(attribute.name.length * 4 + 8
              + (attribute.name === 'fill' || attribute.name === 'class' ? attribute.value.length * 8 + 4
                : attribute.name === 'transform' ? attribute.value.length * 8 + 4 : 0))) { paid = false; break }
          }
          if (!paid) break
        }
        // Only the new fractional proof needs a complete inert shell. Native
        // captures these fields; Scene's private hint gate runs before finish.
        // Generic/default Scene writes never set hasRingConnector.
        if (hasRingConnector && fractionalCircleContext) {
          if (!reserve(12)) break
          const open = Object.getOwnPropertyDescriptor(shell, 'open')
          const close = Object.getOwnPropertyDescriptor(shell, 'close')
          const join = Object.getOwnPropertyDescriptor(shell, 'join')
          if (!open || !Object.hasOwn(open, 'value') || typeof open.value !== 'string'
            || !close || !Object.hasOwn(close, 'value') || typeof close.value !== 'string'
            || !join || !Object.hasOwn(join, 'value') || typeof join.value !== 'string') fractionalCircleContext = false
          else {
            if (!reserve(svg.length * 2 + close.value.length + join.value.length + 16)) break
            if (open.value !== svg || tags.length !== 1 || !tag || tag.name !== 'g' || tag.selfClosing
              || /[^\t\n\r ]/.test(svg.slice(0, tag.start)) || /[^\t\n\r ]/.test(svg.slice(tag.end))
              || close.value !== '</g>' || /[^\t\n\r ]/.test(join.value)) fractionalCircleContext = false
          }
        }
        if (!tag || tag.name !== 'g' || (!retained && decodedSvgAttributeValue(tag, 'style') !== undefined)
          || (retained ? retained.opacity : decodedSvgAttributeValue(tag, 'opacity')) !== shell.paint?.opacity
          || decodedSvgAttributeValue(tag, 'fill') !== undefined || shell.paint?.fill !== undefined
          || tag.attributes.some(attribute => attribute.name === 'id')
          || decodedSvgAttributeValue(tag, 'class')?.split(/\s+/).includes('mono')) uncertain = true
        if (!tag) continue
        const names = new Set<string>()
        for (const attribute of tag.attributes) {
          if (names.has(attribute.name) || !/^(?:class|data-[a-z0-9-]+|role|aria-[a-z]+|tabindex|pointer-events|transform|opacity)$/.test(attribute.name)) uncertain = true
          names.add(attribute.name)
        }
        const raw = retained ? retained.transform : decodedSvgAttributeValue(tag, 'transform')
        if (raw !== undefined) fractionalCircleContext = false
        if (raw === undefined) {
          if (shell.transform !== undefined) uncertain = true
        } else {
          const actual = retained ? retained.matrix : parseSvgTransform(raw), typed = shell.transform && transformMatrix(shell.transform)
          if (formatSvgNumericAttribute('transform', raw) !== raw || !actual || !typed
            || !actual.every((value, index) => Number.isFinite(value) && Number.isFinite(typed[index]) && value === typed[index])) uncertain = true
        }
      }
      if (hasRingConnector && fractionalCircleContext) for (const { node, svg } of leaves) {
        // Pay exact returned-string comparison and constant receipt access,
        // rather than reparsing every already-owned leaf's complete markup.
        if (!reserve(svg.length * 2 + 8)) { fractionalCircleContext = false; break }
        const actual = writtenLeafContextOf(node, svg)
        if (!actual || actual.transformed) { fractionalCircleContext = false; break }
      }
      if (hasRingConnector && fractionalCircleContext) for (const text of texts) {
        if (!ringTextWrite(text.node, text.svg)) { fractionalCircleContext = false; break }
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
        resolveColor })
    },
  }
}
