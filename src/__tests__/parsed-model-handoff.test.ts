import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { mutateChecked, parseRegisteredMermaid, renderMermaidASCIIWithReceipt, renderMermaidPNGWithReceipt, renderMermaidSVGWithReceipt, serializeMermaid, type ParsedDiagram } from '../agent/index.ts'
import { renderMermaidSVGWithReceipt as renderRootSVG } from '../index.ts'
import { renderMermaidPNGInBrowserWithReceipt } from '../browser-png.ts'
import { getFamily, replaceFamilyForTest } from '../agent/families.ts'
import { withParserObservation } from '../shared/parser-observation.ts'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import { pngFixture } from './helpers/png-fixture.ts'

const source = `---
title: AgentFlow ownership
config:
  themeVariables:
    primaryColor: '#cde4f7'
---
agentflow-beta LR
  A[Collect]@{ shape: tool }
  B[Publish]
  A --> B
  A@{
    context:
      -
        name: "First"
        values: [1, 2]
      - ["nested", "list"]
  }
`
const options = { embedFontImport: false, bg: '#ffffff', fg: '#172554' }

function parsed(text = source): ParsedDiagram {
  const result = parseRegisteredMermaid(text)
  if (!result.ok) throw new Error(result.error.map(error => error.message).join('; '))
  return result.value
}

test('parsed AgentFlow retains indentation-sensitive source and the same palette, style and receipts as source rendering', () => {
  const diagram = parsed()
  const preserved = serializeMermaid(diagram, { wrapper: 'verbatim' })
  for (const style of [undefined, 'hand-drawn'] as const) {
    const appearance = { ...options, ...(style ? { style } : {}) }
    const expected = renderRootSVG(source, appearance)
    expect(renderRootSVG(diagram, appearance)).toEqual(expected)
    expect(renderMermaidSVGWithReceipt(diagram, appearance)).toEqual(expected)
  }
  expect(serializeMermaid(diagram, { wrapper: 'verbatim' })).toBe(preserved)
})

test('copied public diagrams retain executable YAML and style semantics without native custody', () => {
  const diagram = parsed()
  const reopened = parsed(diagram.canonicalSource)
  if (reopened.body.kind !== 'agentflow') throw new Error('Expected native AgentFlow after reopening public source')
  expect(reopened.body.metadata.get('A')?.context).toEqual([{ name: 'First', values: [1, 2] }, ['nested', 'list']])
  for (const copy of [{ ...diagram }, structuredClone(diagram)]) {
    for (const style of [undefined, 'hand-drawn'] as const) {
      const appearance = { ...options, ...(style ? { style } : {}) }
      const expected = renderRootSVG(source, appearance)
      const actual = renderRootSVG(copy, appearance)
      expect(actual.svg).toBe(expected.svg)
      expect(actual.receipt.appearanceDigest).toBe(expected.receipt.appearanceDigest)
    }
  }
})

test('AgentFlow source-map locations address its published indentation-preserving canonical source', () => {
  const diagram = parsed('agentflow-beta LR\n\n  A[Collect]@{ shape: tool }\n  B[Publish]\n  A --> B')
  const location = diagram.source.nodes.get('A')!
  expect(location).toEqual({ line: 3, col: 3 })
  expect(diagram.canonicalSource.split('\n')[location.line - 1]!.slice(location.col - 1, location.col)).toBe('A')
})

test('source edits invalidate an owned handoff; public body edits retain the family canonical-source authority', () => {
  const diagram = parsed('agentflow-beta LR\nA[Original] --> B[Publish]')
  if (diagram.body.kind !== 'agentflow') throw new Error('Expected native AgentFlow')
  diagram.body.graph.nodes.get('A')!.label = 'Caller body edit'
  expect(renderRootSVG(diagram, options).svg).toContain('Original')
  const changed = 'agentflow-beta LR\nA[Source edit] --> B[Publish]'
  Object.assign(diagram, { canonicalSource: changed })
  expect(renderRootSVG(diagram, options)).toEqual(renderRootSVG(changed, options))
  expect(renderRootSVG(diagram, options).svg).toContain('Source edit')
})

test('typed edits render their newly admitted source and retain nested metadata', () => {
  const diagram = parsed()
  const changed = mutateChecked(diagram, { kind: 'set_label', target: 'A', label: 'Edited collection' })
  if (!changed.ok) throw new Error(changed.error.message)
  expect(renderRootSVG(changed.value, options)).toEqual(renderRootSVG(serializeMermaid(changed.value), options))
  expect(renderRootSVG(changed.value, options).svg).toContain('Edited collection')
  expect(renderRootSVG(diagram, options).svg).toContain('Collect')
})

test('terminal rendering consumes the same owned model while preserving its source receipt', () => {
  const diagram = parsed()
  let statements = 0
  const actual = withParserObservation('agentflow', event => {
    if (event.unit === 'statement') statements++
  }, () => renderMermaidASCIIWithReceipt(diagram, { colorMode: 'none' }))
  expect(statements).toBe(0)
  expect(actual).toEqual(renderMermaidASCIIWithReceipt(source, { colorMode: 'none' }))
})

