import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GitGraphParseError, MindmapParseError, parseGitGraph, parseMindmap,
  renderMermaidASCII, renderMermaidSVG, serializeMindmap,
} from '../index.ts'
import { layoutGitGraph } from '../gitgraph/layout.ts'
import { mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import type { MindmapNode } from '../mindmap/types.ts'

function* walkMindmap(node: MindmapNode): Generator<MindmapNode> {
  yield node
  for (const child of node.children) yield* walkMindmap(child)
}

function mindmapDepth(node: MindmapNode, id: string, depth = 0): number {
  if (node.id === id) return depth
  for (const child of node.children) {
    const found = mindmapDepth(child, id, depth + 1)
    if (found >= 0) return found
  }
  return -1
}

const OFFICIAL_MARKDOWN_MINDMAP = `mindmap
  id1["\`**Root** with
a second line
Unicode works too: 🤓\`"]
    id2["\`The dog in **the** hog... a *very long text* that wraps to a new line\`"]
    id3[Regular labels still works]`

describe('Mindmap documentation parity and grammar closure', () => {
  test('the visual-evidence fixture exercises every documented shape plus deep/wide decorated Markdown structure', () => {
    const source = readFileSync(join(import.meta.dir, '..', '..', 'docs/design/families/mindmap-demo.mmd'), 'utf8')
    const diagram = parseMindmap(source.replace(/^---[\s\S]*?---\s*/, ''))
    const nodes = [...walkMindmap(diagram.root)]
    expect(nodes).toHaveLength(16)
    expect(new Set(nodes.map(node => node.shape))).toEqual(new Set(['default', 'rect', 'rounded', 'circle', 'bang', 'cloud', 'hexagon']))
    expect(nodes.find(node => node.id === 'discovery')).toMatchObject({ icon: 'fa fa-book', className: 'urgent large' })
    expect(nodes.find(node => node.id === 'evidence')).toMatchObject({ markdown: true })
    expect(Math.max(...nodes.map(node => mindmapDepth(diagram.root, node.id)))).toBeGreaterThanOrEqual(3)
  })

  test('parses, formats, renders, and round-trips the official multiline Markdown String example', () => {
    const parsed = parseMindmap(OFFICIAL_MARKDOWN_MINDMAP)
    expect(parsed.root).toMatchObject({ id: 'id1', shape: 'rect', markdown: true })
    expect(parsed.root.label).toBe('<b>Root</b> with\na second line\nUnicode works too: 🤓')
    expect(parsed.root.children[0]?.label).toContain('<b>the</b>')
    expect(parsed.root.children[0]?.label).toContain('<i>very long text</i>')

    const canonical = serializeMindmap(parsed)
    expect(canonical).toContain('id1["\`**Root** with\na second line\nUnicode works too: 🤓\`"]')
    expect(parseMindmap(canonical)).toEqual(parsed)

    const svg = renderMermaidSVG(OFFICIAL_MARKDOWN_MINDMAP, { embedFontImport: false })
    expect(svg).toContain('font-weight="bold"')
    expect(svg).toContain('font-style="italic"')
    const terminal = renderMermaidASCII(OFFICIAL_MARKDOWN_MINDMAP)
    expect(terminal).toContain('Root with')
    expect(terminal).toContain('Unicode works too: 🤓')
    expect(terminal).not.toMatch(/<\/?[bi]>/)
  })

  test('reserved decorations, metadata, and shaped-node prefixes fail closed instead of changing meaning on serialization', () => {
    const malformed = [
      '::icon (foo)', '::icon', ':::', ':::   ',
      'accTitle:', 'accDescr:', 'id[unterminated', 'id [unterminated', 'id(unclosed', 'id (unclosed',
    ]
    for (const line of malformed) {
      expect(() => parseMindmap(`mindmap\n  Root\n    ${line}`), line).toThrow(MindmapParseError)
    }
  })

  test('every accepted reserved-prefix variant is structurally stable after canonical serialization', () => {
    for (const line of ['child[Child]', 'child(Child)', 'child{{Child}}', 'child))Child((', 'child)Child(', 'Child']) {
      const first = parseMindmap(`mindmap\n  Root\n    ${line}`)
      const second = parseMindmap(serializeMindmap(first))
      expect(second, line).toEqual(first)
    }
  })

  test('accepts the documented tidy-tree selector and diagnoses every other mindmap layout value', () => {
    const tidy = `---\nconfig:\n  layout: tidy-tree\n---\nmindmap\n  Root\n    Child`
    expect(verifyMermaid(tidy).warnings.filter(warning => 'field' in warning && warning.field === 'layout')).toEqual([])
    expect(renderMermaidSVG(tidy, { embedFontImport: false })).toContain('data-id="Root"')

    const invalid = verifyMermaid(`---\nconfig:\n  layout: force-directed\n---\nmindmap\n  Root`)
    expect(invalid.warnings).toContainEqual(expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'layout' }))
    const diagnostics: string[] = []
    renderMermaidSVG('mindmap\n  Root', {
      mermaidConfig: { layout: 'force-directed' },
      onConfigDiagnostic: diagnostic => diagnostics.push(diagnostic.field),
    })
    expect(diagnostics).toContain('layout')
  })
})

