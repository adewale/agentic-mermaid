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
