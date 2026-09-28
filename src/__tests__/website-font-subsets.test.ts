import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import manifestJson from '../../website/source/assets/fonts/inter/manifest.json'
import { WEBSITE_PAYLOAD_BUDGETS } from '../../scripts/site/website-payload-budgets.ts'
import {
  WEBSITE_INTER_GLYPH_PROBES,
  WEBSITE_INTER_SUBSET_DIRECTORY,
  WEBSITE_INTER_SUBSET_FACES,
  WEBSITE_INTER_SUBSET_MANIFEST,
  WEBSITE_INTER_SUBSET_MAX_FACE_BYTES,
  WEBSITE_INTER_SUBSET_MAX_TOTAL_BYTES,
  WEBSITE_INTER_SUBSET_REQUIREMENTS_SHA256,
  WEBSITE_INTER_SUBSET_TOOLCHAIN,
  WEBSITE_INTER_UNICODE_RANGES,
  expectedWebsiteInterSources,
  validateWebsiteInterSubsetManifest,
  type WebsiteInterSubsetManifest,
} from '../../scripts/site/website-font-subsets.ts'
import { ensureWebsiteBuilt } from './website-public-fixture.ts'

ensureWebsiteBuilt()

const ROOT = join(import.meta.dir, '..', '..')
const PUBLIC = join(ROOT, 'website', 'public')
const manifest = manifestJson as unknown as WebsiteInterSubsetManifest
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