test('native and browser PNG transport the owned model with the same drawing and receipt as source', async () => {
  const diagram = parsed()
  const pngOptions = { ...options, onWarning: () => {} }
  expect(renderMermaidPNGWithReceipt(diagram, pngOptions)).toEqual(renderMermaidPNGWithReceipt(source, pngOptions))
  const browser = async (input: ParsedDiagram | string) => {
    let projected = ''
    const result = await renderMermaidPNGInBrowserWithReceipt(input, options, { scale: 1 }, async (svg, context) => {
      projected = svg
      return {
        png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height),
        fontSources: ['embedded-data-uri'],
      }
    })
    return { projected, result }
  }
  expect(await browser(diagram)).toEqual(await browser(source))
})

test('only a source-bound model owned by the current producer skips parser work', () => {
  const diagram = parsed()
  const render = (value: ParsedDiagram) => {
    let statements = 0
    const rendered = withPerformanceExperiments([], () => withParserObservation('agentflow', event => {
      if (event.unit === 'statement') statements++
    }, () => renderRootSVG(value, options)))
    return { statements, rendered }
  }
  const owned = render(diagram)
  expect(owned.statements).toBe(0)
  // A copied public envelope conveys data, never native parser custody.
  const copy = render({ ...diagram, canonicalSource: source })
  expect(copy.statements).toBeGreaterThan(0)
  expect(copy.rendered).toEqual(owned.rendered)
  const original = getFamily('agentflow')!
  const restore = replaceFamilyForTest('agentflow', { ...original })
  try {
    const replaced = render(diagram)
    expect(replaced.statements).toBeGreaterThan(0)
    expect(replaced.rendered).toEqual(owned.rendered)
  } finally { restore() }
  expect(render(diagram).statements).toBe(0)
})

test('wrapper edits still control configuration and source receipts', () => {
  const diagram = parsed('agentflow-beta LR\nA[Collect] --> B[Publish]')
  diagram.meta.frontmatter = { title: 'Changed title', config: { themeVariables: { primaryColor: '#d6ffd6' } } }
  diagram.meta.wrapperSource = undefined
  const expected = serializeMermaid(diagram)
  const actual = renderRootSVG(diagram, options)
  const reloaded = renderRootSVG(expected, options)
  expect(actual.svg).toBe(reloaded.svg)
  expect(actual.receipt.appearanceDigest).toBe(reloaded.receipt.appearanceDigest)
})

test('editing the directive envelope cannot leave an older body-authored config layer active', () => {
  const authored = 'agentflow-beta LR\n%%{init: {"themeVariables":{"primaryColor":"#f0b0b0"}}}%%\nA[Collect] --> B[Publish]'
  for (const diagram of [parsed(authored), structuredClone(parsed(authored))]) {
    diagram.meta.initDirectives.length = 0
    const body = 'agentflow-beta LR\nA[Collect] --> B[Publish]'
    expect(renderRootSVG(diagram, options)).toEqual(renderRootSVG(body, options))
    const directive = '%%{init: {"themeVariables":{"primaryColor":"#c0ffd0"}}}%%'
    diagram.meta.initDirectives.push({ raw: directive, parsed: { themeVariables: { primaryColor: '#c0ffd0' } } })
    expect(renderRootSVG(diagram, options)).toEqual(renderRootSVG(`${directive}\n${body}`, options))
  }
})

test('unowned and cross-realm parsed objects use current source, and wrong family cannot borrow a native model', () => {
  const diagram = parsed('agentflow-beta LR\nA[Original] --> B[Publish]')
  const current = 'agentflow-beta LR\nA[Unowned source] --> B[Publish]'
  const foreign = runInNewContext('({ ...diagram, canonicalSource: source })', { diagram, source: current }) as ParsedDiagram
  for (const value of [{ ...diagram, canonicalSource: current }, foreign]) {
    expect(renderRootSVG(value, options)).toEqual(renderRootSVG(current, options))
  }
  Object.assign(diagram, { kind: 'flowchart' })
  expect(() => renderRootSVG(diagram, options)).toThrow(/serialized as family "agentflow"/)
})

test('preserved and opaque bodies cannot acquire an executable native model', () => {
  const preserved = parsed('futureFamily\npayload')
  expect(() => renderRootSVG(preserved, options)).toThrow()
  const opaque = parsed('agentflow-beta LR\nA[Original] --> B[Publish]')
  Object.assign(opaque, { body: { kind: 'opaque', family: 'agentflow', source: 'agentflow-beta LR\nA[Opaque]' }, canonicalSource: 'agentflow-beta LR\nA[Current opaque]' })
  expect(renderRootSVG(opaque, options).svg).toContain('Current opaque')
})
