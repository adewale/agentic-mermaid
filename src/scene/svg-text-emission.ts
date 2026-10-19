import { connectorInlineLabelText } from './bounds.ts'
import type { DisplayRun } from '../shared/display-text.ts'
import { HAS_FORMAT_TAGS } from '../shared/inline-format.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import { LINE_HEIGHT_RATIO } from '../text-metrics.ts'
import type { TextMark } from './ir.ts'
import { projectSvgCoordinate, writeSvgAttributes, type SvgTextEmission } from './svg-emission.ts'
import type { SvgWriter } from './svg-writer.ts'
import { writeSvgTextWhitespace } from './svg-text-whitespace.ts'

function writeRunAttributes(run: DisplayRun, weight: number, writer: SvgWriter): void {
  if (run.bold) writer.attribute('font-weight', weight > 700 ? String(weight) : 'bold')
  if (run.italic) writer.attribute('font-style', 'italic')
  if (run.underline || run.strikethrough) writer.attribute('text-decoration', `${run.underline ? 'underline' : ''}${run.underline && run.strikethrough ? ' ' : ''}${run.strikethrough ? 'line-through' : ''}`)
}

function writeRuns(runs: readonly DisplayRun[], weight: number, writer: SvgWriter): void {
  for (const run of runs) {
    const decorated = run.bold || run.italic || run.underline || run.strikethrough
    if (decorated) {
      writer.write('<tspan')
      writeRunAttributes(run, weight, writer)
      writer.write('>')
    }
    writer.text(run.text)
    if (decorated) writer.write('</tspan>')
  }
}

function writePreparedLine(block: PixelTextBlock, index: number, x: number, anchor: TextMark['anchor'], writer: SvgWriter, baseline?: number): void {
  const line = block.lineBlocks[index]!
  const native = line.runs.some(run => /[^\x20-\x7e]/u.test(run.text))
  if (native) {
    const center = anchor === 'start' ? x + line.width / 2 : anchor === 'end' ? x - line.width / 2 : x
    writer.write('<tspan')
    writer.attribute('x', String(center))
    if (baseline !== undefined) writer.attribute('y', String(baseline))
    writer.write(' text-anchor="middle" data-text-fragment="true">')
    writeRuns(line.runs, block.fontWeight, writer)
    writer.write('</tspan>')
    return
  }
  if (block.letterSpacing === 0 && !line.fragments) {
    writeRuns(line.runs, block.fontWeight, writer)
    return
  }
  if (!line.fragments) throw new TypeError('Tracked text requires retained fragment allocations')
  const origin = (anchor === 'middle' ? x - line.width / 2 : anchor === 'end' ? x - line.width : x) + line.originX
  for (const fragment of line.fragments) {
    writer.write('<tspan')
    writer.attribute('x', String(origin + fragment.x))
    writer.write(' text-anchor="start" letter-spacing="0" data-text-fragment="true"')
    writer.attribute('textLength', String(Math.max(0, fragment.width)))
    writer.write(' lengthAdjust="spacingAndGlyphs"')
    if (/^ | $/.test(fragment.text)) writer.write(' xml:space="preserve"')
    writeRunAttributes(line.runs[fragment.runIndex]!, block.fontWeight, writer)
    writer.write('>')
    writer.text(fragment.text)
    writer.write('</tspan>')
  }
}

/** The typed text writer consumes the exact layout-retained run allocations.
 * It never recovers text, typography or placement from historical SVG. */
