import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeMermaidTree } from '../agent/describe.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { layoutGitGraph } from '../gitgraph/layout.ts'
import { GitGraphParseError, MindmapParseError, parseGitGraph, parseMindmap, renderMermaidASCII, renderMermaidSVG, serializeGitGraph, serializeMindmap } from '../index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const OFFICIAL_MARKDOWN_MINDMAP = `mindmap
  id1["\`**Root** with
a second line
Unicode works too: 🤓\`"]
    id2["\`The dog in **the** hog... a *very long text* that wraps to a new line\`"]
    id3[Regular labels still works]`

const ANONYMOUS_MULTILINE_MINDMAP = `mindmap
    ["\`**Root** with
a second line
Unicode works too: 🤓\`"]
      id2["\`The dog in **the** hog... a *very long text* that wraps to a new line\`"]
      id3[Rgular labels still works]`

describe('Mindmap grammar, round-trip, and branch geometry', () => {
  test('anonymous delimiter identities, shaped comments, cloud closing tokens and shape text spanning lines retain their meaning', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const [source, expected] of [
        ['mindmap\n  (r[oot)', { id: 'r[oot', label: 'r[oot', shape: 'rounded' }],
        ['mindmap\n  (r{{oot)', { id: 'r{{oot', label: 'r{{oot', shape: 'rounded' }],
        ['mindmap\n  a]b[x]', { id: 'a]b', label: 'x', shape: 'rect' }],
        ['mindmap\n  (Cloud))', { id: 'Cloud', label: 'Cloud', shape: 'cloud' }],
        ['mindmap\n  (Keep %% literal)', { id: 'Keep %% literal', label: 'Keep %% literal', shape: 'rounded' }],
        ['mindmap\n  node[Keep %% literal] %% trailing comment', { id: 'node', label: 'Keep %% literal', shape: 'rect' }],
        ['mindmap\n  id)I am ["quoted(', { id: 'id', label: 'I am ["quoted', shape: 'cloud' }],
        ['mindmap\n  root((line1\n  line2))', { id: 'root', label: 'line1\nline2', shape: 'circle' }],
        ['mindmap\n  root["quoted\n    text"]\n    B', { id: 'root', label: 'quoted\ntext', shape: 'rect', children: [{ id: 'B' }] }],
        ['mindmap\n  root(text\n    more) %% c\n    B', { id: 'root', label: 'text\nmore', shape: 'rounded', children: [{ id: 'B' }] }],
        ['mindmap\n  r))bang\ntext((', { id: 'r', label: 'bang\ntext', shape: 'bang' }],
        ['mindmap\n  root(text\n    %% a comment\n    more)', { id: 'root', label: 'text\nmore', shape: 'rounded' }],
        // The word `mindmap` is the keyword only on its own: here it is text.
        ['mindmap\n  mindmapper\n    [mindmap child]', { id: 'mindmapper', children: [{ id: 'mindmap child', label: 'mindmap child', shape: 'rect' }] }],
      ] as const) {
        expect(await upstream.accepts(source)).toBe(true)
        const parsed = parseMindmap(source)
        expect(parsed.root).toMatchObject(expected)
        const canonical = serializeMindmap(parsed)
        expect(await upstream.accepts(canonical)).toBe(true)
        expect(parseMindmap(canonical)).toEqual(parsed)
      }
    } finally {
      upstream.close()
    }
  })

  test('quotes shaped labels containing delimiters so canonical output remains valid Mermaid', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const source of ['mindmap\n  root["String containing []"]', 'mindmap\n  root("String containing ()")', 'mindmap\n  root(("String containing ()"))', 'mindmap\n  root{{"String containing }}"}}', 'mindmap\n  root)"String containing ("(', 'mindmap\n  root))"String containing (("((']) {
        const parsed = parseMindmap(source)
        const serialized = serializeMindmap(parsed)
        expect(await upstream.accepts(source)).toBe(true)
        expect(await upstream.accepts(serialized)).toBe(true)
        expect(parseMindmap(serialized)).toEqual(parsed)
        expect(serializeMindmap(parseMindmap(serialized))).toBe(serialized)
      }
    } finally {
      upstream.close()
    }
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

  test('anonymous multiline Markdown identities retain their text and children after serialization', async () => {
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(ANONYMOUS_MULTILINE_MINDMAP)).toBe(true)
      const parsed = parseMindmap(ANONYMOUS_MULTILINE_MINDMAP)
      expect(parsed.root).toMatchObject({
        id: 'Root with\na second line\nUnicode works too: 🤓',
        label: '<b>Root</b> with\na second line\nUnicode works too: 🤓',
        shape: 'rect',
        markdown: true,
      })
      expect(parsed.root.children.map(node => ({ id: node.id, label: node.label }))).toEqual([
        { id: 'id2', label: 'The dog in <b>the</b> hog... a <i>very long text</i> that wraps to a new line' },
        { id: 'id3', label: 'Rgular labels still works' },
      ])
      const canonical = serializeMindmap(parsed)
      expect(canonical).toStartWith('mindmap\n  ["`**Root** with\n')
      expect(await upstream.accepts(canonical)).toBe(true)
      expect(parseMindmap(canonical)).toEqual(parsed)
      expect(serializeMindmap(parseMindmap(canonical))).toBe(canonical)
    } finally {
      upstream.close()
    }
  })

  test('reserved decorations, metadata, and shaped-node prefixes fail closed instead of changing meaning on serialization', () => {
    const malformed = [
      '::icon (foo)',
      '::icon',
      ':::',
      ':::   ',
      'accTitle:',
      'accDescr:',
      'id[unterminated',
      'id [unterminated',
      'id(unclosed',
      'id (unclosed',
      // A quoted description's shape closes on its quote's line, as upstream.
      'id["quoted"\n    ]',
      // A node id or a default node's text holds no `(`, `[`, `)`, `{`, `}`
      // or line break, as Mermaid's NODE_ID token.
      'layout s}}es}}election',
      'a{b',
      'a)b',
      // Nor does it start with the word `mindmap`, which Mermaid lexes as the keyword.
      'mindmap child',
      'Mindmap(x)',
      'This String containing []is a comment root((the root))',
      // A shape whose text runs on closes at `theId(`, leaving `child1)`.
      'ld)\n      root\n  Argument mapping    theId(child1)',
      // Shape text past its first close reads only with its delimiters paired
      // and no quote.
      'root[The root]ot]',
      'a(x)(y)',
      'root[a "b" (c)]',
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

  test('a branch meets a bang burst at its painted tip, not at its layout box', () => {
    const svg = renderMermaidSVG('mindmap\n  root((Root))\n    a))Left burst((\n    b))Right burst((', { embedFontImport: false })
    const outline = [...svg.matchAll(/<polygon points="([^"]+)"/g)].flatMap(match => match[1]!.split(' '))
    const endpoints = [...svg.matchAll(/<path class="mindmap-edge"[^>]* d="[^"]* ([-\d.]+) ([-\d.]+)"/g)].map(match => `${match[1]},${match[2]}`)
    expect(endpoints).toHaveLength(2)
    for (const endpoint of endpoints) expect(outline).toContain(endpoint)
  })
})

describe('GitGraph grammar and identity', () => {
  test('preserves every official duplicate-Boston occurrence with editable, stable identity', () => {
    const markdown = readFileSync(join(import.meta.dir, '..', '..', 'skills/agentic-mermaid-diagram-workflow/references/upstream/gitgraph.md'), 'utf8')
    const source = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(match => match[1]!.trim()).find(fence => (fence.match(/commit id:"Boston"/g) ?? []).length === 2)
    expect(source).toBeDefined()
    const parsed = parseRegisteredMermaid(source!)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.value.body.kind !== 'gitgraph') throw new Error('Expected structured GitGraph')
    const body = parsed.value.body
    const boston = body.commits.filter(commit => (commit.sourceId ?? commit.id) === 'Boston')
    expect(boston).toHaveLength(2)
    expect(new Set(body.commits.map(commit => commit.id)).size).toBe(body.commits.length)
    expect(body.commits.filter(commit => commit.source === 'commit')).toHaveLength((source!.match(/^\s*commit\b/gm) ?? []).length)
    expect(verifyMermaid(parsed.value).warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX' || w.code === 'RENDER_FAILED')).toEqual([])
    const canonical = serializeMermaid(parsed.value)
    const reloaded = parseRegisteredMermaid(canonical)
    expect(reloaded.ok && reloaded.value.body).toEqual(body)
    const svg = renderMermaidSVG(source!, { embedFontImport: false })
    for (const occurrence of boston) expect(svg).toContain(`data-id="${occurrence.id}"`)
    expect((svg.match(/>Boston<|>Boston<\/tspan>/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(describeMermaidFacts(parsed.value)).toContain(`commit ${boston[1]!.id} source-id Boston`)
    expect(
      describeMermaidTree(parsed.value)
        .nodes.filter(n => n.label === 'Boston')
        .map(n => n.id),
    ).toEqual(boston.map(c => c.id))
    expect(renderMermaidASCII(source!).split('Boston').length - 1).toBeGreaterThanOrEqual(2)
    const edited = mutate(parsed.value, { kind: 'set_commit_message', id: boston[1]!.id, message: 'Boston interchange' })
    expect(edited.ok).toBe(true)
    if (!edited.ok || edited.value.body.kind !== 'gitgraph') throw new Error('Expected edited GitGraph')
    expect(edited.value.body.commits.find(c => c.id === boston[0]!.id)?.message).toBeUndefined()
    expect(edited.value.body.commits.find(c => c.id === boston[1]!.id)?.message).toBe('Boston interchange')
    expect(parseGitGraph(serializeGitGraph(edited.value.body), { mainBranchName: body.mainBranchName }).commits).toEqual(edited.value.body.commits)
  })

  test('duplicate-ID reading retains wrappers and still rejects malformed statements', () => {
    const malformedFirst = parseRegisteredMermaid('gitGraph\n  not-a-statement\n  commit id:"A"\n  commit id:"A"\n')
    expect(malformedFirst).toMatchObject({ ok: false, error: [{ code: 'PARSE_FAILED' }] })
    const wrappedDuplicate = '---\nconfig:\n  gitGraph:\n    mainBranchName: MetroLine1\n---\ngitGraph\n  commit id:"A"\n  commit id:"A"\n'
    const wrapped = parseRegisteredMermaid(wrappedDuplicate)
    expect(wrapped.ok).toBe(true)
    if (!wrapped.ok || wrapped.value.body.kind !== 'gitgraph') throw new Error('Expected structured GitGraph')
    expect(wrapped.value.body.commits.map(c => [c.id, c.branch])).toEqual([
      ['A', 'MetroLine1'],
      ['A#1', 'MetroLine1'],
    ])
    expect(serializeMermaid(wrapped.value)).toBe(wrappedDuplicate)
  })

  test('the official merge cherry-pick fence has valid Scene and SVG geometry', () => {
    const markdown = readFileSync(join(import.meta.dir, '..', '..', 'skills/agentic-mermaid-diagram-workflow/references/upstream/gitgraph.md'), 'utf8')
    const source = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(match => match[1]!.trim()).find(fence => fence.includes('cherry-pick id:"MERGE" parent:"B"'))
    expect(source).toBeDefined()
    const diagram = parseGitGraph(source!)
    const cherryPick = diagram.commits.find(commit => commit.type === 'CHERRY_PICK')
    expect(cherryPick?.parents).toEqual(['A', 'MERGE'])
    const svg = renderMermaidSVG(source!, { embedFontImport: false })
    expect(svg).toContain(`data-id="${cherryPick!.id}"`)
    expect(svg).toContain('class="git-commit type-cherry_pick"')
  })

  // A line inside the string that starts with `%%` is text, as `%%` later on
  // a line is; Mermaid drops it before lexing (an intentional divergence).
  test('a quoted string runs to its closing quote across lines, keeping the break, not the indentation', () => {
    const diagram = parseGitGraph(`gitGraph
  commit id: "a
    b" msg: "50 %% off
    now" tag: "v1
    rc"
  commit "bare
    %% kept
    msg"
  branch dev
  commit
  checkout main
  merge dev tag: "x
    y"`)
    expect(diagram.commits.map(({ id, message, tags }) => ({ id, message, tags }))).toEqual([
      { id: 'a\nb', message: '50 %% off\nnow', tags: ['v1\nrc'] },
      { id: 'c1', message: 'bare\n%% kept\nmsg', tags: [] },
      { id: 'c2', message: undefined, tags: [] },
      { id: 'c3', message: 'merged branch dev into main', tags: ['x\ny'] },
    ])
  })

  test('rejects cherry-picking a commit already reachable through inherited branch history', () => {
    expect(() =>
      parseGitGraph(`gitGraph
  commit id:"M"
  branch release
  cherry-pick id:"M"`),
    ).toThrow('already reachable')
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
    const relations = [...svg.matchAll(/<polyline\b[^>]*data-id="([^"]+)"[^>]*data-role="edge"[^>]*data-from="([^"]+)"[^>]*data-to="([^"]+)"/g)].map(match => ({ id: match[1], from: match[2], to: match[3] }))
    expect(relations).toHaveLength(4)
    expect(new Set(relations.map(relation => relation.id)).size).toBe(relations.length)
    expect(relations).toContainEqual(expect.objectContaining({ from: 'a-&gt;b', to: 'c' }))
    expect(relations).toContainEqual(expect.objectContaining({ from: 'a', to: 'b-&gt;c' }))
  })
})
