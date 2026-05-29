// Family-plugin registry tests + Phase B universal LABEL_OVERFLOW gap closure.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { knownFamilies, getFamily, registerFamily, extractLabelsGeneric } from '../agent/families.ts'
import '../agent/families-builtin.ts'
import type { DiagramKind } from '../agent/types.ts'

describe('family registry', () => {
  test('all 9 built-in families register', () => {
    const ids = new Set(knownFamilies())
    for (const id of ['flowchart', 'state', 'sequence', 'timeline', 'class', 'er', 'journey', 'xychart', 'architecture'] satisfies DiagramKind[]) {
      expect(ids.has(id)).toBe(true)
    }
  })

  test('each built-in has an extractLabels function', () => {
    for (const id of knownFamilies()) {
      const p = getFamily(id)
      expect(p?.extractLabels).toBeDefined()
    }
  })

  test('registerFamily accepts a new id and getFamily round-trips', () => {
    const fake = { id: 'flowchart' as DiagramKind, detect: () => false, extractLabels: () => [{ text: 't', target: 't' }] }
    // ID collision allowed — last write wins (caller intent: override)
    registerFamily(fake)
    expect(getFamily('flowchart')?.extractLabels?.('')).toEqual([{ text: 't', target: 't' }])
    // restore built-in
    delete require.cache[require.resolve('../agent/families-builtin.ts')]
    require('../agent/families-builtin.ts')
  })
})

describe('Phase B: universal LABEL_OVERFLOW on opaque bodies', () => {
  const long = 'X'.repeat(80)

  // NOTE: class and ER moved to structured bodies (Phase C). Their
  // LABEL_OVERFLOW is now covered by verifyClass/verifyErBody, not the
  // opaque-body extractLabels path. The cases below are the remaining
  // families that still use opaque bodies for these constructs.
  const cases: Array<[string, string]> = [
    ['journey', `journey\n  title ${long}`],
    ['xychart', `xychart-beta\n  title "${long}"`],
    ['architecture', `architecture-beta\n  group api(cloud)[${long}]`],
    ['sequence opaque', `sequenceDiagram\n  participant A\n  participant B\n  alt very long ${long}\n    A->>B: msg\n  end`],
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
})

describe('FamilyPlugin.verify dispatcher', () => {
  test('plugin verify hook is called and warnings surface in verifyMermaid result', () => {
    // Pick a family whose body stays opaque without any custom parser so we
    // can rely on the registered plugin's verify hook firing on the opaque
    // body. Use 'journey' (opaque-by-default in this fork).
    const original = getFamily('journey')
    expect(original).toBeDefined()

    const syntheticWarning = { code: 'UNKNOWN_SHAPE' as const, node: 'synthetic-verify-marker', shape: 'plugin-verify' }
    registerFamily({
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
      registerFamily(original!)
    }
  })

  test('a plugin without a verify hook is a no-op (does not throw)', () => {
    const original = getFamily('xychart')
    expect(original).toBeDefined()
    // Re-register without verify; verifyMermaid must still return ok.
    registerFamily({ ...original!, verify: undefined })
    try {
      const src = 'xychart-beta\n  title "X"\n  x-axis [a, b, c]\n  y-axis "y" 0 --> 10\n  bar [1, 2, 3]'
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      const v = verifyMermaid(p.value)
      expect(v).toBeDefined()
      expect(Array.isArray(v.warnings)).toBe(true)
    } finally {
      registerFamily(original!)
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
    registerFamily({
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
      registerFamily(original!)
    }
  })

  test('Loop 8 A1: built-in ER plugin registers a verify hook that fires through the dispatcher', () => {
    const original = getFamily('er')
    expect(original).toBeDefined()
    expect(original!.verify).toBeDefined()  // confirms M4 wired it

    const sentinel = { code: 'UNKNOWN_SHAPE' as const, node: 'A1-er-sentinel', shape: 'er-plugin-verify' }
    registerFamily({
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
      registerFamily(original!)
    }
  })

  test('a faulty plugin verify hook does not crash verifyMermaid', () => {
    const original = getFamily('architecture')
    expect(original).toBeDefined()
    registerFamily({
      ...original!,
      verify: () => { throw new Error('intentional plugin fault') },
    })
    try {
      const src = 'architecture-beta\n  group api(cloud)[API]\n  service db(database)[DB] in api'
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      // Must not throw — faulty plugin warnings are silently dropped.
      const v = verifyMermaid(p.value)
      expect(v).toBeDefined()
    } finally {
      registerFamily(original!)
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
