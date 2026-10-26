import type { MeaningExpectation, PaintExpectation } from './meaning.ts'

export interface PaintCheck { criterion: string; status: 'passed' | 'failed' | 'unavailable'; expected: unknown; actual: unknown; scope: string }
export interface PaintEvidence { checks: PaintCheck[]; complete: boolean; passed: boolean; nodes: unknown[]; connections: unknown[]; viewBox: string | null }
export interface PaintInput { family: string; expected: MeaningExpectation; paint?: PaintExpectation }

/** The authored request fixes the denominator before any renderer runs. */
export function plannedPaintCriteria(input: PaintInput): string[] {
  return ['svg-root', 'svg-unique-ids', 'canvas', 'visible-authored-labels', 'labels-within-canvas', 'unclipped-authored-labels', 'visible-ink', 'paint-opacity-and-color',
    ...(input.paint?.images?.length ? ['embedded-images'] : []),
    ...(input.paint?.fontSize !== undefined ? ['computed-authored-font-size'] : []),
    ...(input.expected.nodes?.length ? ['painted-node-ownership'] : []),
    ...(input.expected.edges !== undefined ? ['painted-relationships'] : []),
    ...(input.expected.edges?.some(edge => edge.label) ? ['painted-relationship-label-counts', 'painted-relationship-label-ownership'] : []),
    ...(input.expected.edges?.some(edge => edge.startMarker !== undefined || edge.endMarker !== undefined) ? ['painted-relationship-markers'] : []),
    ...(input.family === 'er' && input.expected.facts?.cardinalities ? ['painted-cardinality-decorations'] : []),
    ...(input.expected.groups ?? []).map(group => 'painted-group:' + group.id)]
}

/** Runs in the actual browser after mounting the returned SVG. All geometry is
 * measured from this implementation's ink; Mermaid coordinates are no oracle. */
