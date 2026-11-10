import { renderMultilineText } from '../multiline-utils.ts'
import { expect, test } from 'bun:test'
import { shape, text } from '../scene/marks.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { inlineResolvedColors } from '../theme.ts'
import { formatSvgNumbers, namespaceSvgIds, compactSvg } from '../svg-postprocess.ts'
import { scopeSvgStyles } from '../svg-style-scope.ts'
import { applyOutputSecurityPolicy, applyWrittenOutputSecurityPolicy } from '../output-security.ts'
import { transformSvgAttributes, scanSvgStartTags } from '../svg-structure.ts'
import { writtenTagOf, withWrittenSvgSecurity } from '../svg-writer-evidence.ts'

const document = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`
const mark = (fill = 'var(--ink)', stroke = 'none') => sceneNodeSerialization(shape({
  id: 'written-security', role: 'node', geometry: { kind: 'rect', x: 1 / 3, y: 2, width: 30, height: 20 },
  paint: { fill, stroke }, attributes: { data: { note: 'stroke= then fill=; var(--ink)' } },
}))
const outcome = (svg: string, strict: boolean, written: boolean): unknown => {
  try { return (written ? applyWrittenOutputSecurityPolicy : applyOutputSecurityPolicy)(svg, strict ? 'strict' : 'default') }
  catch (error) { return String(error) }
}

// Independent oracle is the unchanged full-byte admission path. Explicit
// negative expectations also prevent shared acceptance bugs hiding a decline.
test('writer findings follow final color, numeric, identity and style projections', () => withWrittenSvgSecurity(true, () => {
  const raw = document(`<style>svg { --ink: #123456; }</style>${mark()}`)
  const final = compactSvg(scopeSvgStyles(formatSvgNumbers(namespaceSvgIds(inlineResolvedColors(raw, { bg: '#fff', fg: '#111' }), 'written-'))))
  expect(final).toContain('fill="#123456"')
  const tag = scanSvgStartTags(final).find(tag => tag.name === 'rect')!
  expect(writtenTagOf(final.slice(tag.start, tag.end))).toBeDefined()
  expect(applyWrittenOutputSecurityPolicy(final, 'strict')).toEqual(applyOutputSecurityPolicy(final, 'strict'))
}))

test('changed attributes replace their findings and retain lexical diagnostic order', () => withWrittenSvgSecurity(true, () => {
  const raw = document(mark('url(https://example.com/old-fill)', 'url(https://example.com/old-stroke)'))
  const changed = transformSvgAttributes(raw, attribute => attribute.name === 'fill' ? 'url(https://example.com/new-fill)'
    : attribute.name === 'stroke' ? 'url(https://example.com/new-stroke)' : undefined)
  expect(applyWrittenOutputSecurityPolicy(changed, 'default').diagnostics.map(item => item.reference)).toEqual([
    'fill=url(https://example.com/new-fill)', 'stroke=url(https://example.com/new-stroke)',
  ])
  const cleared = transformSvgAttributes(changed, attribute => attribute.name === 'fill' || attribute.name === 'stroke' ? 'none' : undefined)
  expect(applyWrittenOutputSecurityPolicy(cleared, 'strict').diagnostics).toEqual([])
  const active = transformSvgAttributes(cleared, attribute => attribute.name === 'fill' ? 'url(javascript:alert(1))' : undefined)
  expect(() => applyWrittenOutputSecurityPolicy(active, 'default')).toThrow(/active content/)
}))

test('unrecorded rewrites and document context retain final-byte security admission', () => withWrittenSvgSecurity(true, () => {
  const emitted = mark('#123456')
  const unsafe = [
    document(emitted.replace(' />', ' onload="alert(1)" />')),
    document(emitted.replace(' />', ' fill="red" />')),
    document(`<g xmlns="urn:other">${emitted}</g>`),
    document(`<foreignObject>${emitted}</foreignObject>`),
    document(emitted).replace('</svg>', ''),
    document(emitted + '\u0000'),
  ]
  for (const svg of unsafe) {
    expect(typeof outcome(svg, true, true)).toBe('string')
    expect(outcome(svg, true, true)).toEqual(outcome(svg, true, false))
  }
  const injection = transformSvgAttributes(document(emitted), attribute => attribute.name === 'fill' ? 'red" onload="alert(1)' : undefined)
  expect(() => applyWrittenOutputSecurityPolicy(injection, 'default')).toThrow(/active content/)
}))

