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
import { HOSTED_FONT_RESOURCES } from '../font-manifest.ts'
import { renderMermaidSVG, verifyNoExternalRefs, getStyle, inferBackend, knownStyleDescriptors, resolveStyleStack, validateStyleSpec } from '../index.ts'

const FIXTURES = join(import.meta.dir, '..', '..', 'eval', 'layout-compare', 'fixtures')
const BASELINE = join(import.meta.dir, 'testdata', 'styled-output-baseline.json')
const UPDATE = process.env.UPDATE_STYLED_BASELINE === '1'

// One registry projection owns both the golden matrix and hosted discovery.
// Palette-only styles are covered by the composition tests.
const LOOK_DESCRIPTORS = knownStyleDescriptors()
  .filter(descriptor => descriptor.kind === 'look' && !descriptor.isDefault)
const LOOKS = LOOK_DESCRIPTORS.map(descriptor => descriptor.inputName)

function builtInLookFonts() {
  return Array.from(new Set(LOOK_DESCRIPTORS.map(descriptor => descriptor.spec.font).filter((font): font is string => Boolean(font))))
}

function hostedFacesForFamily(family: string) {
  return HOSTED_FONT_RESOURCES.filter((font) => font.family === family)
}

function fixtureSources(): Array<{ name: string; source: string }> {
  return readdirSync(FIXTURES)
    .filter(f => f.endsWith('.mmd'))
    .sort()
    .map(name => ({ name, source: readFileSync(join(FIXTURES, name), 'utf8') }))
}

