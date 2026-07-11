import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG } from '../index.ts'
import {
  ARCHITECTURE_ICON_LIMITS,
  architectureIconManifest,
  resolveArchitectureIcon,
} from '../architecture/icons.ts'

const sourceFor = (icon: string) => `architecture-beta\n  service api(${icon})[API]`

describe('deterministic offline Architecture Iconify registry (B11/A5)', () => {
  test('resolves a curated MDI icon and common upstream AWS aliases offline', () => {
    expect(resolveArchitectureIcon('mdi:api')).toMatchObject({
      canonicalName: 'mdi:api',
      source: '@iconify-json/mdi@1.2.3',
      license: 'Apache-2.0',
    })
    expect(resolveArchitectureIcon('logos:aws-lambda')?.canonicalName).toBe('mdi:function-variant')
    expect(resolveArchitectureIcon('logos:aws-aurora')?.canonicalName).toBe('mdi:database')
    expect(resolveArchitectureIcon('logos:aws-ec2')?.canonicalName).toBe('mdi:server')
  })

  test('emits only a sanitized local path and license/source metadata', () => {
    const svg = renderMermaidSVG(sourceFor('mdi:api'))
    expect(svg).toContain('data-icon="mdi:api"')
    expect(svg).toContain('data-icon-source="@iconify-json/mdi@1.2.3"')
    expect(svg).toContain('data-icon-license="Apache-2.0"')
    expect(svg).toMatch(/<path class="architecture-icon-glyph" d="[^"]+" transform="translate\([^<]+" \/>/)
    expect(svg).not.toContain('<script')
    expect(renderMermaidSVG(sourceFor('mdi:api'))).toBe(svg)
  })

  test('does not call fetch or consult ambient files for curated or unknown icons', () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (() => { calls++; throw new Error('network forbidden') }) as unknown as typeof fetch
    try {
      for (const icon of ['mdi:api', 'logos:aws-lambda', 'logos:aws-s3', 'unknown:private-pack']) {
        expect(() => renderMermaidSVG(sourceFor(icon))).not.toThrow()
      }
      expect(calls).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('keeps the bundled registry finite, path-only, and size-bounded', () => {
    const manifest = architectureIconManifest()
    expect(manifest.length).toBeGreaterThanOrEqual(20)
    expect(manifest.length).toBeLessThanOrEqual(ARCHITECTURE_ICON_LIMITS.maxIcons)
    for (const icon of manifest) {
      expect(icon.path.length).toBeLessThanOrEqual(ARCHITECTURE_ICON_LIMITS.maxPathBytes)
      expect(icon.path).toMatch(/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/)
      expect(icon.path).not.toMatch(/[<>&"']/)
    }
  })

  test('escapes hostile unknown names and falls back to a bounded text badge', () => {
    const hostile = 'evil:<script-onload=alert-1>'
    const svg = renderMermaidSVG(sourceFor(hostile))
    expect(svg).not.toContain('<script')
    expect(svg).not.toMatch(/\sonload=/)
    expect(svg).toContain('data-icon="evil:&lt;script-onload=alert-1&gt;"')
    expect(svg).toContain('architecture-icon-glyph')
  })

  test('ships license attribution with the published package surface', () => {
    const root = join(import.meta.dir, '..', '..')
    const notice = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    const apacheLicense = readFileSync(join(root, 'LICENSES', 'Apache-2.0.txt'), 'utf8')
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(notice).toContain('@iconify-json/mdi 1.2.3')
    expect(notice).toContain('LICENSES/Apache-2.0.txt')
    expect(apacheLicense).toContain('Apache License\n                           Version 2.0, January 2004')
    expect(pkg.files).toContain('THIRD_PARTY_NOTICES.md')
    expect(pkg.files).toContain('LICENSES/')
  })
})
