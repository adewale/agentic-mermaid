// Move 9: keep the PR template's "new diagram family" checklist from drifting
// from the actual registries a new family must touch. A markdown template can't
// run code, so this test is the binding: each REQUIRED registry must (a) appear
// as a token in the template, and (b) be a real, non-empty registry. Adding a
// new required registry to REQUIRED_FAMILY_REGISTRIES forces a template update
// (the token assertion fails until the template names it).

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { FAMILY_COUNT_FIXTURES } from './helpers/family-count-fixtures.ts'
import { BASELINE_REGISTRY } from './baseline-freshness.test.ts'

const TEMPLATE = readFileSync(join(import.meta.dir, '..', '..', '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8')

// Each registry a new family must be wired into: the token the PR template must
// name, and a probe proving the registry exists and is non-empty.
const REQUIRED_FAMILY_REGISTRIES: Array<{ token: string; size: () => number }> = [
  { token: 'BUILTIN_FAMILY_METADATA', size: () => BUILTIN_FAMILY_METADATA.length },
  { token: 'metamorphic', size: () => Object.keys(METAMORPHIC_FAMILIES).length },
  { token: 'baseline', size: () => BASELINE_REGISTRY.length + FAMILY_COUNT_FIXTURES.length },
]

describe('PR template ↔ family-citizenship registries', () => {
  test('the template names every required registry', () => {
    const missing = REQUIRED_FAMILY_REGISTRIES.filter(r => !TEMPLATE.includes(r.token)).map(r => r.token)
    expect(missing).toEqual([])
  })

  test('every named registry is real and non-empty', () => {
    for (const r of REQUIRED_FAMILY_REGISTRIES) expect(r.size()).toBeGreaterThan(0)
  })

  test('the template has the golden-approval checklist item', () => {
    expect(TEMPLATE).toContain('[approve-goldens]')
    expect(TEMPLATE).toContain('testdata/')
  })
})
