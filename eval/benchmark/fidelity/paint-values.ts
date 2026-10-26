import type { AuthoredFidelityCase, MeaningExpectation } from './meaning.ts'
import type { PaintCheck } from './paint.ts'

export function plannedQuantitativeCriteria(input: Pick<AuthoredFidelityCase, 'family' | 'expected'>): string[] {
  const facts = input.expected.facts ?? {}
  if (input.family === 'pie' && facts.slices) return ['painted-slice-weights']
  if (input.family === 'xychart' && facts.series) return ['painted-series-values']
  if (input.family === 'packet' && facts.fields) return ['painted-bit-field-spans']
  if (input.family === 'quadrant' && facts.points) return ['painted-quadrant-coordinates']
  if (input.family === 'radar' && facts.curves) return ['painted-radar-values']
  if (input.family === 'treemap' && facts.values) return ['painted-leaf-weights']
  if (input.family === 'sankey' && facts.links) return ['painted-link-weights']
  if (input.family === 'gantt' && facts.tasks) return ['painted-duration-ratios']
  if (input.family === 'journey' && Array.isArray(facts.tasks) && new Set((facts.tasks as { score: number }[]).map(task => task.score)).size > 1) return ['painted-score-order']
  return []
}

/** Browser-side quantitative checks use each chart's actual coordinate system
 * and independently authored values. No renderer supplies expected geometry. */
