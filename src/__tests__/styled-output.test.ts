// Styled-output goldens + determinism properties for the style backends
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
import { renderMermaidSVG, verifyNoExternalRefs, getStyle, inferBackend, resolveStyleStack, validateStyleSpec } from '../index.ts'

const FIXTURES = join(import.meta.dir, '..', '..', 'eval', 'layout-compare', 'fixtures')
const BASELINE = join(import.meta.dir, 'testdata', 'styled-output-baseline.json')
const UPDATE = process.env.UPDATE_STYLED_BASELINE === '1'

// The built-in full looks (themes register too, but the golden matrix
// pins the looks; palette-only styles are covered by the composition tests).
const LOOKS = [
  'hand-drawn',
  'excalidraw',
  'pen-and-ink',
  'freehand',
  'watercolor',
  'blueprint',
  'tufte',
  'accessible-high-contrast',
  'patent-drawing',
  'status-dashboard',
  'ops-schematic',
  'chalkboard',
  'risograph',
  'architectural-plan',
  'publication-figure',
]

function fixtureSources(): Array<{ name: string; source: string }> {
  return readdirSync(FIXTURES)
    .filter(f => f.endsWith('.mmd'))
    .sort()
    .map(name => ({ name, source: readFileSync(join(FIXTURES, name), 'utf8') }))
}

describe('styled output', () => {
  const fixtures = fixtureSources()

  test('every style × fixture is hash-stable against the committed baseline', () => {
    const records: Record<string, string> = {}
    for (const fixture of fixtures) {
      for (const style of LOOKS) {
        const key = `${fixture.name}#${style}`
        try {
          const svg = renderMermaidSVG(fixture.source, { style })
          records[key] = createHash('sha256').update(svg).digest('hex')
        } catch (e) {
          records[key] = `error:${(e as Error).message}`
        }
      }
    }
    expect(Object.keys(records).length).toBeGreaterThanOrEqual(16 * LOOKS.length)

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
    // Stale keys rot silently otherwise: a removed fixture or style must
    // shrink the baseline too (mirrors the svg-equivalence gate).
    const stale = Object.keys(baseline).filter(k => !(k in records))
    if (stale.length > 0) {
      throw new Error(`styled-output: ${stale.length} stale baseline records (e.g. ${stale[0]}) — regenerate with UPDATE_STYLED_BASELINE=1`)
    }
  })

  test('no styled render throws on any fixture', () => {
    for (const fixture of fixtures) {
      for (const style of LOOKS) {
        renderMermaidSVG(fixture.source, { style }) // throws = fail
      }
    }
  })

  test('seed re-rolls geometry deterministically', () => {
    const source = fixtures.find(f => f.name === 'flowchart-basic.mmd')!.source
    const a1 = renderMermaidSVG(source, { style: 'hand-drawn', seed: 1 })
    const a1again = renderMermaidSVG(source, { style: 'hand-drawn', seed: 1 })
    const a2 = renderMermaidSVG(source, { style: 'hand-drawn', seed: 2 })
    expect(a1).toBe(a1again)
    expect(a1).not.toBe(a2)
  })

  test('user colors and themeVariables beat the style palette', () => {
    const source = fixtures.find(f => f.name === 'flowchart-basic.mmd')!.source
    const withUserBg = renderMermaidSVG(source, { style: 'hand-drawn', bg: '#123456' })
    expect(withUserBg).toContain('#123456')
    expect(withUserBg).not.toContain('#f7f5ef')
    const withThemeVars = renderMermaidSVG(source, {
      style: 'hand-drawn',
      mermaidConfig: { themeVariables: { background: '#654321' } },
    })
    expect(withThemeVars).toContain('#654321')
    expect(withThemeVars).not.toContain('#f7f5ef')
  })

  test('unknown style names throw with the known list', () => {
    expect(() => renderMermaidSVG('graph TD\n A-->B', { style: 'not-a-style' }))
      .toThrow(/Unknown style .*hand-drawn/)
  })

  test('styled output preserves markers, data attributes, and strict security', () => {
    const source = 'graph TD\n  A[Start] -->|go| B{Choice}\n  B ==> C([End])'
    const svg = renderMermaidSVG(source, { style: 'hand-drawn' })
    expect(svg).toContain('marker-end')
    expect(svg).toContain('markerUnits="userSpaceOnUse"')
    expect(svg).toContain('data-from="A"')
    expect(svg).toContain('class="edge-label-halo"')
    const strict = renderMermaidSVG(source, { style: 'hand-drawn', security: 'strict' })
    expect(verifyNoExternalRefs(strict).ok).toBe(true)
  })

  test('crisp output is unaffected by style registration (explicit crisp)', () => {
    const source = 'graph TD\n A-->B'
    expect(renderMermaidSVG(source, { style: 'crisp' })).toBe(renderMermaidSVG(source))
  })
})

