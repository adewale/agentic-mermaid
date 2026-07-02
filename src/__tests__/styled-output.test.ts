// Styled-output goldens + determinism properties for the aesthetic backends
// (SPEC §8: derived oracles for the styled paths; exact bytes stay reserved
// for the crisp path, styled output is hash-pinned per pinned rough.js /
// perfect-freehand versions).
//
// Regenerate after an INTENTIONAL styled-rendering change:
//   UPDATE_STYLED_BASELINE=1 bun test src/__tests__/styled-output.test.ts
// The baseline lives under testdata/, so golden-drift review applies.

import { describe, test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG, knownAesthetics, verifyNoExternalRefs } from '../index.ts'

const FIXTURES = join(import.meta.dir, '..', '..', 'eval', 'layout-compare', 'fixtures')
const BASELINE = join(import.meta.dir, 'testdata', 'styled-output-baseline.json')
const UPDATE = process.env.UPDATE_STYLED_BASELINE === '1'

const AESTHETICS = knownAesthetics().filter(a => a !== 'crisp')

function fixtureSources(): Array<{ name: string; source: string }> {
  return readdirSync(FIXTURES)
    .filter(f => f.endsWith('.mmd'))
    .sort()
    .map(name => ({ name, source: readFileSync(join(FIXTURES, name), 'utf8') }))
}

describe('styled output', () => {
  const fixtures = fixtureSources()

  test('every aesthetic × fixture is hash-stable against the committed baseline', () => {
    const records: Record<string, string> = {}
    for (const fixture of fixtures) {
      for (const aesthetic of AESTHETICS) {
        const key = `${fixture.name}#${aesthetic}`
        try {
          const svg = renderMermaidSVG(fixture.source, { aesthetic })
          records[key] = createHash('sha256').update(svg).digest('hex')
        } catch (e) {
          records[key] = `error:${(e as Error).message}`
        }
      }
    }
    expect(Object.keys(records).length).toBeGreaterThanOrEqual(16 * AESTHETICS.length)

    if (UPDATE || !existsSync(BASELINE)) {
      const sorted: Record<string, string> = {}
      for (const key of Object.keys(records).sort()) sorted[key] = records[key]!
      writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n')
      console.log(`styled-output: baseline written (${Object.keys(records).length} records)`)
      return
    }
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, string>
    for (const [key, hash] of Object.entries(records)) {
      if (baseline[key] === undefined) {
        throw new Error(`styled-output: ${key} missing from baseline — regenerate with UPDATE_STYLED_BASELINE=1`)
      }
      if (baseline[key] !== hash) {
        throw new Error(`styled-output: drift for ${key} — regenerate deliberately with UPDATE_STYLED_BASELINE=1 + [approve-goldens]`)
      }
    }
    // Stale keys rot silently otherwise: a removed fixture or aesthetic must
    // shrink the baseline too (mirrors the svg-equivalence gate).
    const stale = Object.keys(baseline).filter(k => !(k in records))
    if (stale.length > 0) {
      throw new Error(`styled-output: ${stale.length} stale baseline records (e.g. ${stale[0]}) — regenerate with UPDATE_STYLED_BASELINE=1`)
    }
  })

  test('no styled render throws on any fixture', () => {
    for (const fixture of fixtures) {
      for (const aesthetic of AESTHETICS) {
        renderMermaidSVG(fixture.source, { aesthetic }) // throws = fail
      }
    }
  })

  test('seed re-rolls geometry deterministically', () => {
    const source = fixtures.find(f => f.name === 'flowchart-basic.mmd')!.source
    const a1 = renderMermaidSVG(source, { aesthetic: 'hand-drawn', seed: 1 })
    const a1again = renderMermaidSVG(source, { aesthetic: 'hand-drawn', seed: 1 })
    const a2 = renderMermaidSVG(source, { aesthetic: 'hand-drawn', seed: 2 })
    expect(a1).toBe(a1again)
    expect(a1).not.toBe(a2)
  })

  test('user colors and themeVariables beat the aesthetic palette', () => {
    const source = fixtures.find(f => f.name === 'flowchart-basic.mmd')!.source
    const withUserBg = renderMermaidSVG(source, { aesthetic: 'hand-drawn', bg: '#123456' })
    expect(withUserBg).toContain('#123456')
    expect(withUserBg).not.toContain('#f7f5ef')
    const withThemeVars = renderMermaidSVG(source, {
      aesthetic: 'hand-drawn',
      mermaidConfig: { themeVariables: { background: '#654321' } },
    })
    expect(withThemeVars).toContain('#654321')
    expect(withThemeVars).not.toContain('#f7f5ef')
  })

  test('unknown aesthetics throw with the known list', () => {
    expect(() => renderMermaidSVG('graph TD\n A-->B', { aesthetic: 'not-a-style' }))
      .toThrow(/Unknown aesthetic .*hand-drawn/)
  })

  test('styled output preserves markers, data attributes, and strict security', () => {
    const source = 'graph TD\n  A[Start] -->|go| B{Choice}\n  B ==> C([End])'
    const svg = renderMermaidSVG(source, { aesthetic: 'hand-drawn' })
    expect(svg).toContain('marker-end')
    expect(svg).toContain('markerUnits="userSpaceOnUse"')
    expect(svg).toContain('data-from="A"')
    expect(svg).toContain('class="edge-label-halo"')
    const strict = renderMermaidSVG(source, { aesthetic: 'hand-drawn', security: 'strict' })
    expect(verifyNoExternalRefs(strict).ok).toBe(true)
  })

  test('crisp output is unaffected by aesthetic registration (explicit crisp)', () => {
    const source = 'graph TD\n A-->B'
    expect(renderMermaidSVG(source, { aesthetic: 'crisp' })).toBe(renderMermaidSVG(source))
  })
})
