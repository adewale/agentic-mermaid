import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { getStyle, knownStyles, renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { styleKind } from '../scene/style-registry.ts'
import { parseMindmap } from '../mindmap/parser.ts'
import { layoutMindmap } from '../mindmap/layout.ts'

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
      if (entry.family !== 'mindmap' && entry.family !== 'gitgraph') {
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

  test('every built-in Look × Palette combination renders every docs family', () => {
    const looks = knownStyles().filter(name => {
      const spec = getStyle(name)
      return spec && styleKind(spec) === 'look'
    })
    const palettes = knownStyles().filter(name => {
      const spec = getStyle(name)
      return spec && styleKind(spec) === 'theme'
    })
    expect(looks).toHaveLength(15)
    expect(palettes).toHaveLength(20)
    let combinations = 0
    for (const entry of manifest.cases) {
      for (const look of looks) {
        for (const paletteName of palettes) {
          const palette = getStyle(paletteName)!.colors!
          const svg = renderMermaidSVG(entry.source, {
            style: [look, paletteName], seed: 19, security: 'strict', embedFontImport: false,
          })
          const context = `${entry.family} × ${look} × ${paletteName}`
          expect(svg, context).toContain(`--bg:${palette.bg}`)
          expect(svg, context).toContain(`--fg:${palette.fg}`)
          expect(svg, context).not.toMatch(/(?:NaN|Infinity|undefined)/)
          expect(verifyNoExternalRefs(svg), context).toEqual({ ok: true, refs: [] })
          const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
          expect(viewBox, `${context} viewBox`).not.toBeNull()
          expect(Number(viewBox![1])).toBeGreaterThan(0)
          expect(Number(viewBox![2])).toBeGreaterThan(0)
          combinations++
        }
      }
    }
    expect(combinations).toBe(14 * 15 * 20)
  }, 60_000)

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
    const tsFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return tsFiles(path)
      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
    })
    const inputs = [
      join(ROOT, 'eval', 'mermaid-doc-showcase', 'manifest.json'),
      join(ROOT, receipt.generator),
      ...tsFiles(join(ROOT, 'src')),
    ].sort((a, b) => relative(ROOT, a).replaceAll('\\', '/').localeCompare(relative(ROOT, b).replaceAll('\\', '/')))
    const inputHash = createHash('sha256')
    for (const path of inputs) inputHash.update(relative(ROOT, path).replaceAll('\\', '/')).update('\0').update(readFileSync(path)).update('\0')
    expect(receipt.inputCount).toBe(inputs.length)
    expect(receipt.inputTreeSha256).toBe(inputHash.digest('hex'))
    const output = readFileSync(join(ROOT, receipt.output))
    expect(createHash('sha256').update(output).digest('hex')).toBe(receipt.outputSha256)
  })
})
