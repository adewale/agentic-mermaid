// Styled-output goldens + determinism properties for the style backends
// (SPEC §8: derived oracles for the styled paths, pinned per the locked
// rough.js / perfect-freehand versions).
//
// Goldens: normalised SVGs under testdata/styled/, one row per built-in
// family and per non-default look (see GOLDEN_CASES). Regenerate after an
// INTENTIONAL styled-rendering change, review the diff, and list each changed
// golden and why in the PR description:
//   UPDATE_STYLED_BASELINE=1 bun test src/__tests__/styled-output.test.ts
// A missing or stale golden fails; only the update variable writes them.

import { describe, test, expect } from 'bun:test'
import { plugin } from 'bun'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { HOSTED_FONT_RESOURCES } from '../font-manifest.ts'
import { renderMermaidSVG, verifyNoExternalRefs, getStyle, inferBackend, knownStyleDescriptors, resolveStyleStack, validateStyleSpec } from '../index.ts'
import { FAMILY_CONFORMANCE_PROFILES } from './helpers/family-conformance-profiles.ts'
import { renderedTextReady } from './helpers/rendered-text.ts'
import { normalizeSvg } from './helpers/svg-normalize.ts'
import { ensureWebsiteBuilt } from './website-public-fixture.ts'

const FIXTURES = join(import.meta.dir, '..', '..', 'eval', 'layout-compare', 'fixtures')
const GOLDENS = join(import.meta.dir, 'testdata', 'styled')
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

// Row i pairs family i with look i, each list cycling, so every family's
// styled renderer and every look is pinned byte-for-byte and the backends
// spread across families (a full family × look matrix is ~7 MB of SVG). The
// other pairs are covered by render-conformance-plan.test.ts, which renders
// every family × look pair with semantic, finite, security and palette
// oracles; the flowchart/journey layout-stress fixtures add layout cases,
// pinned by layout-equivalence, and all of them render styled in the
// transparent test below.
const GOLDEN_CASES = Array.from({ length: Math.max(BUILTIN_FAMILY_METADATA.length, LOOKS.length) }, (_, i) => {
  const family = BUILTIN_FAMILY_METADATA[i % BUILTIN_FAMILY_METADATA.length]!.id
  const style = LOOKS[i % LOOKS.length]!
  return { family, style, fixture: `${family}-basic.mmd`, golden: `${family}-basic.${style.replace(/[^a-z0-9-]/g, '-')}.svg` }
})

/** A line diff (longest common subsequence): `-N: …` is golden line N,
 *  `+N: …` rendered line N; at most `shown` entries. */
function changedLines(golden: string, rendered: string, shown = 20): string[] {
  const a = golden.split('\n')
  const b = rendered.split('\n')
  const common = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i]![j] = a[i] === b[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!)
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++
      j++
    } else if (i < a.length && (j === b.length || common[i + 1]![j]! >= common[i]![j + 1]!)) {
      out.push(`-${++i}: ${a[i - 1]}`)
    } else {
      out.push(`+${++j}: ${b[j - 1]}`)
    }
  }
  return out.length > shown ? [...out.slice(0, shown), `… ${out.length - shown} more changed line(s)`] : out
}

