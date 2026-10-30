import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { describeMermaidFacts } from '../agent/facts.ts'
import { asGitGraph, asMindmap, layoutMermaid, mutate, parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { visualWidth } from '../ascii/width.ts'
import { assessRenderedLayout, familyHardViolations } from '../family-rubric.ts'
import { gitGraphRouteViolations, layoutGitGraph } from '../gitgraph/layout.ts'
import { GitGraphParseError, parseGitGraph, parseMindmap, renderMermaidASCII, renderMermaidSVG, serializeGitGraph, serializeMindmap, verifyNoExternalRefs } from '../index.ts'
import { layoutMindmap } from '../mindmap/layout.ts'
import { lowerMindmapScene } from '../mindmap/renderer.ts'
import { DefaultBackend, getFamily } from '../agent/core.ts'
import type { PositionedGitGraphCommit, PositionedGitGraphDiagram } from '../gitgraph/types.ts'
import { contrastRatio } from '../shared/color-math.ts'
import { DEFAULTS } from '../theme.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import { connectorUnitTangent } from '../scene/connector-geometry.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const MINDMAP = `mindmap
  accTitle: Product map
  accDescr: Product decisions and delivery
  root((Product))
    Research
      interviews[Interviews]
      :::research
      evidence{{Evidence}}
        ::icon(mdi:lightbulb)
    Delivery
      launch)Launch(
`

const GITGRAPH = `gitGraph LR:
  accTitle: Release history
  accDescr: Feature branch merged for release
  commit id:"base" msg:"Foundation"
  branch feature order:2
  commit id:"work" type:HIGHLIGHT tag:"beta" msg:"Build"
  checkout main
  commit id:"release" type:REVERSE
  branch patchline order:3
  commit id:"patch" msg:"Backport candidate"
  checkout main
  merge feature id:"merge" type:HIGHLIGHT tag:"v1"
  cherry-pick id:"patch" tag:"backport"
`

test.each(['LR', 'TB', 'BT'] as const)('GitGraph %s branch extents retain empty lanes and their own farthest commits', direction => {
  const diagram = parseGitGraph(`gitGraph ${direction}:\ncommit id:"base"\nbranch late order:3\ncommit id:"late"\ncheckout main\ncommit id:"main"\nbranch empty order:1\ncheckout main`)
  for (const parallelCommits of [false, true]) {
    const positioned = layoutGitGraph(diagram, { parallelCommits })
    expect(positioned.branches.map(branch => branch.name)).toEqual(['main', 'empty', 'late'])
    for (const branch of positioned.branches) {
      const own = positioned.commits.filter(commit => commit.branch === branch.name)
      const start = direction === 'LR' ? branch.x1 : branch.y1
      const end = direction === 'LR' ? branch.x2 : branch.y2
      expect(end, branch.name).toBeGreaterThan(start)
      for (const commit of own) {
        const coordinate = direction === 'LR' ? commit.x : commit.y
        expect(coordinate, `${branch.name} contains ${commit.id}`).toBeGreaterThanOrEqual(start)
        expect(coordinate, `${branch.name} contains ${commit.id}`).toBeLessThanOrEqual(end)
      }
    }
  }
})

test('fractional GitGraph branch extents contain their rounded commit boxes', () => {
  const source = `gitGraph
commit id: "1"
commit id: "2"
branch nice_feature
checkout nice_feature
commit id: "3"
checkout main
commit id: "4"
checkout nice_feature
branch very_nice_feature
checkout very_nice_feature
commit id: "5"
checkout main
commit id: "6"
checkout nice_feature
commit id: "7"
checkout main
merge nice_feature id: "customID" tag: "customTag" type: REVERSE
checkout very_nice_feature
commit id: "8"
checkout main
commit id: "9"`
  const parsed = parseMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  const view = layoutMermaid(parsed.value)
  expect(familyHardViolations(assessRenderedLayout(view))).toEqual([])
  for (const group of view.groups)
    for (const id of group.members) {
      const node = view.nodes.find(node => node.id === id)!
      expect(node.x + node.w).toBeLessThanOrEqual(group.x + group.w)
      expect(node.y + node.h).toBeLessThanOrEqual(group.y + group.h)
    }
})

describe('Mindmap full-family citizenship', () => {
  test('preserves indentation semantics, shapes, icons, classes, and accessibility on stable round-trip', () => {
    const parsed = parseMindmap(MINDMAP)
    expect(parsed.accessibilityTitle).toBe('Product map')
    expect(parsed.root.children.map(node => node.id)).toEqual(['Research', 'Delivery'])
    expect(parsed.root.children[0]!.children.map(node => [node.id, node.shape])).toEqual([
      ['interviews', 'rect'],
      ['evidence', 'hexagon'],
    ])
    expect(parsed.root.children[0]!.children[0]!.className).toBe('research')
    expect(parsed.root.children[0]!.children[1]!.icon).toBe('mdi:lightbulb')
    const serialized = serializeMindmap(parsed)
    expect(serializeMindmap(parseMindmap(serialized))).toBe(serialized)
    const multilineA11y = parseMindmap('mindmap\n  accDescr {\n    A multiline description\n    across two lines\n  }\n  Root')
    expect(multilineA11y.accessibilityDescription).toBe('A multiline description\nacross two lines')
    expect(parseMindmap(serializeMindmap(multilineA11y))).toEqual(multilineA11y)
    const commented = parseMindmap('mindmap\n  root(Root)\n    child(Child) %% trailing comment')
    expect(commented.root.children[0]).toMatchObject({ id: 'child', label: 'Child', shape: 'rounded' })
    expect(parseMindmap('mindmap\n  root["100%% ready"]').root.label).toBe('100%% ready')
  })

  test('literal percent pairs survive node text, decorations, typed edits and trailing comments', async () => {
    const source = `mindmap
  root[100%% ready] %% root comment
    a %% b
    quoted["quoted%% label"]
    cloud)cloud%% label( %% cloud comment
      ::icon(mdi:foo%%bar) %% icon comment
      :::hot%%class
    %% real comment
    final(Final)`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const diagram = asMindmap(parsed.value)!
    expect(diagram.body.root.label).toBe('100%% ready')
    expect(diagram.body.root.children.map(node => [node.id, node.label])).toEqual([
      ['a %% b', 'a %% b'],
      ['quoted', 'quoted%% label'],
      ['cloud', 'cloud%% label'],
      ['final', 'Final'],
    ])
    expect(diagram.body.root.children[2]).toMatchObject({ icon: 'mdi:foo%%bar', className: 'hot%%class' })
    expect(verifyMermaid(diagram).warnings.filter(warning => warning.code === 'COMMENT_DROPPED')).toEqual([])
    const changed = mutate(diagram, { kind: 'add_node', id: 'added', label: 'more%%text', shape: 'rect', parent: 'root' })
    if (!changed.ok) throw new Error(changed.error.message)
    const written = serializeMermaid(changed.value)
    for (const text of ['root comment', 'cloud comment', 'icon comment', 'real comment']) expect(written.split(`%% ${text}`)).toHaveLength(2)
    const reloaded = parseMermaid(written)
    if (!reloaded.ok) throw new Error(JSON.stringify(reloaded.error))
    expect(describeMermaidFacts(reloaded.value)).toEqual(describeMermaidFacts(changed.value))
    const upstream = startUpstreamMermaid()
    try {
      const meaning = await upstream.project(written, diagram => {
        const root = diagram.db.getMindmap()
        return { label: root.descr, children: root.children.map((node: any) => ({ id: node.nodeId, label: node.descr, ...(node.icon ? { icon: node.icon } : {}), ...(node.class ? { className: node.class } : {}) })) }
      })
      expect(meaning).toEqual({
        ok: true,
        value: {
          label: '100%% ready',
          children: [
            { id: 'a %% b', label: 'a %% b' },
            { id: 'quoted', label: 'quoted%% label' },
            { id: 'cloud', label: 'cloud%% label', icon: 'mdi:foo%%bar', className: 'hot%%class' },
            { id: 'final', label: 'Final' },
            { id: 'added', label: 'more%%text' },
          ],
        },
      })
    } finally {
      upstream.close()
    }
    for (const label of ['100%% ready', 'a %% b', 'quoted%% label', 'cloud%% label', 'more%%text']) {
      expect(renderMermaidSVG(written)).toContain(label)
      expect(renderMermaidASCII(written)).toContain(label)
    }
  })

  test('a repeated identity is another node, never an overwrite, and keeps its authored text', () => {
    // Mermaid 12.2.0 accepts repeated node text and repeated explicit ids.
    // Each later occurrence gets the next free `<identity>#<n>`; an authored
    // `X#2` keeps its own name, so the second `X` becomes `X#3`.
    const source = 'mindmap\n  root((R))\n    A\n      X\n    B\n      X\n    X#2\n    dup[First]\n    dup[Second]\n'
    const diagram = parseMindmap(source)
    const nodes: Array<{ id: string; sourceId?: string; label: string; parent?: string }> = []
    const visit = (node: typeof diagram.root, parent?: string): void => {
      nodes.push({ id: node.id, ...(node.sourceId ? { sourceId: node.sourceId } : {}), label: node.label, ...(parent ? { parent } : {}) })
      node.children.forEach(child => visit(child, node.id))
    }
    visit(diagram.root)
    expect(nodes).toEqual([
      { id: 'root', label: 'R' },
      { id: 'A', label: 'A', parent: 'root' },
      { id: 'X', label: 'X', parent: 'A' },
      { id: 'B', label: 'B', parent: 'root' },
      { id: 'X#3', sourceId: 'X', label: 'X', parent: 'B' },
      { id: 'X#2', label: 'X#2', parent: 'root' },
      { id: 'dup', label: 'First', parent: 'root' },
      { id: 'dup#2', sourceId: 'dup', label: 'Second', parent: 'root' },
    ])
    expect(serializeMindmap(diagram)).toBe(source)
    expect(parseMindmap(serializeMindmap(diagram))).toEqual(diagram)
    const ascii = renderMermaidASCII(source)
    expect(ascii.split('─ X\n')).toHaveLength(3)
    expect(ascii).toContain('[Second]')
  })

  test('rejects empty icon decorations instead of dropping them on round-trip', () => {
    for (const decoration of ['::icon()', '::icon(   )']) {
      expect(() => parseMindmap(`mindmap\n  Root\n    ${decoration}`), decoration).toThrow('Mindmap icon decoration must contain a non-empty value')
    }
  })

  test('lays out a deterministic central hierarchy with side-monotone subtrees and one branch per non-root node', () => {
    const first = layoutMindmap(parseMindmap(MINDMAP))
    const second = layoutMindmap(parseMindmap(MINDMAP))
    expect(second).toEqual(first)
    expect(first.edges).toHaveLength(first.nodes.length - 1)
    const byId = new Map(first.nodes.map(node => [node.id, node]))
    for (const edge of first.edges) {
      const parent = byId.get(edge.from)!
      const child = byId.get(edge.to)!
      expect(child.side).not.toBe('root')
      if (child.side === 'right') expect(child.x).toBeGreaterThan(parent.x)
      else expect(child.x + child.width).toBeLessThan(parent.x + parent.width)
      expect(edge.d).toContain(' C ')
    }

    const scene = lowerMindmapScene({
      positioned: first,
      colors: DEFAULTS,
      resolved: { renderOptions: {} },
    })
    const connectors = scene.parts.filter(part => part.kind === 'connector')
    expect(connectors).toHaveLength(first.edges.length)
    first.edges.forEach((edge, index) => {
      const connector = connectors[index]!
      expect({ index, kind: connector.kind, geometry: connector.kind === 'connector' ? connector.route.geometry.kind : null }).toEqual({ index, kind: 'connector', geometry: 'path' })
      if (connector.kind !== 'connector' || connector.route.geometry.kind !== 'path') return
      const [start, control1, control2, end] = edge.points
      expect(connector.route.geometry.points).not.toEqual(edge.points)
      expect(connector.route.geometry.points[0]).toEqual(start)
      expect(connector.route.geometry.points.at(-1)).toEqual(end)
      expect(connector.route.startTangent).toEqual(connectorUnitTangent(start!, control1!))
      expect(connector.route.endTangent).toEqual(connectorUnitTangent(control2!, end!))
    })
  })

  test('supports typed tree edits with cycle and duplicate guards', () => {
    const parsed = parseMermaid('mindmap\n  root\n    Alpha\n    Beta')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const narrowed = asMindmap(parsed.value)
    expect(narrowed).not.toBeNull()
    if (!narrowed) return
    const added = mutate(narrowed, { kind: 'add_node', id: 'proof', label: 'Proof', shape: 'rect', parent: 'Alpha' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(serializeMermaid(added.value)).toContain('proof[Proof]')
    const cycle = mutate(added.value, { kind: 'move_node', id: 'Alpha', parent: 'proof' })
    expect(cycle).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
    const duplicate = mutate(added.value, { kind: 'rename_node', from: 'Beta', to: 'proof' })
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'DUPLICATE_NODE' } })
  })

  test('renders accessible, reference-safe SVG and grapheme-safe bounded terminal output', () => {
    const source = 'mindmap\n  根((製品 🧭))\n    調査\n      家族 👨‍👩‍👧‍👦\n    出荷'
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    expect(svg).toContain('data-id="根"')
    expect(svg).toContain('aria-roledescription="mindmap"')
    expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
    const text = renderMermaidASCII(source, { targetWidth: 44 })
    expect(Math.max(...text.split('\n').map(visualWidth))).toBeLessThanOrEqual(44)
    expect(text).toContain('👨‍👩‍👧‍👦')
    expect(verifyMermaid(source).ok).toBe(true)
  })

  test('root text remains WCAG AA against the accent fill in every built-in palette', () => {
    for (const { inputName: name, colors: theme } of BUILTIN_PALETTE_DEFINITIONS) {
      const svg = renderMermaidSVG('mindmap\n  Root\n    Child', { ...theme, embedFontImport: false })
      const root = svg.match(/<g class="mindmap-node depth-0"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? ''
      const fill = root.match(/<(?:rect|circle|ellipse|polygon)[^>]*\sfill="([^"]+)"/)?.[1]
      const text = root.match(/<text[^>]*\sfill="([^"]+)"/)?.[1]
      expect(fill, `${name} root fill`).toBeDefined()
      expect(text, `${name} root text`).toBeDefined()
      expect(contrastRatio(text!, fill!), `${name} root contrast`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('wires documented config and reports invalid/unknown fields instead of swallowing them', () => {
    const source = 'mindmap\n  Root\n    A very long child label that needs deterministic wrapping'
    const base = renderMermaidSVG(source, { embedFontImport: false })
    const configured = renderMermaidSVG(source, { embedFontImport: false, mermaidConfig: { mindmap: { padding: 70, maxNodeWidth: 80 } } })
    expect(configured).not.toBe(base)
    const diagnostics: string[] = []
    renderMermaidSVG(source, {
      embedFontImport: false,
      mermaidConfig: { mindmap: { padding: -1 } },
      onConfigDiagnostic: diagnostic => diagnostics.push(diagnostic.field),
    })
    expect(diagnostics).toContain('mindmap.padding')
    const verified = verifyMermaid('---\nconfig:\n  mindmap:\n    unknownSpacing: 4\n---\nmindmap\n  Root\n    Child')
    expect(verified.warnings).toContainEqual(expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'mindmap.unknownSpacing' }))
  })

  // Generated trees whose text repeats across and within branches (including
  // an authored name shaped like a generated id), at several indentation
  // units. Each node is (depth, text); a node is at most one level deeper
  // than the one before it.
  const repeatedTextTreeArb = fc.tuple(
    fc.array(fc.tuple(fc.nat(), fc.constantFrom('A', 'B', 'X', 'Y', 'X#2', 'X#3')), { minLength: 1, maxLength: 10 }),
    fc.constantFrom(1, 2, 4),
  ).map(([picks, unit]) => {
    const nodes: Array<{ depth: number; text: string }> = [{ depth: 0, text: 'Root' }]
    for (const [pick, text] of picks) nodes.push({ depth: 1 + pick % (nodes[nodes.length - 1]!.depth + 1), text })
    const lines = (step: number, base: number) => ['mindmap', ...nodes.map(node => `${' '.repeat(base + node.depth * step)}${node.text}`)].join('\n') + '\n'
    return { nodes, source: lines(unit, 2), canonical: lines(2, 2) }
  })
  const preorder = (root: ReturnType<typeof parseMindmap>['root']) => {
    const out: Array<{ id: string; sourceId?: string; label: string; depth: number }> = []
    const visit = (node: typeof root, depth: number): void => { out.push({ id: node.id, ...(node.sourceId ? { sourceId: node.sourceId } : {}), label: node.label, depth }); node.children.forEach(child => visit(child, depth + 1)) }
    visit(root, 0)
    return out
  }

  test('keeps deterministic tree invariants and distinct identities under generated repeated text', () => {
    fc.assert(
      fc.property(repeatedTextTreeArb, ({ nodes, source, canonical }) => {
        const parsed = parseMindmap(source)
        const read = preorder(parsed.root)
        // Every node is read, in order and at its depth, with its own text.
        expect(read.map(node => [node.depth, node.label])).toEqual(nodes.map(node => [node.depth, node.text]))
        // Identities are distinct; the authored identity is the node's text;
        // a text's first node keeps it as its id (so an authored `X#2` is
        // never displaced), and each later one is numbered from it.
        expect(new Set(read.map(node => node.id)).size).toBe(read.length)
        for (const [index, node] of read.entries()) {
          expect(node.sourceId ?? node.id).toBe(node.label)
          const first = read.findIndex(other => other.label === node.label) === index
          expect(node.id === node.label).toBe(first)
          if (!first) expect(node.id.startsWith(`${node.label}#`)).toBe(true)
        }
        const layout = layoutMindmap(parsed)
        expect(layout.nodes).toHaveLength(nodes.length)
        expect(layout.edges).toHaveLength(nodes.length - 1)
        // The writer keeps the author's text; reading it back is identity.
        expect(serializeMindmap(parsed)).toBe(canonical)
        expect(parseMindmap(serializeMindmap(parsed))).toEqual(parsed)
        // Typed body and canonical source agree with the authored reading.
        const typed = parseMermaid(source)
        if (!typed.ok || typed.value.body.kind !== 'mindmap') throw new Error(JSON.stringify(typed))
        expect(typed.value.body.root).toEqual(parsed.root)
        const reread = parseMermaid(typed.value.canonicalSource)
        if (!reread.ok) throw new Error(JSON.stringify(reread.error))
        expect(reread.value.body).toEqual(typed.value.body)
        expect(describeMermaidFacts(typed.value).filter(fact => fact.startsWith('node ') && fact.includes(' : '))).toHaveLength(nodes.length)
      }),
      fcParameters({ numRuns: 60, seed: 1501 }),
    )
  })

  test('typed edits on repeated text keep the ids a fresh parse gives', () => {
    fc.assert(
      fc.property(repeatedTextTreeArb.filter(tree => tree.nodes.length > 1), fc.nat(), ({ source }, pick) => {
        const typed = parseMermaid(source)
        if (!typed.ok) throw new Error(JSON.stringify(typed.error))
        const ids = preorder((typed.value.body as { root: ReturnType<typeof parseMindmap>['root'] }).root).map(node => node.id)
        const target = ids[1 + pick % (ids.length - 1)]!
        for (const op of [
          { kind: 'remove_node', id: target, recursive: true },
          { kind: 'move_node', id: target, parent: 'Root', index: 0 },
          { kind: 'set_icon', id: target, icon: 'fa fa-book' },
        ] as const) {
          const edited = mutate(typed.value, op)
          if (!edited.ok) throw new Error(`${JSON.stringify(op)}: ${edited.error.message}`)
          const written = serializeMermaid(edited.value)
          const fresh = parseMermaid(written)
          if (!fresh.ok) throw new Error(JSON.stringify(fresh.error))
          expect(fresh.value.body).toEqual(edited.value.body)
        }
      }),
      fcParameters({ numRuns: 40, seed: 1502 }),
    )
  })

  test('generated repeated-text mindmaps and their written source are valid Mermaid', async () => {
    const upstream = startUpstreamMermaid()
    try {
      await fc.assert(
        fc.asyncProperty(repeatedTextTreeArb, async ({ source }) => {
          expect(await upstream.accepts(source)).toBe(true)
          expect(await upstream.accepts(serializeMindmap(parseMindmap(source)))).toBe(true)
        }),
        fcParameters({ numRuns: 8, seed: 1503 }),
      )
    } finally {
      upstream.close()
    }
  }, 60_000)
})

function publicGitGraphCommit(id: string, sequence: number): PositionedGitGraphCommit {
  return { id, sequence, type: 'NORMAL', customType: 'NORMAL', tags: [], branch: 'main',
    parents: [], source: 'commit', customId: true, x: 60 + sequence * 60, y: 80, lane: 0 }
}

function publicGitGraphScene(commits: PositionedGitGraphCommit[]) {
  const lower = getFamily('gitgraph')?.lowerScene
  if (!lower) throw new Error('public GitGraph family lowering is unavailable')
  const positioned: PositionedGitGraphDiagram = {
    width: 260, height: 160, direction: 'LR', commits, edges: [],
    branches: [{ name: 'main', order: 0, sequence: 0, lane: 0, x1: 40, y1: 80, x2: 220, y2: 80 }],
    showBranches: false, showCommitLabel: false, rotateCommitLabel: false,
  }
  return lower({ positioned, colors: { bg: '#ffffff', fg: '#111111' },
    resolved: { renderOptions: {}, familyAppearance: { themeVariables: {} } } })
}

describe('GitGraph full-family citizenship', () => {

  test('single-commit requests preserve every semantic and visual type pairing and current identity', () => {
    const presentations = [
      ['NORMAL', 'git-commit type-normal'],
      ['REVERSE', 'git-commit type-reverse'],
      ['HIGHLIGHT', 'git-commit type-highlight'],
      ['MERGE', 'git-commit type-merge'],
      ['CHERRY_PICK', 'git-commit type-cherry_pick'],
    ] as const
    // Repeat in reverse order with new identities: independently authored type
    // and class literals must remain current across separate one-commit requests.
    for (const [round, order] of [presentations, [...presentations].reverse()].entries()) {
      for (const [semantic] of order) for (const [visual, className] of order) {
        const id = `request-${round}-${semantic}-${visual}`
        // Deliberately exercise extension visuals beyond the parsed customType
        // union at the actual public positioned-input boundary.
        const commit = { ...publicGitGraphCommit(id, 0), type: semantic, customType: visual } as unknown as PositionedGitGraphCommit
        const svg = DefaultBackend.render(publicGitGraphScene([commit]), { seed: 0 })
        expect(svg).toContain(`<g class="${className}" data-id="${id}" data-branch="main" data-commit-type="${semantic}"${semantic === visual ? '' : ` data-visual-type="${visual}"`} data-role="node">`)
        expect(Object.isFrozen(commit)).toBe(false)
      }
    }
  })

  test('replays branch, merge, and cherry-pick semantics with deterministic generated IDs', () => {
    const parsed = parseGitGraph(GITGRAPH)
    expect(parsed.commits.map(commit => commit.id)).toEqual(['base', 'work', 'release', 'patch', 'merge', 'c5'])
    expect(parsed.commits.find(commit => commit.id === 'merge')).toMatchObject({ type: 'MERGE', customType: 'HIGHLIGHT', parents: ['release', 'work'] })
    expect(parsed.commits.at(-1)).toMatchObject({ source: 'cherry-pick', cherrySource: 'patch', parents: ['merge', 'patch'] })
    const generated = parseGitGraph('gitGraph\n  commit\n  commit')
    expect(generated.commits.map(commit => commit.id)).toEqual(['c0', 'c1'])
    const legacyMessage = parseGitGraph('gitGraph:\n  commit "legacy commit message"')
    expect(legacyMessage.commits[0]?.message).toBe('legacy commit message')
    expect(serializeGitGraph(legacyMessage)).toContain('commit msg:"legacy commit message"')
    expect(parseGitGraph('gitGraph\n  commit\n  commit')).toEqual(generated)
    const serialized = serializeGitGraph(parsed)
    expect(serializeGitGraph(parseGitGraph(serialized))).toBe(serialized)
    expect(parseGitGraph('gitGraph\n  accDescr {\n    Release topology\n  }\n  commit').accessibilityDescription).toBe('Release topology')
    const multilineA11y = parseGitGraph('gitGraph\n  accDescr {\n    Release topology\n    across branches\n  }\n  commit')
    expect(multilineA11y.accessibilityDescription).toBe('Release topology\nacross branches')
    expect(parseGitGraph(serializeGitGraph(multilineA11y))).toEqual(multilineA11y)
  })

  test('retains duplicate identities and diagnoses invalid replay instead of overwriting history', () => {
    expect(parseGitGraph('gitGraph\n  commit id:"same"\n  commit id:"same"').commits.map(c => c.id)).toEqual(['same', 'same#1'])
    expect(() => parseGitGraph('gitGraph\n  checkout missing')).toThrow(GitGraphParseError)
    expect(() => parseGitGraph('gitGraph\n  branch one\n  branch one')).toThrow(GitGraphParseError)
  })

  test('lays out deterministic branch lanes and materializes every parent relation', () => {
    const diagram = parseGitGraph(GITGRAPH)
    const first = layoutGitGraph(diagram)
    expect(layoutGitGraph(diagram)).toEqual(first)
    expect(first.edges).toHaveLength(diagram.commits.reduce((sum, commit) => sum + commit.parents.length, 0))
    expect(new Set(first.commits.map(commit => commit.lane)).size).toBe(3)
    expect(first.edges.some(edge => edge.kind === 'merge')).toBe(true)
    expect(first.edges.some(edge => edge.kind === 'cherry-pick')).toBe(true)

    const parsed = parseMermaid(GITGRAPH)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const rendered = layoutMermaid(parsed.value)
    const nodes = new Map(rendered.nodes.map(node => [node.id, node]))
    for (const group of rendered.groups)
      for (const member of group.members) {
        const node = nodes.get(member)!
        expect(node.x, `${group.id} contains ${member} left`).toBeGreaterThanOrEqual(group.x)
        expect(node.y, `${group.id} contains ${member} top`).toBeGreaterThanOrEqual(group.y)
        expect(node.x + node.w, `${group.id} contains ${member} right`).toBeLessThanOrEqual(group.x + group.w)
        expect(node.y + node.h, `${group.id} contains ${member} bottom`).toBeLessThanOrEqual(group.y + group.h)
      }
  })

  test('keeps implicit branch order monotone beyond nine branches', () => {
    const names = Array.from({ length: 12 }, (_, index) => `b${index + 1}`)
    const diagram = parseGitGraph(['gitGraph', '  commit id:"root"', ...names.map(name => `  branch ${name}`)].join('\n'))
    const implicit = diagram.branches.slice(1).map(branch => branch.order)
    expect(implicit.every((order, index) => index === 0 || order > implicit[index - 1]!)).toBe(true)
    expect(implicit.every(order => order > 0 && order < 1)).toBe(true)
    expect(layoutGitGraph(diagram).branches.map(branch => branch.name)).toEqual(['main', ...names])
  })

  test('sizes every direction for the displayed commit message, including rotation', () => {
    const message = 'A deliberately long release message '.repeat(8).trim()
    for (const direction of ['LR', 'TB', 'BT'] as const) {
      // Everything comes from the rendered SVG: the message's anchor point,
      // alignment, font size, rotation, and fitted textLength, and the canvas.
      const svg = renderMermaidSVG(`gitGraph ${direction}:\n  commit id:"x" msg:"${message}"`)
      const [, canvasW, canvasH] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!.map(Number)
      const tag = svg.match(/<text[^>]*class="git-commit-label"[^>]*>/)![0]
      const attr = (name: string) => tag.match(new RegExp(` ${name}="([^"]+)"`))?.[1]
      const [x, y, size, width] = ['x', 'y', 'font-size', 'textLength'].map(name => Number(attr(name)))
      const angle = Number(attr('transform')?.match(/rotate\(([-\d.]+)/)?.[1] ?? 0)
      const left = attr('text-anchor') === 'middle' ? -width! / 2 : 0
      // The glyph box: textLength wide, 1em above the baseline, 0.3em below it.
      const radians = (angle * Math.PI) / 180
      const corners = [
        [left, -size!],
        [left + width!, -size!],
        [left, 0.3 * size!],
        [left + width!, 0.3 * size!],
      ].map(([dx, dy]) => ({
        x: x! + dx! * Math.cos(radians) - dy! * Math.sin(radians),
        y: y! + dx! * Math.sin(radians) + dy! * Math.cos(radians),
      }))
      const box = {
        minX: Math.min(...corners.map(point => point.x)),
        minY: Math.min(...corners.map(point => point.y)),
        maxX: Math.max(...corners.map(point => point.x)),
        maxY: Math.max(...corners.map(point => point.y)),
      }
      expect({ direction, rotated: angle !== 0, inside: box.minX >= 0 && box.minY >= 0 && box.maxX <= canvasW! && box.maxY <= canvasH! }).toEqual({ direction, rotated: direction === 'LR', inside: true })
    }
  })

  test('supports typed replay mutations and property edits without exposing mutable history', () => {
    const parsed = parseMermaid('gitGraph\n  commit id:"base"')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const narrowed = asGitGraph(parsed.value)
    expect(narrowed).not.toBeNull()
    if (!narrowed) return
    const branch = mutate(narrowed, { kind: 'create_branch', name: 'feature', order: 3 })
    expect(branch.ok).toBe(true)
    if (!branch.ok) return
    const work = mutate(branch.value, { kind: 'append_commit', id: 'work', message: 'Build', type: 'HIGHLIGHT', tags: ['beta'] })
    expect(work.ok).toBe(true)
    if (!work.ok) return
    const main = mutate(work.value, { kind: 'checkout_branch', name: 'main' })
    expect(main.ok).toBe(true)
    if (!main.ok) return
    const merged = mutate(main.value, { kind: 'merge_branch', name: 'feature', id: 'merged' })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(asGitGraph(merged.value)!.body.commits.find(commit => commit.id === 'merged')!.parents).toEqual(['base', 'work'])
    expect(serializeMermaid(merged.value)).toContain('merge feature id:"merged"')
  })

  test('renders semantic commit identities, relation endpoints, and spatial terminal branch topology', () => {
    const svg = renderMermaidSVG(GITGRAPH, { embedFontImport: false })
    expect(svg).toContain('data-id="merge"')
    expect(svg).toContain('data-from="release" data-to="merge"')
    expect(svg).toContain('aria-roledescription="git graph"')
    expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
    const text = renderMermaidASCII(GITGRAPH)
    expect(text).toContain('main')
    expect(text).toContain('feature')
    expect(text).toContain('[Foundation]')
    expect(text).toContain('[merge]')

    const equalOrder = renderMermaidASCII(`gitGraph
  commit id:"base"
  branch "éclair" order:1
  commit id:"e"
  checkout main
  branch Zulu order:1
  commit id:"z"`)
    expect(equalOrder.indexOf('éclair')).toBeLessThan(equalOrder.indexOf('Zulu'))
    const parsed = parseMermaid(GITGRAPH)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(layoutMermaid(parsed.value, { regions: true }).regions!.filter(region => region.kind === 'node')).toHaveLength(6)
  })

  test('keeps semantic and visual commit types separate across repeated profiles and fresh request paints', () => {
    const source = `${GITGRAPH}
  branch integrated order:4
  commit id:"continued"
  checkout main
  merge integrated id:"normal-merge" type:NORMAL
  branch undo order:5
  commit id:"undo-work"
  checkout main
  merge undo id:"reverse-merge" type:REVERSE
  branch finished order:6
  commit id:"finished-work"
  checkout main
  merge finished id:"default-merge"
  commit id:"late" msg:"Late Ω & repeats"`
    // Repeated NORMAL and MERGE profiles deliberately have different identities,
    // branches and visual overrides. Expected attributes come from authored intent.
    const commits = [
      ['base', 'main', 'NORMAL', 'NORMAL', 'circle', '8'],
      ['work', 'feature', 'HIGHLIGHT', 'HIGHLIGHT', 'rect', undefined],
      ['release', 'main', 'REVERSE', 'REVERSE', 'circle', '8'],
      ['patch', 'patchline', 'NORMAL', 'NORMAL', 'circle', '8'],
      ['merge', 'main', 'MERGE', 'HIGHLIGHT', 'rect', undefined],
      ['c5', 'main', 'CHERRY_PICK', 'CHERRY_PICK', 'polygon', undefined],
      ['normal-merge', 'main', 'MERGE', 'NORMAL', 'circle', '8'],
      ['reverse-merge', 'main', 'MERGE', 'REVERSE', 'circle', '8'],
      ['default-merge', 'main', 'MERGE', 'MERGE', 'circle', '10'],
      ['late', 'main', 'NORMAL', 'NORMAL', 'circle', '8'],
    ] as const
    for (const [main, feature] of [['#224466', '#6688aa'], ['#884422', '#aa8866']] as const) {
      const svg = renderMermaidSVG(source, {
        security: 'strict', embedFontImport: false,
        mermaidConfig: { themeVariables: { git0: main, git1: feature } },
      })
      for (const [id, branch, semantic, visual, element, radius] of commits) {
        const attrs = `class="git-commit type-${visual.toLowerCase()}" data-id="${id}" data-branch="${branch}" data-commit-type="${semantic}"${semantic !== visual ? ` data-visual-type="${visual}"` : ''} data-role="node"`
        expect(svg).toContain(`<g ${attrs}>`)
        const body = svg.match(new RegExp(`<g ${attrs}>([\\s\\S]*?)<\\/g>`))?.[1]
        expect(body, id).toBeDefined()
        expect(body, id).toContain(`<${element} `)
        if (radius) expect(body, id).toContain(` r="${radius}"`)
        if (element === 'rect') expect(body, id).toContain('width="18" height="18"')
        if (branch === 'main') expect(body, id).toContain(`stroke="${main}"`)
        if (branch === 'feature') expect(body, id).toContain(`stroke="${feature}"`)
      }
      const relations = scanSvgStartTags(svg).map(tag => new Map(tag.attributes.map(attribute => [attribute.name, attribute.value])))
      for (const [kind, from, to] of [['parent', 'base', 'work'], ['merge', 'work', 'merge'], ['cherry-pick', 'patch', 'c5']]) {
        expect(relations.some(attributes => attributes.get('class') === `git-edge git-edge-${kind}`
          && attributes.get('data-from') === from && attributes.get('data-to') === to)).toBe(true)
      }
      expect(svg).toContain('Late Ω &amp; repeats')
      expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })

    }
  })

  test('authored merge IDs remain visible while explicit commit messages and automatic merge labels retain their precedence', () => {
    for (const [merge, label] of [['merge feature id:"release-merge"', 'release-merge'], ['merge feature', 'merged branch feature into main']]) {
      const source = `gitGraph\n commit id:"base" msg:"Foundation"\n branch feature\n commit id:"work"\n checkout main\n ${merge}`
      const parsed = parseMermaid(source)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      const serialized = serializeMermaid(parsed.value)
      expect(serialized).toContain(merge!)
      expect(serialized).not.toContain('msg:"merged branch')
      for (const input of [source, serialized]) {
        expect(renderMermaidSVG(input)).toContain(`>${label}<`)
        const text = renderMermaidASCII(input)
        expect(text).toContain(`[${label}]`)
        expect(text).toContain('[Foundation]')
      }
    }
  })

  test('branch and tag text remains WCAG AA against its badge in every built-in palette', () => {
    for (const { inputName: name, colors: theme } of BUILTIN_PALETTE_DEFINITIONS) {
      const svg = renderMermaidSVG(GITGRAPH, { ...theme, embedFontImport: false })
      const pairs = [
        ...[...svg.matchAll(/<g class="git-branch"[^>]*>([\s\S]*?)<\/g>/g)].map(match => ({
          background: match[1]!.match(/<rect class="git-branch-label-background"[^>]*\sfill="([^"]+)"/)?.[1],
          text: match[1]!.match(/<text[^>]*class="git-branch-label"[^>]*\sfill="([^"]+)"/)?.[1],
        })),
        ...[...svg.matchAll(/<g class="git-commit[^>]*>([\s\S]*?)<\/g>/g)].flatMap(match => {
          const backgrounds = [...match[1]!.matchAll(/<rect class="git-tag-background"[^>]*\sfill="([^"]+)"/g)].map(item => item[1]!)
          const texts = [...match[1]!.matchAll(/<text[^>]*class="git-tag"[^>]*\sfill="([^"]+)"/g)].map(item => item[1]!)
          return texts.map((text, index) => ({ text, background: backgrounds[index] }))
        }),
      ]
      expect(pairs.length, `${name} branch/tag pairs`).toBeGreaterThan(0)
      for (const [index, pair] of pairs.entries()) {
        expect(pair.text, `${name} pair ${index} text`).toBeDefined()
        expect(pair.background, `${name} pair ${index} background`).toBeDefined()
        expect(contrastRatio(pair.text!, pair.background!), `${name} pair ${index} contrast`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test('wires GitGraph display/replay config and emits diagnostics for invalid values', () => {
    const source = 'gitGraph\n  commit id:"base"\n  branch feature\n  commit id:"work"'
    const hidden = renderMermaidSVG(source, { embedFontImport: false, mermaidConfig: { gitGraph: { showBranches: false, showCommitLabel: false } } })
    expect(hidden).not.toContain('git-branch-label')
    expect(hidden).not.toContain('git-commit-label')
    const diagnostics: string[] = []
    renderMermaidSVG(source, {
      embedFontImport: false,
      mermaidConfig: { gitGraph: { showBranches: 'yes' as never } },
      onConfigDiagnostic: diagnostic => diagnostics.push(diagnostic.field),
    })
    expect(diagnostics).toEqual(['gitGraph.showBranches'])
    const configuredAgent = parseMermaid('---\nconfig:\n  gitGraph:\n    mainBranchName: trunk\n---\ngitGraph\n  commit\n  branch docs\n  checkout trunk')
    expect(configuredAgent.ok && asGitGraph(configuredAgent.value)?.body.mainBranchName).toBe('trunk')
    const verified = verifyMermaid('---\nconfig:\n  gitGraph:\n    mysteryLane: 3\n---\ngitGraph\n  commit')
    expect(verified.warnings).toContainEqual(expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'gitGraph.mysteryLane' }))
  })

  // A connector travelling along a lane past another commit reads as passing
  // through it (a merge drawn through `hotfix` claims the wrong history), and
  // two connectors drawn on one line cannot be told apart. Generated
  // histories, in every direction, with and without parallel commits: every
  // connector joins its own two commits, passes no other commit, and shares
  // collinear ink with another connector only as a trunk leaving or entering
  // a commit both join; the layout certificate agrees.
  describe('connector routes', () => {
    type Point = { x: number; y: number }
    const distance = (p: Point, a: Point, b: Point) => {
      const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
    }
    /** Collinear overlap (longer than a pixel) of two axis-aligned segments. */
    const overlap = (a1: Point, a2: Point, b1: Point, b2: Point): [Point, Point] | undefined => {
      for (const [u, v] of [['x', 'y'], ['y', 'x']] as const) {
        // Segments running along u at the same v.
        if (a1[v] !== a2[v] || b1[v] !== b2[v] || a1[v] !== b1[v] || a1[u] === a2[u] || b1[u] === b2[u]) continue
        const low = Math.max(Math.min(a1[u], a2[u]), Math.min(b1[u], b2[u])), high = Math.min(Math.max(a1[u], a2[u]), Math.max(b1[u], b2[u]))
        if (high - low > 1) return [{ ...a1, [u]: low }, { ...a1, [u]: high }]
      }
      return undefined
    }

    function routeFailures(positioned: PositionedGitGraphDiagram): string[] {
      const failures: string[] = []
      const commitById = new Map(positioned.commits.map(commit => [commit.id, commit]))
      for (const edge of positioned.edges) {
        const name = `${edge.from}->${edge.to}`
        const from = commitById.get(edge.from)!, to = commitById.get(edge.to)!
        if (edge.points[0]!.x !== from.x || edge.points[0]!.y !== from.y || edge.points.at(-1)!.x !== to.x || edge.points.at(-1)!.y !== to.y) failures.push(`${name} does not join its commits`)
        for (const [a, b] of segments(edge.points)) {
          if (a.x !== b.x && a.y !== b.y) failures.push(`${name} has a diagonal segment`)
          // Commit marks reach 10px from their centre.
          for (const commit of positioned.commits) if (commit.id !== edge.from && commit.id !== edge.to && distance(commit, a, b) <= 10) failures.push(`${name} passes ${commit.id}`)
        }
      }
      positioned.edges.forEach((edge, i) => {
        for (const other of positioned.edges.slice(i + 1)) {
          const trunks = [edge.from, edge.to].filter(id => id === other.from || id === other.to).map(id => trunk(edge, other, id))
          for (const [a1, a2] of segments(edge.points))
            for (const [b1, b2] of segments(other.points)) {
              const run = overlap(a1, a2, b1, b2)
              if (run && !trunks.some(path => run.every(end => segments(path).some(([p, q]) => distance(end, p, q) < 0.5)))) failures.push(`${edge.from}->${edge.to} runs along ${other.from}->${other.to}`)
            }
        }
      })
      return failures
    }

    /** Ink two connectors share from a commit both join: the same path from
     *  it until they part, so a fork or a join is one trunk, not two lines. */
    function trunk(a: PositionedGitGraphDiagram['edges'][number], b: PositionedGitGraphDiagram['edges'][number], commit: string): Point[] {
      const walk = (edge: typeof a) => {
        const points = edge.from === commit ? edge.points : [...edge.points].reverse()
        // One point per pixel of path length, so a shared prefix compares
        // pixel by pixel whatever the vertices.
        const out: Point[] = []
        let carried = 0
        for (const [p, q] of segments(points)) {
          const length = Math.hypot(q.x - p.x, q.y - p.y)
          for (let s = carried; s < length; s++) out.push({ x: p.x + ((q.x - p.x) * s) / length, y: p.y + ((q.y - p.y) * s) / length })
          carried = length === 0 ? carried : (Math.ceil(length - carried) + carried) - length
        }
        out.push(points.at(-1)!)
        return out
      }
      const p = walk(a), q = walk(b)
      let n = 1
      while (n < p.length && n < q.length && Math.abs(p[n]!.x - q[n]!.x) < 0.5 && Math.abs(p[n]!.y - q[n]!.y) < 0.5) n++
      return p.slice(0, Math.max(2, n))
    }
    const segments = (points: readonly Point[]) => points.slice(1).map((point, i) => [points[i]!, point] as const)

    const OPS = ['commit', 'branch', 'checkout', 'merge', 'cherry-pick'] as const
    /** Replay generated operations, keeping only statements the parser accepts. */
    function history(ops: ReadonlyArray<{ op: (typeof OPS)[number]; pick: number }>): string[] {
      const lines = ['commit id: "k0"']
      const branches = ['main']
      let commits = 1
      for (const { op, pick } of ops) {
        const commitIds = Array.from({ length: commits }, (_, i) => `k${i}`)
        const candidate = op === 'commit' ? `commit id: "k${commits}"`
          : op === 'branch' ? `branch b${branches.length}`
          : op === 'checkout' ? `checkout ${branches[pick % branches.length]}`
          : op === 'merge' ? `merge ${branches[pick % branches.length]} id: "m${lines.length}"`
          : `cherry-pick id: "${commitIds[pick % commitIds.length]}"`
        try {
          parseGitGraph(['gitGraph', ...lines, candidate].join('\n'))
        } catch {
          continue
        }
        lines.push(candidate)
        if (op === 'commit') commits++
        if (op === 'branch') branches.push(`b${branches.length}`)
      }
      return lines
    }

    test('no connector passes a commit or runs along another connector', () => {
      fc.assert(
        fc.property(fc.array(fc.record({ op: fc.constantFrom(...OPS), pick: fc.nat({ max: 40 }) }), { minLength: 4, maxLength: 28 }), ops => {
          const body = history(ops)
          for (const direction of ['LR', 'TB', 'BT'] as const) {
            const diagram = parseGitGraph([`gitGraph ${direction}:`, ...body].join('\n'))
            for (const parallelCommits of [false, true]) {
              const positioned = layoutGitGraph(diagram, { parallelCommits })
              expect(routeFailures(positioned), `${direction} parallel=${parallelCommits}\n${body.join('\n')}`).toEqual([])
              expect(positioned.uncertifiedLayout, `${direction} parallel=${parallelCommits}`).toBeUndefined()
            }
          }
        }),
        fcParameters({
          numRuns: 60,
          // The reported history: develop's merge ran along main through
          // `hotfix`; the cherry-pick ran along the feature lane through f2
          // and shared a vertical with the f2 -> m1 merge.
          examples: [[[
            { op: 'branch', pick: 0 }, { op: 'commit', pick: 0 }, { op: 'branch', pick: 0 }, { op: 'commit', pick: 0 }, { op: 'commit', pick: 0 },
            { op: 'checkout', pick: 1 }, { op: 'merge', pick: 2 }, { op: 'checkout', pick: 0 }, { op: 'cherry-pick', pick: 2 }, { op: 'commit', pick: 0 }, { op: 'merge', pick: 1 },
          ]], [[
            // A branch merged before it left its lane runs along main past k1, k2.
            { op: 'branch', pick: 0 }, { op: 'checkout', pick: 0 }, { op: 'commit', pick: 0 }, { op: 'commit', pick: 0 }, { op: 'merge', pick: 1 },
          ]], [[
            // Four branches forking from one commit share one trunk.
            ...[1, 2, 3, 4].flatMap(() => [{ op: 'branch' as const, pick: 0 }, { op: 'commit' as const, pick: 0 }, { op: 'checkout' as const, pick: 0 }]),
          ]]],
        }),
      )
    })

    test('the layout certificate names a connector through a commit or along another', () => {
      // Hand-drawn routes the old router produced: the merge into c8 runs
      // along main through hotfix; the cherry-pick shares the f2 merge's column.
      const commits = [
        { id: 'f1', lane: 2, x: 100, y: 200 }, { id: 'f2', lane: 2, x: 200, y: 200 }, { id: 'm1', lane: 1, x: 300, y: 100 },
        { id: 'pick', lane: 0, x: 400, y: 0 }, { id: 'hotfix', lane: 0, x: 500, y: 0 }, { id: 'c8', lane: 0, x: 600, y: 0 },
      ]
      const edges = [
        { from: 'm1', to: 'c8', kind: 'merge' as const, points: [{ x: 300, y: 100 }, { x: 450, y: 100 }, { x: 450, y: 0 }, { x: 600, y: 0 }] },
        { from: 'f2', to: 'm1', kind: 'merge' as const, points: [{ x: 200, y: 200 }, { x: 250, y: 200 }, { x: 250, y: 100 }, { x: 300, y: 100 }] },
        { from: 'f1', to: 'pick', kind: 'cherry-pick' as const, points: [{ x: 100, y: 200 }, { x: 250, y: 200 }, { x: 250, y: 0 }, { x: 400, y: 0 }] },
      ]
      const found = gitGraphRouteViolations(commits, edges).map(violation => [violation.kind, ...violation.targets])
      expect(found).toContainEqual(['edgeThroughNode', 'm1->c8', 'hotfix'])
      expect(found).toContainEqual(['edgeThroughNode', 'f1->pick', 'f2'])
      expect(found).toContainEqual(['collinearEdges', 'f2->m1', 'f1->pick'])
      const verify = verifyMermaid('gitGraph\n  commit id:"c1"\n  branch develop\n  commit id:"d1"\n  branch feature/login\n  commit id:"f1"\n  commit id:"f2"\n  checkout develop\n  merge feature/login id:"m1"\n  checkout main\n  cherry-pick id:"f1"\n  commit id:"hotfix"\n  merge develop id:"c8"')
      expect(verify.warnings.filter(warning => warning.code === 'LAYOUT_UNCERTIFIED')).toEqual([])
    })
  })

  test('preserves deterministic commit and parent counts under generated linear histories', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), length => {
        const source = ['gitGraph', ...Array.from({ length }, () => '  commit')].join('\n')
        const first = parseGitGraph(source)
        const second = parseGitGraph(source)
        expect(second).toEqual(first)
        expect(first.commits.map(commit => commit.id)).toEqual(Array.from({ length }, (_, index) => `c${index}`))
        expect(first.commits.reduce((sum, commit) => sum + commit.parents.length, 0)).toBe(length - 1)
      }),
      fcParameters({ numRuns: 30, seed: 1601 }),
    )
  })
})