export function writeSceneText(node: TextMark, recipe: SvgTextEmission, writer: SvgWriter): void {
  const block = node.measurement === 'prepared' ? node.block : undefined
  if (recipe.spans) {
    let end = 0
    for (const span of recipe.spans) {
      if (span.start !== end || span.end > node.text.length) throw new TypeError('SVG text spans must cover semantic text exactly')
      end = span.end
    }
    if (end !== node.text.length) throw new TypeError('SVG text spans must cover semantic text exactly')
  }
  if (recipe.background) {
    if (!node.block) throw new TypeError('SVG text background requires retained text metrics')
    const background = recipe.background
    const width = node.block.width + background.padding * 2
    const height = node.block.height + background.padding * 2
    const x = node.x - width / 2, y = node.y - height / 2
    if (![x, y, width, height].every(Number.isFinite)) throw new TypeError('SVG text background geometry must be finite')
    writer.write('<rect')
    writer.attribute('x', String(x)); writer.attribute('y', String(y))
    writer.attribute('width', String(width)); writer.attribute('height', String(height))
    writer.attribute('rx', String(background.rx)); writer.attribute('ry', String(background.ry))
    writer.attribute('fill', background.paint.fill); writer.attribute('stroke', background.paint.stroke)
    writer.attribute('stroke-width', background.paint.strokeWidth)
    if (background.attributes) writeSvgAttributes(node, background.attributes, writer)
    writer.write(' />\n')
  }
  const tail = (): void => { if (recipe.tailAttributes) writeSvgAttributes(node, recipe.tailAttributes, writer) }
  if (recipe.layout === 'direct') {
    if (recipe.content === 'source' && (!block || block.prepared.display !== 'literal')) throw new TypeError('Direct source text requires a retained literal preparation')
    const content = recipe.content === 'source' ? block!.prepared.source : node.text
    writer.write('<text')
    writeSvgAttributes(node, recipe.attributes, writer)
    if (recipe.dy !== undefined) writer.attribute('dy', String(recipe.dy))
    tail()
    writer.write('>')
    if (recipe.whitespace) writeSvgTextWhitespace(content, recipe.whitespace, writer)
    else writer.text(content)
    writer.write('</text>')
    return
  }
  const lines = block?.lines ?? node.text.split('\n')
  const prepared = node.block!
  const visible = prepared.lineBlocks.map(line => line.runs.map(run => run.text).join('')).join('\n')
  const native = !!block && block.lineBlocks.some(line => line.runs.some(run => /[^\x20-\x7e]/u.test(run.text)))
  const fragmented = !!block && (block.letterSpacing !== 0 || native)
  const x = projectSvgCoordinate(node.x, recipe.positionFormat)
  const y = projectSvgCoordinate(node.y, recipe.positionFormat)
  const has = (name: string) => recipe.attributes.some(attribute => attribute.name === name)
  writer.write('<text')
  writer.attribute('x', String(x))
  writer.attribute('y', String(y))
  writeSvgAttributes(node, recipe.attributes, writer)
  if (node.display === 'literal' && HAS_FORMAT_TAGS.test(node.text) && !has('data-literal-text')) writer.write(' data-literal-text="true"')
  if (/(?:^ | $| {2}|\t)/m.test(visible) && !has('xml:space')) writer.write(' xml:space="preserve"')
  if (block) writer.write(' data-prepared-text="true"')
  const advance = (index: number): void => {
    if (block && !fragmented && !block.lineBlocks[index]!.fragments) {
      writer.attribute('textLength', String(block.lineBlocks[index]!.width))
      writer.write(' lengthAdjust="spacingAndGlyphs" data-font-metrics="deterministic-fit"')
    }
  }
  const line = (index: number, baseline?: number): void => {
    const plain = block?.lineBlocks[index]
    if (recipe.spans && block?.lines.length === 1 && !fragmented && !plain?.fragments && plain?.runs.every(run => !run.bold && !run.italic && !run.underline && !run.strikethrough)) {
      for (const span of recipe.spans) {
        writer.write('<tspan')
        writeSvgAttributes(node, span.attributes, writer)
        writer.write('>'); writer.text(node.text.slice(span.start, span.end)); writer.write('</tspan>')
      }
    } else if (block) writePreparedLine(block, index, x, node.anchor, writer, baseline)
    else writeRuns(prepared.lineBlocks[index]!.runs, 400, writer)
  }
  const shift = node.fontSize * (recipe.baselineShift ?? 0.35)
  if (lines.length === 1) {
    if (native) {
      tail()
      writer.write('>')
      line(0, y + shift)
    } else {
      writer.attribute('dy', String(shift))
      advance(0)
      tail()
      writer.write('>')
      line(0)
    }
  } else {
    tail()
    writer.write('>')
    const height = block?.lineHeight ?? node.fontSize * LINE_HEIGHT_RATIO
    const first = -((lines.length - 1) / 2) * height + shift
    for (let index = 0; index < lines.length; index++) {
      writer.write('<tspan')
      writer.attribute('x', String(x))
      writer.attribute(native ? 'y' : 'dy', String(native ? y + first + index * height : index === 0 ? first : height))
      advance(index)
      writer.write('>')
      line(index)
      writer.write('</tspan>')
    }
  }
  writer.write('</text>')
}