test('opaque styles, comments and namespace references agree with full scanning', () => withWrittenSvgSecurity(true, () => {
  const emitted = mark('#123456')
  const cases = [
    document(`<style>.a{fill:url(https://example.com/a)}</style>${emitted}`),
    document(`<style>.a{content:'${emitted}';fill:url(https://example.com/b)}</style>`),
    document(`<style/>url(https://example.com/between)<style>none</style>${emitted}`),
    document(`<style-extra>url(https://example.com/prefix)</style-extra><style>none</style>${emitted}`),
    document(`<STYLE>.a{fill:url(https://example.com/c)}</STYLE>${emitted}`),
    document(`<style>/* </style> */</style>${emitted}`),
    document(`<style>.a{}<style>.b{fill:url(https://example.com/d)}</style>.c{}</style>${emitted}`),
    document(`<!--<script/>--><style>/*<!-- url(https://example.com/hidden) -->*/ .a{fill:none}</style>${emitted}`),
    document(emitted, 'xml:base="https://example.com/base"'),
    document(`<image href="https://example.com/image"/>${emitted}`),
    document(`<animate-extra/>${emitted}`),
  ]
  for (const svg of cases) for (const strict of [false, true]) expect(outcome(svg, strict, true)).toEqual(outcome(svg, strict, false))
  expect(() => applyWrittenOutputSecurityPolicy(cases[0]!, 'strict')).toThrow(/strict/)
}))

test('typed multiline, formatted and fragmented text retain literal and XML semantics', () => withWrittenSvgSecurity(true, () => {
  for (const value of ['<script>& var(--fg)', 'line one\nline two', '東京 👩‍💻 &amp;', 'plain **bold** text']) {
    const rendered = sceneNodeSerialization(text({ id: 'written-label', role: 'label', text: value, x: 10, y: 10, fontSize: 12,
      anchor: 'start', paint: { fill: 'var(--fg)' }, display: 'formatted', letterSpacing: 1 }))
    const svg = inlineResolvedColors(document(rendered), { bg: '#fff', fg: '#111' })
    expect(applyWrittenOutputSecurityPolicy(svg, 'strict')).toEqual(applyOutputSecurityPolicy(svg, 'strict'))
    const root = scanSvgStartTags(svg).find(tag => tag.name === 'text')!
    expect(writtenTagOf(svg.slice(root.start, root.end))).toBeDefined()
  }
}))

test('evicted writer evidence falls back to full admission with the same denied reference', () => withWrittenSvgSecurity(true, () => {
  const first = mark('url(https://example.com/evicted)')
  for (let i = 0; i < 96; i++) sceneNodeSerialization(shape({ id: `pressure-${i}`, role: 'node',
    geometry: { kind: 'rect', x: i, y: 0, width: 1, height: 1 }, paint: { fill: 'none' },
    attributes: { data: { pressure: `${i}:${'x'.repeat(16384)}` } },
  }))
  expect(writtenTagOf(first)).toBeUndefined()
  expect(applyWrittenOutputSecurityPolicy(document(first)).diagnostics).toEqual([
    { code: 'EXTERNAL_REFERENCE', reference: 'fill=url(https://example.com/evicted)' },
  ])
  expect(() => applyWrittenOutputSecurityPolicy(document(first), 'strict')).toThrow(/strict/)
}))

test('forged text attribute evidence cannot authorize an event handler', () => withWrittenSvgSecurity(true, () => {
  const attrs = 'onload="alert(1)"'
  const forged = Object.freeze({ text: attrs, fields: Object.freeze(['data-note', 'safe']) })
  const svg = document(renderMultilineText('safe', 0, 0, 12, attrs, 0, false, forged))
  expect(() => applyWrittenOutputSecurityPolicy(svg)).toThrow(/active content/)
}))
