// Family-plugin registry tests + Phase B universal LABEL_OVERFLOW gap closure.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { layoutMermaid } from '../agent/core.ts'
import { BUILTIN_FAMILY_METADATA, knownFamilies, getFamily, registerFamily, replaceFamilyForTest, extractLabelsGeneric } from '../agent/families.ts'
import '../agent/families-builtin.ts'

describe('family registry', () => {
  test('every metadata-backed built-in family registers', () => {
    expect(new Set(knownFamilies())).toEqual(new Set(BUILTIN_FAMILY_METADATA.map(family => family.id)))
  })

  test('knownFamilies returns built-ins in metadata order', () => {
    expect(knownFamilies()).toEqual(BUILTIN_FAMILY_METADATA.map(f => f.id))
  })

  test('each built-in has an extractLabels function', () => {
    for (const id of knownFamilies()) {
      const p = getFamily(id)
      expect(p?.extractLabels).toBeDefined()
    }
  })

  test('built-in collisions fail unless the explicit test replacement seam is used', () => {
    const original = getFamily('flowchart')
    expect(original).toBeDefined()
    const fake = { ...original!, extractLabels: () => [{ text: 't', target: 't' }] }
    expect(() => registerFamily(fake)).toThrow(/already exists/)
    const restore = replaceFamilyForTest('flowchart', fake)
    try {
      expect(getFamily('flowchart')?.extractLabels?.('')).toEqual([{ text: 't', target: 't' }])
    } finally {
      restore()
    }
  })
})

describe('Phase B: universal LABEL_OVERFLOW on opaque bodies', () => {
  const long = 'X'.repeat(80)

  // NOTE: xychart and unmodeled journey `click` lines are source-level/opaque
  // in the agent surface; plugin extractLabels still has teeth on opaque bodies.
  const cases: Array<[string, string]> = [
    ['journey opaque', `journey\n  title ${long}\n  click task href`],
    ['journey opaque task without actors', `journey\n  ${long}: 3\n  click task href`],
    ['journey opaque actor', `journey\n  Alpha: 3: ${long}\n  click task href`],
    ['journey opaque accDescr block', `journey\n  accDescr {\n    ${long}\n  }\n  click task href`],
    ['journey opaque accDescr opener text', `journey\n  accDescr { ${long}\n  }\n  click task href`],
    ['xychart opaque', `xychart-beta\n  title "${long}"\n  curve basis`],
    ['xychart opaque unquoted title', `xychart-beta\n  title ${long}\n  curve basis`],
    ['xychart opaque unquoted series label', `xychart-beta\n  bar ${long} [1,2]\n  curve basis`],
    ['xychart opaque titled axis category', `xychart-beta\n  x-axis Month [${long}]\n  curve basis`],
    ['xychart opaque unquoted axis title with quoted category', `xychart-beta\n  x-axis ${long} ["Jan"]\n  curve basis`],
    ['xychart opaque numeric-prefix axis title', `xychart-beta\n  x-axis 2024-${long} [Jan]\n  curve basis`],
    ['xychart opaque numeric-prefix ranged axis title', `xychart-beta\n  x-axis 2024-${long} 0 --> 10\n  curve basis`],
    ['xychart opaque accDescr block', `xychart-beta\n  accDescr {\n    ${long}\n  }\n  curve basis`],
    ['xychart opaque escaped quote title', `xychart-beta\n  title "A \\" ${long}"\n  curve basis`],
    ['xychart opaque single-quoted title', `xychart-beta\n  title '${long}'\n  curve basis`],
    ['xychart opaque one-line semicolon title', `xychart-beta; title "${long}"; curve basis`],
    ['xychart opaque one-line unquoted semicolon title', `xychart-beta; title ${long}; bar [1]; curve basis`],
  ]

  for (const [name, src] of cases) {
    test(`${name}: LABEL_OVERFLOW fires`, () => {
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      expect(p.value.body.kind).toBe('opaque')
      const v = verifyMermaid(p.value)
      const labelW = v.warnings.filter(w => w.code === 'LABEL_OVERFLOW')
      expect(labelW.length).toBeGreaterThan(0)
    })

    test(`${name}: under-cap label does NOT fire`, () => {
      const small = src.replace(long, 'Short label')
      const p = parseMermaid(small)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      const v = verifyMermaid(p.value)
      const labelW = v.warnings.filter(w => w.code === 'LABEL_OVERFLOW')
      expect(labelW).toEqual([])
    })
  }

  test('architecture accessibility is structured and still checks label overflow', () => {
    const source = `architecture-beta\n  accTitle: a11y\n  group api(cloud)[${long}]`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('architecture')
    expect(verifyMermaid(parsed.value).warnings.some(warning => warning.code === 'LABEL_OVERFLOW')).toBe(true)
  })

  // BUILD-18: a sequence whose only long label lives inside an opaque-block
  // segment is now STRUCTURED (not whole-body opaque), yet universal
  // LABEL_OVERFLOW still has teeth via the opaque-block label extraction.
  test('sequence structured-with-segments: opaque-block label still triggers LABEL_OVERFLOW', () => {
    const src = `sequenceDiagram\n  participant A\n  participant B\n  alt very long ${long}\n    A->>B: msg\n  end`
    const p = parseMermaid(src)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.body.kind).toBe('sequence')        // structured, not opaque
    const v = verifyMermaid(p.value)
    expect(v.warnings.filter(w => w.code === 'LABEL_OVERFLOW').length).toBeGreaterThan(0)
    // And a short block label stays clean.
    const small = parseMermaid(src.replace(long, 'short'))
    expect(small.ok).toBe(true)
    if (!small.ok) return
    expect(verifyMermaid(small.value).warnings.filter(w => w.code === 'LABEL_OVERFLOW')).toEqual([])
  })
})

