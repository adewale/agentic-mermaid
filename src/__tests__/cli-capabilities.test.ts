// Loop 7 A3.1: `am capabilities --json` — registry-driven introspection.

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getFamily, getFamilyConformanceReport, knownFamilies } from '../agent/families.ts'
import { WARNING_SEVERITY } from '../agent/types.ts'
import { buildCapabilities, MUTATION_OPS_BY_FAMILY } from '../cli/index.ts'
import { CLI_RENDER_FORMATS, cliRenderFormatJsonSchema } from '../render-contract.ts'
import { createSectionACapabilityReport, sectionACapabilityDiscoverySummary } from '../section-a-capability-report.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../upstream-mermaid-manifest.ts'

describe('am capabilities', () => {
  it('emits a JSON object with bounded built-in discovery and Section A summary fields', () => {
    const cap = buildCapabilities()
    expect(typeof cap.sdkVersion).toBe('string')
    expect(cap.sdkVersion.length).toBeGreaterThan(0)
    expect(Array.isArray(cap.families)).toBe(true)
    expect(Array.isArray(cap.warningCodes)).toBe(true)
    expect(cap.outputFormats).toEqual([...CLI_RENDER_FORMATS])
    expect(cap.sectionA).toEqual(sectionACapabilityDiscoverySummary())
    expect(cap.sectionA.noAbsentSyntaxCapabilities).toBe(true)
  })

  it('Section A CLI discovery is the canonical registry projection, not a copied matrix', () => {
    const sectionA = buildCapabilities().sectionA
    expect(sectionA.counts.registeredFamilyCount).toBe(knownFamilies().length)
    expect(sectionA.reportDigest).toBe(createSectionACapabilityReport().digest)
    expect(sectionA.upstreamPin.inventorySha256).toBe(createSectionACapabilityReport().upstream.inventorySha256)
  })

  it('keeps exhaustive syntax evidence out of the routine agent-discovery budget', () => {
    const cap = buildCapabilities()
    expect(cap.sectionA.counts.syntaxFeatureClassificationCount).toBe(UPSTREAM_MERMAID_MANIFEST.semanticInventory.syntaxFeatures.length)
    expect('matrices' in cap.sectionA).toBe(false)
    expect(cap.sectionA.fullReport).toEqual({
      repositoryModule: 'src/section-a-capability-report.ts',
      factory: 'createSectionACapabilityReport',
      markdown: 'docs/project/section-a-capability-report.md',
      regenerateCommand: 'bun run section-a-report',
    })
    // The discovery payload grows a few KB per registered family (example,
    // config keys, ops). The teeth of this gate are the matrix exclusions
    // above; the byte ceiling only guards against re-inlining bulk evidence.
    expect(Buffer.byteLength(JSON.stringify(cap), 'utf8')).toBeLessThan(80 * 1024)
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
      const descriptor = getFamily(f.id)!
      expect(typeof f.id).toBe('string')
      // Capability output is a JSON transport. Optional undefined identity
      // fields are intentionally omitted rather than materialized as keys;
      // the registry-only kind discriminator is not part of this projection.
      expect(f.identity).toEqual({
        id: descriptor.identity.id,
        version: descriptor.identity.version,
        compatibility: JSON.parse(JSON.stringify(descriptor.identity.compatibility)),
        provenance: JSON.parse(JSON.stringify(descriptor.identity.provenance)),
      })
      expect('kind' in f.identity).toBe(false)
      const fullConformance = getFamilyConformanceReport(f.id)!
      expect(f.conformance).toEqual({
        ...fullConformance,
        capabilities: fullConformance.capabilities.map(({ witnessId: _witnessId, ...result }) => result),
      })
      expect(f.conformance).not.toBe(fullConformance)
      expect(f.conformance.capabilities.every(result => !('witnessId' in result))).toBe(true)
      expect(fullConformance.capabilities.every(result => result.status !== 'passed' || Boolean(result.witnessId))).toBe(true)
      expect(f.conformance.passed).toBe(true)
      // hasParse/hasSerialize/hasVerify were dropped — they were true for every
      // family (dead info that read as a probe-me menu). Only varying fields remain.
      expect('hasParse' in f).toBe(false)
      expect(f.hasMutate).toBe(mutable.has(f.id))
      expect(typeof f.hasExtractLabels).toBe('boolean')
      expect(f.mutationOps).toEqual(f.id in MUTATION_OPS_BY_FAMILY ? [...MUTATION_OPS_BY_FAMILY[f.id as keyof typeof MUTATION_OPS_BY_FAMILY]] : [])
      expect(f.editPolicy).toBe(mutable.has(f.id) ? 'structured-when-narrowed' : 'source-level-only')
    }
  })

  it('advertises op FIELD SHAPES (opFields) so a model fills an op without guessing', () => {
    const cap = buildCapabilities()
    for (const [family, ops] of Object.entries(MUTATION_OPS_BY_FAMILY)) {
      const entry = cap.families.find(f => f.id === family)!
      // opFields keys must be exactly the mutation ops, each with typed fields.
      expect(Object.keys(entry.opFields ?? {}).sort()).toEqual([...ops].sort())
      for (const fields of Object.values(entry.opFields!)) {
        for (const fd of fields) {
          expect(typeof fd.name).toBe('string')
          expect(typeof fd.required).toBe('boolean')
          expect(typeof fd.type).toBe('string')
        }
      }
    }
    // Enum vocabularies are spelled out inline in the type (the thing a model
    // most needs and could not previously discover): e.g. class add_relation.relKind.
    const relKind = (cap.families.find(f => f.id === 'class')!.opFields?.add_relation ?? []).find(f => f.name === 'relKind')
    expect(relKind?.type).toContain('inheritance')
    expect(relKind?.type).toContain('composition')
    // xychart add_series uses the surprising `kind2` field — surfaced, not guessed.
    expect((cap.families.find(f => f.id === 'xychart')!.opFields?.add_series ?? []).some(f => f.name === 'kind2')).toBe(true)
  })

  it('advertises the narrower and header keyword(s) for every builtin family', () => {
    const cap = buildCapabilities()
    for (const f of cap.families) {
      expect(typeof f.narrower).toBe('string')
      expect(f.narrower!.startsWith('as')).toBe(true)
      expect(Array.isArray(f.headers) && f.headers!.length > 0).toBe(true)
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
      expect(w.tier).toMatch(/^(structural|geometric|lint)$/)
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
    expect(schema.properties.outputFormats.items).toEqual(cliRenderFormatJsonSchema())
    const outputFormats = new Set(schema.properties.outputFormats.items.enum)
    for (const format of cap.outputFormats) expect(outputFormats.has(format)).toBe(true)
    for (const k of schema.properties.sectionA.required ?? []) {
      expect(Object.prototype.hasOwnProperty.call(cap.sectionA, k)).toBe(true)
    }
    expect(cap.sectionA.noAbsentSyntaxCapabilities).toBe(true)
  })
})

