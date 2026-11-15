import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import {
  NodeResourceResolver,
  ResourceResolutionError,
  type InstalledResourceVerification,
  type ResourceResolutionCode,
} from '../node-resource-resolver.ts'
import { snapshotResourceManifest, type ResourceManifest } from '../resource-manifest.ts'
import { registeredEmbeddedFontResourceFiles, type EmbeddedFontResourceFile } from './embedded-font-registry.ts'

export { registerEmbeddedFontResourceFiles, type EmbeddedFontResourceFile } from './embedded-font-registry.ts'

interface ManifestPathOwner {
  readonly resourceId: string
  readonly missingCode: Extract<ResourceResolutionCode, 'RESOURCE_MISSING' | 'RESOURCE_LICENSE_NOTICE_MISSING'>
}

/**
 * Reconstruct a private manifest-shaped package root from opaque embedded-file
 * paths, then delegate every trust decision to NodeResourceResolver. The
 * resolver snapshots verified bytes before this temporary root is removed, so
 * downstream rasterization never reads an unverified embedded path directly.
 */
export function verifyEmbeddedFontResourceFiles(
  manifest: ResourceManifest,
  files: readonly EmbeddedFontResourceFile[],
): InstalledResourceVerification {
  const snapshot = snapshotResourceManifest(manifest)
  const pathOwners = new Map<string, ManifestPathOwner>()
  for (const entry of snapshot.resources) {
    pathOwners.set(entry.path, { resourceId: entry.identity.id, missingCode: 'RESOURCE_MISSING' })
    if (!pathOwners.has(entry.license.noticePath)) {
      pathOwners.set(entry.license.noticePath, {
        resourceId: entry.identity.id,
        missingCode: 'RESOURCE_LICENSE_NOTICE_MISSING',
      })
    }
  }

  const root = mkdtempSync(join(tmpdir(), 'agentic-mermaid-embedded-resources-'))
  try {
    const materialized = new Set<string>()
    for (const file of files) {
      const owner = pathOwners.get(file.manifestPath)
      if (!owner) {
        throw new ResourceResolutionError(
          'UNKNOWN_RESOURCE',
          file.manifestPath,
          `embedded path is not declared by the font resource manifest: ${file.manifestPath}`,
        )
      }
      if (materialized.has(file.manifestPath)) {
        throw new ResourceResolutionError(
          'INVALID_RESOURCE_MANIFEST',
          owner.resourceId,
          `duplicate embedded path: ${file.manifestPath}`,
        )
      }

      let bytes: Uint8Array
      try {
        bytes = readFileSync(file.embeddedPath)
      } catch {
        throw new ResourceResolutionError(
          owner.missingCode,
          owner.resourceId,
          `embedded source is unavailable for declared path: ${file.manifestPath}`,
        )
      }
      const target = join(root, file.manifestPath)
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      writeFileSync(target, bytes, { flag: 'wx', mode: 0o400 })
      materialized.add(file.manifestPath)
    }

    return new NodeResourceResolver(root, snapshot).verifyInstalled()
  } finally {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // Cleanup must not mask the resource verifier's stable failure code.
    }
  }
}

/** Verify the binary host's registered closure, if this is such a host. */
export function verifyRegisteredEmbeddedFontResources(
  manifest: ResourceManifest,
): InstalledResourceVerification | undefined {
  const registeredFiles = registeredEmbeddedFontResourceFiles()
  return registeredFiles ? verifyEmbeddedFontResourceFiles(manifest, registeredFiles) : undefined
}
