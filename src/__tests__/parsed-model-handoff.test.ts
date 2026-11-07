import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { mutateChecked, parseRegisteredMermaid, renderMermaidSVGWithReceipt, serializeMermaid, type ParsedDiagram } from '../agent/index.ts'
import { renderMermaidSVGWithReceipt as renderRootSVG } from '../index.ts'
import { getFamily, replaceFamilyForTest } from '../agent/families.ts'
import { withParserObservation } from '../shared/parser-observation.ts'

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

test('only a source-bound model owned by the current producer skips parser work', () => {
  const diagram = parsed()
  const render = (value: ParsedDiagram) => {
    let statements = 0
    const rendered = withParserObservation('agentflow', event => {
      if (event.unit === 'statement') statements++
    }, () => renderRootSVG(value, options))
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