describe('family examples', () => {
  it('every built-in family ships a canonical example that parses, verifies clean, and renders', async () => {
    const { parseRegisteredMermaid: parseMermaid } = await import('../agent/parse.ts')
    const { serializeMermaid } = await import('../agent/serialize.ts')
    const { describeMermaidFacts } = await import('../agent/facts.ts')
    const { verifyMermaid } = await import('../agent/verify.ts')
    const { renderMermaidSVG } = await import('../index.ts')
    const cap = buildCapabilities()
    for (const family of cap.families) {
      expect({ id: family.id, hasExample: typeof family.example === 'string' && family.example.length > 0 }).toEqual({ id: family.id, hasExample: true })
      const parsed = parseMermaid(family.example!)
      expect({ id: family.id, parseOk: parsed.ok }).toEqual({ id: family.id, parseOk: true })
      if (!parsed.ok) continue
      // The example must be the family's kind, verify with ZERO warnings
      // (it's the syntax agents copy — it must be beyond reproach), and
      // render (implied by the verify RENDER_FAILED gate, asserted anyway).
      expect({ id: family.id, kind: String(parsed.value.kind), bodyKind: String(parsed.value.body.kind) }).toEqual({ id: family.id, kind: family.id, bodyKind: family.id })
      const v = verifyMermaid(parsed.value)
      expect({ id: family.id, ok: v.ok, warnings: v.warnings.map(w => w.code) }).toEqual({ id: family.id, ok: true, warnings: [] })

      // Phase 0 / X1: the discovery example is also the minimum executable
      // serializer→render-parser conformance witness for every registered
      // family. Canonical output must stay structured, fact-equivalent,
      // idempotent, verified, and renderable through the public SVG path.
      const canonical = serializeMermaid(parsed.value)
      const reparsed = parseMermaid(canonical)
      expect({ id: family.id, reparseOk: reparsed.ok }).toEqual({ id: family.id, reparseOk: true })
      if (!reparsed.ok) continue
      expect({ id: family.id, kind: String(reparsed.value.kind), bodyKind: String(reparsed.value.body.kind) }).toEqual({ id: family.id, kind: family.id, bodyKind: family.id })
      expect(describeMermaidFacts(reparsed.value)).toEqual(describeMermaidFacts(parsed.value))
      expect(serializeMermaid(reparsed.value)).toBe(canonical)
      expect(verifyMermaid(reparsed.value).warnings).toEqual([])
      expect(renderMermaidSVG(canonical).length).toBeGreaterThan(100)
    }
  })
})