export function inspectQuantitativePaint(input: { family: string; expected: MeaningExpectation; source?: string; nodes?: { id: string; label: string; box: { x: number; y: number; width: number; height: number } }[] }): PaintCheck[] {
  const svg = document.querySelector('svg'), facts: any = input.expected.facts ?? {}, checks: PaintCheck[] = []
  if (!svg) return checks
  const add = (criterion: string, expected: unknown, actual: unknown, passed: boolean | null, scope: string) => checks.push({ criterion, expected, actual, status: passed === null ? 'unavailable' : passed ? 'passed' : 'failed', scope })
  const norm = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim()
  const uncertain = new Set<string>(), colorCanvas = document.createElement('canvas').getContext('2d')!
  const alpha = (color: string): number => { if (color === 'none' || color === 'transparent') return 0; if (/url\(/.test(color)) { const id = /#([^\s)"']+)/.exec(color)?.[1], gradient = id ? document.getElementById(decodeURIComponent(id)) : undefined, stops = gradient && ['linearGradient', 'radialGradient'].includes(gradient.localName) ? [...gradient.querySelectorAll('stop')] : []; if (stops.length && stops.every(stop => alpha(getComputedStyle(stop).stopColor) * Number(getComputedStyle(stop).stopOpacity) > 0)) return 1; uncertain.add('paint:' + color); return 1 }; if (/context-|var\(/.test(color)) { uncertain.add('paint:' + color); return 1 }; colorCanvas.clearRect(0, 0, 1, 1); colorCanvas.fillStyle = color; colorCanvas.fillRect(0, 0, 1, 1); return colorCanvas.getImageData(0, 0, 1, 1).data[3]! / 255 }
  const visible = (element: Element) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (['defs', 'marker', 'clipPath', 'mask'].includes(current.localName) || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      if (style.clipPath && style.clipPath !== 'none' || style.maskImage && style.maskImage !== 'none' || style.filter && style.filter !== 'none') uncertain.add('unprojected geometry clip/mask/filter')
      if (current === svg) break
    }
    const style = getComputedStyle(element)
    return alpha(style.fill) * Number(style.fillOpacity) > 0 || alpha(style.stroke) * Number(style.strokeOpacity) > 0 && Number.parseFloat(style.strokeWidth) > 0
  }
  const box = (element: Element) => { const value = element.getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height } }
  type Box = ReturnType<typeof box>
  const center = (value: Box) => ({ x: value.x + value.width / 2, y: value.y + value.height / 2 })
  const text = [...svg.querySelectorAll('text,tspan')].filter(element => visible(element) && ![...element.children].some(child => norm(child.textContent ?? '') === norm(element.textContent ?? '')))
  const label = (value: string) => { const exact = text.filter(element => norm(element.textContent ?? '') === norm(value)); if (exact.length === 1) return exact[0]; if (exact.length > 1) return undefined; const decorated = input.family === 'pie' ? text.filter(element => norm(element.textContent ?? '').replace(/\s+(?:\([-+\d.e]+%?\)|\[[-+\d.e]+\])$/, '') === norm(value)) : []; return decorated.length === 1 ? decorated[0] : undefined }
  const rectangles = [...svg.querySelectorAll('rect')].filter(element => visible(element) && box(element).width > 0 && box(element).height > 0)
  const owned = (value: string): Box | undefined => {
    const element = label(value)
    if (!element) return undefined
    for (let owner: Element | null = element.parentElement; owner && owner !== svg; owner = owner.parentElement) {
      const direct = [...owner.children].filter(child => child.localName === 'rect' && visible(child))
      if (direct.length === 1) return box(direct[0]!)
    }
    const point = center(box(element)), candidates = rectangles.filter(rectangle => { const b = box(rectangle); return point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height }).sort((a, b) => box(a).width * box(a).height - box(b).width * box(b).height)
    if (candidates[0]) return box(candidates[0])
    const near = rectangles.map(rectangle => { const r = box(rectangle); return { r, distance: Math.hypot(Math.max(r.x - point.x, 0, point.x - r.x - r.width), Math.max(r.y - point.y, 0, point.y - r.y - r.height)) } }).sort((a, b) => a.distance - b.distance)
    return near[0] && near[0].distance <= Math.max(box(element).width, box(element).height * 2) + 10 && (!near[1] || near[1].distance - near[0].distance > 2) ? near[0].r : undefined
  }
  const point = (element: SVGGraphicsElement, x: number, y: number) => { const matrix = element.getScreenCTM(); return matrix ? new DOMPoint(x, y).matrixTransform(matrix) : new DOMPoint(NaN, NaN) }
  const anchor = (element: Element) => { const item = element as SVGTextElement; return point(item, item.x?.baseVal.numberOfItems ? item.x.baseVal.getItem(0).value : 0, item.y?.baseVal.numberOfItems ? item.y.baseVal.getItem(0).value : 0) }
  const axisCoordinate = (element: Element) => {
    const origin = anchor(element), ticks: { x: number; y: number }[] = [], numeric = '([-+\\d.]+)'
    for (const line of svg.querySelectorAll('line')) { const a = point(line, line.x1.baseVal.value, line.y1.baseVal.value), b = point(line, line.x2.baseVal.value, line.y2.baseVal.value); if (Math.abs(a.y - b.y) < .1 && Math.abs(a.x - b.x) >= 2 && Math.abs(a.x - b.x) <= 25) ticks.push({ x: (a.x + b.x) / 2, y: a.y }) }
    for (const path of svg.querySelectorAll('path')) for (const match of (path.getAttribute('d') ?? '').matchAll(new RegExp('[Mm]\\s*' + numeric + '[, ]+' + numeric + '\\s*([HhLl])\\s*' + numeric + '(?:[, ]+' + numeric + ')?', 'g'))) {
      const x = Number(match[1]), y = Number(match[2]), command = match[3]!, toX = Number(match[4]), toY = Number(match[5] ?? y), a = point(path, x, y), b = point(path, command === 'h' || command === 'l' ? x + toX : toX, command === 'H' || command === 'h' ? y : command === 'l' ? y + toY : toY)
      if (Math.abs(a.y - b.y) < .1 && Math.abs(a.x - b.x) >= 2 && Math.abs(a.x - b.x) <= 25) ticks.push({ x: (a.x + b.x) / 2, y: a.y })
    }
    const font = Number.parseFloat(getComputedStyle(element).fontSize), near = ticks.filter(tick => Math.abs(tick.y - origin.y) <= font && Math.abs(tick.x - origin.x) <= font * 3).sort((a, b) => Math.abs(a.y - origin.y) - Math.abs(b.y - origin.y))
    return near[0]?.y ?? origin.y
  }
  const sample = (element: Element, count = 512) => {
    const path = element as SVGGeometryElement, length = path.getTotalLength(), matrix = path.getScreenCTM()
    return matrix ? Array.from({ length: count + 1 }, (_, index) => path.getPointAtLength(length * index / count).matrixTransform(matrix)) : []
  }
  const area = (element: Element) => { const values = sample(element); return Math.abs(values.reduce((sum, p, i) => { const next = values[(i + 1) % values.length]!; return sum + p.x * next.y - next.x * p.y }, 0)) / 2 }
  const swatch = (value: string): string | undefined => {
    const element = label(value)
    if (!element) return undefined
    const b = box(element), candidates = rectangles.filter(rectangle => { const r = box(rectangle); return r.width <= 40 && r.height <= 40 && r.x + r.width <= b.x + 2 && Math.abs(center(r).y - center(b).y) <= Math.max(b.height, r.height) }).sort((a, c) => Math.abs(center(box(a)).y - center(b).y) - Math.abs(center(box(c)).y - center(b).y) || box(c).x - box(a).x)
    return candidates[0] ? getComputedStyle(candidates[0]).fill : undefined
  }
  if (input.family === 'pie' && facts.slices) {
    const slices: { label: string; value: number }[] = facts.slices, paths = [...svg.querySelectorAll('path')].filter(element => visible(element) && /[aA]/.test(element.getAttribute('d') ?? '') && alpha(getComputedStyle(element).fill) > 0)
    const total = paths.reduce((sum, path) => sum + area(path), 0), weight = slices.reduce((sum, slice) => sum + slice.value, 0)
    const actual = slices.map(slice => { const color = swatch(slice.label), owners = paths.filter(path => getComputedStyle(path).fill === color), legend = label(slice.label), suffix = legend ? /[\[(]([-+\d.e]+)(%?)[\])]$/.exec(norm(legend.textContent ?? '')) : null; return { label: slice.label, owners: owners.length, fraction: total ? owners.reduce((sum, path) => sum + area(path), 0) / total : null, displayedQuantity: suffix ? { value: Number(suffix[1]), expected: suffix[2] ? slice.value / weight * 100 : slice.value } : null } })
    const available = actual.every((item, index) => item.owners === 1 || slices[index]!.value === 0 && item.owners === 0)
    add('painted-slice-weights', slices, actual, available && weight > 0 ? actual.every((item, index) => Math.abs(item.fraction! - slices[index]!.value / weight) <= .03 && (!item.displayedQuantity || Math.abs(item.displayedQuantity.value - item.displayedQuantity.expected) <= .11)) : null, 'Legend color binds each authored label to actual filled arc geometry; sampled areas must match weights within 3 percentage points. Any emitted numeric legend suffix must agree within0.11 units/percentage-points')
  }
  if (input.family === 'packet' && facts.fields) {
    const fields: { label: string; start: number; end: number }[] = facts.fields, actual = fields.map(field => ({ ...field, box: owned(field.label) }))
    const available = actual.every(field => field.box)
    const ordered = actual.every((field, index) => !index || !field.box || !actual[index - 1]!.box || field.box.y > actual[index - 1]!.box!.y + 2 || Math.abs(field.box.y - actual[index - 1]!.box!.y) <= 2 && field.box.x > actual[index - 1]!.box!.x)
    const ratios = actual.map(field => { const row = actual.filter(other => field.box && other.box && Math.abs(field.box.y - other.box.y) <= 2); return { label: field.label, actual: field.box ? field.box.width / row.reduce((sum, item) => sum + item.box!.width, 0) : null, expected: (field.end - field.start + 1) / row.reduce((sum, item) => sum + item.end - item.start + 1, 0) } })
    add('painted-bit-field-spans', fields, { fields: actual, ratios, ordered }, available ? ordered && ratios.every(ratio => Math.abs(ratio.actual! - ratio.expected) <= .04) : null, 'Owned field rectangles retain bit order and within-row bit-span proportions; 4 percentage-point padding tolerance, not cross-renderer coordinates')
  }
  if (input.family === 'quadrant' && facts.points) {
    const candidates = rectangles.filter(element => alpha(getComputedStyle(element).fill) > 0).map(box)
    const regions = candidates.filter(candidate => candidates.filter(other => Math.abs(other.width - candidate.width) < 2 && Math.abs(other.height - candidate.height) < 2).length === 4)
    const dots = [...svg.querySelectorAll('circle')].filter(visible)
    const plot = regions.length === 4 && new Set(regions.map(r => Math.round(r.x) + ':' + Math.round(r.y))).size === 4 && new Set(regions.map(r => Math.round(r.x))).size === 2 && new Set(regions.map(r => Math.round(r.y))).size === 2 ? { x: Math.min(...regions.map(r => r.x)), y: Math.min(...regions.map(r => r.y)), right: Math.max(...regions.map(r => r.x + r.width)), bottom: Math.max(...regions.map(r => r.y + r.height)) } : undefined
    const boundDots = new Set<Element>()
    const values = (facts.points as { label: string; x: number; y: number }[]).map(value => {
      const element = label(value.label), near = element ? dots.map(dot => ({ dot, distance: Math.hypot(center(box(dot)).x - center(box(element)).x, center(box(dot)).y - center(box(element)).y) })).sort((a, b) => a.distance - b.distance) : []
      const bound = near[0] && (!near[1] || near[1].distance - near[0].distance > 2) && near[0].distance <= Math.max(30, element ? box(element).width + box(element).height : 0) && !boundDots.has(near[0].dot) ? near[0].dot : undefined
      if (bound) boundDots.add(bound)
      const actual = bound && plot ? { x: (center(box(bound)).x - plot.x) / (plot.right - plot.x), y: 1 - (center(box(bound)).y - plot.y) / (plot.bottom - plot.y) } : null
      return { label: value.label, actual, expected: value }
    })
    add('painted-quadrant-coordinates', facts.points, values, plot && values.every(value => value.actual) ? values.every(value => Math.abs(value.actual!.x - value.expected.x) < .015 && Math.abs(value.actual!.y - value.expected.y) < .015) : null, 'Authored point labels bind nearest visible dots; positions normalize to the four actual quadrant regions with 1.5% tolerance')
  }
  if (input.family === 'xychart' && facts.series) {
    const categories: string[] = facts['x-categories'] ?? [], range: number[] = facts['y-range'] ?? [], series: { kind: string; values: number[] }[] = facts.series
    const categoryText = categories.map(label), lower = label(String(range[0])), upper = label(String(range[1])), available = range.length === 2 && lower && upper && categoryText.every(Boolean)
    const values: unknown[] = [], failures: string[] = []
    if (available) {
      const y0 = axisCoordinate(lower!), y1 = axisCoordinate(upper!), xs = categoryText.map(element => anchor(element!).x), step = xs.length > 1 ? Math.min(...xs.slice(1).map((x, index) => Math.abs(x - xs[index]!))) : 100, baselineTolerance = Math.max(3, Number.parseFloat(getComputedStyle(lower!).fontSize) * .65)
      const y = (value: number) => y0 + (value - range[0]!) / (range[1]! - range[0]!) * (y1 - y0)
      const bars = rectangles.filter(element => { const r = box(element); return r.width < step * 1.3 && r.y >= Math.min(y0, y1) - baselineTolerance && r.y + r.height <= Math.max(y0, y1) + baselineTolerance })
      const lines = [...svg.querySelectorAll('path')].filter(element => visible(element) && getComputedStyle(element).fill === 'none' && (element.getAttribute('d')?.match(/[Mm]/g)?.length ?? 0) === 1 && !/axis|grid|legend/i.test([element, ...Array.from((function* () { for (let p: Element | null = element.parentElement; p && p !== svg; p = p.parentElement) yield p })())].map(item => item.getAttribute('class')).join(' ')) && box(element).width >= step)
      if (series.filter(item => item.kind === 'bar').length > 1 || series.filter(item => item.kind === 'line').length > 1) failures.push('Multiple same-kind series need reviewed legend ownership')
      for (const item of series) {
        if (item.kind === 'bar') item.values.forEach((value, index) => {
          const near = bars.filter(bar => Math.abs(center(box(bar)).x - xs[index]!) <= step * .35).sort((a, b) => Math.abs(center(box(a)).x - xs[index]!) - Math.abs(center(box(b)).x - xs[index]!)), r = near[0] ? box(near[0]) : undefined
          const okay = value === 0 && !r || !!r && near.length === 1 && Math.abs((value >= 0 ? r.y : r.y + r.height) - y(value)) <= 3 && Math.abs((value >= 0 ? r.y + r.height : r.y) - y(Math.max(range[0]!, Math.min(range[1]!, 0)))) <= baselineTolerance
          if (!okay) failures.push('bar:' + index); values.push({ kind: 'bar', category: categories[index], value, box: r ?? null, expectedCoordinate: y(value) })
        })
        if (item.kind === 'line') {
          if (lines.length !== 1) failures.push('Line path ownership unavailable')
          else { const points = sample(lines[0]!, 2048); item.values.forEach((value, index) => { const closest = [...points].sort((a, b) => Math.abs(a.x - xs[index]!) - Math.abs(b.x - xs[index]!))[0]!; if (Math.abs(closest.y - y(value)) > 3) failures.push('line:' + index); values.push({ kind: 'line', category: categories[index], value, actual: { x: closest.x, y: closest.y }, expectedCoordinate: y(value) }) }) }
        }
      }
    }
    add('painted-series-values', facts.series, { values, findings: failures }, available ? failures.some(value => value.includes('ownership') || value.startsWith('Multiple')) ? null : failures.length === 0 : null, 'Actual labeled tick coordinates calibrate this chart; value tips/line category intersections are within 3 CSS pixels. Bar bases allow at most .65 font-em intentional axis overhang (minimum3px); shortened or floating bars fail. Complete interpolation/axis-style fidelity is outside this check')
  }
  if (input.family === 'radar' && facts.curves) {
    const rings = [...svg.querySelectorAll('circle')].filter(visible).sort((a, b) => box(b).width - box(a).width), outer = rings[0], curves: { id: string; label: string; values: number[] }[] = facts.curves, axes: { id: string; label: string }[] = facts.axes ?? [], range: number[] = facts.range ?? []
    const paths = [...svg.querySelectorAll('path')].filter(element => visible(element) && /radarCurve-|radar-area|pele-curve/.test(element.getAttribute('class') ?? ''))
    const available = outer && Math.abs(box(outer).width - box(outer).height) <= .5 && range.length === 2 && range[1]! > range[0]! && axes.length > 0 && paths.length === curves.length && curves.length === 1
    const actual: unknown[] = []; let passed = true
    if (available) {
      const c = center(box(outer!)), radius = box(outer!).width / 2, points = sample(paths[0]!, 4096)
      axes.forEach((axis, index) => { const element = label(axis.label); if (!element) { passed = false; return }; const p = center(box(element)), angle = Math.atan2(p.y - c.y, p.x - c.x); const ranked = points.map(value => ({ value, angle: Math.abs(Math.atan2(Math.sin(Math.atan2(value.y - c.y, value.x - c.x) - angle), Math.cos(Math.atan2(value.y - c.y, value.x - c.x) - angle))) })).sort((a, b) => a.angle - b.angle); const selected = ranked[0]!.value, value = range[0]! + Math.hypot(selected.x - c.x, selected.y - c.y) / radius * (range[1]! - range[0]!); if (Math.abs(value - curves[0]!.values[index]!) > .15) passed = false; actual.push({ axis: axis.label, expected: curves[0]!.values[index], actual: value }) })
    }
    add('painted-radar-values', facts.curves, actual, available ? passed : null, 'Actual outer grid and authored axis-label rays calibrate curve intersections; 0.15 data-unit sampling/label-offset tolerance. Multi-curve legend ownership needs separate evidence')
  }
  if (input.family === 'treemap' && facts.values) {
    const values: { id: string; value: number }[] = facts.values, nodes = input.expected.nodes ?? [], actual = values.map(value => ({ ...value, box: input.nodes?.find(node => node.id === value.id)?.box ?? owned(nodes.find(node => node.id === value.id)?.label ?? value.id.split('/').at(-1)!) }))
    const groups = [...new Set(values.map(value => value.id.split('/').slice(0, -1).join('/')))].map(parent => actual.filter(value => value.id.split('/').slice(0, -1).join('/') === parent)).filter(group => group.length > 1)
    const available = groups.length > 0 && groups.flat().every(value => value.box)
    const ratios = available ? groups.flatMap(group => { const total = group.reduce((sum, item) => sum + item.box!.width * item.box!.height, 0), expected = group.reduce((sum, item) => sum + item.value, 0); return group.map(item => ({ id: item.id, expected: item.value / expected, actual: item.box!.width * item.box!.height / total })) }) : []
    add('painted-leaf-weights', facts.values, ratios, available ? ratios.every(value => Math.abs(value.expected - value.actual) <= .08) : null, 'Actual sibling leaf areas retain authored weight fractions within 8 percentage points for container padding; single-child and cross-level area claims are excluded')
  }
  if (input.family === 'sankey' && facts.links) {
    const links: { source: string; target: string; value: number }[] = facts.links, paths = [...svg.querySelectorAll('path')].filter(element => visible(element) && /sankey-link|pele-sankey-link/.test(element.getAttribute('class') ?? '') || visible(element) && element.getAttribute('d')?.includes('C') && Number.parseFloat(getComputedStyle(element).strokeWidth) > 2)
    const nodes = input.expected.nodes ?? [], ownedNodes = nodes.map(node => ({ id: node.id, box: owned(node.label) })), widths: { source?: string; target?: string; width: number }[] = []
    for (const path of paths) {
      const p = sample(path), xs = p.map(value => value.x), left = Math.min(...xs), right = Math.max(...xs), filled = getComputedStyle(path).fill !== 'none'
      const leftPoints = p.filter(value => value.x <= left + .5), rightPoints = p.filter(value => value.x >= right - .5), start = { x: left, y: leftPoints.reduce((sum, value) => sum + value.y, 0) / leftPoints.length }, end = { x: right, y: rightPoints.reduce((sum, value) => sum + value.y, 0) / rightPoints.length }
      const bind = (point: { x: number; y: number }) => { const candidates = ownedNodes.filter(node => node.box && point.y >= node.box.y - 2 && point.y <= node.box.y + node.box.height + 2).map(node => ({ id: node.id, distance: Math.min(Math.abs(point.x - node.box!.x), Math.abs(point.x - node.box!.x - node.box!.width)) })).sort((a, b) => a.distance - b.distance); return candidates[0] && candidates[0].distance <= 3 && (!candidates[1] || candidates[1].distance - candidates[0].distance > 2) ? candidates[0].id : undefined }
      widths.push({ source: bind(start), target: bind(end), width: filled ? Math.max(...leftPoints.map(value => value.y)) - Math.min(...leftPoints.map(value => value.y)) : Number.parseFloat(getComputedStyle(path).strokeWidth) })
    }
    const remaining = [...widths], actual = [...links].sort((a, b) => a.value - b.value).map(link => { const candidates = remaining.filter(value => value.source === link.source && value.target === link.target).sort((a, b) => a.width - b.width), observed = candidates[0]; if (observed) remaining.splice(remaining.indexOf(observed), 1); return { ...link, observed } })
    const available = widths.length === links.length && actual.every(value => value.observed && value.observed.width > 0)
    const scale = available ? actual.reduce((sum, value) => sum + value.observed!.width, 0) / links.reduce((sum, value) => sum + value.value, 0) : 0
    add('painted-link-weights', links, actual, available ? actual.every(value => Math.abs(value.observed!.width / scale - value.value) <= Math.max(.1, value.value * .05)) : null, 'Actual endpoint-owned flow strokes/ribbons share the independently authored weight scale; 5% geometric sampling tolerance')
  }
  if (input.family === 'gantt' && facts.tasks) {
    const tasks: { id: string; label: string; end: string }[] = facts.tasks, values = tasks.map(task => ({ ...task, box: owned(task.label), days: /^(\d+(?:\.\d+)?)d$/.test(task.end) ? Number.parseFloat(task.end) : null }))
    const available = !/\bexcludes\b/i.test(input.source ?? '') && values.length > 1 && values.every(value => value.days !== null && value.days > 0 && value.box)
    const scale = available ? values.reduce((sum, value) => sum + value.box!.width, 0) / values.reduce((sum, value) => sum + value.days!, 0) : 0
    add('painted-duration-ratios', tasks, values, available ? values.every(value => Math.abs(value.box!.width / scale - value.days!) <= .1) : null, 'Owned bars preserve relative explicit day durations on a linear calendar; exclusions, milestones and absolute-date inference require separate calendar evidence')
  }
  if (input.family === 'journey' && facts.tasks && new Set((facts.tasks as { score: number }[]).map(task => task.score)).size > 1) {
    const tasks: { label: string; score: number }[] = facts.tasks, faces = [...svg.querySelectorAll('circle')].filter(element => visible(element) && Number(element.getAttribute('r')) >= 9)
    const values = tasks.map(task => { const element = label(task.label), x = element ? center(box(element)).x : NaN; const candidates = faces.filter(face => Math.abs(center(box(face)).x - x) <= 4); return { ...task, y: candidates.length === 1 ? center(box(candidates[0]!)).y : null } })
    const available = values.every(value => value.y !== null) && new Set(values.map(value => value.score)).size > 1
    add('painted-score-order', tasks, values, available ? values.every(a => values.every(b => a.score === b.score ? Math.abs(a.y! - b.y!) <= 2 : a.score > b.score ? a.y! < b.y! : a.y! > b.y!)) : null, 'Actual task-owned score glyphs preserve relative score order and equal-score alignment within2px. A single unlabeled score has no independent absolute-axis observation; native exact values remain separate')
  }
  if (uncertain.size) for (const check of checks) if (check.status === 'passed') { check.status = 'unavailable'; check.scope += '; geometry/paint projection remains unavailable: ' + [...uncertain].join(', ') }
  return checks
}
