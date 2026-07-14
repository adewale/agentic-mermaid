import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  UNREGISTERED_FAMILY_CAPABILITY_STATES,
  getFamily,
  knownFamilies,
  type FamilyDescriptor,
} from '../agent/families.ts'
import {
  FAMILY_SYNTAX_STATES,
  SYNTAX_CAPABILITY_DIMENSIONS,
  createSyntaxCapabilityLedger,
  validateSyntaxCapabilityLedger,
  type SyntaxCapabilityLedger,
} from '../syntax-capability-ledger.ts'
import {
  UPSTREAM_MERMAID_MANIFEST,
  type UpstreamMermaidManifest,
} from '../upstream-mermaid-manifest.ts'

const ROOT = join(import.meta.dir, '..', '..')

function descriptors(): FamilyDescriptor[] {
  return knownFamilies()
    .map(id => getFamily(id))
    .filter((descriptor): descriptor is FamilyDescriptor => descriptor !== undefined)
}

function familyIds(ledger: SyntaxCapabilityLedger): string[] {
  return [...new Set(ledger.families.map(row => row.familyId))]
}

describe('generated Mermaid syntax capability ledger', () => {
  test('classifies the complete pinned inventory over the eleven stable dimensions', () => {
    const ledger = createSyntaxCapabilityLedger(UPSTREAM_MERMAID_MANIFEST, descriptors())
    expect(ledger.dimensions.map(dimension => dimension.id)).toEqual([
      'identity-routing',
      'document-framing',
      'grammar',
      'text',
      'authored-appearance',
      'semantic-identity',
      'interaction-assets',
      'configuration',
      'processing',
      'outputs',
      'evidence',
    ])
    expect(ledger.features.map(row => row.featureId))
      .toEqual(UPSTREAM_MERMAID_MANIFEST.semanticInventory.syntaxFeatures.map(feature => feature.id))
    expect(ledger.families).toHaveLength(familyIds(ledger).length * SYNTAX_CAPABILITY_DIMENSIONS.length)
    expect(new Set(ledger.features.map(row => row.dimensionId)))
      .toEqual(new Set(SYNTAX_CAPABILITY_DIMENSIONS.map(dimension => dimension.id)))
    expect(ledger.features.some(row => row.state === 'absent')).toBe(false)
    expect(ledger.families.some(row => row.state === 'absent')).toBe(false)
    expect(ledger.families.some(row => Object.values(row.processing ?? {}).includes('absent'))).toBe(false)
    for (const row of ledger.families.filter(row => row.dimensionId === 'processing' && !row.registrationId)) {
      expect(row.processing).toEqual(UNREGISTERED_FAMILY_CAPABILITY_STATES)
    }
    expect(validateSyntaxCapabilityLedger(ledger, UPSTREAM_MERMAID_MANIFEST, familyIds(ledger))).toEqual([])
  })

  test('grounds every family and feature row in concrete repository evidence', () => {
    const ledger = createSyntaxCapabilityLedger(UPSTREAM_MERMAID_MANIFEST, descriptors())
    for (const row of ledger.families) {
      expect(row.evidence.length).toBeGreaterThan(0)
      for (const evidence of row.evidence) {
        expect({ source: evidence.source, exists: existsSync(join(ROOT, evidence.source)), locator: evidence.locator.length > 0 })
          .toEqual({ source: evidence.source, exists: true, locator: true })
      }
      if (row.state !== 'native') expect(row.diagnostic?.length).toBeGreaterThan(0)
    }
    for (const row of ledger.features) {
      expect(row.evidence.length).toBeGreaterThan(0)
      expect(row.artifactId.length).toBeGreaterThan(0)
      expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/)
      for (const source of row.evidence) expect(existsSync(join(ROOT, source))).toBe(true)
      if (row.state !== 'native') expect(row.diagnostic?.length).toBeGreaterThan(0)
    }
  })

  test('rejects missing dimensions, missing features, and every absent state', () => {
    const original = createSyntaxCapabilityLedger(UPSTREAM_MERMAID_MANIFEST, descriptors())
    const expectedFamilies = familyIds(original)

    const missingDimension = structuredClone(original) as unknown as {
      dimensions: Array<{ id: string }>
    }
    missingDimension.dimensions.pop()
    expect(validateSyntaxCapabilityLedger(
      missingDimension as unknown as SyntaxCapabilityLedger,
      UPSTREAM_MERMAID_MANIFEST,
      expectedFamilies,
    )).toContain('syntax capability dimensions are missing, duplicated, or out of order')

    const missingFeature = structuredClone(original) as unknown as {
      features: unknown[]
    }
    missingFeature.features.pop()
    expect(validateSyntaxCapabilityLedger(
      missingFeature as unknown as SyntaxCapabilityLedger,
      UPSTREAM_MERMAID_MANIFEST,
      expectedFamilies,
    )).toContain('syntax feature classifications are missing: 1')

    const absentFeature = structuredClone(original) as unknown as {
      features: Array<{ featureId: string; state: string }>
    }
    absentFeature.features[0]!.state = 'absent'
    expect(validateSyntaxCapabilityLedger(
      absentFeature as unknown as SyntaxCapabilityLedger,
      UPSTREAM_MERMAID_MANIFEST,
      expectedFamilies,
    )).toContain(`syntax feature ${absentFeature.features[0]!.featureId} is absent`)

    const absentFamily = structuredClone(original) as unknown as {
      families: Array<{ familyId: string; dimensionId: string; state: string }>
    }
    absentFamily.families[0]!.state = 'absent'
    expect(validateSyntaxCapabilityLedger(
      absentFamily as unknown as SyntaxCapabilityLedger,
      UPSTREAM_MERMAID_MANIFEST,
      expectedFamilies,
    )).toContain(`syntax family ${absentFamily.families[0]!.familyId}/${absentFamily.families[0]!.dimensionId} is absent`)

    const driftedOpenFamily = structuredClone(original) as unknown as {
      families: Array<{
        familyId: string
        dimensionId: string
        registrationId?: string
        processing?: Record<string, string>
      }>
    }
    const openProcessing = driftedOpenFamily.families.find(row =>
      row.dimensionId === 'processing' && !row.registrationId)!
    openProcessing.processing!.serialize = 'diagnosed'
    expect(validateSyntaxCapabilityLedger(
      driftedOpenFamily as unknown as SyntaxCapabilityLedger,
      UPSTREAM_MERMAID_MANIFEST,
      expectedFamilies,
    )).toContain(
      `syntax family ${openProcessing.familyId}/processing does not match the canonical unregistered-family contract`,
    )
  })

  test('automatically accounts for a synthetic next-version feature without descriptor copies', () => {
    const manifest = structuredClone(UPSTREAM_MERMAID_MANIFEST) as UpstreamMermaidManifest
    const artifact = manifest.semanticInventory.sourceArtifacts.find(candidate => candidate.id === 'official-doc:flowchart')!
    manifest.semanticInventory.syntaxFeatures.push({
      id: 'official-doc:flowchart:section:future-click-assets',
      artifact: artifact.id,
      families: ['flowchart'],
      status: 'documented',
      fingerprint: 'f'.repeat(64),
      sourceSha256: 'e'.repeat(64),
    })
    manifest.semanticInventory.syntaxFeatures.sort((a, b) => a.id.localeCompare(b.id))

    const ledger = createSyntaxCapabilityLedger(manifest, descriptors())
    expect(ledger.features.find(row => row.featureId === 'official-doc:flowchart:section:future-click-assets'))
      .toMatchObject({
        familyIds: ['flowchart'],
        dimensionId: 'interaction-assets',
        classificationRuleId: 'interaction-assets-terms-v1',
        state: 'source-preserved',
        artifactId: artifact.id,
      })
    expect(validateSyntaxCapabilityLedger(ledger, manifest, familyIds(ledger))).toEqual([])
  })

  test('keeps the syntax state vocabulary singular and explicit', () => {
    expect(FAMILY_SYNTAX_STATES).toEqual([
      'native', 'source-preserved', 'diagnosed', 'not-applicable', 'absent',
    ])
  })
})
