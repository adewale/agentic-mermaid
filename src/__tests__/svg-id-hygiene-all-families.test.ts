import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { namespaceSvgIds } from '../renderer.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { SaxesParser } from 'saxes'
import { Resvg } from '@resvg/resvg-js'

function xmlElements(svg: string): Array<{ name: string; attributes: Record<string, string>; text: string }> {
  const elements: Array<{ name: string; attributes: Record<string, string>; text: string }> = []
  const stack: typeof elements = []
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', tag => {
    const element = { name: tag.name, text: '',
      attributes: Object.fromEntries(Object.entries(tag.attributes).map(([name, attribute]) => [name, attribute.value])),
    }
    elements.push(element); stack.push(element)
  })
  const text = (value: string) => { const element = stack.at(-1); if (element) element.text += value }
  parser.on('text', text); parser.on('cdata', text)
  parser.on('closetag', () => { stack.pop() })
  parser.write(svg).close()
  return elements
}

function mixedMarkerIds(reverse: boolean, encoded: boolean): string {
  const markers = [
    `<marker id="arrowhead" data-marker="red" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#ff0000"/></marker>`,
    `<marker id="${encoded ? 'p&#45;arrowhead' : 'p-arrowhead'}" data-marker="blue" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><circle cx="5" cy="5" r="5" fill="#0000ff"/></marker>`,
    `<marker id="p-arrowhead-1" data-marker="green" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 5L5 0L10 5L5 10Z" fill="#00aa00"/></marker>`,
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="80" viewBox="0 0 100 80" aria-labelledby="arrowhead p-arrowhead" aria-describedby="p-arrowhead-1 missing">
<defs>${(reverse ? markers.reverse() : markers).join('')}</defs>
<style>.red{marker-end:url(#arrowhead)}</style>
<path data-edge="red" class="red" d="M10 15H60" stroke="black" marker-end="url(#arrowhead)"/>
<path data-edge="blue" d="M10 35H60" stroke="black" marker-end="url(#p-arrowhead)"/>
<path data-edge="green" d="M10 55H60" stroke="black" marker-end="url(#p-arrowhead-1)"/>
<use href="#arrowhead"/><use xlink:href="#p-arrowhead"/><use href="#missing"/>
<text data-id="arrowhead" data-note="url(#arrowhead)">url(#arrowhead) &amp;amp; p-arrowhead</text>
</svg>`
}

function withAccessibility(source: string, family: string): string {
  const lines = source.split('\n')
  lines.splice(1, 0, `  accTitle: ${family} title`, `  accDescr: ${family} description`)
  return lines.join('\n')
}

function declarations(svg: string): string[] {
  return [...svg.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]!)
}

function references(svg: string): string[] {
  const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map(match => match[1]!)
  for (const match of svg.matchAll(/\s(?:xlink:)?href="#([^"]+)"/g)) refs.push(match[1]!)
  for (const match of svg.matchAll(/\saria-(?:labelledby|describedby)="([^"]+)"/g)) refs.push(...match[1]!.split(/\s+/))
  return refs
}

describe('all-family multi-diagram SVG ID hygiene', () => {
  test.each([false, true])('mixed prefixed marker IDs retain distinct XML owners and references, reverse=%s', reverse => {
    const input = mixedMarkerIds(reverse, true), output = namespaceSvgIds(input, 'p-')
    const elements = xmlElements(output)
    const markers = elements.filter(element => element.name === 'marker')
    const markerIds = markers.map(marker => marker.attributes.id!)
    expect(new Set(markerIds).size).toBe(3)
    expect(markers.find(marker => marker.attributes['data-marker'] === 'blue')!.attributes.id).toBe('p-arrowhead')
    expect(markers.find(marker => marker.attributes['data-marker'] === 'green')!.attributes.id).toBe('p-arrowhead-1')
    for (const color of ['red', 'blue', 'green']) {
      const marker = markers.find(item => item.attributes['data-marker'] === color)!
      const edge = elements.find(item => item.attributes['data-edge'] === color)!
      expect(edge.attributes['marker-end']).toBe(`url(#${marker.attributes.id})`)
    }
    const root = elements[0]!
    expect(root.attributes['aria-labelledby']!.split(/\s+/)).toEqual([
      markers.find(marker => marker.attributes['data-marker'] === 'red')!.attributes.id!, 'p-arrowhead',
    ])
    expect(root.attributes['aria-describedby']).toBe('p-arrowhead-1 missing')
    expect(output).toContain('href="#missing"')
    expect(output).toContain('<text data-id="arrowhead" data-note="url(#arrowhead)">url(#arrowhead) &amp;amp; p-arrowhead</text>')
    expect(namespaceSvgIds(output, 'p-')).toBe(output)
    expect(namespaceSvgIds(input, 'p-')).toBe(output)
  })

  test('namespacing preserves the actual red, blue and green marker ink', () => {
    const input = mixedMarkerIds(false, false)
    const before = new Resvg(input).render().pixels
    for (const [red, green, blue] of [[255, 0, 0], [0, 0, 255], [0, 170, 0]]) {
      let colored = 0
      for (let index = 0; index < before.length; index += 4) {
        if (before[index] === red && before[index + 1] === green && before[index + 2] === blue && before[index + 3]! > 0) colored++
      }
      expect(colored).toBeGreaterThan(0)
    }
    const after = new Resvg(namespaceSvgIds(input, 'p-')).render().pixels
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true)
  })

  test('XML references decode once while CDATA references retain literal entity-like text', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-labelledby="a&amp;b a&amp;amp;b missing">
<path id="a&amp;b"/><path id="a&amp;amp;b"/>
<use href="#a&amp;b"/><use xlink:href="#a&amp;amp;b"/>
<rect fill="url(&quot;#a&amp;b&quot;)" stroke="URL( '#a&amp;amp;b' )"/>
<style>.ordinary{fill:url(#a&amp;b)}.double{stroke:url("#a&amp;amp;b")}</style>
<style><![CDATA[.literal{fill:url(#a&amp;b)}.simple{stroke:url(#a&b)}]]></style>
</svg>`
    const output = namespaceSvgIds(input, 'p-'), elements = xmlElements(output)
    expect(elements.filter(element => element.attributes.id).map(element => element.attributes.id)).toEqual(['p-a&b', 'p-a&amp;b'])
    expect(elements.filter(element => element.name === 'use').map(element => element.attributes.href ?? element.attributes['xlink:href'])).toEqual(['#p-a&b', '#p-a&amp;b'])
    expect(elements[0]!.attributes['aria-labelledby']).toBe('p-a&b p-a&amp;b missing')
    const paint = elements.find(element => element.name === 'rect')!
    expect(paint.attributes.fill).toBe('url("#p-a&b")')
    expect(paint.attributes.stroke).toBe("URL( '#p-a&amp;b' )")
    expect(elements.filter(element => element.name === 'style').map(element => element.text)).toEqual([
      '.ordinary{fill:url(#p-a&b)}.double{stroke:url("#p-a&amp;b")}',
      '.literal{fill:url(#p-a&amp;b)}.simple{stroke:url(#p-a&b)}',
    ])
    expect(namespaceSvgIds(output, 'p-')).toBe(output)
  })

  test.each(['metadata', 'text'])('literal tag-like text inside %s CDATA never becomes an ID or CSS context', element => {
    const literal = '<path id="ghost"/><style>.label{fill:url(#a)}</style>'
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="40"><path id="a"/>' +
      `<${element} x="0" y="20"><![CDATA[${literal}]]></${element}></svg>`
    const elements = xmlElements(namespaceSvgIds(input, 'p-'))
    expect(elements.flatMap(item => item.attributes.id ?? [])).toEqual(['p-a'])
    expect(elements.find(item => item.name === element)!.text).toBe(literal)
  })

  test.each(['u&#114;l(#a)', 'url&#40;#a)'])('XML decoding precedes CSS tokenization for %s and preserves gradient ink', value => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">' +
      '<defs><linearGradient id="a"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>' +
      `<rect width="40" height="20" fill="${value}"/></svg>`
    const before = new Resvg(input).render().pixels
    const literal = new Resvg(input.replace(value, 'url(#a)')).render().pixels
    expect(Buffer.from(before).equals(Buffer.from(literal))).toBe(true)
    expect([...before].some((channel, index) => (index % 4 === 0 || index % 4 === 2) && channel > 0)).toBe(true)
    const output = namespaceSvgIds(input, 'p-')
    expect(xmlElements(output).find(element => element.name === 'rect')!.attributes.fill).toBe('url(#p-a)')
    expect(Buffer.from(new Resvg(output).render().pixels).equals(Buffer.from(before))).toBe(true)
  })

  test('encoded CSS missing references stay unresolved, including a quoted closing parenthesis', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">' +
      '<defs><linearGradient id="a"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>' +
      '<rect width="40" height="20" fill="u&#114;l(#p-a)"/></svg>'
    const output = namespaceSvgIds(input, 'p-')
    expect(xmlElements(output).flatMap(element => element.attributes.id ?? [])).not.toContain('p-a')
    expect(output).toContain('fill="u&#114;l(#p-a)"')
    expect(Buffer.from(new Resvg(output).render().pixels).equals(Buffer.from(new Resvg(input).render().pixels))).toBe(true)
    const quoted = namespaceSvgIds('<svg xmlns="http://www.w3.org/2000/svg"><path id="a)b"/>' +
      '<rect fill="url(&quot;#a)b&quot;)" stroke="url(&quot;#p-a)b&quot;)"/></svg>', 'p-')
    const elements = xmlElements(quoted), id = elements.find(element => element.attributes.id)!.attributes.id!
    expect(id).not.toBe('p-a)b')
    expect(elements.at(-1)!.attributes.fill).toBe(`url("#${id}")`)
    expect(elements.at(-1)!.attributes.stroke).toBe('url("#p-a)b")')
  })

  test('a style-closing lookalike inside an XML comment cannot hide the actual CSS reference', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a"/></defs>' +
      '<style><!-- </style> url(#comment-only) -->.x{fill:url(#a)}</style><rect class="x"/></svg>'
    const output = namespaceSvgIds(input, 'p-'), elements = xmlElements(output)
    expect(elements.find(element => element.name === 'linearGradient')!.attributes.id).toBe('p-a')
    expect(elements.find(element => element.name === 'style')!.text).toBe('.x{fill:url(#p-a)}')
    expect(output).toContain('<!-- </style> url(#comment-only) -->')
  })

  test('collision suffixes cannot steal natural targets or make missing references resolve', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><path id="arrowhead"/>' +
      '<path id="p-arrowhead"/><path id="p-arrowhead-1"/><path id="arrowhead-2"/>' +
      '<use href="#p-arrowhead-3"/><path marker-end="url(#arrowhead)"/></svg>'
    const elements = xmlElements(namespaceSvgIds(input, 'p-'))
    const ids = elements.flatMap(element => element.attributes.id ? [element.attributes.id] : [])
    expect(new Set(ids).size).toBe(4)
    expect(ids).toContain('p-arrowhead-2')
    expect(ids).not.toContain('p-arrowhead-3')
    expect(elements.find(element => element.name === 'use')!.attributes.href).toBe('#p-arrowhead-3')
    expect(elements.at(-1)!.attributes['marker-end']).toBe(`url(#${ids[0]})`)
  })

  test('two instances of every family have no declaration collisions or dangling refs', () => {
    const documents: string[] = []
    for (const entry of Object.values(METAMORPHIC_FAMILIES)) {
      const source = withAccessibility(entry.build(entry.kRange[0], 'Refs'), entry.family)
      for (const instance of ['left', 'right']) {
        const prefix = `${instance}-${entry.family}-`
        const svg = renderMermaidSVG(source, { embedFontImport: false, idPrefix: prefix, shadow: true })
        const ids = declarations(svg)
        expect(ids.length, `${entry.family} ${instance} declarations`).toBeGreaterThan(0)
        expect(new Set(ids).size, `${entry.family} ${instance} local uniqueness`).toBe(ids.length)
        expect(ids.every(id => id.startsWith(prefix)), `${entry.family} prefix enrollment`).toBe(true)
        const declared = new Set(ids)
        for (const ref of references(svg)) expect(declared.has(ref), `${entry.family} dangling #${ref}`).toBe(true)
        documents.push(svg)
      }
    }
    const combined = documents.flatMap(declarations)
    expect(new Set(combined).size).toBe(combined.length)
  })

  test('rewrites marker/filter/clip-path/paint/href and multi-token ARIA references', () => {
    const input = `<svg aria-labelledby="title desc" aria-describedby="desc">
<defs>
  <marker id="marker"><path /></marker>
  <filter id="filter"><feGaussianBlur /></filter>
  <clipPath id="clip"><rect /></clipPath>
  <linearGradient id="paint"><stop /></linearGradient>
  <path id="shape" />
</defs>
<title id="title">T</title><desc id="desc">D</desc>
<path marker-end="url(#marker)" filter="url(#filter)" clip-path="url(#clip)" fill="url(#paint)" />
<use href="#shape"/><use xlink:href="#shape"/>
</svg>`
    const output = namespaceSvgIds(input, 'diagram-')
    const declared = new Set(declarations(output))
    expect(declared).toEqual(new Set(['diagram-marker', 'diagram-filter', 'diagram-clip', 'diagram-paint', 'diagram-shape', 'diagram-title', 'diagram-desc']))
    expect(new Set(references(output))).toEqual(declared)
    expect(output).not.toMatch(/(?:url\(#|href="#|aria-(?:labelledby|describedby)=")[^\n"]*(?<!diagram-)(?:marker|filter|clip|paint|shape|title|desc)/)
  })

  test('rejects prefixes that could escape an SVG attribute or URL reference', () => {
    expect(() => namespaceSvgIds('<svg><path id="safe"/></svg>', 'bad\" onload="x-'))
      .toThrow('idPrefix must be non-empty and contain only')
  })

  test('does not rewrite user-facing data-id identities', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A --> B', { idPrefix: 'instance-' })
    expect(svg).toContain('data-id="A"')
    expect(svg).not.toContain('data-id="instance-A"')
  })
})
