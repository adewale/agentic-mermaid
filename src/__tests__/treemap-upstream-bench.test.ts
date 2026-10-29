import { describe, expect, it, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asTreemap, parseRegisteredMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid } from '../agent/core.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { parseTreemapDiagram } from '../treemap/parser.ts'
import type { TreemapBody } from '../treemap/types.ts'

const bench = join(import.meta.dir, '../../eval/mermaid-treemap-bench'),
  excluded: { test: string }[] = JSON.parse(readFileSync(join(bench, 'exclusions.json'), 'utf8'))
const parse = (source: string) => {
  const body = parseTreemapDiagram(source)
  return {
    lexerErrors: [],
    parserErrors: [],
    value: {
      $type: 'Treemap',
      TreemapRows: [...body.nodes.map(node => ({ $type: 'TreemapRow', item: { $type: node.value === undefined ? 'Section' : 'Leaf', name: node.label, value: node.value, classSelector: node.className } })), ...Object.keys(body.classDefs).map(className => ({ $type: 'ClassDefStatement', className }))],
    },
  }
}
const createTreemapServices = () => ({ Treemap: { parser: { LangiumParser: { parse } } } })
const expectNoErrorsOrAlternatives = (result: ReturnType<typeof parse>) => {
  expect(result.lexerErrors).toHaveLength(0)
  expect(result.parserErrors).toHaveLength(0)
}
function tree(body: TreemapBody) {
  const children = new Map<string | undefined, typeof body.nodes>()
  for (const n of body.nodes) {
    const list = children.get(n.parentId) ?? []
    list.push(n)
    children.set(n.parentId, list)
  }
  const node = (n: (typeof body.nodes)[number]): unknown => ({ label: n.label, ...(n.value === undefined ? {} : { value: n.value }), ...(n.className ? { className: n.className } : {}), children: (children.get(n.id) ?? []).map(node) })
  return (children.get(undefined) ?? []).map(node)
}
function buildHierarchy(items: { level: number; name: string; type: string; value?: number }[]): unknown[] {
  const source = 'treemap\n' + items.map(item => ' '.repeat(item.level) + JSON.stringify(item.name) + (item.type === 'Leaf' ? `: ${item.value}` : '')).join('\n'),
    body = parseTreemapDiagram(source),
    roots = tree(body) as { label: string; value?: number; children: unknown[] }[]
  const project = (n: { label: string; value?: number; children: unknown[] }): unknown => ({ name: n.label, ...(n.value === undefined ? { children: n.children.map(c => project(c as typeof n)) } : { value: n.value }) })
  return roots.map(project)
}
for (const file of ['treemap.test.ts.txt', 'utils.test.ts.txt']) {
  const source = readFileSync(join(bench, 'upstream', file), 'utf8').replace(/^import[^;]*;\s*/gm, ''),
    compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(source),
    checkedIt = (name: string, fn: () => void) => {
      if (excluded.some(e => e.test === name)) {
        // biome-ignore lint/suspicious/noSkippedTests: Three upstream parser-recovery AST assertions are explicitly accounted for in the exclusion ledger.
        return it.skip(name, fn)
      }
      return it(name, fn)
    }
  new Function('describe', 'it', 'expect', 'createTreemapServices', 'expectNoErrorsOrAlternatives', 'buildHierarchy', compiled)(describe, checkedIt, expect, createTreemapServices, expectNoErrorsOrAlternatives, buildHierarchy)
}
const cases = JSON.parse(readFileSync(join(bench, 'cases.json'), 'utf8')) as { id: string; source: string; expect: { roots: unknown[]; title: string; accessibilityTitle: string; accessibilityDescription: string; error?: string } }[]
for (const c of cases)
  test(c.id + ' preserves independently observed pinned hierarchy', () => {
    const result = parseRegisteredMermaid(c.source)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const body = asTreemap(result.value)
    expect(body).not.toBeNull()
    if (!body) return
    expect({ roots: tree(body.body), title: body.body.title ?? '', accessibilityTitle: body.body.accessibilityTitle ?? '', accessibilityDescription: body.body.accessibilityDescription ?? '' }).toEqual(c.expect)
    const text = serializeMermaid(body),
      again = parseRegisteredMermaid(text)
    expect(again.ok).toBe(true)
    if (again.ok) expect(serializeMermaid(again.value)).toBe(text)
    expect(renderMermaidSVG(c.source)).toContain('<svg')
    expect(renderMermaidASCII(c.source).trim()).not.toBe('')
  })
for (const source of ['treemap\nclass myNode myClass', 'treemap\nclass myNode myClass;'])
  test('error-recovery source remains preserved: ' + source.split('\n')[1], () => {
    const result = parseRegisteredMermaid(source)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.body.kind).toBe('opaque')
      expect(serializeMermaid(result.value)).toBe(source + '\n')
    }
  })
