import { expect, test } from 'bun:test'
import { projectSvgCss, scanSvgStartTags, svgRootStartTag, transformSvgCssValues, visitSvgStartTags } from '../svg-structure.ts'
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

test('selected lexical visits skip attributes while preserving quoted tag boundaries', () => {
  const source = `<!--<g fill="hidden">--><?xml skip?><svg data-note="a > b"><g fill='red'/><path d="M0 0" /></svg>`
  const events: string[] = []
  visitSvgStartTags(source, {
    startTag(name, start, end, selfClosing) {
      events.push(`${name}:${source.slice(start, end)}:${selfClosing}`)
      return name === 'g'
    },
    attribute(name, nameStart, valueStart, valueEnd, quote) {
      events.push(`${name}:${source.slice(nameStart, valueStart - 2)}:${source.slice(valueStart, valueEnd)}:${quote}`)
    },
    endTag() { events.push('end') },
  })
  expect(events).toEqual([
    'svg:<svg data-note="a > b">:false', 'end',
    "g:<g fill='red'/>:true", "fill:fill:red:'", 'end',
    'path:<path d="M0 0" />:true', 'end',
  ])
  expect(scanSvgStartTags("<svg><g fill='red'/></svg>")).toEqual([
    { name: 'svg', start: 0, end: 5, selfClosing: false, attributes: [] },
    { name: 'g', start: 5, end: 20, selfClosing: true, attributes: [
      { name: 'fill', value: 'red', quote: "'", nameStart: 8, valueStart: 14, valueEnd: 17 },
    ] },
  ])
})

for (const [source, cssValues, contexts, styles, transformed] of [
  [
    '<svg style="--ink:red" data-note="red > blue"><style>.x{fill:red}</style><g fill="red" data-paint="red"/><text>red</text></svg>',
    ['--ink:red', '.x{fill:red}', 'red'], ['--ink:red', '.x{fill:red}'], ['.x{fill:red}'],
    '<svg style="--ink:tan" data-note="red > blue"><style>.x{fill:tan}</style><g fill="tan" data-paint="red"/><text>red</text></svg>',
  ],
  [
    '<svg><!--<g fill="red"/>--><style/><STYLE>red</STYLE><g fill="red" broken=unquoted stroke="red"/></svg>',
    ['red'], [], [],
    '<svg><!--<g fill="red"/>--><style/><STYLE>red</STYLE><g fill="tan" broken=unquoted stroke="red"/></svg>',
  ],
  [
    '<svg><style><![CDATA[.x{content:\'<g fill="red">\';fill:red}]]></style></svg>',
    ['<![CDATA[.x{content:\'<g fill="red">\';fill:red}]]>', 'red'],
    ['<![CDATA[.x{content:\'<g fill="red">\';fill:red}]]>'],
    ['<![CDATA[.x{content:\'<g fill="red">\';fill:red}]]>'],
    '<svg><style><![CDATA[.x{content:\'<g fill="tan">\';fill:tan}]]></style></svg>',
  ],
] as const) {
  test(`CSS projections retain only selected contexts: ${source}`, () => {
    const projection = projectSvgCss(source)
    expect(projection.source).toBe(source)
    expect(projection.cssRanges.map(range => source.slice(range.start, range.end))).toEqual([...cssValues])
    expect(projection.styleContexts.map(range => source.slice(range.start, range.end))).toEqual([...contexts])
    expect(projection.styleRanges.map(range => source.slice(range.start, range.end))).toEqual([...styles])
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.cssRanges)).toBe(true)
    expect(projection.cssRanges.every(Object.isFrozen)).toBe(true)
    expect(transformSvgCssValues(source, css => css.replaceAll('red', 'tan'), projection)).toBe(transformed)
    expect(() => transformSvgCssValues(`${source} `, css => css, projection)).toThrow(/does not match/)
    expect(() => transformSvgCssValues(source.replace('svg', 'SVG'), css => css, projection)).toThrow(/does not match/)
  })
}
