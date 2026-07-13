import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import {
  BUILTIN_FAMILY_METADATA,
  augmentFamily,
  detectRegisteredFamilyFromFirstLine,
  getFamily,
  knownFamilies,
  registerFamily,
  type FamilyDescriptor,
} from '../agent/families.ts'
import { parseMermaid, parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { projectPositionedView } from '../agent/index.ts'
import { ok, toFinite } from '../agent/types.ts'
import type { ExternalFamilyId, FamilyId } from '../agent/types.ts'
import { detectDiagramType, detectDiagramTypeFromFirstLine } from '../mermaid-source.ts'
import { MermaidFamilyDetectionError } from '../family-detection.ts'
import { UPSTREAM_MERMAID_FAMILY_INDEX } from '../upstream-family-index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { canonicalExtensionId, createExtensionIdentity, ExtensionCollisionError } from '../shared/extension-identity.ts'
import { explicitFamilyConfigDiagnostics } from '../shared/family-config-diagnostics.ts'
import { runCli } from '../cli/index.ts'
import {
  UPSTREAM_MERMAID_MANIFEST,
  canonicalUpstreamInventory,
  diffUpstreamMermaidManifests,
  findUpstreamFamilyByHeader,
  validateUpstreamMermaidManifest,
  type UpstreamMermaidManifest,
} from '../upstream-mermaid-manifest.ts'

function syntheticFamily(localId: string, header: string): FamilyDescriptor {
  const id = canonicalExtensionId('family', localId) as ExternalFamilyId
  return {
    contractVersion: 1,
    identity: createExtensionIdentity({
      id,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: 'family-descriptor@1' },
      provenance: { owner: localId.split('/')[0] ?? localId, source: 'test' },
    }),
    id,
    label: `Synthetic ${localId}`,
    headers: [header],
    aliases: [],
    maturity: 'experimental',
    collisionPriority: 0,
    detect: line => line === header.toLowerCase(),
    detectLoose: line => line.startsWith(header.toLowerCase()),
    semanticRoles: [],
    capabilityEvidence: [
      { capability: 'detection', state: 'native', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
      { capability: 'source-preservation', state: 'source-preserved', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
      { capability: 'parse', state: 'source-preserved', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
      { capability: 'serialize', state: 'source-preserved', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
      { capability: 'mutation', state: 'diagnosed', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
      { capability: 'verify', state: 'diagnosed', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
      { capability: 'layout', state: 'native', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
      { capability: 'scene', state: 'absent', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
      { capability: 'svg', state: 'native', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
      { capability: 'terminal', state: 'native', evidence: ['src/__tests__/upstream-family-manifest.test.ts'] },
    ],
    layout: () => ({ width: 80, height: 24 }),
    projectPositioned: ({ positioned }) => ({
      version: 1,
      nodes: [],
      edges: [],
      groups: [],
      bounds: { w: toFinite(positioned.width), h: toFinite(positioned.height) },
    }),
    renderSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="24" viewBox="0 0 80 24"><text x="4" y="16">future</text></svg>',
    renderAscii: () => 'future',
  }
}

describe('pinned Mermaid public-family manifest', () => {
  test('pins the audited family policy and watch entries', () => {
    expect(validateUpstreamMermaidManifest()).toEqual([])
    expect(UPSTREAM_MERMAID_MANIFEST.provenance).toMatchObject({
      version: '11.16.0',
      tag: 'mermaid@11.16.0',
      commit: '5e3c88ea6d937a89078a5e8f1b2a6fd0ea391a5c',
    })
    expect(UPSTREAM_MERMAID_MANIFEST.families.filter(family => family.source === 'external-first-party').map(family => family.id)).toEqual(['zenuml'])
    expect(UPSTREAM_MERMAID_MANIFEST.watchEntries.map(entry => entry.id).sort()).toEqual(['error', 'frontmatter', 'info'])
    expect(Object.values(UPSTREAM_MERMAID_MANIFEST.semanticInventory).every(entries => entries.length > 0)).toBe(true)
    const officialArtifacts = new Set(UPSTREAM_MERMAID_MANIFEST.semanticInventory.sourceArtifacts
      .filter(artifact => artifact.kind === 'official-doc')
      .map(artifact => artifact.id))
    const inventoriedFamilies = new Set(UPSTREAM_MERMAID_MANIFEST.semanticInventory.syntaxFeatures
      .filter(feature => officialArtifacts.has(feature.artifact))
      .flatMap(feature => feature.families))
    const exampleFamilies = new Set(UPSTREAM_MERMAID_MANIFEST.semanticInventory.examples
      .filter(example => example.artifacts.some(artifact => officialArtifacts.has(artifact)))
      .map(example => example.family))
    expect(officialArtifacts.size).toBe(UPSTREAM_MERMAID_MANIFEST.families.length)
    expect(inventoriedFamilies).toEqual(new Set(UPSTREAM_MERMAID_MANIFEST.families.map(family => family.id)))
    expect(exampleFamilies).toEqual(new Set(UPSTREAM_MERMAID_MANIFEST.families.map(family => family.id)))
    expect(UPSTREAM_MERMAID_MANIFEST.families.find(family => family.id === 'sankey')?.lifecycle.introduction).toEqual({
      status: 'declared', version: '10.3.0', evidence: 'official-title',
    })
    expect(UPSTREAM_MERMAID_MANIFEST.families.every(family => family.officialSyntaxPage.url.startsWith('https://mermaid.ai/open-source/syntax/'))).toBe(true)
  })

  test('the committed inventory hash covers the complete ordered inventory', () => {
    const hash = createHash('sha256').update(canonicalUpstreamInventory()).digest('hex')
    expect(hash).toBe(UPSTREAM_MERMAID_MANIFEST.provenance.inventorySha256)
  })

  test('runtime detection uses a compact projection instead of shipping the semantic audit corpus', () => {
    expect(UPSTREAM_MERMAID_FAMILY_INDEX).toEqual({
      schemaVersion: 1,
      provenance: {
        version: UPSTREAM_MERMAID_MANIFEST.provenance.version,
        commit: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
        inventorySha256: UPSTREAM_MERMAID_MANIFEST.provenance.inventorySha256,
      },
      families: UPSTREAM_MERMAID_MANIFEST.families,
    })
    expect('semanticInventory' in UPSTREAM_MERMAID_FAMILY_INDEX).toBe(false)
  })

  test('the deterministic installed-package generator is fresh', () => {
    const result = spawnSync(process.execPath, ['run', 'scripts/generate-upstream-mermaid-manifest.ts', '--check'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    })
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
  })

  test('validation rejects forged provenance and incomplete package or semantic inventories', () => {
    const stale = structuredClone(UPSTREAM_MERMAID_MANIFEST) as UpstreamMermaidManifest
    stale.provenance.packageJsonSha256 = '0'.repeat(64)
    stale.provenance.tag = 'mermaid@0.0.0'
    stale.surfaces = stale.surfaces.slice(1)
    stale.semanticInventory.examples = []
    stale.semanticInventory.syntaxFeatures[0]!.families = ['invented-family']
    ;(stale.semanticInventory.syntaxFeatures[0] as { status: string }).status = 'invented-status'
    stale.families[0]!.officialSyntaxPage.artifact = 'missing-official-doc'
    ;(stale.families[0]!.lifecycle.introduction as { status: string }).status = 'invented-status'
    expect(validateUpstreamMermaidManifest(stale)).toEqual(expect.arrayContaining([
      'provenance tag does not match version',
      'packageJsonSha256 is invalid',
      'surface inventory is incomplete or out of order',
      'example inventory is empty',
      `syntax feature ${stale.semanticInventory.syntaxFeatures[0]!.id} has invalid families`,
      `syntax feature ${stale.semanticInventory.syntaxFeatures[0]!.id} has invalid status`,
      `family ${stale.families[0]!.id} has invalid official syntax page`,
      `family ${stale.families[0]!.id} has invalid lifecycle accounting`,
    ]))
  })

  test('native header claims are exactly the headers claimed by built-in descriptors', () => {
    const nativeFamilies = new Set<string>()
    for (const family of UPSTREAM_MERMAID_MANIFEST.families) {
      for (const header of family.headers.filter(candidate => candidate.agenticStatus === 'native')) {
        nativeFamilies.add(family.id)
        expect(detectDiagramTypeFromFirstLine(header.value)).toBe(family.id as FamilyId)
      }
    }
    expect(nativeFamilies).toEqual(new Set(BUILTIN_FAMILY_METADATA.map(family => family.id)))
  })

  test('upgrade diffs expose families and semantic syntax, example, config, and theme changes', () => {
    const next = structuredClone(UPSTREAM_MERMAID_MANIFEST) as UpstreamMermaidManifest
    next.provenance.version = '11.17.0'
    next.families = next.families.filter(family => family.id !== 'zenuml')
    next.families.push({
      id: 'future', label: 'Future', source: 'core', maturity: 'beta', upstreamDetectorIds: ['future'],
      headers: [{ value: 'future-beta', agenticStatus: 'unsupported' }],
      officialSyntaxPage: {
        path: 'skills/agentic-mermaid-diagram-workflow/references/upstream/future.md',
        url: 'https://mermaid.ai/open-source/syntax/future.html',
        artifact: 'official-doc:future',
      },
      lifecycle: { introduction: { status: 'not-declared' }, deprecation: { status: 'not-declared' } },
    })
    next.families.find(family => family.id === 'flowchart')!.headers.push({ value: 'flowchart-next', agenticStatus: 'unsupported' })
    next.families.find(family => family.id === 'timeline')!.maturity = 'stable'
    next.watchEntries.push({ id: 'probe', kind: 'internal', headers: ['probe'] })
    next.surfaces.find(surface => surface.id === 'configuration')!.sha256 = 'a'.repeat(64)
    next.semanticInventory.sourceArtifacts.find(artifact => artifact.id === 'suite-cases')!.sha256 = 'b'.repeat(64)
    const changedSyntaxId = next.semanticInventory.syntaxFeatures[0]!.id
    next.semanticInventory.syntaxFeatures[0]!.fingerprint = '1'.repeat(64)
    const removedSyntaxId = next.semanticInventory.syntaxFeatures.pop()!.id
    next.semanticInventory.syntaxFeatures.push({
      id: 'suite-cases:future-syntax', artifact: 'suite-cases', families: ['flowchart'], status: 'executable',
      fingerprint: 'c'.repeat(64), sourceSha256: 'd'.repeat(64),
    })
    const changedExampleId = next.semanticInventory.examples[0]!.id
    next.semanticInventory.examples[0]!.sourceSha256 = '2'.repeat(64)
    const removedExampleId = next.semanticInventory.examples.pop()!.id
    next.semanticInventory.examples.push({
      id: 'flowchart:syntax/flowchart.md#999', family: 'flowchart', origin: 'syntax/flowchart.md', index: 999,
      sourceSha256: 'e'.repeat(64), artifacts: ['docs-corpus'],
    })
    const changedConfigId = next.semanticInventory.configKeys[0]!.id
    next.semanticInventory.configKeys[0]!.type = 'number'
    const removedConfigId = next.semanticInventory.configKeys.pop()!.id
    next.semanticInventory.configKeys.push({ id: 'future.enabled', type: 'boolean', optional: true })
    const changedThemeId = next.semanticInventory.themeVariables[0]!.id
    next.semanticInventory.themeVariables[0]!.defaultSha256 = '3'.repeat(64)
    const removedThemeId = next.semanticInventory.themeVariables.pop()!.id
    next.semanticInventory.themeVariables.push({ id: 'futureAccent', type: 'string', defaultSha256: 'f'.repeat(64) })

    expect(diffUpstreamMermaidManifests(UPSTREAM_MERMAID_MANIFEST, UPSTREAM_MERMAID_MANIFEST)).toEqual({
      fromVersion: '11.16.0', toVersion: '11.16.0',
      addedFamilies: [], removedFamilies: [], changedFamilies: [],
      addedWatchEntries: [], removedWatchEntries: [], changedWatchEntries: [],
      addedSurfaces: [], removedSurfaces: [], changedSurfaces: [],
      addedSemanticSources: [], removedSemanticSources: [], changedSemanticSources: [],
      addedSyntaxFeatures: [], removedSyntaxFeatures: [], changedSyntaxFeatures: [],
      addedExamples: [], removedExamples: [], changedExamples: [],
      addedConfigKeys: [], removedConfigKeys: [], changedConfigKeys: [],
      addedThemeVariables: [], removedThemeVariables: [], changedThemeVariables: [],
    })
    const diff = diffUpstreamMermaidManifests(UPSTREAM_MERMAID_MANIFEST, next)
    expect(diff).toMatchObject({
      fromVersion: '11.16.0', toVersion: '11.17.0',
      addedFamilies: ['future'], removedFamilies: ['zenuml'], addedWatchEntries: ['probe'],
    })
    expect(diff.changedFamilies).toEqual([
      { id: 'flowchart', fields: ['headers'] },
      { id: 'timeline', fields: ['maturity'] },
    ])
    expect(diff.changedSurfaces).toEqual([{ id: 'configuration', fields: ['sha256'] }])
    expect(diff.changedSemanticSources).toEqual([{ id: 'suite-cases', fields: ['sha256'] }])
    expect(diff.addedSyntaxFeatures).toEqual(['suite-cases:future-syntax'])
    expect(diff.removedSyntaxFeatures).toEqual([removedSyntaxId])
    expect(diff.changedSyntaxFeatures).toEqual([{ id: changedSyntaxId, fields: ['fingerprint'] }])
    expect(diff.addedExamples).toEqual(['flowchart:syntax/flowchart.md#999'])
    expect(diff.removedExamples).toEqual([removedExampleId])
    expect(diff.changedExamples).toEqual([{ id: changedExampleId, fields: ['sourceSha256'] }])
    expect(diff.addedConfigKeys).toEqual(['future.enabled'])
    expect(diff.removedConfigKeys).toEqual([removedConfigId])
    expect(diff.changedConfigKeys).toEqual([{ id: changedConfigId, fields: ['type'] }])
    expect(diff.addedThemeVariables).toEqual(['futureAccent'])
    expect(diff.removedThemeVariables).toEqual([removedThemeId])
    expect(diff.changedThemeVariables).toEqual([{ id: changedThemeId, fields: ['defaultSha256'] }])
  })
})

describe('forward-compatible family classification', () => {
  test('every official unsupported dialect is classified and never routed to Flowchart', () => {
    const unsupported = UPSTREAM_MERMAID_MANIFEST.families.flatMap(family =>
      family.headers
        .filter(header => header.agenticStatus !== 'native')
        .map(header => ({ family, header })))
    expect(unsupported.length).toBeGreaterThan(20)
    for (const { family, header } of unsupported) {
      const source = `${header.value}\n  preserved payload`
      expect(detectRegisteredFamilyFromFirstLine(header.value, 'loose')).toBeNull()
      expect(detectDiagramType(source)).toBeNull()
      expect(findUpstreamFamilyByHeader(header.value)).toMatchObject({
        family: { id: family.id },
        header: { value: header.value, agenticStatus: header.agenticStatus },
      })
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(false)
      if (parsed.ok) continue
      expect(parsed.error[0]).toMatchObject({
        code: 'UNSUPPORTED_FAMILY',
        preservation: {
          version: 1,
          classification: header.agenticStatus === 'inventory-only' ? 'inventory-only' : 'unsupported',
          source,
          upstreamFamilyId: family.id,
          mermaidVersion: '11.16.0',
        },
      })
    }
  })

  test('C4 and unknown future sources preserve every authored byte on diagnostics', () => {
    const c4 = '---\ntitle: Deployment\n---\n%%{init: {"theme":"base"}}%%\n%% keep me\nC4Deployment\n  Deployment_Node(a, "A")\n'
    const c4Result = parseMermaid(c4)
    expect(c4Result.ok).toBe(false)
    if (!c4Result.ok) {
      expect(c4Result.error[0]?.code).toBe('UNSUPPORTED_FAMILY')
      expect(c4Result.error[0]?.preservation).toMatchObject({
        classification: 'inventory-only', source: c4, header: 'C4Deployment', upstreamFamilyId: 'c4',
      })
    }

    const future = '\uFEFF\n%% untouched\nfutureDiagram-v99\n  opaque { bytes }\n'
    const futureResult = parseMermaid(future)
    expect(futureResult.ok).toBe(false)
    if (!futureResult.ok) {
      expect(futureResult.error[0]).toMatchObject({
        code: 'UNKNOWN_HEADER',
        preservation: { classification: 'unknown', source: future, header: 'futureDiagram-v99' },
      })
    }
  })

  test('SVG and ASCII expose the same stable unsupported/unknown diagnostic without Flowchart fallback', () => {
    const cases = [
      {
        source: 'requirementDiagram\n  requirement R {\n    id: 1\n  }\n',
        expected: { code: 'UNSUPPORTED_FAMILY', classification: 'unsupported', family: 'requirement', header: 'requirementDiagram' },
      },
      {
        source: 'C4Context\n  Person(user, "User")\n',
        expected: { code: 'UNSUPPORTED_FAMILY', classification: 'inventory-only', family: 'c4', header: 'C4Context' },
      },
      {
        source: 'brandNewDiagram-v42\n  keep these bytes\n',
        expected: { code: 'UNKNOWN_HEADER', classification: 'unknown', family: undefined, header: 'brandNewDiagram-v42' },
      },
    ] as const

    for (const { source, expected } of cases) {
      for (const [output, render] of [
        ['svg', () => renderMermaidSVG(source)],
        ['ascii', () => renderMermaidASCII(source, { colorMode: 'none' })],
      ] as const) {
        try {
          render()
          throw new Error(`${output} unexpectedly rendered ${expected.header}`)
        } catch (error) {
          expect(error).toBeInstanceOf(MermaidFamilyDetectionError)
          const detection = error as MermaidFamilyDetectionError
          expect({
            code: detection.code,
            classification: detection.preservation.classification,
            family: detection.preservation.upstreamFamilyId,
            header: detection.preservation.header,
            source: detection.preservation.source,
          }).toEqual({ ...expected, source })
          expect(detection.message.toLowerCase()).not.toContain('flowchart')
        }
      }
    }
  })
})

describe('synthetic family registration', () => {
  test('descriptor parse and serialize hooks own a typed open extension envelope', () => {
    const source = 'nativeFutureDiagram\naccTitle: Future title\n  payload stays typed\n'
    const base = syntheticFamily('acme/native-future', 'nativeFutureDiagram')
    const id = base.id as ExternalFamilyId
    const descriptor: FamilyDescriptor = {
      ...base,
      capabilityEvidence: base.capabilityEvidence.map(claim =>
        claim.capability === 'source-preservation' || claim.capability === 'parse' || claim.capability === 'serialize'
          ? { ...claim, state: 'native' }
          : claim),
      parse: context => ok({
        kind: 'extension',
        family: id,
        source: context.opaqueSource,
        data: {
          familyLines: [...context.lines],
          accessibilityTitle: context.meta.accessibility.title,
        },
      }),
      serialize: body => body.kind === 'extension' ? body.source : '',
    }
    const dispose = registerFamily(descriptor)
    try {
      const parsed = parseRegisteredMermaid(source)
      expect(parsed).toMatchObject({
        ok: true,
        value: {
          kind: base.id,
          body: {
            kind: 'extension',
            family: base.id,
            data: {
              familyLines: ['nativeFutureDiagram', 'payload stays typed'],
              accessibilityTitle: 'Future title',
            },
          },
        },
      })
      if (parsed.ok) expect(serializeMermaid(parsed.value)).toBe(source)
    } finally {
      dispose()
    }
  })

  test('registers and detects a future family without a core routing switch', () => {
    const before = knownFamilies()
    const descriptor: FamilyDescriptor = {
      ...syntheticFamily('acme/future', 'futureDiagram'),
      config: { section: 'future', keys: ['spacing', 'legacy'], noopKeys: ['legacy'] },
    }
    const dispose = registerFamily(descriptor)
    try {
      expect(getFamily('family:acme/future')).toBeDefined()
      expect(detectRegisteredFamilyFromFirstLine('futureDiagram')).toBe('family:acme/future')
      expect(detectDiagramTypeFromFirstLine('futureDiagram')).toBe('family:acme/future')
      expect(knownFamilies().slice(-1)).toEqual(['family:acme/future'])
      expect(renderMermaidSVG('futureDiagram\n  A -> B')).toContain('>future</text>')
      expect(renderMermaidASCII('futureDiagram\n  A -> B', { colorMode: 'none' })).toBe('future')
      const cliFile = `/tmp/agentic-mermaid-extension-${Date.now()}.mmd`
      writeFileSync(cliFile, 'futureDiagram\n  A -> B')
      const chunks: string[] = []
      const originalWrite = process.stdout.write
      process.stdout.write = ((chunk: unknown) => { chunks.push(String(chunk)); return true }) as typeof process.stdout.write
      try {
        expect(runCli(['render', cliFile, '--format', 'svg'])).toBe(0)
        expect(chunks.join('')).toContain('>future</text>')
        chunks.length = 0
        expect(runCli(['render', cliFile, '--format', 'json'])).toBe(0)
        expect(JSON.parse(chunks.join(''))).toMatchObject({
          version: 1,
          bounds: { w: 80, h: 24 },
          receipt: { output: 'layout' },
        })
      } finally {
        process.stdout.write = originalWrite
      }
      expect(projectPositionedView(descriptor.id, { width: 80, height: 24 })).toEqual({
        version: 1, nodes: [], edges: [], groups: [], bounds: { w: toFinite(80), h: toFinite(24) },
      })
      expect(explicitFamilyConfigDiagnostics(descriptor.id, {
        future: { spacing: 12, legacy: true, typo: 1 },
      })).toEqual([
        expect.objectContaining({ field: 'future.legacy' }),
        expect.objectContaining({ field: 'future.typo' }),
      ])
      expect(Object.isFrozen(getFamily(descriptor.id)?.config?.keys)).toBe(true)

      const parsed = parseMermaid('futureDiagram\n  A -> B')
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error[0]).toMatchObject({
        code: 'EXTENSION_PARSE_REQUIRES_OPEN_ENVELOPE',
        preservation: { source: 'futureDiagram\n  A -> B', upstreamFamilyId: 'family:acme/future' },
        help: expect.stringContaining('parseRegisteredMermaid'),
      })
      const openParsed = parseRegisteredMermaid('futureDiagram\n  A -> B')
      expect(openParsed).toMatchObject({
        ok: true,
        value: {
          kind: 'family:acme/future',
          body: { kind: 'extension', family: 'family:acme/future', source: 'futureDiagram\n  A -> B' },
        },
      })

      expect(() => registerFamily(syntheticFamily('acme/future', 'futureDiagram2')))
        .toThrow(ExtensionCollisionError)
      expect(getFamily('family:acme/future')?.headers).toEqual(['futureDiagram'])
    } finally {
      dispose()
    }
    expect(knownFamilies()).toEqual(before)
  })

  test('rejects invalid namespaces, header collisions, and metadata mutation atomically', () => {
    const before = knownFamilies()
    const invalid = syntheticFamily('acme/invalid', 'invalidDiagram')
    ;(invalid as { id: string }).id = 'acme:invalid'
    expect(() => registerFamily(invalid)).toThrow(/"family:" namespace/)

    expect(() => registerFamily(syntheticFamily('acme/collision', 'flowchart')))
      .toThrow(/header "flowchart" is already owned by "flowchart"/)

    const detectorCollision: FamilyDescriptor = {
      ...syntheticFamily('acme/detector-collision', 'detectorOnly'),
      detect: (line: string) => line === 'detectoronly' || line === 'flowchart',
    }
    expect(() => registerFamily(detectorCollision))
      .toThrow(/detector .* overlaps header "flowchart" owned by "flowchart"/)

    const flowchart = getFamily('flowchart')
    expect(() => augmentFamily('flowchart', { id: 'family:evil' } as never)).toThrow(/Cannot augment/)
    expect(getFamily('flowchart')).toBe(flowchart)
    expect(knownFamilies()).toEqual(before)
  })

  test('rejects incomplete, contradictory, or ungrounded descriptor claims atomically', () => {
    const before = knownFamilies()
    const missing = syntheticFamily('acme/missing-evidence', 'missingEvidenceDiagram')
    expect(() => registerFamily({
      ...missing,
      capabilityEvidence: missing.capabilityEvidence.filter(claim => claim.capability !== 'terminal'),
    })).toThrow(/lacks evidence for capability "terminal"/)

    const duplicate = syntheticFamily('acme/duplicate-evidence', 'duplicateEvidenceDiagram')
    expect(() => registerFamily({
      ...duplicate,
      capabilityEvidence: [...duplicate.capabilityEvidence, duplicate.capabilityEvidence[0]!],
    })).toThrow(/duplicate evidence for capability "detection"/)

    const emptyPath = syntheticFamily('acme/empty-evidence', 'emptyEvidenceDiagram')
    expect(() => registerFamily({
      ...emptyPath,
      capabilityEvidence: emptyPath.capabilityEvidence.map(claim => claim.capability === 'svg'
        ? { ...claim, evidence: [''] }
        : claim),
    })).toThrow(/capability "svg" must cite at least one evidence path/)

    const contradictory = syntheticFamily('acme/contradictory', 'contradictoryDiagram')
    expect(() => registerFamily({
      ...contradictory,
      capabilityEvidence: contradictory.capabilityEvidence.map(claim => claim.capability === 'svg'
        ? { ...claim, state: 'absent' }
        : claim),
    })).toThrow(/capability "svg" claims "absent" but its hooks require "native"/)

    const duplicateRoles = syntheticFamily('acme/duplicate-roles', 'duplicateRolesDiagram')
    expect(() => registerFamily({ ...duplicateRoles, semanticRoles: ['acme:node', 'acme:node'] }))
      .toThrow(/duplicate Scene roles/)

    const rolesWithoutScene = syntheticFamily('acme/roles-without-scene', 'rolesWithoutSceneDiagram')
    expect(() => registerFamily({ ...rolesWithoutScene, semanticRoles: ['acme:node'] }))
      .toThrow(/declares Scene roles without a Scene lowering/)

    const projectionWithoutLayout = syntheticFamily('acme/projection-without-layout', 'projectionWithoutLayoutDiagram')
    expect(() => registerFamily({ ...projectionWithoutLayout, layout: undefined }))
      .toThrow(/cannot project a positioned artifact without a layout hook/)

    expect(knownFamilies()).toEqual(before)
  })

  test('snapshots extension identity and routing metadata at registration', () => {
    const descriptor = syntheticFamily('acme/immutable', 'immutableDiagram')
    const mutableProvenance = { owner: 'acme', source: 'test' }
    const mutableIdentity = {
      ...descriptor.identity,
      compatibility: { ...descriptor.identity.compatibility },
      provenance: mutableProvenance,
    }
    ;(descriptor as unknown as { identity: typeof mutableIdentity }).identity = mutableIdentity
    const dispose = registerFamily(descriptor)
    try {
      ;(descriptor.headers as string[])[0] = 'flowchart'
      mutableProvenance.owner = 'tampered'
      expect(getFamily('family:acme/immutable')).toMatchObject({
        headers: ['immutableDiagram'],
        identity: { provenance: { owner: 'acme' } },
      })
      expect(detectRegisteredFamilyFromFirstLine('immutableDiagram')).toBe('family:acme/immutable')
      expect(detectRegisteredFamilyFromFirstLine('flowchart')).toBe('flowchart')
    } finally {
      dispose()
    }
    expect(getFamily('family:acme/immutable')).toBeUndefined()
  })
})
