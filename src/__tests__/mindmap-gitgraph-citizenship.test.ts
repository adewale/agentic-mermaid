import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'

import {
  GitGraphDuplicateCommitError, GitGraphParseError, MindmapDuplicateIdError,
  parseGitGraph, parseMindmap, renderMermaidASCII, renderMermaidSVG,
  serializeGitGraph, serializeMindmap, verifyNoExternalRefs,
} from '../index.ts'
import {
  asGitGraph, asMindmap, layoutMermaid, mutate, parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid,
} from '../agent/index.ts'
import { layoutMindmap } from '../mindmap/layout.ts'
import { lowerMindmapScene } from '../mindmap/renderer.ts'
import { layoutGitGraph } from '../gitgraph/layout.ts'
import { visualWidth } from '../ascii/width.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { contrastRatio } from '../shared/color-math.ts'
import { DEFAULTS } from '../theme.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import { connectorUnitTangent } from '../scene/connector-geometry.ts'

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

describe('Mindmap full-family citizenship', () => {
  test('preserves indentation semantics, shapes, icons, classes, and accessibility on stable round-trip', () => {
    const parsed = parseMindmap(MINDMAP)
    expect(parsed.accessibilityTitle).toBe('Product map')
    expect(parsed.root.children.map(node => node.id)).toEqual(['Research', 'Delivery'])
    expect(parsed.root.children[0]!.children.map(node => [node.id, node.shape])).toEqual([
      ['interviews', 'rect'], ['evidence', 'hexagon'],
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

  test('rejects duplicate semantic identities instead of silently overwriting a node', () => {
    expect(() => parseMindmap('mindmap\n  root\n    dup[First]\n    dup[Second]')).toThrow(MindmapDuplicateIdError)
  })

  test('rejects empty icon decorations instead of dropping them on round-trip', () => {
    for (const decoration of ['::icon()', '::icon(   )']) {
      expect(() => parseMindmap(`mindmap\n  Root\n    ${decoration}`), decoration)
        .toThrow('Mindmap icon decoration must contain a non-empty value')
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
      expect(connector.kind).toBe('connector')
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

  test('keeps deterministic tree invariants under generated sibling labels', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,8}$/), { minLength: 1, maxLength: 8 }), labels => {
      const source = ['mindmap', '  Root', ...labels.map(label => `    ${label}`)].join('\n')
      const parsed = parseMindmap(source)
      const layout = layoutMindmap(parsed)
      expect(layout.nodes).toHaveLength(labels.length + 1)
      expect(layout.edges).toHaveLength(labels.length)
      expect(serializeMindmap(parseMindmap(serializeMindmap(parsed)))).toBe(serializeMindmap(parsed))
    }), { numRuns: 30, seed: 1501 })
  })
})

describe('GitGraph full-family citizenship', () => {
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

  test('names duplicate identities and invalid replay state instead of overwriting history', () => {
    expect(() => parseGitGraph('gitGraph\n  commit id:"same"\n  commit id:"same"')).toThrow(GitGraphDuplicateCommitError)
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
    for (const group of rendered.groups) for (const member of group.members) {
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
      const layout = layoutGitGraph(parseGitGraph(`gitGraph ${direction}:\n  commit id:"x" msg:"${message}"`))
      const commit = layout.commits[0]!
      const origin = direction === 'LR'
        ? { x: commit.x, y: commit.y + 24, anchor: 'middle' as const, angle: 45 }
        : { x: commit.x + 14, y: commit.y + 4, anchor: 'start' as const, angle: 0 }
      const width = measureTextWidth(message, 11, 500)
      const left = origin.anchor === 'middle' ? -width / 2 : 0
      const corners = [[left, -11], [left + width, -11], [left, 3], [left + width, 3]].map(([x, y]) => {
        const radians = origin.angle * Math.PI / 180
        return {
          x: origin.x + x! * Math.cos(radians) - y! * Math.sin(radians),
          y: origin.y + x! * Math.sin(radians) + y! * Math.cos(radians),
        }
      })
      expect(Math.min(...corners.map(point => point.x)), `${direction} min x`).toBeGreaterThanOrEqual(0)
      expect(Math.min(...corners.map(point => point.y)), `${direction} min y`).toBeGreaterThanOrEqual(0)
      expect(Math.max(...corners.map(point => point.x)), `${direction} max x`).toBeLessThanOrEqual(layout.width)
      expect(Math.max(...corners.map(point => point.y)), `${direction} max y`).toBeLessThanOrEqual(layout.height)
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
    expect(text).toContain('[merged branch feature into main]')

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

  test('branch and tag text remains WCAG AA against its badge in every built-in palette', () => {
    for (const { inputName: name, colors: theme } of BUILTIN_PALETTE_DEFINITIONS) {
      const svg = renderMermaidSVG(GITGRAPH, { ...theme, embedFontImport: false })
      const pairs = [
        ...[...svg.matchAll(/<g class="git-branch"[^>]*>([\s\S]*?)<\/g>/g)].map(match => ({
          background: match[1]!.match(/<rect class="git-branch-label-background"[^>]*\sfill="([^"]+)"/)?.[1],
          text: match[1]!.match(/<text class="git-branch-label"[^>]*\sfill="([^"]+)"/)?.[1],
        })),
        ...[...svg.matchAll(/<g class="git-commit[^>]*>([\s\S]*?)<\/g>/g)].flatMap(match => {
          const backgrounds = [...match[1]!.matchAll(/<rect class="git-tag-background"[^>]*\sfill="([^"]+)"/g)].map(item => item[1]!)
          const texts = [...match[1]!.matchAll(/<text class="git-tag"[^>]*\sfill="([^"]+)"/g)].map(item => item[1]!)
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

  test('preserves deterministic commit and parent counts under generated linear histories', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20 }), length => {
      const source = ['gitGraph', ...Array.from({ length }, () => '  commit')].join('\n')
      const first = parseGitGraph(source)
      const second = parseGitGraph(source)
      expect(second).toEqual(first)
      expect(first.commits.map(commit => commit.id)).toEqual(Array.from({ length }, (_, index) => `c${index}`))
      expect(first.commits.reduce((sum, commit) => sum + commit.parents.length, 0)).toBe(length - 1)
    }), { numRuns: 30, seed: 1601 })
  })
})
