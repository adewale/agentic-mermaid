/**
 * Browser bundle contract (BUILD-30).
 *
 * The published `./browser` IIFE is the only artifact a `<script src>` consumer
 * can use: there is no resolver in a plain script tag, so nothing about the ESM
 * entries or the exports map protects this path. This file is that protection.
 *
 * It drives `dist/browser.global.js` in real Chromium and asserts:
 *   B1  the global exists and carries the render surface — the exact failure the
 *       PR-118 consumer hit, where a hand-rolled bundle built clean and left the
 *       global `undefined`
 *   B2  every registered family renders, and renders byte-identically to the
 *       source build — the bundle is a faithful build, not a lossy one
 *   B3  no node: builtin leaked into the artifact
 *
 * B2 enumerates BUILTIN_FAMILY_METADATA rather than a fixture list, so a family
 * added to the registry later is covered here without editing this file. The
 * count guard below is what makes that real: it fails if the registry is ever
 * read as empty, which would otherwise turn the whole suite into a silent no-op.
 *
 * Requires: Playwright browsers installed (`bunx playwright install chromium`).
 * Run:  bun run test:browser
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'
import { renderMermaidSVG } from '../src/index.ts'

const REPO = join(import.meta.dir, '..')
const BUNDLE = join(REPO, 'dist', 'browser.global.js')
const BUILD_TIMEOUT_MS = 300_000
/** The IIFE's `globalName`. Changing it is a breaking change for script-tag consumers. */
const GLOBAL = 'agenticMermaid'
/** Every family carries a canonical `example`; a registry smaller than this means something is wrong. */
const MIN_EXPECTED_FAMILIES = 10

let browser: Browser
let page: Page

beforeAll(async () => {
  if (!existsSync(BUNDLE)) {
    const build = spawnSync('bun', ['run', 'build'], { cwd: REPO, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
    if (build.status !== 0 || !existsSync(BUNDLE)) {
      throw new Error(`\`bun run build\` did not produce ${BUNDLE} (status ${build.status}).\n${build.stderr ?? ''}`)
    }
  }
  browser = await chromium.launch()
  page = await browser.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ path: BUNDLE })
}, BUILD_TIMEOUT_MS)

afterAll(async () => {
  await browser?.close()
})

describe('browser bundle', () => {
  // B1. The PR-118 failure mode: a bundle that builds and exports nothing.
  test('exposes the render surface on the global', async () => {
    const surface = await page.evaluate(name => {
      const api = (globalThis as Record<string, any>)[name]
      return {
        present: Boolean(api),
        renderMermaidSVG: typeof api?.renderMermaidSVG,
        renderMermaidASCII: typeof api?.renderMermaidASCII,
        exportCount: api ? Object.keys(api).length : 0,
      }
    }, GLOBAL)
    expect(surface.present).toBe(true)
    expect(surface.renderMermaidSVG).toBe('function')
    expect(surface.renderMermaidASCII).toBe('function')
    expect(surface.exportCount).toBeGreaterThan(50)
  })

  // B2. Registry-driven, so future families enroll without touching this file.
  test('registry is non-empty, so the per-family checks below are not vacuous', () => {
    expect(BUILTIN_FAMILY_METADATA.length).toBeGreaterThanOrEqual(MIN_EXPECTED_FAMILIES)
    for (const family of BUILTIN_FAMILY_METADATA) {
      expect(family.example?.trim().length ?? 0, `${family.id} must declare a canonical example`).toBeGreaterThan(0)
    }
  })

  for (const family of BUILTIN_FAMILY_METADATA) {
    test(`renders ${family.id} identically to the source build`, async () => {
      const result = await page.evaluate(
        ([name, source]) => {
          try {
            return { svg: (globalThis as Record<string, any>)[name].renderMermaidSVG(source), error: null }
          } catch (error) {
            return { svg: null, error: String(error) }
          }
        },
        [GLOBAL, family.example] as const,
      )
      expect(result.error, `${family.id} threw in the browser`).toBeNull()
      expect(result.svg).toContain('<svg')
      // Byte-equality against the source build. Layout is deterministic and text
      // metrics are contract-driven, so any divergence here is the bundle
      // dropping or substituting something, not browser rasterization.
      expect(result.svg).toBe(renderMermaidSVG(family.example))
    })
  }

  // B3. `platform: 'browser'` should make this impossible at build time; assert
  // it on the shipped bytes anyway, since that is what consumers download.
  test('ships no node: builtin imports', () => {
    const source = readFileSync(BUNDLE, 'utf8')
    expect(source).not.toMatch(/(?:require\(|from\s*)["']node:/)
  })
})
