import { escapeAttr } from './multiline-utils.ts'
import { decodedSvgAttributeValue, scanSvgStartTags, transformSvgAttributes } from './svg-structure.ts'

/** resvg 2.6.2 implements SVG 1.1's `auto`, not SVG 2's
 * `auto-start-reverse`. Lower that orientation at the native adapter boundary:
 * end/mid keep `auto`; start gets an explicitly rotated resource and mirrored
 * reference point. Rotate in viewBox coordinates so clipping and units survive.
 * Shared by N-API and hosted WASM. Public SVG/Scene resources stay unchanged. */
export function prepareResvgMarkerOrientation(svg: string): string {
  if (!svg.includes('auto-start-reverse')) return svg
  const tags = scanSvgStartTags(svg)
  const ids = new Set(tags.map(tag => decodedSvgAttributeValue(tag, 'id')).filter(Boolean))
  const starts = new Map<string, string>()
  const additions: Array<{ at: number; content: string }> = []
  for (const tag of tags) {
    if (tag.name !== 'marker' || decodedSvgAttributeValue(tag, 'orient') !== 'auto-start-reverse') continue
    const id = decodedSvgAttributeValue(tag, 'id')
    if (!id || tag.selfClosing) continue
    const close = svg.indexOf('</marker>', tag.end)
    if (close < 0) throw new Error(`Unclosed native marker ${id}`)
    const viewBox = decodedSvgAttributeValue(tag, 'viewBox')?.trim().split(/[\s,]+/).map(Number)
    const width = Number(decodedSvgAttributeValue(tag, 'markerWidth') ?? 3)
    const height = Number(decodedSvgAttributeValue(tag, 'markerHeight') ?? 3)
    const [x, y, w, h] = viewBox ?? [0, 0, width, height]
    const refX = Number(decodedSvgAttributeValue(tag, 'refX') ?? 0)
    const refY = Number(decodedSvgAttributeValue(tag, 'refY') ?? 0)
    if (![x, y, w, h, refX, refY].every(value => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`Native marker ${id} requires numeric coordinates`)
    }
    let startId = `${id}-native-start`
    while (ids.has(startId)) startId += '-'
    ids.add(startId)
    starts.set(id, startId)
    const cx = x! + w! / 2, cy = y! + h! / 2
    const values: Record<string, string> = { id: escapeAttr(startId), orient: 'auto', refX: String(2 * cx - refX), refY: String(2 * cy - refY) }
    let opening = transformSvgAttributes(svg.slice(tag.start, tag.end), attribute => values[attribute.name])
    for (const name of ['refX', 'refY']) {
      if (!tag.attributes.some(attribute => attribute.name === name)) opening = opening.replace(/>$/, ` ${name}="${values[name]}">`)
    }
    additions.push({ at: close + '</marker>'.length, content: `\n${opening}<g transform="rotate(180 ${cx} ${cy})">${svg.slice(tag.end, close)}</g></marker>` })
  }
  let expanded = svg
  for (const addition of additions.reverse()) expanded = expanded.slice(0, addition.at) + addition.content + expanded.slice(addition.at)
  return transformSvgAttributes(expanded, (attribute, tag) => {
    if (tag.name === 'marker' && attribute.name === 'orient' && attribute.value === 'auto-start-reverse') return 'auto'
    if (attribute.name !== 'marker-start') return undefined
    const id = /^url\(#([^)]*)\)$/.exec(decodedSvgAttributeValue(tag, 'marker-start') ?? '')?.[1]
    const startId = id ? starts.get(id) : undefined
    return startId ? `url(#${escapeAttr(startId)})` : undefined
  })
}