describe('canonical website Inter subsets', () => {
  test('pins four source faces, toolchain, policy, coverage, and canonical WOFF2 bytes', () => {
    expect(validateWebsiteInterSubsetManifest(manifest)).toEqual([])
    expect(manifest.toolchain).toEqual(WEBSITE_INTER_SUBSET_TOOLCHAIN)
    expect(manifest.probes).toEqual(WEBSITE_INTER_GLYPH_PROBES)
    expect(manifest.unicodeRanges).toEqual(WEBSITE_INTER_UNICODE_RANGES)
    expect(manifest.sources).toEqual(expectedWebsiteInterSources())
    expect(manifest.totalBytes).toBeLessThanOrEqual(WEBSITE_INTER_SUBSET_MAX_TOTAL_BYTES)
    expect(manifest.requirementsSha256).toBe(WEBSITE_INTER_SUBSET_REQUIREMENTS_SHA256)
    expect(digest(readFileSync(join(ROOT, WEBSITE_INTER_SUBSET_TOOLCHAIN.requirements)))).toBe(WEBSITE_INTER_SUBSET_REQUIREMENTS_SHA256)

    const directory = join(ROOT, WEBSITE_INTER_SUBSET_DIRECTORY)
    expect(readdirSync(directory).sort()).toEqual([
      ...manifest.outputs.map(output => output.file),
      basename(WEBSITE_INTER_SUBSET_MANIFEST),
    ].sort())
    for (const source of manifest.sources) {
      const bytes = readFileSync(join(ROOT, 'assets', 'fonts', source.file))
      expect({ file: source.file, bytes: bytes.byteLength, sha256: digest(bytes) }).toEqual({
        file: source.file, bytes: source.bytes, sha256: source.sha256,
      })
    }
    for (const output of manifest.outputs) {
      const bytes = readFileSync(join(directory, output.file))
      expect(bytes.subarray(0, 4).toString('ascii'), output.file).toBe('wOF2')
      expect({ bytes: bytes.byteLength, sha256: digest(bytes) }).toEqual({ bytes: output.bytes, sha256: output.sha256 })
      expect(output.file).toContain(output.sha256.slice(0, 12))
      expect(output.bytes).toBeLessThanOrEqual(WEBSITE_INTER_SUBSET_MAX_FACE_BYTES)
    }
  })

  test('public CSS prefers ranged content-addressed subsets while editor/export CSS stays full-TTF-only', () => {
    const styles = readFileSync(join(PUBLIC, 'styles.css'), 'utf8')
    const editor = readFileSync(join(PUBLIC, 'editor', 'index.html'), 'utf8')
    for (const face of WEBSITE_INTER_SUBSET_FACES) {
      const output = manifest.outputs.find(candidate => candidate.source === face.file)!
      const fullSource = `src: url('/fonts/${face.file}') format('truetype');`
      const subsetSource = `src: url('/fonts/${output.file}') format('woff2');`
      expect(styles).toContain(fullSource)
      expect(styles).toContain(subsetSource)
      expect(styles).toContain(`font-weight: ${face.weight}; font-style: normal; font-display: swap; unicode-range: ${WEBSITE_INTER_UNICODE_RANGES.join(', ')};`)
      expect(styles.indexOf(fullSource)).toBeLessThan(styles.indexOf(subsetSource))
      expect(editor).toContain(fullSource)
      expect(editor).not.toContain(output.file)
      expect(statSync(join(PUBLIC, 'fonts', output.file)).size).toBe(output.bytes)
      expect(statSync(join(PUBLIC, 'fonts', face.file)).size).toBe(expectedWebsiteInterSources().find(source => source.file === face.file)!.bytes)
    }
    expect(readdirSync(join(PUBLIC, 'fonts')).filter(file => /^Inter-.*\.subset.*\.woff2$/.test(file)).sort())
      .toEqual(manifest.outputs.map(output => output.file).sort())
  })

  test('route budgets encode both compressed-route stop gates and the full-font blank editor', () => {
    // These fixed pre-optimization totals independently prove that the public
    // routes retain the required compression improvement. website:payload:check
    // enforces the budgets against a live capture on every PR, so bounding each
    // budget by its stop gate keeps the gate live without a recorded report.
    const starting = {
      home: { rawBytes: 1_252_938, gzipBytes: 642_665, brotliBytes: 557_024 },
      examples: { rawBytes: 3_283_215, gzipBytes: 1_007_440, brotliBytes: 821_122 },
    }
    for (const id of ['home', 'examples'] as const) {
      const budget = WEBSITE_PAYLOAD_BUDGETS[id]!
      expect(budget.maxGzipBytes / starting[id].gzipBytes, `${id} gzip`).toBeLessThanOrEqual(0.7)
      expect(budget.maxBrotliBytes / starting[id].brotliBytes, `${id} Brotli`).toBeLessThanOrEqual(0.7)
      expect(budget.forbidden, `${id} full TTF`).toContain('^/fonts/Inter-.*\\.ttf$')
    }
    const editorBudget = WEBSITE_PAYLOAD_BUDGETS['editor-empty']!
    expect(editorBudget.maxRequests).toBe(2)
    expect(editorBudget.required).toEqual(['^/editor/$', '^/editor/editor-[a-f0-9]{12}\\.js$'])
  })

  test('rejects source, content-address, coverage, and byte-ceiling sabotage', () => {
    const staleSource = structuredClone(manifest)
    staleSource.sources[0]!.sha256 = '0'.repeat(64)
    expect(validateWebsiteInterSubsetManifest(staleSource)).toContain('source manifest drift')

    const renamed = structuredClone(manifest)
    renamed.outputs[0]!.file = 'Inter-Regular.subset-deadbeefdead.woff2'
    expect(validateWebsiteInterSubsetManifest(renamed)).toContain('Inter-Regular.ttf: filename/hash mismatch')

    const missingCoverage = structuredClone(manifest)
    missingCoverage.coverage[0]!.covered.pop()
    expect(validateWebsiteInterSubsetManifest(missingCoverage)).toContain('coverage proof drift')

    const oversized = structuredClone(manifest)
    oversized.outputs[0]!.bytes = WEBSITE_INTER_SUBSET_MAX_FACE_BYTES + 1
    oversized.totalBytes = oversized.outputs.reduce((sum, output) => sum + output.bytes, 0)
    expect(validateWebsiteInterSubsetManifest(oversized)).toContain(`Inter-Regular.ttf: ${WEBSITE_INTER_SUBSET_MAX_FACE_BYTES + 1} exceeds ${WEBSITE_INTER_SUBSET_MAX_FACE_BYTES}`)
  })
})
