// Config diagnostics must tell the truth about Mermaid's own keys. Every key in
// the pinned upstream config inventory is official, so a diagnostic may call it
// ineffective (the renderer ignores it) or invalid (wrong value type), but never
// unknown or undocumented. Before this suite 17 official keys across sequence,
// xychart, gantt, mindmap, and gitgraph were reported as possible misspellings.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { getInstalledFamilyDescriptor } from '../agent/family-router.ts'
import type { DiagramKind } from '../agent/types.ts'
import { familyConfigDiagnostics } from '../shared/family-config-diagnostics.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../upstream-mermaid-manifest.ts'

const MISSPELLING = /unknown|documented [a-z-]+ field/

const CONFIG_KEYS = UPSTREAM_MERMAID_MANIFEST.semanticInventory.configKeys

/** A value of the key's declared type, so only the key itself can be faulted. */
function sampleValue(type: string): unknown {
  if (/\[\]/.test(type)) return ['#000000']
  if (/^boolean\b/.test(type)) return true
  if (/^number\b/.test(type)) return 1
  if (/^string\b|^"|FontCalculator/.test(type)) return 'x'
  return {}
}

function rootFor(path: string[], value: unknown): Record<string, unknown> {
  return path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>
}

const FAMILIES = BUILTIN_FAMILY_METADATA.flatMap(family => {
  const spec = getInstalledFamilyDescriptor(family.id)?.config
  return spec ? [{ kind: family.id as DiagramKind, spec }] : []
})

describe('config diagnostics for official Mermaid keys', () => {
  it('never calls a pinned upstream key unknown or undocumented', () => {
    const misreported: string[] = []
    let checked = 0
    for (const { kind, spec } of FAMILIES) {
      for (const key of CONFIG_KEYS.filter(candidate => candidate.id.startsWith(`${spec.section}.`))) {
        checked++
        const diagnostics = familyConfigDiagnostics(kind, [rootFor(key.id.split('.'), sampleValue(String(key.type)))], spec)
        for (const diagnostic of diagnostics) {
          if (MISSPELLING.test(diagnostic.message)) misreported.push(`${key.id}: ${diagnostic.message}`)
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
    expect(misreported).toEqual([])
  })

  it('still calls a key unknown when neither Mermaid nor this renderer defines it', () => {
    const official = new Set(CONFIG_KEYS.map(key => key.id))
    fc.assert(
      fc.property(fc.constantFrom(...FAMILIES), fc.stringMatching(/^[a-z][a-zA-Z]{2,12}$/), ({ kind, spec }, key) => {
        fc.pre(!official.has(`${spec.section}.${key}`) && !spec.keys.includes(key))
        const diagnostics = familyConfigDiagnostics(kind, [{ [spec.section]: { [key]: true } }], spec)
        expect(diagnostics.some(diagnostic => diagnostic.field === `${spec.section}.${key}` && MISSPELLING.test(diagnostic.message))).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})
