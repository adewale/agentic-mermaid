// Loop 11 M1 (#7540/#6621): namespace SVG def ids so multiple diagrams on one
// HTML page don't collide on shared def ids (arrowhead, bm-shadow, …).
// Opt-in via RenderOptions.idPrefix; default '' preserves current behavior.

import { describe, test, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { namespaceSvgIds } from '../renderer.ts'

const ids = (s: string) => [...s.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]!)
const refs = (s: string) => [...s.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]!)
const ariaRefs = (s: string) => [...s.matchAll(/\saria-(?:labelledby|describedby)="([^"]+)"/g)]
  .flatMap(m => m[1]!.split(/\s+/).filter(Boolean))

describe('#7540 unique SVG ids across diagrams', () => {
  test('default (no idPrefix) is unchanged — back-compat', () => {
    const s = renderMermaidSVG('flowchart TD\n A[Start]-->B')
    expect(s).toContain('id="arrowhead"')
  })

  test('two diagrams with distinct prefixes have zero colliding ids', () => {
    const a = renderMermaidSVG('flowchart TD\n A[Start]-->B\n A-.->C', { idPrefix: 'd0-' })
    const b = renderMermaidSVG('flowchart LR\n X-->Y\n X-->Z', { idPrefix: 'd1-' })
    const collide = ids(a).filter(x => ids(b).includes(x))
    expect(collide).toEqual([])
    expect(ids(a).every(i => i.startsWith('d0-'))).toBe(true)
    expect(ids(b).every(i => i.startsWith('d1-'))).toBe(true)
  })

  test('all url(#…) references resolve to a declared (prefixed) id — no dangling', () => {
    const a = renderMermaidSVG('flowchart TD\n A[Start]-->B\n A-.->C\n B-->D', { idPrefix: 'd0-' })
    const declared = new Set(ids(a))
    for (const r of refs(a)) expect(declared.has(r)).toBe(true)
    expect(refs(a).every(r => r.startsWith('d0-'))).toBe(true)
  })

  test('same diagram + same prefix is byte-identical (determinism)', () => {
    const src = 'flowchart TD\n A-->B\n B-->C'
    expect(renderMermaidSVG(src, { idPrefix: 'p-' })).toBe(renderMermaidSVG(src, { idPrefix: 'p-' }))
  })

  test('custom-stroke markers (suffixed ids) are also namespaced', () => {
    const a = renderMermaidSVG('flowchart TD\n A-->B\n linkStyle 0 stroke:#f00', { idPrefix: 'q-' })
    expect(ids(a).every(i => i.startsWith('q-'))).toBe(true)
    const declared = new Set(ids(a))
    for (const r of refs(a)) expect(declared.has(r)).toBe(true)
  })

  test('journey markers and accessibility ids are namespaced by idPrefix', () => {
    const src = `journey
  accTitle: Working day
  accDescr: Sentiment across the day
  section Go to work
  Make tea: 5: Me
  Do work: 1: Me, Cat`
    const a = renderMermaidSVG(src, { idPrefix: 'j0-' })
    const b = renderMermaidSVG(src, { idPrefix: 'j1-' })
    expect(ids(a).filter(x => ids(b).includes(x))).toEqual([])
    expect(ids(a).every(i => i.startsWith('j0-'))).toBe(true)
    expect(ids(b).every(i => i.startsWith('j1-'))).toBe(true)
    const declared = new Set(ids(a))
    for (const r of refs(a)) expect(declared.has(r)).toBe(true)
    for (const r of ariaRefs(a)) {
      expect(r.startsWith('j0-')).toBe(true)
      expect(declared.has(r)).toBe(true)
    }
  })

  test('namespaceSvgIds: empty prefix is a no-op', () => {
    const s = renderMermaidSVG('flowchart TD\n A-->B')
    expect(namespaceSvgIds(s, '')).toBe(s)
  })

  test('namespaceSvgIds does not rewrite a url(#…) that is not a declared id', () => {
    // A label that happens to contain url(#foo) text must not be rewritten,
    // since #foo isn't a declared def id.
    const svg = '<svg><defs><marker id="arrowhead"/></defs><text>see url(#external)</text>' +
      '<line marker-end="url(#arrowhead)"/></svg>'
    const out = namespaceSvgIds(svg, 'z-')
    expect(out).toContain('id="z-arrowhead"')
    expect(out).toContain('url(#z-arrowhead)')
    expect(out).toContain('url(#external)') // untouched — not a declared id
  })
})