export async function inspectFidelityPaint(input: PaintInput): Promise<PaintEvidence> {
  const checks: PaintCheck[] = []
  const check = (criterion: string, expected: unknown, actual: unknown, passed: boolean | null, scope: string) => checks.push({ criterion, expected, actual, status: passed === null ? 'unavailable' : passed ? 'passed' : 'failed', scope })
  const svg = document.querySelector('svg')
  if (!svg) return { checks: [{ criterion: 'svg-root', status: 'failed', expected: 'mounted SVG', actual: null, scope: 'Actual public SVG result; remaining planned paint evidence is unavailable' }], complete: false, passed: false, nodes: [], connections: [], viewBox: null }
  check('svg-root', 'mounted SVG', 'svg', true, 'Actual public SVG result')
  const ids = [...(svg.id ? [svg.id] : []), ...[...svg.querySelectorAll('[id]')].map(element => element.id)]
  check('svg-unique-ids', ids.length, new Set(ids).size, ids.length === new Set(ids).size, 'Duplicate SVG identities can change marker, clip and owned-label references')
  await document.fonts.ready
  const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim()
  const rect = (element: Element) => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }
  const labelBox = (element: Element) => { if (element.namespaceURI === 'http://www.w3.org/2000/svg') return rect(element); const range = document.createRange(); range.selectNodeContents(element); const b = range.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }
  type Box = ReturnType<typeof rect>
  const center = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
  const contains = (outer: Box, inner: Box, epsilon = 1.5) => inner.x >= outer.x - epsilon && inner.y >= outer.y - epsilon && inner.x + inner.width <= outer.x + outer.width + epsilon && inner.y + inner.height <= outer.y + outer.height + epsilon
  const colorCanvas = document.createElement('canvas').getContext('2d')!
  const colors = new Map<string, number | null>()
  const unknownPaint = new Set<string>()
  const colorAlpha = (color: string): number | null => {
    if (['none', 'transparent'].includes(color)) return 0
    if (/url\(|context-|var\(/.test(color)) { unknownPaint.add(color); return null }
    if (colors.has(color)) return colors.get(color)!
    colorCanvas.clearRect(0, 0, 1, 1); colorCanvas.fillStyle = color; colorCanvas.fillRect(0, 0, 1, 1)
    const alpha = colorCanvas.getImageData(0, 0, 1, 1).data[3]! / 255; colors.set(color, alpha); return alpha
  }
  const visible = (element: Element, definitions = false) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if ((!definitions && ['defs', 'marker', 'clipPath', 'mask', 'symbol'].includes(current.localName)) || ['none'].includes(style.display) || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return false
      if (/opacity\(\s*0(?:\.0+)?%?\s*\)/.test(style.filter)) return false
      if (style.filter && style.filter !== 'none') unknownPaint.add('filter:' + style.filter)
      if (style.mixBlendMode && style.mixBlendMode !== 'normal') unknownPaint.add('blend:' + style.mixBlendMode)
      if (current === svg) break
    }
    if (element.localName === 'image') return true
    const style = getComputedStyle(element)
    const fill = colorAlpha(style.fill), stroke = colorAlpha(style.stroke)
    const fillVisible = element.localName !== 'line' && (fill === null || fill * Number(style.fillOpacity) > 0)
    const strokeVisible = stroke === null || stroke * Number(style.strokeOpacity) > 0 && Number.parseFloat(style.strokeWidth) > 0
    if (element.namespaceURI !== 'http://www.w3.org/2000/svg') { const color = colorAlpha(style.color); return color === null || color > 0 }
    return (!['text', 'tspan'].includes(element.localName) || Number.parseFloat(style.fontSize) > 0) && (fillVisible || strokeVisible)
  }
  const rootBox = rect(svg)
  check('canvas', 'positive finite rendered canvas', rootBox, [rootBox.x, rootBox.y, rootBox.width, rootBox.height].every(Number.isFinite) && rootBox.width > 0 && rootBox.height > 0, 'Actual browser viewport of the returned SVG')
  const labelText = (element: Element): string => {
    if (element.namespaceURI !== 'http://www.w3.org/2000/svg') return (element as HTMLElement).innerText ?? element.textContent ?? ''
    let result = '', previous: DOMRect | undefined
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { result += child.textContent ?? ''; const range = document.createRange(); range.selectNodeContents(child); const box = range.getBoundingClientRect(); if (box.width && box.height) previous = box; continue }
      if (!(child instanceof Element)) continue
      const box = child.getBoundingClientRect()
      if (previous && Math.abs(box.y - previous.y) > Math.max(1, Math.min(box.height, previous.height) * .4)) result += ' '
      result += labelText(child); previous = box
    }
    return result
  }
  const labelElements = [...svg.querySelectorAll('text,foreignObject *')].filter(element => normalize(labelText(element)) && (element.namespaceURI === 'http://www.w3.org/2000/svg' ? element.localName === 'text' : ![...element.children].some(child => normalize(labelText(child)) === normalize(labelText(element)))))
  const matches = (label: string) => {
    const exact = labelElements.filter(element => normalize(labelText(element)) === normalize(label))
    if (exact.length) return exact
    const token = normalize(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp('(?<![\\p{L}\\p{N}_])' + token + '(?![\\p{L}\\p{N}_])', 'u')
    return labelElements.filter(element => pattern.test(normalize(labelText(element))))
  }
  const visibleMatches = (label: string) => matches(label).filter(element => visible(element) && labelBox(element).width > 0 && labelBox(element).height > 0)
  const labelResults = [...new Set(input.expected.labels.filter(Boolean))].map(label => {
    const elements = visibleMatches(label)
    return { label, count: elements.length, boxes: elements.map(labelBox), inCanvas: elements.length > 0 && elements.every(element => contains(rootBox, labelBox(element))) }
  })
  const imageBackedLabels = labelElements.length === 0 && !!svg.querySelector('image')
  check('visible-authored-labels', input.expected.labels, labelResults.map(item => ({ label: item.label, count: item.count })), imageBackedLabels ? null : labelResults.every(item => item.count > 0), imageBackedLabels ? 'Image-backed text needs reviewed image/OCR evidence, not a missing-label verdict' : 'Computed visibility and nonzero browser text bounds; metadata/title/defs text earns no credit')
  check('labels-within-canvas', 'every authored label fits the canvas', labelResults.filter(item => !item.inCanvas), imageBackedLabels ? null : labelResults.every(item => item.inCanvas), 'Actual rendered label bounds, with 1.5 CSS-pixel serialization tolerance')
  const clipped: string[] = []
  let unknownClipping = false
  for (const label of input.expected.labels.filter(Boolean)) for (const element of visibleMatches(label)) {
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      const outer = rect(parent), ink = labelBox(element)
      if (['hidden', 'clip'].includes(style.overflowX) && (ink.x < outer.x - 1.5 || ink.x + ink.width > outer.x + outer.width + 1.5) || ['hidden', 'clip'].includes(style.overflowY) && (ink.y < outer.y - 1.5 || ink.y + ink.height > outer.y + outer.height + 1.5)) clipped.push(label)
      if (style.clip && style.clip !== 'auto') { unknownClipping = true; check('legacy-clip:' + label, 'label survives legacy CSS clipping', style.clip, null, 'Legacy CSS clip rectangles need a reviewed projection') }
      const clip = style.clipPath
      if (clip && clip !== 'none') {
        const id = /#([^\s)"']+)/.exec(clip)?.[1], clipElement = id ? document.getElementById(decodeURIComponent(id)) : null
        const shapes = clipElement ? [...clipElement.children] : []
        const shape = shapes.length === 1 && ['rect', 'circle', 'ellipse'].includes(shapes[0]!.localName) ? shapes[0] as SVGGeometryElement : undefined
        const matrix = (parent as SVGGraphicsElement).getScreenCTM?.()
        if (shape && matrix && clipElement?.getAttribute('clipPathUnits') !== 'objectBoundingBox' && !shape.hasAttribute('transform') && !clipElement?.hasAttribute('transform')) {
          const box = labelBox(element), inverse = matrix.inverse(), points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
          if (!points.every(([x, y]) => shape.isPointInFill(new DOMPoint(x, y).matrixTransform(inverse)))) clipped.push(label)
        } else { unknownClipping = true; check('clip-path:' + label, 'label remains inside the actual clipping path', clip, null, 'Complex or object-bounding-box clipping requires a reviewed projection; no paint-complete credit') }
      }
      if (style.maskImage && style.maskImage !== 'none') { unknownClipping = true; check('mask:' + label, 'label survives its actual mask', style.maskImage, null, 'Mask alpha is not inferred from a positive text bounding box') }
      if (parent === svg) break
    }
  }
  check('unclipped-authored-labels', [], clipped, clipped.length ? false : unknownClipping ? null : true, 'Actual self/ancestor clipping and overflow; unprojected masks/clip paths remain unavailable')
  if (input.paint?.fontSize !== undefined) {
    const sizes = input.expected.labels.filter(Boolean).map(label => ({ label, values: visibleMatches(label).flatMap(element => {
      const descendants = [...element.querySelectorAll('tspan,span,p')].filter(child => normalize(labelText(child)) && visible(child))
      return (descendants.length ? descendants : [element]).map(child => Number.parseFloat(getComputedStyle(child).fontSize))
    }) }))
    check('computed-authored-font-size', input.paint.fontSize, sizes, sizes.every(item => item.values.length > 0 && item.values.every(size => Number.isFinite(size) && Math.abs(size - input.paint!.fontSize!) <= .1)), 'Every authored text run must receive the requested public font size; one unrelated matching label earns no credit')
  }
  const images: Array<{ href: string; loaded: boolean; visible: boolean; clipUnknown: boolean; box: Box; error?: string }> = []
  for (const element of svg.querySelectorAll('image')) {
    const href = element.getAttribute('href') ?? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? ''
    const image = new Image(); image.src = href
    let clipUnknown = false
    for (let current: Element | null = element; current; current = current.parentElement) { const style = getComputedStyle(current); if (style.clipPath && style.clipPath !== 'none' || style.maskImage && style.maskImage !== 'none') clipUnknown = true; if (current === svg) break }
    const box = rect(element), painted = visible(element) && box.width > 0 && box.height > 0 && contains(rootBox, box)
    try { await Promise.race([image.decode(), new Promise((_, reject) => setTimeout(() => reject(Error('Image decode timeout')), 5000))]); images.push({ href, loaded: true, visible: painted, clipUnknown, box }) }
    catch (error) { images.push({ href, loaded: false, visible: painted, clipUnknown, box, error: String(error) }) }
  }
  if (input.paint?.images?.length) {
    const retained = input.paint.images.every(requested => images.filter(image => image.href === requested.href).length === requested.count)
    check('embedded-images', input.paint.images, images, !retained || images.some(image => !image.loaded || !image.visible) ? false : images.some(image => image.clipUnknown) ? null : true, 'Every independently declared image must be emitted with its authored asset, decoded and visible. Missing images are failures; unprojected image masks/clips stay unavailable.')
  } else if (images.length) check('emitted-image-decoding', 'all unexpected emitted images decode', images, images.every(item => item.loaded && item.visible), 'Diagnostic only: decoding emitted images does not prove the renderer retained an author-requested image')
  const geometry = [...svg.querySelectorAll('path,line,rect,circle,ellipse,polygon,polyline')].filter(element => visible(element) && rect(element).width + rect(element).height > 0)
  check('visible-ink', 'nonempty visible diagram geometry', geometry.length, geometry.length > 0 ? true : svg.querySelector('use,foreignObject,image') ? null : false, 'Visible geometric elements; unprojected use/HTML/image-only ink remains unavailable, not a drawing defect')
  const ownedBox = (element: Element): { owner: Element; shape: Element; box: Box; outlines?: Element[] } | undefined => {
    const point = center(rect(element))
    for (let current: Element | null = element.parentElement; current && current !== svg; current = current.parentElement) {
      const shapes = [...current.querySelectorAll('rect,circle,ellipse,polygon,path')].filter(child => visible(child))
      const candidates = shapes.filter(child => { const box = rect(child); return box.width > 0 && box.height > 0 && contains(box, { ...point, width: 0, height: 0 }, 2) })
      // A compartment header is ink inside its node, not the node boundary.
      const shape = candidates.find(candidate => candidates.every(other => contains(rect(candidate), rect(other), 1)))
      if (shape) {
        const body = current.matches('.c4-person') ? current.querySelector(':scope > g.basic.label-container') : null
        const parts = body ? [...body.children].filter(child => ['rect', 'circle', 'ellipse'].includes(child.localName) && visible(child) && rect(child).width > 0 && rect(child).height > 0) : []
        if (parts.length > 1) { const boxes = parts.map(rect), x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y)); return { owner: current, shape, outlines: parts, box: { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y } } }
        return { owner: current, shape, box: rect(shape) }
      }
    }
    return undefined
  }
  const anchors = new Map<string, { id: string; label: string; owner: Element; shape: Element; box: Box; outlines?: Element[] }>()
  const nodeLabelElements = new Set<Element>()
  const missingNodes: string[] = []
  for (const node of input.expected.nodes ?? []) {
    if (!node.label) { missingNodes.push(node.id); continue }
    let elements = visibleMatches(node.label)
    if (input.family === 'sequence') elements = elements.sort((a, b) => rect(a).y - rect(b).y).slice(0, 1)
    const owners = new Map<Element, { owner: Element; shape: Element; box: Box }>()
    for (const element of elements) { const owned = ownedBox(element); if (owned) owners.set(owned.owner, owned) }
    if (owners.size === 1) { const owned = [...owners.values()][0]!; anchors.set(node.id, { ...node, ...owned }); elements.forEach(element => nodeLabelElements.add(element)) }
    else missingNodes.push(node.id)
  }
  if (input.expected.nodes?.length) check('painted-node-ownership', input.expected.nodes.map(node => node.id), [...anchors.keys()], missingNodes.length ? null : true, missingNodes.length ? 'Ambiguous or absent label-to-shape ownership: ' + missingNodes.join(', ') : 'Unique actual label-to-shape ownership, independently of native model identity')
  const distanceToBox = (point: { x: number; y: number }, box: Box) => {
    const dx = Math.max(box.x - point.x, 0, point.x - box.x - box.width), dy = Math.max(box.y - point.y, 0, point.y - box.y - box.height)
    const inside = dx === 0 && dy === 0
    return inside ? Math.min(point.x - box.x, box.x + box.width - point.x, point.y - box.y, box.y + box.height - point.y) : Math.hypot(dx, dy)
  }
  const pointFor = (element: Element, end: boolean) => {
    const item = element as SVGGeometryElement
    if (typeof item.getTotalLength !== 'function' || typeof item.getPointAtLength !== 'function') return undefined
    const matrix = item.getScreenCTM(), length = item.getTotalLength()
    if (!matrix || !Number.isFinite(length) || length <= 0) return undefined
    const point = item.getPointAtLength(end ? length : 0).matrixTransform(matrix)
    return { x: point.x, y: point.y }
  }
  type Point = { x: number; y: number }
  const sampled = new Map<Element, Point[]>()
  const pointsOn = (element: Element): Point[] => {
    if (sampled.has(element)) return sampled.get(element)!
    const shape = element as SVGGeometryElement, matrix = shape.getScreenCTM?.(), length = shape.getTotalLength?.()
    if (!matrix || !Number.isFinite(length) || length <= 0) return []
    const count = Math.max(2, Math.min(3000, Math.ceil(length)))
    const points = Array.from({ length: count + 1 }, (_, i) => { const point = shape.getPointAtLength(length * i / count).matrixTransform(matrix); return { x: point.x, y: point.y } })
    // SVG fills implicitly close a single open subpath even when its stroke
    // does not. A filled node's actual outline includes that closing edge.
    if (element.localName === 'path' && getComputedStyle(element).fill !== 'none' && (element.getAttribute('d')?.match(/[Mm]/g)?.length ?? 0) === 1) { const first = points[0]!, last = points.at(-1)!, gap = Math.hypot(first.x - last.x, first.y - last.y), steps = Math.min(3000, Math.ceil(gap)); for (let i = 1; i <= steps; i++) points.push({ x: last.x + (first.x - last.x) * i / steps, y: last.y + (first.y - last.y) * i / steps }) }
    sampled.set(element, points); return points
  }
  const distanceToInk = (point: Point, element: Element) => Math.min(...pointsOn(element).map(item => Math.hypot(point.x - item.x, point.y - item.y)))
  const distanceToNode = (point: Point, node: { shape: Element; outlines?: Element[] }) => Math.min(...(node.outlines ?? [node.shape]).map(shape => distanceToInk(point, shape)))
  let ambiguousEndpoints = false
  const bind = (point: Point, clearance = 2) => {
    const candidates = [...anchors.values()].map(node => {
      if (input.family !== 'sequence') return { id: node.id, distance: distanceToNode(point, node) }
      const lifelines = geometry.filter(element => {
        const start = pointFor(element, false), end = pointFor(element, true)
        return start && end && Math.abs(start.x - end.x) <= 1 && Math.abs(start.x - center(node.box).x) <= 2 && Math.min(start.y, end.y) <= node.box.y + node.box.height + 2 && Math.max(start.y, end.y) >= point.y && Math.min(start.y, end.y) <= point.y
      })
      return { id: node.id, distance: Math.min(...lifelines.map(element => distanceToInk(point, element))) }
    }).filter(item => item.distance <= Math.max(2, clearance)).sort((a, b) => a.distance - b.distance)
    if (candidates.length > 1 && candidates[1]!.distance - candidates[0]!.distance <= 2) { ambiguousEndpoints = true; return undefined }
    return candidates[0]?.id
  }
  const vertices = (element: Element): Point[] | undefined => {
    if (['polygon', 'polyline'].includes(element.localName)) return [...(element as SVGPolygonElement).points].map(point => ({ x: point.x, y: point.y }))
    if (element.localName !== 'path') return undefined
    const d = element.getAttribute('d') ?? ''
    if (/[A-Za-z]/.test(d.replace(/[MLHVZmlhvz]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi, ''))) return undefined
    const tokens = d.match(/[MLHVZmlhvz]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [], points: Point[] = []
    let index = 0, command = '', current = { x: 0, y: 0 }
    while (index < tokens.length) {
      if (/^[A-Za-z]$/.test(tokens[index]!)) command = tokens[index++]!
      const kind = command.toUpperCase(), relative = command !== kind
      if (kind === 'Z') { command = ''; continue }
      if (!['M', 'L', 'H', 'V'].includes(kind)) return undefined
      const first = Number(tokens[index++]), second = kind === 'M' || kind === 'L' ? Number(tokens[index++]) : 0
      if (!Number.isFinite(first) || !Number.isFinite(second)) return undefined
      current = kind === 'H' ? { x: first + (relative ? current.x : 0), y: current.y } : kind === 'V' ? { x: current.x, y: first + (relative ? current.y : 0) } : { x: first + (relative ? current.x : 0), y: second + (relative ? current.y : 0) }
      points.push(current); if (kind === 'M') command = relative ? 'l' : 'L'
    }
    return points
  }
  const concaveArrowTip = (points: Point[]) => {
    if (points.length !== 4) return undefined
    const turns = points.map((current, i) => { const previous = points[(i + 3) % 4]!, next = points[(i + 1) % 4]!; return Math.sign((current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x)) })
    const positive = turns.filter(turn => turn > 0).length, negative = turns.filter(turn => turn < 0).length
    if (!(positive === 1 && negative === 3 || negative === 1 && positive === 3)) return undefined
    return points[(turns.findIndex(turn => turn === (positive === 1 ? 1 : -1)) + 2) % 4]
  }
  const shapeKind = (element: Element): string => {
    if (element.localName === 'circle') return 'circle'
    const points = vertices(element)
    if (!points) return 'unknown'
    const style = getComputedStyle(element), closed = element.localName === 'polygon' || /z\s*$/i.test(element.getAttribute('d') ?? '')
    const filled = style.fill !== 'none' && Number(style.fillOpacity) > 0 && colorAlpha(style.fill) !== 0
    if (closed && concaveArrowTip(points)) return 'arrow'
    if (points.length === 3 && Math.abs((points[1]!.x - points[0]!.x) * (points[2]!.y - points[0]!.y) - (points[1]!.y - points[0]!.y) * (points[2]!.x - points[0]!.x)) > 1e-5) return !closed || filled && (style.stroke === 'none' || style.fill === style.stroke) ? 'arrow' : 'triangle'
    if (points.length === 4 && closed && new Set(points.map(point => point.x)).size === 3 && new Set(points.map(point => point.y)).size === 3) return filled && (style.stroke === 'none' || style.fill === style.stroke) ? 'diamond' : 'open-diamond'
    return 'decoration'
  }
  const pointedVertex = (points: Point[]): Point | undefined => {
    if (points.length === 4) return concaveArrowTip(points)
    if (points.length !== 3) return undefined
    const axial = points.filter((_, i) => { const a = points[(i + 1) % 3]!, b = points[(i + 2) % 3]!; return Math.abs(a.x - b.x) < 1e-5 || Math.abs(a.y - b.y) < 1e-5 })
    if (axial.length === 1) return axial[0]
    const scored = points.map((point, index) => { const a = points[(index + 1) % 3]!, b = points[(index + 2) % 3]!, base = Math.hypot(a.x - b.x, a.y - b.y); return { point, score: Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / (base * base) } }).sort((a, b) => b.score - a.score)
    return scored[0]!.score - scored[1]!.score > .03 ? scored[0]!.point : undefined
  }
  const tangentAt = (element: Element, side: 'start' | 'end') => {
    const item = element as SVGGeometryElement, matrix = item.getScreenCTM(), length = item.getTotalLength(), offset = Math.min(1, length / 2)
    if (!matrix || !offset) return undefined
    const a = item.getPointAtLength(side === 'start' ? 0 : length - offset), b = item.getPointAtLength(side === 'start' ? offset : length)
    const first = a.matrixTransform(matrix), last = b.matrixTransform(matrix), magnitude = Math.hypot(last.x - first.x, last.y - first.y), localMagnitude = Math.hypot(b.x - a.x, b.y - a.y)
    return magnitude && localMagnitude ? { x: (last.x - first.x) / magnitude, y: (last.y - first.y) / magnitude, scale: magnitude / localMagnitude } : undefined
  }
  type Marker = { kind: string; point?: Point; unknown?: string; orientation?: boolean; clearance?: number }
  const markerFor = (element: Element, side: 'start' | 'end', endpoint: Point): Marker => {
    const setting = getComputedStyle(element)[side === 'start' ? 'markerStart' : 'markerEnd']
    if (!setting || setting === 'none') return { kind: 'none', point: endpoint }
    const id = /#([^\s)"']+)/.exec(setting)?.[1], marker = id ? document.getElementById(decodeURIComponent(id)) : null
    if (!marker || marker.localName !== 'marker') return { kind: 'none', point: endpoint }
    const shapes = [...marker.querySelectorAll('path,polygon,polyline,circle,line')].filter(shape => visible(shape, true))
    if (!shapes.length) return { kind: 'none', point: endpoint }
    if (input.family === 'er') return { kind: 'decoration', point: endpoint, clearance: Math.min(8, Number(marker.getAttribute('markerWidth') ?? 3) / 2) }
    if (shapes.length !== 1 || shapes[0]!.hasAttribute('transform')) return { kind: 'unknown', point: endpoint, unknown: 'Compound or transformed marker needs a reviewed geometry projection' }
    const shape = shapes[0]!, kind = shapeKind(shape), polygon = vertices(shape), owner = marker as unknown as SVGMarkerElement
    if (!polygon || kind === 'unknown' || !['auto', 'auto-start-reverse', null].includes(marker.getAttribute('orient'))) return { kind, point: endpoint, unknown: 'Marker tip/rotation projection is unavailable' }
    const reference = { x: owner.refX.baseVal.value, y: owner.refY.baseVal.value }
    const directional = ['arrow', 'triangle'].includes(kind)
    const tangent = tangentAt(element, side)
    if (!tangent) return { kind, point: endpoint, unknown: 'No stable endpoint tangent for marker placement' }
    const box = owner.viewBox.baseVal, viewScale = box.width && box.height ? Math.min(owner.markerWidth.baseVal.value / box.width, owner.markerHeight.baseVal.value / box.height) : 1
    const units = marker.getAttribute('markerUnits') === 'userSpaceOnUse' ? 1 : Number.parseFloat(getComputedStyle(element).strokeWidth)
    const reverse = side === 'start' && marker.getAttribute('orient') === 'auto-start-reverse' ? -1 : 1
    const projectVertex = (p: Point) => { const dx = (p.x - reference.x) * viewScale * units * tangent.scale * reverse, dy = (p.y - reference.y) * viewScale * units * tangent.scale * reverse; return { x: endpoint.x + tangent.x * dx - tangent.y * dy, y: endpoint.y + tangent.y * dx + tangent.x * dy } }
    const tip = directional ? pointedVertex(polygon) : [...polygon].sort((a, b) => Math.min(...[...anchors.values()].map(node => distanceToNode(projectVertex(a), node))) - Math.min(...[...anchors.values()].map(node => distanceToNode(projectVertex(b), node))))[0]
    if (!tip) return { kind, point: endpoint, unknown: 'No reviewed arrow tip for marker placement' }
    const dx = (tip.x - reference.x) * viewScale * units * tangent.scale * reverse, dy = (tip.y - reference.y) * viewScale * units * tangent.scale * reverse
    const others = polygon.filter(point => point !== tip), base = { x: others.reduce((sum, point) => sum + point.x, 0) / others.length, y: others.reduce((sum, point) => sum + point.y, 0) / others.length }
    const size = Math.max(...polygon.map(point => Math.hypot(point.x - tip.x, point.y - tip.y))) * viewScale * units * tangent.scale
    return { kind, point: { x: endpoint.x + tangent.x * dx - tangent.y * dy, y: endpoint.y + tangent.y * dx + tangent.x * dy }, clearance: Math.min(8, size / 2), ...(directional ? { orientation: (tip.x - base.x) * reverse * (side === 'start' ? -1 : 1) > 0 } : {}) }
  }
  const inlineMarker = (element: Element, side: 'start' | 'end', endpoint: Point, other: Point): Marker => {
    const owner = element.closest('g.pele-edge,g.edge,[data-edge-id]')
    if (!owner) return { kind: 'none', point: endpoint }
    const shapes = [...owner.querySelectorAll('.pele-marker,.arrowhead,[data-role="marker"]')].filter(shape => visible(shape) && shape !== element && Math.hypot(center(rect(shape)).x - endpoint.x, center(rect(shape)).y - endpoint.y) < Math.hypot(center(rect(shape)).x - other.x, center(rect(shape)).y - other.y))
    if (!shapes.length) return { kind: 'none', point: endpoint }
    if (input.family === 'er') return { kind: 'decoration', point: endpoint, clearance: 4 }
    if (shapes.length !== 1) return { kind: 'unknown', point: endpoint, unknown: 'Compound inline decoration needs a reviewed projection' }
    const shape = shapes[0]!, kind = shapeKind(shape), points = vertices(shape), matrix = (shape as SVGGraphicsElement).getScreenCTM()
    if (!points || !matrix) return { kind, point: endpoint, unknown: 'Inline marker tip projection is unavailable' }
    const screen = points.map(point => new DOMPoint(point.x, point.y).matrixTransform(matrix))
    if (['arrow', 'triangle'].includes(kind)) {
      const tip = pointedVertex(screen), tangent = tangentAt(element, side)
      if (!tip || !tangent) return { kind, point: endpoint, unknown: 'Inline arrow has no uniquely projected tip/orientation' }
      const rest = screen.filter(point => point !== tip), base = { x: rest.reduce((sum, point) => sum + point.x, 0) / rest.length, y: rest.reduce((sum, point) => sum + point.y, 0) / rest.length }
      return { kind, point: tip, clearance: Math.min(8, Math.max(...screen.map(point => Math.hypot(point.x - tip.x, point.y - tip.y))) / 2), orientation: ((tip.x - base.x) * tangent.x + (tip.y - base.y) * tangent.y) * (side === 'start' ? -1 : 1) > 0 }
    }
    const candidates = screen.map(point => ({ point, distance: Math.min(...[...anchors.values()].map(node => distanceToNode(point, node))) })).sort((a, b) => a.distance - b.distance)
    if (!candidates.length || candidates[0]!.distance > 2) return { kind, point: endpoint, unknown: 'No inline marker point is attached to an owned node boundary' }
    void side
    return { kind, point: candidates[0]!.point }
  }
  const connections: Array<{ source: string; target: string; directed: boolean; startMarker: string; endMarker: string; element: Element }> = []
  let unresolvedProjection = false
  const edgeSelector = '.edge path,.edgePath path,.edge-path,.edge-paths path,.pele-edge path,path.flowchart-link,path.relation,path.relationshipLine,path.transition,path.em-relation,g.message line,g.message path,[data-relationship="sequence-message"],line.messageLine0,line.messageLine1,path.messageLine0,path.messageLine1,[data-edge-id],polyline.class-relationship,polyline.er-relationship'
  let paths = [...svg.querySelectorAll(edgeSelector)].filter(element => visible(element) && ['path', 'line', 'polyline'].includes(element.localName))
  if (!paths.length) paths = geometry.filter(element => ['path', 'line', 'polyline'].includes(element.localName) && ![...anchors.values()].some(node => node.owner.contains(element)))
  paths = paths.filter(element => !element.matches('.pele-marker,.arrowhead,[data-role="marker"]'))
  for (const element of paths) {
    const start = pointFor(element, false), end = pointFor(element, true)
    if (!start || !end) continue
    let first = markerFor(element, 'start', start), last = markerFor(element, 'end', end)
    if (first.kind === 'none') first = inlineMarker(element, 'start', start, end)
    if (last.kind === 'none') last = inlineMarker(element, 'end', end, start)
    if (first.orientation === false) first.kind = 'wrong-arrow-orientation'
    if (last.orientation === false) last.kind = 'wrong-arrow-orientation'
    if (first.unknown || last.unknown) unresolvedProjection = true
    const source = bind(first.point ?? start, first.clearance), target = bind(last.point ?? end, last.clearance)
    if (!source || !target) continue
    connections.push({ source, target, directed: [first.kind, last.kind].some(kind => ['arrow', 'triangle'].includes(kind)), startMarker: first.kind, endMarker: last.kind, element })
  }
  unresolvedProjection ||= ambiguousEndpoints
  const markerDirected = (kind: string) => ['arrow', 'triangle'].includes(kind)
  const pair = (source: string, target: string, directed: boolean, startMarker = 'none', endMarker = directed ? 'arrow' : 'none', decorations = false) => {
    const first = markerDirected(startMarker), last = markerDirected(endMarker)
    if (directed && first && !last) { [source, target] = [target, source]; [startMarker, endMarker] = [endMarker, startMarker] }
    else if ((!directed || first && last) && source > target) { [source, target] = [target, source]; [startMarker, endMarker] = [endMarker, startMarker] }
    return JSON.stringify([source, target, directed, ...(decorations ? [startMarker, endMarker] : [])])
  }
  const decorationExpected = input.expected.edges?.some(edge => edge.startMarker !== undefined || edge.endMarker !== undefined) ?? false
  const keyFor = (edge: { source: string; target: string; directed: boolean; startMarker?: string; endMarker?: string }, decorations = decorationExpected) => pair(edge.source, edge.target, edge.directed, edge.startMarker ?? 'none', edge.endMarker ?? (edge.directed ? 'arrow' : 'none'), decorations)
  if (input.expected.edges !== undefined) {
    const graphFamilies = ['flowchart', 'class', 'state', 'er', 'sequence', 'block', 'requirement', 'architecture', 'c4', 'eventmodeling']
    if (missingNodes.length || unresolvedProjection || !graphFamilies.includes(input.family)) check('painted-relationships', input.expected.edges, connections.map(({ element: _, ...edge }) => edge), null, 'This representation needs a reviewed endpoint/marker projection; no semantic paint credit from labels alone')
    else {
      const actual = connections.map(edge => keyFor(edge, false)).sort(), expected = input.expected.edges.map(edge => keyFor(edge, false)).sort()
      check('painted-relationships', expected, actual, JSON.stringify(expected) === JSON.stringify(actual), 'Owned outline/lifeline endpoint proximity and exact multiplicity. Clearance is at most max(2 CSS pixels, half the observed painted marker length), capped at 8; this is not a strict physical-touch certificate')
    }
    if (decorationExpected) {
      const actual = connections.map(edge => keyFor(edge)).sort(), expected = input.expected.edges.map(edge => keyFor(edge)).sort()
      check('painted-relationship-markers', expected, actual, missingNodes.length || unresolvedProjection ? null : JSON.stringify(expected) === JSON.stringify(actual), 'Actual triangle/arrow/diamond/circle glyph geometry and marker ownership; a decoration is not automatically a directed arrow')
    }
    const labels = input.expected.edges.filter(edge => edge.label).map(edge => edge.label!)
    const counts = new Map<string, number>()
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
    if (labels.length) {
      const matched = new Map<string, Element[]>([...counts.keys()].map(label => [label, visibleMatches(label).filter(element => !nodeLabelElements.has(element))]))
      check('painted-relationship-label-counts', Object.fromEntries(counts), Object.fromEntries([...matched].map(([label, elements]) => [label, elements.length])), [...counts].every(([label, count]) => matched.get(label)!.length === count), 'Each authored relationship label needs its own visible text occurrence, excluding actual node titles')
      const actualLabels: string[] = [], expectedLabels = input.expected.edges.filter(edge => edge.label).map(edge => JSON.stringify([keyFor(edge), normalize(edge.label!)])).sort()
      let ambiguous = false
      const identifiers = (element: Element) => { const values = new Set<string>(); for (let current: Element | null = element; current && current !== svg; current = current.parentElement) for (const name of ['id', 'data-id', 'data-edge-id']) { const id = current.getAttribute(name); if (id) values.add(id) } return values }
      const distance = (element: Element, connection: typeof connections[number]) => { const box = rect(element); return Math.min(...pointsOn(connection.element).map(point => Math.hypot(Math.max(box.x - point.x, 0, point.x - box.x - box.width), Math.max(box.y - point.y, 0, point.y - box.y - box.height)))) }
      for (const [label, elements] of matched) for (const element of elements) {
        const ranked = connections.map(connection => ({ connection, distance: distance(element, connection) })).sort((a, b) => a.distance - b.distance)
        const ids = identifiers(element), owned = ranked.filter(item => [...identifiers(item.connection.element)].some(id => ids.has(id)))
        const threshold = Math.max(6, rect(element).height * .75)
        const candidate = owned.length === 1 && owned[0]!.distance <= threshold && owned[0]!.distance <= (ranked[0]?.distance ?? Infinity) + 2 ? owned[0] : ranked[0] && ranked[0].distance <= threshold && (!ranked[1] || ranked[1].distance - ranked[0].distance > 2) ? ranked[0] : undefined
        if (!candidate) { ambiguous = true; continue }
        actualLabels.push(JSON.stringify([keyFor(candidate.connection), normalize(label)]))
      }
      actualLabels.sort()
      check('painted-relationship-label-ownership', expectedLabels, actualLabels, missingNodes.length || unresolvedProjection || ambiguous ? null : JSON.stringify(expectedLabels) === JSON.stringify(actualLabels), 'Visible label must belong to the corresponding actual route: unique geometry or matching public SVG edge identity plus spatial agreement; global text counts cannot bind labels')
    }
    if (input.family === 'er' && input.expected.facts?.cardinalities) check('painted-cardinality-decorations', input.expected.facts.cardinalities, connections.map(({ element: _, ...item }) => item), null, 'Owned endpoints are measured, but exact crow-foot/optional-circle combinations need a reviewed per-marker paint projection; native cardinalities alone earn no paint credit')
  }
  for (const group of input.expected.groups ?? []) {
    if (input.family === 'mindmap') { check('painted-group:' + group.id, group, null, null, 'Mindmap parent/child membership is a logical hierarchy, not an authored enclosing container; native membership is checked separately and connector ownership needs a reviewed paint projection'); continue }
    if (!group.label) { check('painted-group:' + group.id, group, null, null, 'Anonymous group needs a reviewed SVG identity projection'); continue }
    const owners = visibleMatches(group.label).map(ownedBox).filter((item): item is NonNullable<typeof item> => !!item)
    if (owners.length !== 1) { check('painted-group:' + group.id, group, null, null, 'Group-to-owned-container projection is ambiguous or missing'); continue }
    const descendantIds = (id: string, visiting: Set<string>): string[] => { if (visiting.has(id)) return []; const found = input.expected.groups?.find(candidate => candidate.id === id); return found ? found.members.flatMap(member => descendantIds(member, new Set([...visiting, id]))) : [id] }
    const members = descendantIds(group.id, new Set()), available = members.every(id => anchors.has(id))
    const outside = members.filter(id => anchors.has(id) && !contains(owners[0]!.box, anchors.get(id)!.box, 2))
    check('painted-group:' + group.id, members, outside, available ? outside.length === 0 : null, 'Authored descendant nodes fit their actual owned group boundary; immediate membership is checked independently in the native model')
  }
  check('paint-opacity-and-color', 'resolved visible paint colors/alpha', [...unknownPaint], unknownPaint.size ? null : true, 'Unresolved paint servers/context colors cannot silently earn a visible-ink or complete-style claim')
  return { checks, complete: checks.every(item => item.status !== 'unavailable'), passed: checks.length > 0 && checks.every(item => item.status === 'passed'), nodes: [...anchors.values()].map(({ owner: _, shape: __, outlines: ___, ...node }) => node), connections: connections.map(({ element: _, ...edge }) => edge), viewBox: svg.getAttribute('viewBox') }
}
