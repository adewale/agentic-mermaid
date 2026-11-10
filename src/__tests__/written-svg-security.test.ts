import { renderMultilineText } from '../multiline-utils.ts'
import { expect, test } from 'bun:test'
import { useTestChildren } from './helpers/test-child.ts'
import { shape, text } from '../scene/marks.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { inlineResolvedColors } from '../theme.ts'
import { formatSvgNumbers, namespaceSvgIds, compactSvg } from '../svg-postprocess.ts'
import { scopeSvgStyles } from '../svg-style-scope.ts'
import { applyOutputSecurityPolicy, applyWrittenOutputSecurityPolicy } from '../output-security.ts'
import { transformSvgAttributes, scanSvgStartTags } from '../svg-structure.ts'
import { writtenTagOf, withWrittenSvgSecurity, retainWrittenFields } from '../svg-writer-evidence.ts'

const runChild = useTestChildren(20_000)

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

test('writer-assisted admission inspects styles closed with XML whitespace', () => withWrittenSvgSecurity(true, () => {
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
}))

test('style element children cannot inherit writer evidence or hide outer CSS', () => withWrittenSvgSecurity(true, () => {
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
  for (let i = 0; i < 192; i++) sceneNodeSerialization(shape({ id: `pressure-${i}`, role: 'node',
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

// Exercise Node's substring storage, where visible string length does not
// bound retained parent bytes. The wide margin checks source lifetime rather
// than pinning the allocator's exact heap size.
test('bounded writer evidence does not retain large parents of short fields', async () => {
  const child = await runChild('node', ['--expose-gc', '--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import { getHeapStatistics } from 'node:v8'
    import { retainWrittenFields, withWrittenSvgSecurity } from './src/svg-writer-evidence.ts'
    import { applyWrittenOutputSecurityPolicy } from './src/output-security.ts'
    const used = () => { for (let i = 0; i < 3; i++) globalThis.gc(); return getHeapStatistics().used_heap_size }
    for (const field of ['paint', 'name']) {
      const before = used()
      withWrittenSvgSecurity(true, () => {
        for (let i = 0; i < 64; i++) {
          const prefix = field === 'paint' ? 'url(https://example.com/' + i + ')' : 'data-key-' + String(i).padStart(10, '0')
          const source = prefix + ' '.repeat(1_000_000)
          source.charCodeAt(source.length - 1)
          const slice = source.slice(0, prefix.length)
          const name = field === 'paint' ? 'fill' : slice
          const value = field === 'paint' ? slice : 'safe'
          retainWrittenFields('<rect ' + name + '="' + value + '" />', 'rect', [name, value], true)
        }
      })
      const retained = used() - before
      assert.ok(retained < 16 * 1024 * 1024, field + ' pinned large source strings: ' + retained)
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.com/0)" /></svg>'
    assert.throws(() => applyWrittenOutputSecurityPolicy(svg, 'strict'), /strict/)
    assert.deepEqual(applyWrittenOutputSecurityPolicy(svg).diagnostics, [
      { code: 'EXTERNAL_REFERENCE', reference: 'fill=url(https://example.com/0)' },
    ])
  `], { cwd: `${import.meta.dir}/../..` })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
})


test('current SVG findings expire with execution and restore after an opaque nested call', () => {
  const payload = 'x'.repeat(1100000)
  const opening = `<rect data-note="${payload}" fill="url(https://example.com/scoped)" />`
  withWrittenSvgSecurity(true, () => {
    retainWrittenFields(opening, 'rect', ['data-note', payload, 'fill', 'url(https://example.com/scoped)'], true)
    expect(writtenTagOf(opening)).toBeDefined()
    expect(() => applyWrittenOutputSecurityPolicy(document(opening), 'strict')).toThrow(/strict/)
    expect(() => withWrittenSvgSecurity(false, () => {
      expect(writtenTagOf(opening)).toBeUndefined()
      throw new Error('opaque backend failed')
    })).toThrow('opaque backend failed')
    expect(writtenTagOf(opening)).toBeDefined()
    const inner = opening.replace('/scoped)', '/nested)')
    withWrittenSvgSecurity(true, () => {
      expect(writtenTagOf(opening)).toBeUndefined()
      retainWrittenFields(inner, 'rect', ['data-note', payload, 'fill', 'url(https://example.com/nested)'], true)
      expect(writtenTagOf(inner)).toBeDefined()
    })
    expect(writtenTagOf(opening)).toBeDefined()
    expect(writtenTagOf(inner)).toBeUndefined()
  })
  expect(writtenTagOf(opening)).toBeUndefined()
  expect(() => applyOutputSecurityPolicy(document(opening), 'strict')).toThrow(/strict/)
})
