// Loop 7 A3.1: `am capabilities --json` — registry-driven introspection.

import { describe, it, expect } from 'bun:test'
import { buildCapabilities } from '../cli/index.ts'
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
    expect(cap.outputFormats).toEqual(['svg', 'ascii'])
  })

  it('includes every registered family in the families list', () => {
    const cap = buildCapabilities()
    const ids = new Set(cap.families.map(f => f.id))
    for (const id of knownFamilies()) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('each family entry reports hasParse / hasSerialize / hasMutate / hasVerify / hasExtractLabels', () => {
    const cap = buildCapabilities()
    for (const f of cap.families) {
      expect(typeof f.id).toBe('string')
      expect(typeof f.hasParse).toBe('boolean')
      expect(typeof f.hasSerialize).toBe('boolean')
      expect(typeof f.hasMutate).toBe('boolean')
      expect(typeof f.hasVerify).toBe('boolean')
      expect(typeof f.hasExtractLabels).toBe('boolean')
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
  it('emitted JSON conforms to capabilities.schema.json (shape only)', () => {
    const schemaPath = join(import.meta.dir, '__fixtures__', 'capabilities.schema.json')
    if (!existsSync(schemaPath)) return // schema is optional; CI fixture
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    const cap = buildCapabilities()
    expect(schema.type).toBe('object')
    // Every required key the schema declares must be present in the emitted
    // envelope.
    for (const k of schema.required ?? []) {
      expect(Object.prototype.hasOwnProperty.call(cap, k)).toBe(true)
    }
  })
})