describe('FamilyPlugin.verify dispatcher', () => {
  test('plugin verify hook is called and warnings surface in verifyMermaid result', () => {
    // Pick a structured family to prove FamilyPlugin.verify fires independent
    // of whether a particular body is structured or opaque/source-preserved.
    const original = getFamily('journey')
    expect(original).toBeDefined()

    const syntheticWarning = { code: 'UNKNOWN_SHAPE' as const, node: 'synthetic-verify-marker', shape: 'plugin-verify' }
    const restore = replaceFamilyForTest('journey', {
      ...original!,
      verify: () => [syntheticWarning],
    })

    try {
      const src = 'journey\n  title Test\n  section Buy\n    Browse: 5: Me'
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      const v = verifyMermaid(p.value)
      const hit = v.warnings.find(w => w.code === 'UNKNOWN_SHAPE' && (w as { node?: string }).node === 'synthetic-verify-marker')
      expect(hit).toBeDefined()
    } finally {
      // Restore the built-in plugin so other tests see the original.
      restore()
    }
  })

  test('a plugin without a verify hook is a no-op (does not throw)', () => {
    const original = getFamily('xychart')
    expect(original).toBeDefined()
    // Re-register without verify; verifyMermaid must still return ok.
    const restore = replaceFamilyForTest('xychart', { ...original!, verify: undefined })
    try {
      const src = 'xychart-beta\n  title "X"\n  x-axis [a, b, c]\n  y-axis "y" 0 --> 10\n  bar [1, 2, 3]'
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      const v = verifyMermaid(p.value)
      expect(v).toBeDefined()
      expect(Array.isArray(v.warnings)).toBe(true)
    } finally {
      restore()
    }
  })

  test('Loop 8 A1: built-in class plugin registers a verify hook that fires through the dispatcher', () => {
    // Audit Item A1 — before Loop 8, the class plugin had no `verify` hook so
    // the dispatcher branch in verify.ts was unreachable for class diagrams
    // (only the per-body verifyClass branch ran). With the hook now wired,
    // overriding the plugin with a sentinel warning must surface through
    // verifyMermaid's result — proving the dispatcher path is non-vestigial.
    const original = getFamily('class')
    expect(original).toBeDefined()
    expect(original!.verify).toBeDefined()  // confirms M4 wired it

    const sentinel = { code: 'UNKNOWN_SHAPE' as const, node: 'A1-sentinel', shape: 'class-plugin-verify' }
    const restore = replaceFamilyForTest('class', {
      ...original!,
      verify: () => [sentinel],
    })

    try {
      const src = 'classDiagram\n  class Foo {\n    +bar()\n  }'
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      const v = verifyMermaid(p.value)
      const hit = v.warnings.find(w => w.code === 'UNKNOWN_SHAPE' && (w as { node?: string }).node === 'A1-sentinel')
      expect(hit).toBeDefined()
    } finally {
      restore()
    }
  })

  test('Loop 8 A1: built-in ER plugin registers a verify hook that fires through the dispatcher', () => {
    const original = getFamily('er')
    expect(original).toBeDefined()
    expect(original!.verify).toBeDefined()  // confirms M4 wired it

    const sentinel = { code: 'UNKNOWN_SHAPE' as const, node: 'A1-er-sentinel', shape: 'er-plugin-verify' }
    const restore = replaceFamilyForTest('er', {
      ...original!,
      verify: () => [sentinel],
    })

    try {
      const src = 'erDiagram\n  CUSTOMER ||--o{ ORDER : places'
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      const v = verifyMermaid(p.value)
      const hit = v.warnings.find(w => w.code === 'UNKNOWN_SHAPE' && (w as { node?: string }).node === 'A1-er-sentinel')
      expect(hit).toBeDefined()
    } finally {
      restore()
    }
  })

  test('a faulty plugin verify hook is isolated as an error instead of silently dropped', () => {
    const original = getFamily('architecture')
    expect(original).toBeDefined()
    const restore = replaceFamilyForTest('architecture', {
      ...original!,
      verify: () => { throw new Error('intentional plugin fault') },
    })
    try {
      const src = 'architecture-beta\n  group api(cloud)[API]\n  service db(database)[DB] in api'
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      const v = verifyMermaid(p.value)
      expect(v.ok).toBe(false)
      expect(v.warnings).toContainEqual(expect.objectContaining({
        code: 'RENDER_FAILED',
        reason: expect.stringMatching(/architecture.*verify hook failed: intentional plugin fault/i),
      }))
    } finally {
      restore()
    }
  })

  test('a faulty layout hook throws publicly and fails verify instead of returning clean 0x0 geometry', () => {
    const original = getFamily('class')
    expect(original).toBeDefined()
    const restore = replaceFamilyForTest('class', {
      ...original!,
      layout: () => { throw new Error('intentional layout fault') },
    })
    try {
      const parsed = parseMermaid('classDiagram\n  class Example')
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(() => layoutMermaid(parsed.value)).toThrow(/class.*layout hook failed: intentional layout fault/i)
      const verified = verifyMermaid(parsed.value)
      expect(verified.ok).toBe(false)
      expect(verified.warnings).toContainEqual(expect.objectContaining({
        code: 'RENDER_FAILED',
        reason: expect.stringMatching(/class.*layout hook failed: intentional layout fault/i),
      }))
    } finally {
      restore()
    }
  })
})

describe('generic label extractor', () => {
  test('finds quoted strings and bracketed text', () => {
    const out = extractLabelsGeneric('some [label one] and "label two"')
    const texts = out.map(o => o.text).sort()
    expect(texts).toContain('label one')
    expect(texts).toContain('label two')
  })

  test('handles colon-suffixed labels', () => {
    const out = extractLabelsGeneric('A->>B: this is text')
    const texts = out.map(o => o.text)
    expect(texts.some(t => t.includes('this is text'))).toBe(true)
  })

  test('ignores comments and blank lines', () => {
    const out = extractLabelsGeneric('%% comment line\n\n%%{init: ...}%%')
    expect(out).toEqual([])
  })
})