describe('style consolidation', () => {
  const source = 'graph TD\n  A[Start] --> B{Choice}\n  B --> C([End])'

  test('a role-only style object stays on the byte-identical crisp path', () => {
    // The old DiagramStyleOptions shape is a valid (anonymous) StyleSpec and
    // must keep producing the crisp renderer's exact bytes.
    const viaStyle = renderMermaidSVG(source, { style: { node: { cornerRadius: 9 } } })
    expect(viaStyle).toContain('rx="9"')
    expect(viaStyle).not.toContain('data-backdrop="page"') // crisp path, no styled shell
  })

  test('a theme is a style: THEMES palettes resolve by name', () => {
    const dracula = getStyle('dracula')
    expect(dracula?.colors?.bg).toBeDefined()
    const svg = renderMermaidSVG(source, { style: 'dracula' })
    expect(svg).toContain(dracula!.colors!.bg!)
    // Palette-only styles ship a self-contained page rect (styled path).
    expect(svg).toContain('data-backdrop="page"')
  })

  test('stacks merge left → right: hand-drawn × dracula', () => {
    const dracula = getStyle('dracula')!
    const stacked = renderMermaidSVG(source, { style: ['hand-drawn', 'dracula'] })
    // dracula's palette wins over hand-drawn's paper…
    expect(stacked).toContain(dracula.colors!.bg!)
    expect(stacked).not.toContain('#f7f5ef')
    // …while hand-drawn's sketch geometry survives (rough paths + backdrop).
    expect(stacked).toContain('data-backdrop="paper-ruled"')
    // and the whole thing is deterministic.
    expect(stacked).toBe(renderMermaidSVG(source, { style: ['hand-drawn', 'dracula'] }))
  })

  test('coverage looks keep structural ink on the active theme foreground', () => {
    const themes = ['github-light', 'nord-light', 'dracula']
    const coverageLooks = [
      'accessible-high-contrast',
      'patent-drawing',
      'status-dashboard',
      'ops-schematic',
      'chalkboard',
      'risograph',
      'architectural-plan',
      'publication-figure',
    ]
    for (const themeName of themes) {
      const themeFg = getStyle(themeName)!.colors!.fg!
      for (const style of coverageLooks) {
        const svg = renderMermaidSVG(source, { style: [style, themeName] })
        expect(svg).toContain(`stroke="${themeFg}"`)
      }
    }
  })

  test('an inline fragment on top of a stack wins per field', () => {
    const merged = resolveStyleStack(['hand-drawn', { roughness: 2.5, colors: { accent: '#ff0000' } }])!
    expect(merged.roughness).toBe(2.5)
    expect(merged.colors?.accent).toBe('#ff0000')
    expect(merged.colors?.bg).toBe('#f7f5ef') // untouched channels survive
    expect(merged.backdrop).toBe('paper-ruled')
  })

  test('backends are inferred from what the style asks for', () => {
    expect(inferBackend({})).toBe('default')
    expect(inferBackend({ colors: { bg: '#fff' } })).toBe('default')
    expect(inferBackend({ stroke: 'jittered' })).toBe('rough')
    expect(inferBackend({ fill: 'hachure' })).toBe('rough')
    expect(inferBackend({ backdrop: 'grid' })).toBe('rough')
    expect(inferBackend({ stroke: 'freehand' })).toBe('hybrid')
    expect(inferBackend({ fill: 'wash' })).toBe('hybrid')
    expect(inferBackend({ fill: 'wash', backend: 'rough' })).toBe('rough') // expert override
    for (const name of LOOKS_WITH_BACKENDS) {
      expect(inferBackend(getStyle(name.style)!)).toBe(name.backend)
    }
  })

  test('an inline custom style renders without registration', () => {
    const svg = renderMermaidSVG(source, {
      style: { colors: { bg: '#fffdf7', fg: '#1c1917' }, stroke: 'jittered', roughness: 0.8 },
    })
    expect(svg).toContain('#fffdf7')
    expect(svg).toContain('data-backdrop="page"')
  })

  test('strokeWidth is honored on the default backend via role line widths', () => {
    // Found by the Haiku emergence probe: a crisp-stroke style with
    // strokeWidth used to be silently inert on the inferred default backend.
    const svg = renderMermaidSVG(source, { style: { colors: { bg: '#0a0e27' }, strokeWidth: 2 } })
    expect(svg).toContain('stroke-width="2"')
    const overridden = renderMermaidSVG(source, { style: { strokeWidth: 2, node: { lineWidth: 0.5 } } })
    expect(overridden).toContain('stroke-width="0.5"') // explicit role width wins
  })

  test('validateStyleSpec accepts fragments and rejects junk', () => {
    expect(validateStyleSpec({ colors: { bg: '#fff' }, stroke: 'jittered' })).toEqual([])
    expect(validateStyleSpec({ node: { cornerRadius: 4 } })).toEqual([])
    expect(validateStyleSpec({ stroke: 'wobbly' }).length).toBeGreaterThan(0)
    expect(validateStyleSpec({ colors: { background: '#fff' } }).length).toBeGreaterThan(0)
    expect(validateStyleSpec({ node: { banana: true } }).length).toBeGreaterThan(0)
    expect(validateStyleSpec({ edge: 'x' }).length).toBeGreaterThan(0)
    expect(validateStyleSpec({ group: [] }).length).toBeGreaterThan(0)
    expect(validateStyleSpec({ text: { fontSize: 'large' } }).length).toBeGreaterThan(0)
    expect(validateStyleSpec({ edge: { textTransform: 'scream' } }).length).toBeGreaterThan(0)
    expect(validateStyleSpec({ evil: '<script>' }).length).toBeGreaterThan(0)
    expect(validateStyleSpec('hand-drawn').length).toBeGreaterThan(0)
  })
})