describe('styled output', () => {
  const fixtures = fixtureSources()

  test('the golden matrix derives from every registered non-default built-in look', () => {
    expect(LOOKS.length).toBeGreaterThan(0)
    expect(LOOKS).not.toContain('crisp')
    expect(LOOKS).not.toContain('cupertino')
    expect(LOOKS).not.toContain('vercel-inspired-prototype')
    expect(LOOKS).not.toContain('cloudflare-workers-inspired-prototype')
  })

  test('the brand-inspired prototypes remain documentation-only', () => {
    for (const name of ['cupertino', 'vercel-inspired-prototype', 'cloudflare-workers-inspired-prototype']) {
      expect(getStyle(name), name).toBeUndefined()
      expect(() => renderMermaidSVG(fixtures[0]!.source, { style: name }), name)
        .toThrow(new RegExp(`Unknown style "${name}"`))
    }
  })

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
    // shrink the styled baseline too.
    const stale = Object.keys(baseline).filter(k => !(k in records))
    if (stale.length > 0) {
      throw new Error(`styled-output: ${stale.length} stale baseline records (e.g. ${stale[0]}) — regenerate with UPDATE_STYLED_BASELINE=1`)
    }
  }, 10_000)

  test('no styled render throws on any fixture', () => {
    for (const fixture of fixtures) {
      for (const style of LOOKS) {
        renderMermaidSVG(fixture.source, { style }) // throws = fail
      }
    }
  }, 10_000)

  test('transparent styled output stays transparent across every family fixture', () => {
    for (const fixture of fixtures) {
      const svg = renderMermaidSVG(fixture.source, {
        style: 'publication-figure',
        transparent: true,
      })
      expect(svg, fixture.name).not.toContain('data-backdrop="page"')
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
    expect(svg).not.toContain('markerUnits="userSpaceOnUse"')
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

  test('removed role-style objects are rejected instead of silently applying', () => {
    expect(() => renderMermaidSVG(source, { style: { node: { cornerRadius: 9 } } as any })).toThrow(/Invalid style spec/)
  })

  test('a registered Palette resolves by its stable input name', () => {
    const dracula = getStyle('dracula')
    expect(dracula?.colors?.bg).toBeDefined()
    const svg = renderMermaidSVG(source, { style: 'dracula' })
    expect(svg).toContain(dracula!.colors!.bg!)
    // Palette-only styles ship a self-contained page rect (styled path).
    expect(svg).toContain('data-backdrop="page"')
  })

  test('Style + Palette stacks stay deterministic and finite across all elevated family features', () => {
    const demoRoot = join(import.meta.dir, '..', '..', 'docs', 'design', 'families')
    const familyFixtures = [
      ['flowchart-v11-shapes-demo.mmd', {}],
      ['state-pseudostates-demo.mmd', {}],
      ['sequence-config-demo.mmd', {}],
      ['timeline-vertical-demo.mmd', {}],
      ['class-namespaces-demo.mmd', {}],
      ['er-direction-demo.mmd', {}],
      ['journey-section-overlap-demo.mmd', {}],
      ['architecture-align-demo.mmd', {}],
      ['xychart-legend-demo.mmd', {}],
      ['pie-donut-labels-demo.mmd', {}],
      ['quadrant-styling-demo.mmd', {}],
      ['gantt-dependency-overlay-demo.mmd', { gantt: { dependencyArrows: true, criticalPath: true } }],
      ['mindmap-demo.mmd', {}],
      ['gitgraph-demo.mmd', {}],
    ] as const
    const stacks = [
      ['hand-drawn', 'dracula'],
      ['publication-figure', 'github-light'],
      ['watercolor', 'nord-light'],
    ]
    for (const [fixture, renderOptions] of familyFixtures) {
      const source = readFileSync(join(demoRoot, fixture), 'utf8')
      for (const stack of stacks) {
        const palette = getStyle(stack[1]!)!.colors!
        const first = renderMermaidSVG(source, { ...renderOptions, style: stack, seed: 7 })
        const again = renderMermaidSVG(source, { ...renderOptions, style: stack, seed: 7 })
        expect(first, `${fixture} × ${stack.join('+')}`).toBe(again)
        expect(first).toContain(`--bg:${palette.bg}`)
        expect(first).toContain(`--fg:${palette.fg}`)
        expect(first).not.toMatch(/(?:NaN|Infinity|undefined)/)
        const viewBox = first.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
        expect(viewBox, `${fixture} has a viewBox`).not.toBeNull()
        expect(Number(viewBox![1])).toBeGreaterThan(0)
        expect(Number(viewBox![2])).toBeGreaterThan(0)
      }
    }
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

  test('strokeWidth is honored on the default backend', () => {
    const svg = renderMermaidSVG(source, { style: { colors: { bg: '#0a0e27' }, strokeWidth: 2 } })
    expect(svg).toContain('stroke-width="2"')
  })

  test('fails final Style fields that have no active backend projection', () => {
    for (const fill of ['none', 'solid'] as const) {
      expect(() => renderMermaidSVG(source, { style: { fill } }))
        .toThrow(/"fill" has no crisp\/default backend projection/)
    }
    for (const field of ['hachureAngle', 'hachureGap', 'fillWeight'] as const) {
      expect(() => renderMermaidSVG(source, { style: { [field]: 1 } }))
        .toThrow(new RegExp(`"${field}".*require fill "hachure"`))
    }
    for (const field of ['washOpacity', 'washEdge'] as const) {
      expect(() => renderMermaidSVG(source, { style: { [field]: 0.5 } }))
        .toThrow(new RegExp(`"${field}".*require fill "wash"`))
    }

    expect(renderMermaidSVG(source, {
      style: [{ hachureGap: 7 }, { fill: 'hachure' }],
    })).toContain('<svg')
    expect(renderMermaidSVG(source, {
      style: [{ washOpacity: 0.4 }, { fill: 'wash' }],
    })).toContain('<svg')
  })

  test('validateStyleSpec accepts public fragments and rejects removed role keys plus junk', () => {
    expect(validateStyleSpec({ colors: { bg: '#fff' }, stroke: 'jittered' })).toEqual([])
    expect(validateStyleSpec({ stroke: 'wobbly' }).length).toBeGreaterThan(0)
    expect(validateStyleSpec({ colors: { background: '#fff' } }).length).toBeGreaterThan(0)
    expect(validateStyleSpec({ node: { cornerRadius: 4 } })).toContain('unknown field "node"')
    expect(validateStyleSpec({ edge: 'x' })).toContain('unknown field "edge"')
    expect(validateStyleSpec({ group: [] })).toContain('unknown field "group"')
    expect(validateStyleSpec({ text: { fontSize: 'large' } })).toContain('unknown field "text"')
    expect(validateStyleSpec({ backend: 'rough' })).toContain('unknown field "backend"')
    expect(validateStyleSpec({ evil: '<script>' }).length).toBeGreaterThan(0)
    expect(validateStyleSpec('hand-drawn').length).toBeGreaterThan(0)
  })
})

describe('bundled fonts', () => {
  test('every typeface a built-in look references is declared in the hosted font manifest', () => {
    for (const font of builtInLookFonts()) {
      expect({ font, hostedFaces: hostedFacesForFamily(font).map((face) => face.file) }).not.toEqual({ font, hostedFaces: [] })
    }
  })

  test('every hosted typeface ships in assets/fonts', () => {
    // PNG rasterization loads assets/fonts with loadSystemFonts: false — a
    // look whose face is missing there uses Inter with DejaVu per-glyph fallback.
    const fontsDir = join(import.meta.dir, '..', '..', 'assets', 'fonts')
    for (const { file } of HOSTED_FONT_RESOURCES) {
      expect({ file, exists: existsSync(join(fontsDir, file)) }).toEqual({ file, exists: true })
    }
  })

  test('hosted PNG worker bundles every hosted style/default face', () => {
    const hostedPng = readFileSync(join(import.meta.dir, '..', '..', 'website', 'src', 'png-wasm.ts'), 'utf8')
    const generatedDir = join(import.meta.dir, '..', '..', 'website', 'src', 'generated')

    for (const { file } of HOSTED_FONT_RESOURCES) {
      expect(hostedPng).toContain(`./generated/${file}`)
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
  { style: 'look:tufte', backend: 'default' },
  { style: 'accessible-high-contrast', backend: 'default' },
  { style: 'patent-drawing', backend: 'rough' },
  { style: 'status-dashboard', backend: 'default' },
  { style: 'ops-schematic', backend: 'rough' },
  { style: 'chalkboard', backend: 'rough' },
  { style: 'risograph', backend: 'rough' },
  { style: 'architectural-plan', backend: 'rough' },
  { style: 'publication-figure', backend: 'default' },
] as const
