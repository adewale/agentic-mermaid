import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { parseMindmap } from '../mindmap/parser.ts'
import { layoutMindmap } from '../mindmap/layout.ts'
import { hashFileTree, sortRepositoryPaths, transitiveLocalInputs } from '../../scripts/pr-assets/artifact-receipt.ts'

const ROOT = join(import.meta.dir, '..', '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'eval', 'mermaid-doc-showcase', 'manifest.json'), 'utf8')) as {
  schemaVersion: number
  mermaidVersion: string
  upstreamRevision: string
  cases: Array<{
    family: string
    title: string
    officialDocs: string
    origin: string
    index: number
    source: string
    sourceSha256: string
  }>
}
const docsCorpus = JSON.parse(readFileSync(join(ROOT, 'eval', 'mermaid-docs-corpus', 'corpus.json'), 'utf8')) as Array<{
  family: string
  source: string
  origin: string
  index: number
}>

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('official Mermaid documentation showcase', () => {
  test('pins exactly one authentic docs example for every supported family', () => {
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.mermaidVersion).toBe('11.16.0')
    expect(manifest.upstreamRevision).toMatch(/^[a-f0-9]{40}$/)
    expect(manifest.cases.map(entry => entry.family).sort()).toEqual(BUILTIN_FAMILY_METADATA.map(entry => entry.id).sort())
    for (const entry of manifest.cases) {
      expect(entry.officialDocs).toMatch(/^https:\/\/mermaid\.js\.org\/syntax\//)
      expect(sha256(entry.source), entry.family).toBe(entry.sourceSha256)
      // mindmap/gitgraph/radar were added after the legacy 12-family docs corpus
      // was frozen; their showcase source lives only in this manifest.
      if (entry.family !== 'mindmap' && entry.family !== 'gitgraph' && entry.family !== 'radar') {
        const corpusEntry = docsCorpus.find(candidate => candidate.family === entry.family && candidate.index === entry.index)
        expect(corpusEntry, `${entry.family} docs corpus row`).toBeDefined()
        expect(corpusEntry?.origin).toBe(entry.origin)
        expect(corpusEntry?.source).toBe(entry.source)
      }
      const svg = renderMermaidSVG(entry.source, { embedFontImport: false, security: 'strict' })
      expect(svg, entry.family).toContain('<svg')
      expect(svg, entry.family).not.toMatch(/(?:NaN|Infinity|undefined)/)
      expect(verifyNoExternalRefs(svg), entry.family).toEqual({ ok: true, refs: [] })
    }
  })

  test('Mindmap docs example uses a compact central canvas and branch colors', () => {
    const entry = manifest.cases.find(candidate => candidate.family === 'mindmap')!
    const layout = layoutMindmap(parseMindmap(entry.source))
    expect(layout.width / layout.height).toBeLessThanOrEqual(3.1)
    const svg = renderMermaidSVG(entry.source, { embedFontImport: false })
    const branchStrokes = new Set([...svg.matchAll(/class="mindmap-edge"[^>]*stroke="([^"]+)"/g)].map(match => match[1]))
    const branchFills = new Set([...svg.matchAll(/class="mindmap-node depth-1"[\s\S]*?<[^>]+ fill="([^"]+)"/g)].map(match => match[1]))
    expect(branchStrokes.size).toBeGreaterThanOrEqual(3)
    expect(branchFills.size).toBeGreaterThanOrEqual(3)
  })

  test('generated docs gallery receipt covers current sources and PNG bytes', () => {
    const receipt = JSON.parse(readFileSync(join(ROOT, 'eval', 'mermaid-doc-showcase', 'gallery-receipt.json'), 'utf8')) as {
      schemaVersion: number
      generator: string
      inputCount: number
      inputTreeSha256: string
      output: string
      outputSha256: string
    }
    expect(receipt.schemaVersion).toBe(1)
    expect(receipt.generator).toBe('scripts/pr-assets/mermaid-doc-showcase-gallery.ts')
    const inputs = sortRepositoryPaths(ROOT, [
      join(ROOT, 'eval', 'mermaid-doc-showcase', 'manifest.json'),
      join(ROOT, 'package.json'),
      join(ROOT, 'bun.lock'),
      ...transitiveLocalInputs(ROOT, [join(ROOT, receipt.generator)]),
    ])
    expect(receipt.inputCount).toBe(inputs.length)
    expect(receipt.inputTreeSha256).toBe(hashFileTree(ROOT, inputs))
    const output = readFileSync(join(ROOT, receipt.output))
    expect(createHash('sha256').update(output).digest('hex')).toBe(receipt.outputSha256)
  })
})
