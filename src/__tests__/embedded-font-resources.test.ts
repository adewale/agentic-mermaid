import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  verifyEmbeddedFontResourceFiles,
  type EmbeddedFontResourceFile,
} from '../agent/embedded-font-resources.ts'
import { ResourceResolutionError } from '../node-resource-resolver.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'
import type { ResourceManifest } from '../resource-manifest.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): {
  manifest: ResourceManifest
  files: EmbeddedFontResourceFile[]
  fontBytes: Uint8Array
  fontSource: string
} {
  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-embedded-fixture-'))
  roots.push(root)
  const fontBytes = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x07])
  const fontSource = join(root, 'opaque-font-asset')
  const licenseSource = join(root, 'opaque-license-asset')
  writeFileSync(fontSource, fontBytes)
  writeFileSync(licenseSource, 'fixture licence')
  const manifest: ResourceManifest = {
    version: 1,
    resources: [{
      identity: createExtensionIdentity({
        id: 'resource:test/embedded.ttf',
        kind: 'resource',
        version: '1.0.0',
        provenance: { owner: 'test', source: 'embedded-fixture' },
      }),
      path: 'assets/fonts/embedded.ttf',
      mediaType: 'font/ttf',
      sha256: createHash('sha256').update(fontBytes).digest('hex'),
      bytes: fontBytes.byteLength,
      license: { spdx: 'OFL-1.1', noticePath: 'assets/fonts/FONT-LICENSES.md' },
      required: true,
      network: 'forbidden',
    }],
  }
  return {
    manifest,
    files: [
      { manifestPath: 'assets/fonts/embedded.ttf', embeddedPath: fontSource },
      { manifestPath: 'assets/fonts/FONT-LICENSES.md', embeddedPath: licenseSource },
    ],
    fontBytes,
    fontSource,
  }
}

function expectCode(run: () => unknown, code: ResourceResolutionError['code']): void {
  try {
    run()
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceResolutionError)
    expect((error as ResourceResolutionError).code).toBe(code)
  }
}

describe('compiled-host embedded font resources', () => {
  test('materializes opaque host paths and returns only manifest-verified snapshots', () => {
    const { manifest, files, fontBytes, fontSource } = fixture()
    const result = verifyEmbeddedFontResourceFiles(manifest, files)
    expect(result.diagnostics).toEqual([])
    expect(result.resources).toHaveLength(1)

    writeFileSync(fontSource, new Uint8Array(fontBytes.byteLength).fill(0xff))
    expect(result.resources[0]!.readBytes()).toEqual(fontBytes)
  })

  test('fails closed for missing required bytes, licence closure, and digest drift', () => {
    const missingFont = fixture()
    expectCode(
      () => verifyEmbeddedFontResourceFiles(missingFont.manifest, missingFont.files.slice(1)),
      'RESOURCE_MISSING',
    )

    const missingLicense = fixture()
    expectCode(
      () => verifyEmbeddedFontResourceFiles(missingLicense.manifest, missingLicense.files.slice(0, 1)),
      'RESOURCE_LICENSE_NOTICE_MISSING',
    )

    const changed = fixture()
    writeFileSync(changed.fontSource, new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x08]))
    expectCode(
      () => verifyEmbeddedFontResourceFiles(changed.manifest, changed.files),
      'RESOURCE_DIGEST_MISMATCH',
    )
  })

  test('rejects undeclared and duplicate embedded paths', () => {
    const undeclared = fixture()
    expectCode(
      () => verifyEmbeddedFontResourceFiles(undeclared.manifest, [
        ...undeclared.files,
        { manifestPath: 'assets/fonts/unlisted.ttf', embeddedPath: undeclared.fontSource },
      ]),
      'UNKNOWN_RESOURCE',
    )

    const duplicate = fixture()
    expectCode(
      () => verifyEmbeddedFontResourceFiles(duplicate.manifest, [
        ...duplicate.files,
        duplicate.files[0]!,
      ]),
      'INVALID_RESOURCE_MANIFEST',
    )
  })
})
