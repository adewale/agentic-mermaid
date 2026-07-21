import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import {
  WEBSITE_BUILD_ENVIRONMENT_KEYS,
  WEBSITE_BUILD_FINGERPRINT_PATHS,
  computeWebsiteBuildFingerprint,
  isWebsiteBuildFingerprintInput,
  runStableFingerprintBuild,
} from '../../scripts/site/website-build-fingerprint.ts'

const REPO = join(import.meta.dir, '..', '..')
const temporary: string[] = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('website build fingerprint authority', () => {
  test('enrolls every direct local module and runtime-read boundary', () => {
    const build = readFileSync(join(REPO, 'website', 'build.ts'), 'utf8')
    const imports = Array.from(build.matchAll(/(?:from\s+|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g), match => match[1]!)
    expect(imports.length).toBeGreaterThan(10)
    for (const specifier of imports) {
      const repoRelative = normalize(relative(REPO, resolve(REPO, 'website', specifier))).replaceAll('\\', '/')
      expect(isWebsiteBuildFingerprintInput(repoRelative), specifier).toBe(true)
    }

    for (const path of [
      'scripts/site/editor.ts',
      'scripts/site/example-render-state.ts',
      'shared/browser/copy-feedback.js',
      'editor/html/topbar.html',
      'editor/css/panels.css',
      'website/wrangler.jsonc',
      'assets/fonts/Inter-Regular.ttf',
      'eval/mindmap-gitgraph-content-corpus/mindmap/wide-incident-response.mmd',
    ]) expect(isWebsiteBuildFingerprintInput(path), path).toBe(true)

    expect(isWebsiteBuildFingerprintInput('website/public/index.html')).toBe(false)
    expect(isWebsiteBuildFingerprintInput('website/.wrangler/state/v3.json')).toBe(false)
    expect(isWebsiteBuildFingerprintInput('website/src/generated/deploy-version.ts')).toBe(false)
    expect(isWebsiteBuildFingerprintInput('src/__tests__/website-build.test.ts')).toBe(false)
  })

  test('hashes contents, paths, missing inputs, and stable provenance', () => {
    const root = mkdtempSync(join(tmpdir(), 'am-website-fingerprint-'))
    temporary.push(root)
    const first = join(root, 'inputs', 'first.txt')
    mkdirSync(dirname(first), { recursive: true })
    writeFileSync(first, 'alpha')
    const options = { paths: ['inputs', 'missing.txt'], provenance: ['commit', 'clean'] }
    const initial = computeWebsiteBuildFingerprint(root, options)
    expect(computeWebsiteBuildFingerprint(root, options)).toBe(initial)

    writeFileSync(first, 'beta')
    expect(computeWebsiteBuildFingerprint(root, options)).not.toBe(initial)
    writeFileSync(first, 'alpha')
    writeFileSync(join(root, 'inputs', 'second.txt'), 'two')
    expect(computeWebsiteBuildFingerprint(root, options)).not.toBe(initial)
    expect(computeWebsiteBuildFingerprint(root, { ...options, provenance: ['other'] })).not.toBe(initial)

    for (const key of WEBSITE_BUILD_ENVIRONMENT_KEYS) {
      expect(computeWebsiteBuildFingerprint(root, { ...options, environment: { [key]: 'changed' } }), key).not.toBe(initial)
    }
  })

  test('retries a mixed build and commits only a stable fingerprint', () => {
    const fingerprints = ['A', 'B', 'B', 'B']
    let builds = 0
    let resets = 0
    const committed: string[] = []
    runStableFingerprintBuild({
      fingerprint: () => fingerprints.shift()!,
      build: () => { builds++ },
      reset: () => { resets++ },
      commit: value => { committed.push(value) },
    })
    expect({ builds, resets, committed }).toEqual({ builds: 2, resets: 1, committed: ['B'] })

    let failures = 0
    expect(() => runStableFingerprintBuild({
      fingerprint: () => 'stable',
      build: () => { throw new Error('build failed') },
      reset: () => { failures++ },
      commit: () => { throw new Error('must not commit') },
    })).toThrow('build failed')
    expect(failures).toBe(1)
  })

  test('keeps the authority conservative without fingerprinting generated output', () => {
    expect(WEBSITE_BUILD_FINGERPRINT_PATHS).toContain('website')
    expect(WEBSITE_BUILD_FINGERPRINT_PATHS).toContain('editor')
    expect(WEBSITE_BUILD_FINGERPRINT_PATHS).toContain('scripts/site')
    expect(WEBSITE_BUILD_FINGERPRINT_PATHS).toContain('scripts/docs')
    expect(WEBSITE_BUILD_FINGERPRINT_PATHS).toContain('shared')
    expect(WEBSITE_BUILD_FINGERPRINT_PATHS).toContain('eval/mindmap-gitgraph-content-corpus')

    const root = mkdtempSync(join(tmpdir(), 'am-website-fingerprint-'))
    temporary.push(root)
    for (const path of ['website/source/input.txt', 'website/public/output.txt', 'website/.wrangler/state/cache.txt', 'website/src/generated/value.ts']) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), path)
    }
    const options = { paths: ['website'], provenance: ['fixed'] }
    const initial = computeWebsiteBuildFingerprint(root, options)
    for (const excluded of ['website/public/output.txt', 'website/.wrangler/state/cache.txt', 'website/src/generated/value.ts']) {
      writeFileSync(join(root, excluded), 'changed output')
      expect(computeWebsiteBuildFingerprint(root, options), excluded).toBe(initial)
    }
    writeFileSync(join(root, 'website/source/input.txt'), 'changed source')
    expect(computeWebsiteBuildFingerprint(root, options)).not.toBe(initial)

    const corpus = join(root, 'eval/mindmap-gitgraph-content-corpus/mindmap/wide-incident-response.mmd')
    mkdirSync(dirname(corpus), { recursive: true })
    writeFileSync(corpus, 'mindmap\n  root')
    const corpusOptions = { provenance: ['fixed'], environment: {} }
    const corpusFingerprint = computeWebsiteBuildFingerprint(root, corpusOptions)
    writeFileSync(corpus, 'mindmap\n  changed')
    expect(computeWebsiteBuildFingerprint(root, corpusOptions)).not.toBe(corpusFingerprint)
  })
})