/** Inline labels belong to their typed connector, rather than a retained
 * second SVG subtree. The temporary text view does not escape this call. */
export function writeConnectorLabels(node: import('./ir.ts').SceneNode, writer: SvgWriter): void {
  if (node.kind !== 'connector') throw new TypeError('Expected a typed connector')
  for (const [index, label] of node.labels.entries()) {
    if (label.visual?.kind !== 'inline') continue
    if (!label.anchor || !label.paint || label.fontSize === undefined || label.textAnchor === undefined) throw new TypeError(`Connector "${node.id}" inline label ${index + 1} requires anchor, paint, fontSize, and textAnchor`)
    const block = connectorInlineLabelText(label)
    const paint = { ...label.paint, ...(label.halo ? { stroke: label.halo.color ?? 'var(--bg)', strokeWidth: String(label.halo.width), paintOrder: 'stroke fill' } : {}) }
    const text: TextMark = { kind: 'text', id: label.id ?? `${node.id}-label-${index + 1}`, role: 'label',
      text: label.text, x: label.anchor.x, y: label.anchor.y - Math.max(0, label.clearance ?? 0),
      fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: label.textAnchor,
      block, measurement: 'prepared', display: block.prepared.display, paint,
      ...(node.transform ? { transform: node.transform } : {}),
      textLayout: { width: block.width, height: block.height, lineHeight: block.lineHeight, offsetY: -block.fontSize * 0.35 } }
    const attrs: import('./svg-emission.ts').SvgAttribute[] = [
      { name: 'data-id', value: { source: 'metadata', value: text.id } },
      { name: 'data-role', value: { source: 'metadata', value: 'label' } },
      { name: 'data-connector-label-for', value: { source: 'metadata', value: node.id } },
      { name: 'font-size', value: { source: 'text', field: 'fontSize' } },
      { name: 'font-weight', value: { source: 'text', field: 'fontWeight' } },
      ...(block.letterSpacing ? [{ name: 'letter-spacing' as const, value: { source: 'text' as const, field: 'letterSpacing' as const } }] : []),
      { name: 'text-anchor', value: { source: 'text', field: 'anchor' } },
    ]
    if (node.transform) attrs.push({ name: 'transform', value: { source: 'transform' } })
    const fields = [['fill', 'fill'], ['stroke', 'stroke'], ['stroke-width', 'strokeWidth'],
      ['stroke-dasharray', 'strokeDasharray'], ['stroke-dashoffset', 'strokeDashoffset'],
      ['stroke-linecap', 'strokeLinecap'], ['stroke-linejoin', 'strokeLinejoin'], ['stroke-miterlimit', 'strokeMiterlimit'],
      ['vector-effect', 'vectorEffect'], ['paint-order', 'paintOrder'], ['opacity', 'opacity']] as const
    for (const [name, field] of fields) if (paint[field] !== undefined) attrs.push({ name, value: { source: 'paint', field } })
    writer.write('\n')
    writeSceneText(text, { kind: 'text', layout: 'multiline', attributes: attrs, baselineShift: 0 }, writer)
  }
}