/** What changed between a golden and a render; empty when they are equal. */
function goldenDiff(golden: string, rendered: string): string[] {
  if (normalizeSvg(golden) === normalizeSvg(rendered)) return []
  const changed = changedLines(normalizeSvg(golden, { maskStyleScope: true }), normalizeSvg(rendered, { maskStyleScope: true }))
  return changed.length > 0 ? changed : ['only the root style-scope class differs']
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

  for (const { style, fixture, golden } of GOLDEN_CASES) {
    test(`${fixture} × ${style} matches testdata/styled/${golden}`, () => {
      const svg = renderMermaidSVG(readFileSync(join(FIXTURES, fixture), 'utf8'), { style })
      const path = join(GOLDENS, golden)
      if (UPDATE) {
        mkdirSync(GOLDENS, { recursive: true })
        writeFileSync(path, svg)
      }
      // A deleted or renamed golden must fail, never silently re-bless itself.
      expect({ golden, exists: existsSync(path) }).toEqual({ golden, exists: true })
      expect({ golden, changed: goldenDiff(readFileSync(path, 'utf8'), svg) }).toEqual({ golden, changed: [] })
    })
  }

  test('every styled golden belongs to a case', () => {
    // A removed family or look must take its golden with it.
    const expected = new Set(GOLDEN_CASES.map(({ golden }) => golden))
    const stale = () => readdirSync(GOLDENS).filter(file => !expected.has(file)).sort()
    if (UPDATE) for (const file of stale()) rmSync(join(GOLDENS, file))
    expect(stale()).toEqual([])
  })

  test('a golden diff lists only the changed lines', () => {
    const scoped = (scope: string, fill: string) => `<svg class="${scope}">\n<rect class="${scope}" fill="${fill}"/>\n<text class="${scope}">A</text>\n</svg>`
    // Any paint change renames the scope class on every line; the diff still
    // names just the rect.
    expect(goldenDiff(scoped('am-aaaaaaaaaaaaaa', '#fff'), scoped('am-bbbbbbbbbbbbbb', '#000'))).toEqual([
      '-2: <rect class="am-scope" fill="#fff"/>',
      '+2: <rect class="am-scope" fill="#000"/>',
    ])
    expect(goldenDiff(scoped('am-aaaaaaaaaaaaaa', '#fff'), scoped('am-bbbbbbbbbbbbbb', '#fff'))).toEqual(['only the root style-scope class differs'])
    expect(goldenDiff('<svg>\n</svg>', '<svg>\n<a/>\n</svg>\n')).toEqual(['+2: <a/>'])
    expect(goldenDiff('<svg/>\r\n', '<svg/>')).toEqual([])
  })

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
    const stacks = [
      ['hand-drawn', 'dracula'],
      ['publication-figure', 'github-light'],
      ['watercolor', 'nord-light'],
    ]
    for (const { id } of BUILTIN_FAMILY_METADATA) {
      const { riskFixture, riskOptions: renderOptions } = FAMILY_CONFORMANCE_PROFILES[id]
      const fixture = riskFixture
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

  test('hosted PNG worker loads and verifies every hosted face, and reports legibility warnings', async () => {
    // The only test here that needs website/src/generated (the Worker's fonts
    // and wasm), so only it pays for the website build.
    ensureWebsiteBuilt()
    // The Worker's .ttf/.wasm imports are Wrangler-owned module rules. Serve
    // them as the same bytes here so the real worker module runs natively.
    const loadedAssets: string[] = []
    plugin({
      name: 'hosted-png-worker-assets',
      setup(build) {
        build.onLoad({ filter: /[\\/]website[\\/]src[\\/]generated[\\/][^\\/]+\.(?:ttf|wasm)$/ }, args => {
          loadedAssets.push(basename(args.path))
          return { exports: { default: new Uint8Array(readFileSync(args.path)).buffer }, loader: 'object' }
        })
      },
    })
    const { renderMermaidPNGWasm } = await import('../../website/src/png-wasm.ts')
    // Another module in this process may already have initialized resvg-wasm,
    // which allows one initialization per process. Do that first on purpose.
    await renderedTextReady()
    expect(loadedAssets.filter(file => file.endsWith('.ttf')).sort())
      .toEqual(HOSTED_FONT_RESOURCES.map(font => font.file).sort())

    // The first render verifies every bundled face against its manifest
    // digest before rasterizing. fitTo shrinks 11px labels below the 9px
    // floor, so the shared legibility gate must surface in the hosted result.
    const { png, warnings } = await renderMermaidPNGWasm('flowchart LR\n  A[Start] -- go --> B[Finish]\n', { fitTo: { width: 100 } })
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'BELOW_READABLE_SIZE', cause: 'fitTo' }))
  }, 180_000)
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
