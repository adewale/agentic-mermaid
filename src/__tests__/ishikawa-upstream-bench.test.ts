import { describe, it, test, expect, beforeEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseIshikawaDiagram } from '../ishikawa/parser.ts'
import type { IshikawaBody } from '../ishikawa/types.ts'
import { parseRegisteredMermaid, asIshikawa, serializeMermaid, renderMermaidSVG, renderMermaidASCII } from '../agent/core.ts'

const bench = join(import.meta.dir, '../../eval/mermaid-ishikawa-bench')
function roots(body: IshikawaBody) {
  const children = new Map<string | undefined, typeof body.nodes>()
  for (const n of body.nodes) {
    const list = children.get(n.parentId) ?? []
    list.push(n)
    children.set(n.parentId, list)
  }
  const tree = (n: (typeof body.nodes)[number]): unknown => ({ label: n.label, children: (children.get(n.id) ?? []).map(tree) })
  return (children.get(undefined) ?? []).map(tree)
}
class IshikawaDB {
  body: IshikawaBody = { kind: 'ishikawa', nodes: [] }
  clear() {
    this.body = { kind: 'ishikawa', nodes: [] }
  }
  getRoot() {
    const project = (n: { label: string; children: unknown[] }): unknown => ({ text: n.label, children: n.children.map(c => project(c as typeof n)) })
    const root = roots(this.body)[0] as { label: string; children: unknown[] } | undefined
    return root ? project(root) : undefined
  }
}
const ishikawa = {
  yy: new IshikawaDB(),
  parse(source: string) {
    this.yy.body = parseIshikawaDiagram(source)
  },
}
const source = readFileSync(join(bench, 'upstream/ishikawa.spec.ts.txt'), 'utf8').replace(/^import[^;]*;\s*/gm, '')
new Function('describe', 'it', 'expect', 'beforeEach', 'ishikawa', 'IshikawaDB', 'setLogLevel', new Bun.Transpiler({ loader: 'ts' }).transformSync(source))(describe, it, expect, beforeEach, ishikawa, IshikawaDB, () => {})
const cases = JSON.parse(readFileSync(join(bench, 'cases.json'), 'utf8')) as { id: string; source: string; expect: { roots: unknown[]; title: string; accessibilityTitle: string; accessibilityDescription: string; error?: string } }[]
for (const c of cases)
  test(c.id + ' preserves independently observed pinned causal tree', () => {
    const result = parseRegisteredMermaid(c.source)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const body = asIshikawa(result.value)
    expect(body).not.toBeNull()
    if (!body) return
    expect({ roots: roots(body.body), title: result.value.meta.frontmatter?.title ?? '', accessibilityTitle: body.body.accessibilityTitle ?? '', accessibilityDescription: body.body.accessibilityDescription ?? '' }).toEqual(c.expect)
    const text = serializeMermaid(body),
      again = parseRegisteredMermaid(text)
    expect(again.ok).toBe(true)
    if (again.ok) expect(serializeMermaid(again.value)).toBe(text)
    expect(renderMermaidSVG(c.source)).toContain('<svg')
    expect(renderMermaidASCII(c.source).trim()).not.toBe('')
  })
