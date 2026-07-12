import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { layoutGitGraph } from '../gitgraph/layout.ts'
import { layoutMindmap } from '../mindmap/layout.ts'
import type { MindmapNode, MindmapShape } from '../mindmap/types.ts'
import { getStyle, renderMermaidASCII, renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { asGitGraph, asMindmap, layoutMermaid, parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { visualWidth } from '../ascii/width.ts'
import { audit as auditSvgOverlaps } from '../../eval/overlap-audit/audit.ts'

const CORPUS = join(import.meta.dir, '..', '..', 'eval', 'mindmap-gitgraph-content-corpus')

type Expected = {
  nodeCount?: number
  rootChildren?: number
  layout?: 'central' | 'tidy-tree'
  labels?: string[]
  terminalText: string[]
  shapes?: MindmapShape[]
  icons?: string[]
  classes?: string[]
  commitCount?: number
  branchCount?: number
  direction?: 'LR' | 'TB' | 'BT'
  commitIds?: string[]
  branches?: string[]
  tags?: string[]
  svgText?: string[]
  parentCount?: number
  parentRelations?: Record<string, string[]>
  branchLaneOrder?: string[]
  cherrySource?: string
  cherryParent?: string
  commitLabelFontSize?: number
  rotateCommitLabel?: boolean
  warningCodes: string[]
}
type CorpusCase = {
  id: string
  family: 'mindmap' | 'gitgraph'
  file: string
  scenario: string
  sources: string[]
  expect: Expected
}
type Manifest = {
  schemaVersion: number
  target: string
  method: string
  forkSnapshot: string
  forkGraphSnapshot: Array<{
    root: string
    sampledForks: Array<{ repo: string; stars: number }>
    sampleWeight: number
    finding: string
  }>
  cases: CorpusCase[]
}
type ForkSnapshot = {
  schemaVersion: number
  fetchedAt: string
  policy: { sampleRule: string; sampleSizes: Record<string, number>; exclusions: Record<string, string[]> }
  roots: Array<{
    root: string
    apiUrl: string
    responseSha256: string
    returned: number
    sampleSize: number
    excluded: string[]
    forks: Array<{ id: number; repo: string; url: string; stars: number; pushedAt: string; archived: boolean }>
  }>
}

const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as Manifest
const forkSnapshot = JSON.parse(readFileSync(join(CORPUS, manifest.forkSnapshot), 'utf8')) as ForkSnapshot
const sourceFor = (entry: CorpusCase): string => readFileSync(join(CORPUS, entry.file), 'utf8')
const flattenMindmap = (node: MindmapNode): MindmapNode[] =>
  [node, ...node.children.flatMap(flattenMindmap)]
const plainSvgText = (svg: string): string => svg
  .replace(/<[^>]+>/g, ' ')
  .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
  .replace(/\s+/g, ' ').trim()

describe('Mindmap/GitGraph popularity-weighted real-content corpus', () => {
  test('gallery receipt pins every source input and generated artifact', () => {
    const receipt = JSON.parse(readFileSync(join(CORPUS, 'gallery-receipt.json'), 'utf8')) as {
      schemaVersion: number
      generator: string
      inputs: Array<{ path: string; sha256: string }>
      outputs: Array<{ path: string; sha256: string }>
    }
    expect(receipt.schemaVersion).toBe(1)
    expect(receipt.generator).toBe('scripts/pr-assets/mindmap-gitgraph-content-gallery.ts')
    expect(receipt.inputs.map(input => input.path)).toContain('eval/mindmap-gitgraph-content-corpus/manifest.json')
    expect(receipt.inputs.some(input => input.path.startsWith('src/mindmap/'))).toBe(true)
    expect(receipt.inputs.some(input => input.path.startsWith('src/gitgraph/'))).toBe(true)
    expect(receipt.outputs.map(output => output.path).sort()).toEqual([
      'docs/design/families/gitgraph-content-gallery.png',
      'docs/design/families/mindmap-content-gallery.png',
    ])
    for (const artifact of [...receipt.inputs, ...receipt.outputs]) {
      const actual = createHash('sha256').update(readFileSync(join(CORPUS, '..', '..', artifact.path))).digest('hex')
      expect(actual, artifact.path).toBe(artifact.sha256)
    }
  })

  test('manifest accounts for every fixture and records reproducible source weighting', () => {
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.target).toBe('Mermaid 11.16.0')
    expect(manifest.method).toContain('reproducible point-in-time sample')
    expect(forkSnapshot.schemaVersion).toBe(1)
    expect(forkSnapshot.fetchedAt).toMatch(/^2026-07-12T\d{2}:\d{2}:\d{2}Z$/)
    expect(forkSnapshot.policy.sampleRule).toContain('first N API-ranked')
    expect(forkSnapshot.policy.exclusions['lukilabs/beautiful-mermaid']?.join(' ')).toContain('self-referential')
    expect(manifest.forkGraphSnapshot.map(entry => entry.root)).toEqual([
      'mermaid-js/mermaid', 'lukilabs/beautiful-mermaid', 'AlexanderGrooff/mermaid-ascii',
    ])
    for (const graph of manifest.forkGraphSnapshot) {
      const raw = forkSnapshot.roots.find(root => root.root === graph.root)
      expect(raw, graph.root).toBeDefined()
      expect(raw?.apiUrl).toBe(`https://api.github.com/repos/${graph.root}/forks?sort=stargazers&per_page=100&page=1`)
      expect(raw?.responseSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(raw?.returned).toBeGreaterThanOrEqual(raw?.sampleSize ?? Number.POSITIVE_INFINITY)
      expect(forkSnapshot.policy.sampleSizes[graph.root]).toBe(raw?.sampleSize)
      const selected = raw!.forks
        .filter(fork => !fork.archived && !raw!.excluded.includes(fork.repo))
        .slice(0, raw!.sampleSize)
        .map(({ repo, stars }) => ({ repo, stars }))
      expect(graph.sampledForks, graph.root).toEqual(selected)
      expect(graph.sampleWeight).toBe(selected.reduce((sum, fork) => sum + fork.stars, 0))
      expect(graph.finding.length).toBeGreaterThan(40)
    }
    const fixtureFiles = (['mindmap', 'gitgraph'] as const).flatMap(family =>
      readdirSync(join(CORPUS, family)).filter(file => file.endsWith('.mmd')).map(file => `${family}/${file}`),
    ).sort()
    expect(manifest.cases.map(entry => entry.file).sort()).toEqual(fixtureFiles)
    expect(new Set(manifest.cases.map(entry => entry.id)).size).toBe(manifest.cases.length)
    expect(manifest.cases.filter(entry => entry.family === 'mindmap')).toHaveLength(6)
    expect(manifest.cases.filter(entry => entry.family === 'gitgraph')).toHaveLength(7)
    for (const entry of manifest.cases) {
      expect(entry.scenario.length, entry.id).toBeGreaterThan(40)
      expect(entry.sources.length, entry.id).toBeGreaterThanOrEqual(2)
      for (const source of entry.sources) expect(source, entry.id).toMatch(/^https:\/\//)
    }
  })

  for (const entry of manifest.cases) {
    test(`${entry.id} preserves structure, family geometry, SVG safety, and terminal content`, () => {
      const source = sourceFor(entry)
      const parsed = parseMermaid(source)
      expect(parsed.ok, entry.id).toBe(true)
      if (!parsed.ok) return
      expect(parsed.value.kind).toBe(entry.family)

      const verified = verifyMermaid(source)
      expect(verified.ok, entry.id).toBe(true)
      expect(verified.warnings.map(warning => warning.code) as string[], entry.id).toEqual(entry.expect.warningCodes)
      expect(verified.layout.nodes.length, `${entry.id}: truthful public layout`).toBeGreaterThan(0)

      const canonical = serializeMermaid(parsed.value)
      const reparsed = parseMermaid(canonical)
      expect(reparsed.ok, entry.id).toBe(true)
      if (reparsed.ok) expect(serializeMermaid(reparsed.value)).toBe(canonical)

      if (entry.family === 'mindmap') {
        const narrowed = asMindmap(parsed.value)
        expect(narrowed, entry.id).not.toBeNull()
        if (!narrowed) return
        const authoredNodes = flattenMindmap(narrowed.body.root)
        expect(authoredNodes).toHaveLength(entry.expect.nodeCount!)
        expect(narrowed.body.root.children).toHaveLength(entry.expect.rootChildren!)
        for (const label of entry.expect.labels ?? []) {
          expect(authoredNodes.some(node => node.label === label), `${entry.id}: ${label}`).toBe(true)
        }
        if (entry.expect.shapes) expect([...new Set(authoredNodes.map(node => node.shape))].sort()).toEqual([...entry.expect.shapes].sort())
        if (entry.expect.icons) expect(authoredNodes.flatMap(node => node.icon ? [node.icon] : [])).toEqual(entry.expect.icons)
        if (entry.expect.classes) expect(authoredNodes.flatMap(node => node.className ? [node.className] : [])).toEqual(entry.expect.classes)
        const positioned = layoutMindmap(narrowed.body, {
          layout: entry.expect.layout === 'tidy-tree' ? 'tidy-tree' : 'radial',
        })
        expect(positioned.nodes).toHaveLength(entry.expect.nodeCount!)
        expect(positioned.edges).toHaveLength(entry.expect.nodeCount! - 1)
        const nonRootSides = new Set(positioned.nodes.filter(node => node.depth > 0).map(node => node.side))
        if (entry.expect.layout === 'tidy-tree') expect(nonRootSides).toEqual(new Set(['right']))
        else expect(nonRootSides).toEqual(new Set(['left', 'right']))
      } else {
        const narrowed = asGitGraph(parsed.value)
        expect(narrowed, entry.id).not.toBeNull()
        if (!narrowed) return
        expect(narrowed.body.commits.map(commit => commit.id)).toEqual(entry.expect.commitIds!)
        expect(new Set(narrowed.body.branches.map(branch => branch.name))).toEqual(new Set(entry.expect.branches!))
        expect(narrowed.body.direction).toBe(entry.expect.direction!)
        const tags = new Set(narrowed.body.commits.flatMap(commit => commit.tags))
        for (const tag of entry.expect.tags ?? []) expect(tags.has(tag), `${entry.id}: tag ${tag}`).toBe(true)
        const parentCount = narrowed.body.commits.reduce((sum, commit) => sum + commit.parents.length, 0)
        expect(parentCount).toBe(entry.expect.parentCount!)
        const positioned = layoutGitGraph(narrowed.body)
        expect(positioned.commits).toHaveLength(entry.expect.commitCount!)
        expect(positioned.edges).toHaveLength(entry.expect.parentCount!)
        expect(positioned.branches).toHaveLength(entry.expect.branchCount!)
        for (const [commitId, parents] of Object.entries(entry.expect.parentRelations ?? {})) {
          const commit = narrowed.body.commits.find(candidate => candidate.id === commitId)
          expect(commit?.parents, `${entry.id}: parents of ${commitId}`).toEqual(parents)
          for (const parent of parents) {
            expect(positioned.edges.some(edge => edge.from === parent && edge.to === commitId), `${entry.id}: ${parent} -> ${commitId}`).toBe(true)
          }
        }
        if (entry.expect.branchLaneOrder) {
          expect([...positioned.branches].sort((a, b) => a.lane - b.lane).map(branch => branch.name)).toEqual(entry.expect.branchLaneOrder)
        }
        const bySequence = [...positioned.commits].sort((a, b) => a.sequence - b.sequence)
        const first = bySequence[0]!
        const last = bySequence.at(-1)!
        if (entry.expect.direction === 'LR') expect(last.x).toBeGreaterThan(first.x)
        if (entry.expect.direction === 'TB') expect(last.y).toBeGreaterThan(first.y)
        if (entry.expect.direction === 'BT') expect(last.y).toBeLessThan(first.y)
        if (entry.expect.cherrySource) {
          const cherry = narrowed.body.commits.find(commit => commit.source === 'cherry-pick')
          expect(cherry?.cherrySource).toBe(entry.expect.cherrySource)
          expect(cherry?.cherryParent).toBe(entry.expect.cherryParent)
        }
        if (entry.expect.commitLabelFontSize) {
          const frontmatter = narrowed.meta.frontmatter as {
            themeVariables?: { commitLabelFontSize?: number }
            gitGraph?: { rotateCommitLabel?: boolean }
          } | undefined
          expect(frontmatter?.themeVariables?.commitLabelFontSize).toBe(entry.expect.commitLabelFontSize)
          expect(frontmatter?.gitGraph?.rotateCommitLabel).toBe(entry.expect.rotateCommitLabel)
        }
      }

      const svg = renderMermaidSVG(source, { embedFontImport: false })
      expect(svg).toContain('<svg')
      expect(renderMermaidSVG(source, { embedFontImport: false })).toBe(svg)
      expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
      expect(auditSvgOverlaps(svg), `${entry.id}: rendered overlap audit`).toEqual([])
      const svgText = plainSvgText(svg)
      for (const sentinel of entry.expect.svgText ?? entry.expect.labels ?? []) {
        expect(svgText, `${entry.id}: SVG text ${sentinel}`).toContain(sentinel)
      }
      const terminalWidth = entry.family === 'mindmap' ? 100 : 120
      const terminal = renderMermaidASCII(source, { targetWidth: terminalWidth, colorMode: 'none' })
      for (const sentinel of entry.expect.terminalText) {
        expect(terminal, `${entry.id}: terminal text ${sentinel}`).toContain(sentinel)
      }
      expect(Math.max(...terminal.split('\n').map(visualWidth))).toBeLessThanOrEqual(terminalWidth)
    })
  }

  test('every real-content scenario composes deterministically with Style + Palette stacks', () => {
    const stacks = [
      ['hand-drawn', 'dracula'],
      ['publication-figure', 'github-light'],
      ['watercolor', 'nord-light'],
    ] as const
    for (const entry of manifest.cases) {
      const source = sourceFor(entry)
      for (const stack of stacks) {
        const options = { style: [...stack], seed: 7, security: 'strict' as const, embedFontImport: false }
        const first = renderMermaidSVG(source, options)
        const again = renderMermaidSVG(source, options)
        const palette = getStyle(stack[1])!.colors!
        expect(first, `${entry.id} × ${stack.join('+')}`).toBe(again)
        expect(first).toContain(`--bg:${palette.bg}`)
        expect(first).toContain(`--fg:${palette.fg}`)
        expect(first).not.toMatch(/(?:NaN|Infinity|undefined)/)
        expect(verifyNoExternalRefs(first), `${entry.id} × ${stack.join('+')}`).toEqual({ ok: true, refs: [] })
        const sentinel = entry.expect.svgText?.[0] ?? entry.expect.labels?.[0]
        expect(sentinel, entry.id).toBeDefined()
        expect(plainSvgText(first), `${entry.id} × ${stack.join('+')} text`).toContain(sentinel!)
      }
    }
  })

  test('public layout honors wrapper-only Mindmap layout and GitGraph main-branch config', () => {
    const tidyEntry = manifest.cases.find(entry => entry.id === 'mindmap-tidy-tree-explicit')!
    const tidyParsed = parseMermaid(sourceFor(tidyEntry))
    expect(tidyParsed.ok).toBe(true)
    if (tidyParsed.ok) {
      const layout = layoutMermaid(tidyParsed.value)
      const root = layout.nodes.find(node => node.id === 'root')!
      expect(layout.nodes.filter(node => node.id !== 'root').every(node => node.x > root.x)).toBe(true)
    }

    for (const id of ['gitgraph-unicode-unusual-branches', 'gitgraph-transit-domain-transfer']) {
      const entry = manifest.cases.find(candidate => candidate.id === id)!
      const parsed = parseMermaid(sourceFor(entry))
      expect(parsed.ok, id).toBe(true)
      if (!parsed.ok) continue
      const body = asGitGraph(parsed.value)!.body
      expect(body.mainBranchName).not.toBe('main')
      expect(layoutMermaid(parsed.value).nodes).toHaveLength(entry.expect.commitCount!)
      expect(verifyMermaid(sourceFor(entry)).warnings).not.toContainEqual(expect.objectContaining({ syntax: 'empty_layout' }))
    }
  })
})