describe('GitGraph documentation parity and identity closure', () => {
  test('preserves and diagnoses the official duplicate-Boston fence without offering ambiguous mutation', () => {
    const markdown = readFileSync(join(import.meta.dir, '..', '..', 'skills/agentic-mermaid-diagram-workflow/references/upstream/gitgraph.md'), 'utf8')
    const source = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)]
      .map(match => match[1]!.trim())
      .find(fence => (fence.match(/commit id:"Boston"/g) ?? []).length === 2)
    expect(source).toBeDefined()
    const parsed = parseRegisteredMermaid(source!)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body).toMatchObject({ kind: 'opaque', family: 'gitgraph',
      diagnostic: { code: 'GITGRAPH_DUPLICATE_COMMIT_ID', id: 'Boston' } })
    expect(serializeMermaid(parsed.value)).toBe(`${source}\n`)
    const verification = verifyMermaid(parsed.value)
    expect(verification.ok).toBe(false)
    expect(verification.warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'gitgraph_duplicate_commit_id',
      message: expect.stringContaining('Rename one duplicate ID'),
    }))
    expect(verification.warnings).toContainEqual(expect.objectContaining({
      code: 'RENDER_FAILED', reason: expect.stringContaining("Duplicate gitGraph commit id 'Boston'"),
    }))
    expect(mutate(parsed.value, { kind: 'append_commit', id: 'next' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
    expect(() => renderMermaidSVG(source!)).toThrow('Duplicate gitGraph commit id')
  })

  test('duplicate-ID preservation does not promote ordinary or other malformed GitGraph input', () => {
    const unique = parseRegisteredMermaid('gitGraph\n  commit id:"A"\n  commit id:"B"\n')
    expect(unique.ok).toBe(true)
    if (unique.ok) expect(unique.value.body.kind).toBe('gitgraph')

    const malformedFirst = parseRegisteredMermaid('gitGraph\n  not-a-statement\n  commit id:"A"\n  commit id:"A"\n')
    expect(malformedFirst).toMatchObject({ ok: false, error: [{ code: 'PARSE_FAILED' }] })

    const wrappedDuplicate = '---\nconfig:\n  gitGraph:\n    mainBranchName: MetroLine1\n---\ngitGraph\n  commit id:"A"\n  commit id:"A"\n'
    const wrapped = parseRegisteredMermaid(wrappedDuplicate)
    expect(wrapped.ok).toBe(true)
    if (wrapped.ok) {
      expect(wrapped.value.body.kind).toBe('opaque')
      expect(serializeMermaid(wrapped.value)).toBe(wrappedDuplicate)
      expect(verifyMermaid(wrapped.value).warnings).toContainEqual(expect.objectContaining({
        code: 'RENDER_FAILED', reason: expect.stringContaining("Duplicate gitGraph commit id 'A'"),
      }))
    }
  })

  test('the official merge cherry-pick fence has valid Scene and SVG geometry', () => {
    const markdown = readFileSync(join(import.meta.dir, '..', '..', 'skills/agentic-mermaid-diagram-workflow/references/upstream/gitgraph.md'), 'utf8')
    const source = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)]
      .map(match => match[1]!.trim())
      .find(fence => fence.includes('cherry-pick id:"MERGE" parent:"B"'))
    expect(source).toBeDefined()
    const diagram = parseGitGraph(source!)
    const cherryPick = diagram.commits.find(commit => commit.type === 'CHERRY_PICK')
    expect(cherryPick?.parents).toEqual(['A', 'MERGE'])
    const svg = renderMermaidSVG(source!, { embedFontImport: false })
    expect(svg).toContain(`data-id="${cherryPick!.id}"`)
    expect(svg).toContain('class="git-commit type-cherry_pick"')
  })

  test('the visual-evidence fixture exercises title, direction, orders, types, tags, merge, and merge-parent cherry-pick', () => {
    const source = readFileSync(join(import.meta.dir, '..', '..', 'docs/design/families/gitgraph-demo.mmd'), 'utf8')
    const body = source.replace(/^---[\s\S]*?---\s*/, '')
    const diagram = parseGitGraph(body, { title: 'Release train with backport' })
    expect(diagram.title).toBe('Release train with backport')
    expect(diagram.branches.map(branch => branch.name)).toEqual(['main', 'develop', 'release'])
    expect(diagram.commits).toHaveLength(8)
    expect(new Set(diagram.commits.map(commit => commit.type))).toEqual(new Set(['NORMAL', 'HIGHLIGHT', 'REVERSE', 'MERGE', 'CHERRY_PICK']))
    expect(diagram.commits.find(commit => commit.id === 'MERGE')?.parents).toEqual(['HOTFIX', 'UI'])
    expect(diagram.commits.find(commit => commit.type === 'CHERRY_PICK')?.parents).toEqual(['RC', 'MERGE'])
  })

  test('rejects cherry-picking a commit already reachable through inherited branch history', () => {
    expect(() => parseGitGraph(`gitGraph
  commit id:"M"
  branch release
  cherry-pick id:"M"`)).toThrow('already reachable')
  })

  test('rejects undocumented non-positive explicit branch orders', () => {
    for (const order of [-2, -1, 0]) {
      expect(() => parseGitGraph(`gitGraph\n  commit\n  branch bad order:${order}`), String(order)).toThrow(GitGraphParseError)
    }
  })

  test('uses source creation order as the equal-order tiebreaker on SVG and terminal surfaces', () => {
    const source = `gitGraph
  commit id:"base"
  branch "éclair" order:1
  commit id:"e"
  checkout main
  branch Zulu order:1
  commit id:"z"`
    expect(layoutGitGraph(parseGitGraph(source)).branches.map(branch => branch.name)).toEqual(['main', 'éclair', 'Zulu'])
    const terminal = renderMermaidASCII(source)
    expect(terminal.indexOf('éclair')).toBeLessThan(terminal.indexOf('Zulu'))
  })

  test('renders a frontmatter title separately from accessibility metadata on SVG and terminal surfaces', () => {
    const source = `---
title: Release train
---
gitGraph
  accTitle: Accessible history
  commit id:"base"`
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('<title id="gitgraph-title">Accessible history</title>')
    expect(svg).toContain('class="gitgraph-title"')
    expect(svg).toContain('>Release train</text>')
    expect(renderMermaidASCII(source)).toContain('Release train')
  })

  test('layout emits one semantic parent relation when a direct typed caller supplies duplicate parent IDs', () => {
    const diagram = parseGitGraph('gitGraph\n  commit id:"base"\n  commit id:"child"')
    diagram.commits[1] = { ...diagram.commits[1]!, parents: ['base', 'base'] }
    const edges = layoutGitGraph(diagram).edges
    expect(edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(['base->child'])
  })

  test('relation identities remain injective when quoted commit IDs contain relation delimiters', () => {
    const source = `gitGraph
  commit id:"root"
  branch left
  commit id:"a->b"
  commit id:"c"
  checkout main
  branch right
  commit id:"a"
  commit id:"b->c"`
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    const relations = [...svg.matchAll(/<polyline\b[^>]*data-from="([^"]+)"[^>]*data-to="([^"]+)"[^>]*data-id="([^"]+)"[^>]*data-role="edge"/g)]
      .map(match => ({ from: match[1], to: match[2], id: match[3] }))
    expect(relations).toHaveLength(4)
    expect(new Set(relations.map(relation => relation.id)).size).toBe(relations.length)
    expect(relations).toContainEqual(expect.objectContaining({ from: 'a-&gt;b', to: 'c' }))
    expect(relations).toContainEqual(expect.objectContaining({ from: 'a', to: 'b-&gt;c' }))
  })
})
