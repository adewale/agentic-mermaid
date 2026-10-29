import { expect, test } from 'bun:test'
import { projectSvgCss, scanSvgStartTags, svgRootStartTag, transformSvgCssValues, svgStyleRanges } from '../svg-structure.ts'
import { withSvgInspectionCache } from '../svg-inspection-cache.ts'
import { applyOutputSecurityPolicy, verifyNoExternalRefs } from '../output-security.ts'

test('inspection evidence is immutable, exact-byte keyed, and mode independent', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com"><text>safe</text></a></svg>'
  withSvgInspectionCache(() => {
    const tags = scanSvgStartTags(source)
    expect(scanSvgStartTags(source)).toBe(tags)
    expect(Object.isFrozen(tags)).toBe(true)
    expect(Object.isFrozen(tags[1]!.attributes)).toBe(true)
    expect(Object.isFrozen(tags[1])).toBe(true)
    expect(Object.isFrozen(tags[1]!.attributes[0])).toBe(true)
    expect(() => { (tags[1]!.attributes[0] as { value: string }).value = '#local' }).toThrow()
    const findings = verifyNoExternalRefs(source)
    findings.refs.length = 0
    expect(verifyNoExternalRefs(source).ok).toBe(false)
    expect(applyOutputSecurityPolicy(source).diagnostics.length).toBeGreaterThan(0)
    expect(() => applyOutputSecurityPolicy(source, 'strict')).toThrow(/strict/)
    const rewritten = source.replace('https://example.com', 'javascript:alert(1)')
    expect(() => applyOutputSecurityPolicy(rewritten)).toThrow(/active content/)
    expect(() => applyOutputSecurityPolicy(source.replace('</svg>', ''))).toThrow(/envelope/)
  })
  expect(svgRootStartTag('<!--not a root--><svg></svg>')).toBeUndefined()
  expect(svgRootStartTag(' <svg data-label="a > b"><text>ok</text></svg>')?.attributes[0]?.value).toBe('a > b')
})

test('lexical inventories preserve quoted boundaries and skip comments and processing instructions', () => {
  const source = `<!--<g fill="hidden">--><?xml skip?><svg data-note="a > b"><g fill='red'/><path d="M0 0" /></svg>`
  expect(scanSvgStartTags(source).map(tag => [tag.name, source.slice(tag.start, tag.end), tag.selfClosing])).toEqual([
    ['svg', '<svg data-note="a > b">', false],
    ['g', "<g fill='red'/>", true],
    ['path', '<path d="M0 0" />', true],
  ])
  expect(scanSvgStartTags("<svg><g fill='red'/></svg>")).toEqual([
    { name: 'svg', start: 0, end: 5, selfClosing: false, attributes: [] },
    { name: 'g', start: 5, end: 20, selfClosing: true, attributes: [
      { name: 'fill', value: 'red', quote: "'", nameStart: 8, valueStart: 14, valueEnd: 17 },
    ] },
  ])
})

test('style-body ranges ignore attributes, comments and self-closing or differently cased tags', () => {
  const source = '<svg style="--ignored:red"><!--<style>hidden</style>--><style data-note="a > b" broken=no>.x{fill:red}</style><style/><STYLE>upper</STYLE><style>.y{fill:blue}</style></svg>'
  const ranges = svgStyleRanges(source)
  expect(ranges.map(range => source.slice(range.start, range.end))).toEqual(['.x{fill:red}', '.y{fill:blue}'])
  expect(svgStyleRanges('<svg><style>unclosed')).toEqual([])
})

for (const [source, cssValues, contexts, transformed] of [
  [
    '<svg style="--ink:red" data-note="red > blue"><style>.x{fill:red}</style><g fill="red" data-paint="red"/><text>red</text></svg>',
    ['--ink:red', '.x{fill:red}', 'red'], ['--ink:red', '.x{fill:red}'],
    '<svg style="--ink:tan" data-note="red > blue"><style>.x{fill:tan}</style><g fill="tan" data-paint="red"/><text>red</text></svg>',
  ],
  [
    '<svg><!--<g fill="red"/>--><style/><STYLE>red</STYLE><g fill="red" broken=unquoted stroke="red"/></svg>',
    ['red'], [],
    '<svg><!--<g fill="red"/>--><style/><STYLE>red</STYLE><g fill="tan" broken=unquoted stroke="red"/></svg>',
  ],
  [
    '<svg><style><![CDATA[.x{content:\'<g fill="red">\';fill:red}]]></style></svg>',
    ['<![CDATA[.x{content:\'<g fill="red">\';fill:red}]]>', 'red'],
    ['<![CDATA[.x{content:\'<g fill="red">\';fill:red}]]>'],
    '<svg><style><![CDATA[.x{content:\'<g fill="tan">\';fill:tan}]]></style></svg>',
  ],
] as const) {
  test(`CSS projections retain only selected contexts: ${source}`, () => {
    const projection = projectSvgCss(source)
    expect(projection.source).toBe(source)
    expect(projection.cssRanges.map(range => source.slice(range.start, range.end))).toEqual([...cssValues])
    expect(projection.styleContexts.map(range => source.slice(range.start, range.end))).toEqual([...contexts])
    expect(transformSvgCssValues(source, css => css.replaceAll('red', 'tan'), projection)).toBe(transformed)
    expect(() => transformSvgCssValues(`${source} `, css => css, projection)).toThrow(/does not match/)
    expect(() => transformSvgCssValues(source.replace('svg', 'SVG'), css => css, projection)).toThrow(/does not match/)
  })
}
