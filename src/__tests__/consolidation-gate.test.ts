/**
 * Consolidation gate — keeps eliminated duplication from creeping back.
 *
 * The 2026-07 consolidation audit (open items live in TODO.md §5; audit retired)
 * found the same primitives re-implemented across families, and several of the
 * copies had silently diverged (class/er measured titles at the wrong weight,
 * four escapeAttr copies dropped the apostrophe escape, two luminance formulas
 * disagreed). Each scan below pins one "this must stay single-sourced"
 * invariant at the source level: re-adding a local copy fails here with a
 * pointer to the shared home.
 *
 * These are doc-sync-style conformance checks (the code is the source of
 * truth); they complement — not replace — the behavioral gates
 * (svg-a11y-conformance, synthesize-body-kinds, escape/color property tests).
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(import.meta.dir, '..')

function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      out.push(...sourceFiles(p))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(p)
    }
  }
  return out
}

/** Files matching `pattern`, excluding the allowed home(s) of the primitive. */
function offenders(pattern: RegExp, allowed: string[]): string[] {
  return sourceFiles()
    .map(f => ({ f, rel: relative(SRC, f) }))
    .filter(({ rel }) => !allowed.includes(rel))
    .filter(({ f }) => pattern.test(readFileSync(f, 'utf8')))
    .map(({ rel }) => rel)
}

describe('consolidation gate — shared primitives stay single-sourced', () => {
  it('XML escaping lives in multiline-utils.ts only', () => {
    // A new `function escapeXml/escapeAttr` outside the shared home means a
    // renderer re-grew its own escape set (the old copies dropped the
    // apostrophe escape). Import from multiline-utils.ts instead.
    expect(offenders(/function escape(?:Xml|Attr)\s*\(/, ['multiline-utils.ts'])).toEqual([])
  })

  it('FNV-1a hashing lives in scene/seed.ts only', () => {
    // The 0x811c9dc5/0x01000193 constants must not be re-rolled per family —
    // use seedFrom()/hashId() from scene/seed.ts.
    expect(offenders(/0x811c9dc5/i, ['scene/seed.ts'])).toEqual([])
  })

  it('hex color math lives in shared/color-math.ts only', () => {
    // Hex parsing/serialization/mixing had four diverging copies. New code
    // imports parseHex/toHex/mixHex/luma255 from shared/color-math.ts.
    // color-resolver.ts and xychart/colors.ts keep exported names as one-line
    // delegates over the shared module — allowed; re-implementations are not.
    const hexParse = /function (?:parseHex|hexToRgb|parseHexToRgb|rgbToHex|mixHex|mixHexColors|mixColors)\s*\(/
    expect(offenders(hexParse, ['shared/color-math.ts', 'color-resolver.ts', 'xychart/colors.ts'])).toEqual([])
    // The BT.601 luma weights likewise (string form catches inline copies).
    expect(offenders(/0\.299\s*\*|\*\s*299\b/, ['shared/color-math.ts'])).toEqual([])
  })

  it('SVG root accessibility attrs live in shared/svg-a11y.ts only', () => {
    expect(offenders(/function buildAccessibilityAttrs\s*\(/, ['shared/svg-a11y.ts'])).toEqual([])
    // The `.replace('>', …)` splice on svgOpenTag output was how pie/quadrant
    // lost their <title>/<desc> wiring — pass attrs via svgOpenTag's 5th
    // parameter instead. (xychart's data-attribute splice on '<svg ' is
    // position-sensitive legacy output and deliberately not matched.)
    expect(offenders(/svgOpenTag\([^)]*\)[\s\S]{0,40}?\.replace\('>'/, [])).toEqual([])
  })

  it('no family defines STYLE_DEFAULTS in both layout.ts and renderer.ts', () => {
    // Layout (sizing) and renderer (drawing) must resolve the same style
    // table. One definition per family is fine wherever it lives; a second
    // literal in the sibling file re-opens the measured-vs-drawn divergence
    // that undersized class/er title boxes.
    const declaration = /_STYLE_DEFAULTS: RenderStyleDefaults = \{/
    const byFamily = new Map<string, string[]>()
    for (const f of sourceFiles()) {
      const rel = relative(SRC, f)
      const m = rel.match(/^([^/]+)\/(layout|renderer)\.ts$/)
      if (!m) continue
      if (!declaration.test(readFileSync(f, 'utf8'))) continue
      byFamily.set(m[1]!, [...(byFamily.get(m[1]!) ?? []), rel])
    }
    const duplicated = [...byFamily.values()].filter(files => files.length > 1).flat()
    expect(duplicated).toEqual([])
  })

  it('the family list is not re-enumerated as a type union outside types.ts', () => {
    // `'flowchart' | 'state' | … | 'gantt'` written out longhand is a 13th
    // copy of DiagramKind waiting to drift (facade.ts's two copies had
    // already diverged in member order). Import DiagramKind instead.
    // mcp/sdk-decl.ts is the sandbox's *declaration string* of the SDK types
    // and cannot import — it mirrors types.ts by construction and is allowed.
    const longhand = /'flowchart'\s*\|\s*'state'\s*\|\s*'sequence'/
    expect(offenders(longhand, ['agent/types.ts', 'mcp/sdk-decl.ts'])).toEqual([])
  })
})
