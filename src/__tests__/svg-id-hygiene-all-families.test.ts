import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { namespaceSvgIds } from '../renderer.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'

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
