// Loop 7 A3.1: `am capabilities --json` — registry-driven introspection.

import { describe, it, expect } from 'bun:test'
import { buildCapabilities, MUTATION_OPS_BY_FAMILY } from '../cli/index.ts'
import { knownFamilies } from '../agent/families.ts'
import { WARNING_SEVERITY } from '../agent/types.ts'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

describe('am capabilities', () => {
  it('emits a JSON object with sdkVersion, families, warningCodes, outputFormats', () => {
    const cap = buildCapabilities()
    expect(typeof cap.sdkVersion).toBe('string')
    expect(cap.sdkVersion.length).toBeGreaterThan(0)
    expect(Array.isArray(cap.families)).toBe(true)
    expect(Array.isArray(cap.warningCodes)).toBe(true)
    expect(cap.outputFormats).toEqual(['svg', 'ascii', 'unicode', 'png', 'json'])
  })

  it('includes every registered family in the families list', () => {
    const cap = buildCapabilities()
    const ids = new Set(cap.families.map(f => f.id))
    for (const id of knownFamilies()) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('each family entry reports the public agent surface, not plugin internals', () => {
    const cap = buildCapabilities()
    const mutable = new Set(Object.keys(MUTATION_OPS_BY_FAMILY))
    for (const f of cap.families) {
      expect(typeof f.id).toBe('string')
      expect(f.hasParse).toBe(true)
      expect(f.hasSerialize).toBe(true)
      expect(f.hasVerify).toBe(true)
      expect(f.hasMutate).toBe(mutable.has(f.id))
      expect(typeof f.hasExtractLabels).toBe('boolean')
      expect(f.mutationOps).toEqual(f.id in MUTATION_OPS_BY_FAMILY ? [...MUTATION_OPS_BY_FAMILY[f.id as keyof typeof MUTATION_OPS_BY_FAMILY]] : [])
      expect(f.editPolicy).toBe(mutable.has(f.id) ? 'structured-when-narrowed' : 'source-level-only')
    }
  })

  it('advertises mutation ops for every mutable family', () => {
    const cap = buildCapabilities()
    for (const [family, ops] of Object.entries(MUTATION_OPS_BY_FAMILY)) {
      const entry = cap.families.find(f => f.id === family)
      expect(entry).toBeDefined()
      expect(entry!.hasMutate).toBe(true)
      expect(entry!.mutationOps).toEqual([...ops])
      expect(entry!.mutationOps.length).toBeGreaterThan(0)
      expect(entry!.editPolicy).toBe('structured-when-narrowed')
    }
    for (const f of cap.families.filter(f => !f.hasMutate)) {
      expect(f.mutationOps).toEqual([])
      expect(f.editPolicy).toBe('source-level-only')
    }
  })

  it('includes every registered warning code with tier + severity', () => {
    const cap = buildCapabilities()
    const codes = new Set(cap.warningCodes.map(w => w.code))
    for (const code of Object.keys(WARNING_SEVERITY)) {
      expect(codes.has(code as never)).toBe(true)
    }
    for (const w of cap.warningCodes) {
      expect(w.tier).toMatch(/^(structural|geometric)$/)
      expect(w.severity).toMatch(/^(error|warning)$/)
    }
  })

  // Schema fixture validation (no ajv — manual shape assertion). The schema
  // lives at src/__tests__/__fixtures__/capabilities.schema.json so anyone
  // can lift it into their own JSON Schema toolchain.
  it('emitted JSON conforms to capabilities.schema.json required fields and enums', () => {
    const schemaPath = join(import.meta.dir, '__fixtures__', 'capabilities.schema.json')
    if (!existsSync(schemaPath)) return // schema is optional; CI fixture
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    const cap = buildCapabilities()
    expect(schema.type).toBe('object')
    for (const k of schema.required ?? []) {
      expect(Object.prototype.hasOwnProperty.call(cap, k)).toBe(true)
    }
    const familySchema = schema.properties.families.items
    const editPolicies = new Set(familySchema.properties.editPolicy.enum)
    for (const family of cap.families) {
      for (const k of familySchema.required ?? []) {
        expect(Object.prototype.hasOwnProperty.call(family, k)).toBe(true)
      }
      expect(editPolicies.has(family.editPolicy)).toBe(true)
    }
    const outputFormats = new Set(schema.properties.outputFormats.items.enum)
    for (const format of cap.outputFormats) expect(outputFormats.has(format)).toBe(true)
  })
})
