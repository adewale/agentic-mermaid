import { renderMultilineText } from '../multiline-utils.ts'
import { expect, test } from 'bun:test'
import { shape, text } from '../scene/marks.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { inlineResolvedColors } from '../theme.ts'
import { formatSvgNumbers, namespaceSvgIds, compactSvg } from '../svg-postprocess.ts'
import { scopeSvgStyles } from '../svg-style-scope.ts'
import { applyOutputSecurityPolicy, applyWrittenOutputSecurityPolicy, verifySvgDocumentEnvelope, verifySvgDocumentDataPositions } from '../output-security.ts'
import { transformSvgAttributes, scanSvgStartTags } from '../svg-structure.ts'


const document = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`
const mark = (fill = 'var(--ink)', stroke = 'none') => sceneNodeSerialization(shape({
  id: 'written-security', role: 'node', geometry: { kind: 'rect', x: 1 / 3, y: 2, width: 30, height: 20 },
  paint: { fill, stroke }, attributes: { data: { note: 'stroke= then fill=; var(--ink)' } },
}))
const outcome = (svg: string, strict: boolean, written: boolean): unknown => {
  try { return (written ? applyWrittenOutputSecurityPolicy : applyOutputSecurityPolicy)(svg, strict ? 'strict' : 'default') }
  catch (error) { return String(error) }
}

test('emitted bytes cannot replace paid XML work or text-position checks', () => {
  const emitted = mark('#123456')
  const svg = document(`${emitted}<text> </text>`, 'data-note=" "')
  expect(verifySvgDocumentEnvelope(svg)).toBe(true)
  expect(verifySvgDocumentEnvelope(svg, () => false)).toBe(false)
  expect(verifySvgDocumentDataPositions(svg, [svg.indexOf('data-note="') + 'data-note="'.length])).toBe(false)
  expect(verifySvgDocumentDataPositions(svg, [svg.indexOf('<text>') + '<text>'.length])).toBe(true)
})

test('inherited parser metadata cannot allow elements inside style text', () => {
  Object.defineProperty(Object.prototype, 'styleStart', { configurable: true, get: () => 0 })
  try {
    const svg = document('<g></g><style><path /></style>')
    expect(() => applyOutputSecurityPolicy(svg)).toThrow('invalid SVG document envelope')
    expect(() => applyWrittenOutputSecurityPolicy(svg)).toThrow('invalid SVG document envelope')
  } finally { delete (Object.prototype as { styleStart?: number }).styleStart }
})

// Independent oracle is the unchanged full-byte admission path. Explicit
// negative expectations also prevent shared acceptance bugs hiding a decline.
test('writer-owned admission agrees with full scanning after color, numeric, identity and style projections', () => {
  const raw = document(`<style>svg { --ink: #123456; }</style>${mark()}`)
  const final = compactSvg(scopeSvgStyles(formatSvgNumbers(namespaceSvgIds(inlineResolvedColors(raw, { bg: '#fff', fg: '#111' }), 'written-'))))
  expect(final).toContain('fill="#123456"')
  expect(applyWrittenOutputSecurityPolicy(final, 'strict')).toEqual(applyOutputSecurityPolicy(final, 'strict'))
})

test('changed attributes are admitted again in lexical diagnostic order', () => {
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
})

test('rewrites and document context retain final-byte security admission', () => {
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
})

test('opaque styles, comments and namespace references agree with full scanning', () => {
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
})

test('writer-owned admission inspects styles closed with XML whitespace', () => {
  for (const whitespace of [' ', '\t', '\r', '\n', ' \t\r\n']) {
    const style = (css: string) => document(`<style>.a{fill:${css}}</style${whitespace}>${mark('none')}`)
    const safe = style('url(#local)')
    expect(applyWrittenOutputSecurityPolicy(safe, 'strict')).toEqual({ svg: safe, diagnostics: [] })
    const external = style('url(https://example.invalid/style.svg)')
    expect(applyWrittenOutputSecurityPolicy(external).diagnostics).toEqual([
      { code: 'EXTERNAL_REFERENCE', reference: 'url(https://example.invalid/style.svg)' },
    ])
    expect(() => applyWrittenOutputSecurityPolicy(external, 'strict')).toThrow(/strict/)
    for (const mode of ['default', 'strict'] as const) {
      expect(() => applyWrittenOutputSecurityPolicy(style('url(javascript:alert(1))'), mode)).toThrow(/active content/)
    }
  }
})

test('style element children cannot hide outer CSS', () => {
  for (const body of [
    '<style><style></style>.x{fill:url(https://example.invalid/outer.svg)}</style>',
    '<style><style></style>.x{fill:url(javascript:alert(1))}</style>',
    `<style>.x{fill:ur${mark('none')}l(https://example.invalid/split.svg)}</style>`,
  ]) {
    for (const mode of ['default', 'strict'] as const) {
      expect(() => applyWrittenOutputSecurityPolicy(document(body), mode)).toThrow(/invalid SVG document envelope/)
    }
  }
  const safe = document(`<style><!-- <style> -->.x{fill:url(#local)}</style >${mark('none')}`)
  expect(applyWrittenOutputSecurityPolicy(safe, 'strict')).toEqual({ svg: safe, diagnostics: [] })
})

test('typed multiline, formatted and fragmented text retain literal and XML semantics', () => {
  for (const value of ['<script>& var(--fg)', 'line one\nline two', '東京 👩‍💻 &amp;', 'plain **bold** text']) {
    const rendered = sceneNodeSerialization(text({ id: 'written-label', role: 'label', text: value, x: 10, y: 10, fontSize: 12,
      anchor: 'start', paint: { fill: 'var(--fg)' }, display: 'formatted', letterSpacing: 1 }))
    const svg = inlineResolvedColors(document(rendered), { bg: '#fff', fg: '#111' })
    expect(applyWrittenOutputSecurityPolicy(svg, 'strict')).toEqual(applyOutputSecurityPolicy(svg, 'strict'))
  }
})

test('text attributes cannot carry an event handler past admission', () => {
  const svg = document(renderMultilineText('safe', 0, 0, 12, 'onload="alert(1)"', 0, false))
  expect(() => applyWrittenOutputSecurityPolicy(svg)).toThrow(/active content/)
})