describe('bundled fonts', () => {
  test('every typeface a built-in look references ships in assets/fonts', () => {
    // PNG rasterization loads assets/fonts with loadSystemFonts: false — a
    // look whose face is missing there silently falls back to DejaVu Sans.
    const fontsDir = join(import.meta.dir, '..', '..', 'assets', 'fonts')
    for (const name of LOOKS) {
      const font = getStyle(name)?.font
      if (!font) continue
      const file = join(fontsDir, `${font.replace(/ /g, '')}.ttf`)
      if (!existsSync(file)) {
        throw new Error(`style "${name}" references font "${font}" but ${file} is not bundled`)
      }
    }
  })

  test('hosted PNG worker bundles every built-in style face', () => {
    const hostedPng = readFileSync(join(import.meta.dir, '..', '..', 'website', 'src', 'png-wasm.ts'), 'utf8')
    const websiteBuild = readFileSync(join(import.meta.dir, '..', '..', 'website', 'build.ts'), 'utf8')
    const generatedDir = join(import.meta.dir, '..', '..', 'website', 'src', 'generated')
    const styleFontFiles = Array.from(new Set(
      LOOKS
        .map(name => getStyle(name)?.font)
        .filter((font): font is string => Boolean(font))
        .map(font => `${font.replace(/ /g, '')}.ttf`),
    ))

    for (const file of styleFontFiles) {
      expect(hostedPng).toContain(`./generated/${file}`)
      expect(websiteBuild).toContain(`'${file}'`)
      expect(existsSync(join(generatedDir, file))).toBe(true)
    }
  })
})

const LOOKS_WITH_BACKENDS = [
  { style: 'hand-drawn', backend: 'rough' },
  { style: 'excalidraw', backend: 'rough' },
  { style: 'pen-and-ink', backend: 'rough' },
  { style: 'freehand', backend: 'hybrid' },
  { style: 'watercolor', backend: 'hybrid' },
  { style: 'blueprint', backend: 'rough' },
  { style: 'tufte', backend: 'default' },
  { style: 'accessible-high-contrast', backend: 'default' },
  { style: 'patent-drawing', backend: 'rough' },
  { style: 'status-dashboard', backend: 'default' },
  { style: 'ops-schematic', backend: 'rough' },
  { style: 'chalkboard', backend: 'rough' },
  { style: 'risograph', backend: 'rough' },
  { style: 'architectural-plan', backend: 'rough' },
  { style: 'publication-figure', backend: 'default' },
] as const
