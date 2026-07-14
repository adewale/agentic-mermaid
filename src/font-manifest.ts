import { createExtensionIdentity } from './shared/extension-identity.ts'
import {
  RESOURCE_MANIFEST_VERSION,
  validateResourceManifest as validateManifest,
  type ResourceLicense,
  type ResourceManifest,
  type ResourceManifestEntry,
} from './resource-manifest.ts'

export type { ResourceLicense, ResourceManifest, ResourceManifestEntry } from './resource-manifest.ts'

export interface HostedFontFace {
  family: string
  file: string
  weight: string
  style: string
}

export interface HostedFontResource extends HostedFontFace, ResourceManifestEntry {}

interface HostedFontResourceSeed extends HostedFontFace {
  sha256: string
  bytes: number
  license: 'OFL-1.1' | 'Bitstream-Vera'
}

const HOSTED_FONT_RESOURCE_SEEDS: readonly HostedFontResourceSeed[] = [
  { family: 'Inter', file: 'Inter-Regular.ttf', weight: '400', style: 'normal', sha256: '1b08e7fc267a5c7e1d614100f604b83e7e8a0be241f0f288faa2b3ac93a683ba', bytes: 324820, license: 'OFL-1.1' },
  { family: 'Inter', file: 'Inter-Medium.ttf', weight: '500', style: 'normal', sha256: '8c883f63b2c4157d997319f2c8bc6995ed4357ef371940d31ca159004a4aae63', bytes: 325304, license: 'OFL-1.1' },
  { family: 'Inter', file: 'Inter-SemiBold.ttf', weight: '600', style: 'normal', sha256: 'e7a1aaf7eda9f2fad4131725fa556265ec75ca7b2d756260173a040363e8d4f7', bytes: 326048, license: 'OFL-1.1' },
  { family: 'Inter', file: 'Inter-Bold.ttf', weight: '700', style: 'normal', sha256: 'b37284b5701b6b168dfc770aa1a4ac492106422fd3ba76bc7641e37434e8019c', bytes: 326468, license: 'OFL-1.1' },
  { family: 'Caveat', file: 'Caveat.ttf', weight: '400 700', style: 'normal', sha256: '0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988', bytes: 403648, license: 'OFL-1.1' },
  { family: 'EB Garamond', file: 'EBGaramond.ttf', weight: '400 700', style: 'normal', sha256: 'ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027', bytes: 851176, license: 'OFL-1.1' },
  { family: 'Architects Daughter', file: 'ArchitectsDaughter.ttf', weight: '400', style: 'normal', sha256: '6159718a08898e34bc1cb7354086141a5f9a70b73e54dbec27ead0d59a697359', bytes: 43352, license: 'OFL-1.1' },
  { family: 'Share Tech Mono', file: 'ShareTechMono.ttf', weight: '400', style: 'normal', sha256: '9ceab1f87414829af259c0f537573ae03ef7dd3147c0b27a36a1a0beb6732677', bytes: 43272, license: 'OFL-1.1' },
  { family: 'DejaVu Sans', file: 'DejaVuSans.ttf', weight: '400', style: 'normal', sha256: 'ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280', bytes: 759720, license: 'Bitstream-Vera' },
  { family: 'DejaVu Sans', file: 'DejaVuSans-Bold.ttf', weight: '700', style: 'normal', sha256: '5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895', bytes: 708920, license: 'Bitstream-Vera' },
]

function fontResourceLocalId(face: HostedFontFace): string {
  return `font/${face.file.toLowerCase().replace(/[^a-z0-9._/-]+/g, '-')}`
}

/** Canonical installed-resource view; consumers derive legacy face/file lists. */
export const HOSTED_FONT_RESOURCES: readonly HostedFontResource[] = Object.freeze(
  HOSTED_FONT_RESOURCE_SEEDS.map(face => Object.freeze({
    family: face.family,
    file: face.file,
    weight: face.weight,
    style: face.style,
    path: `assets/fonts/${face.file}`,
    mediaType: 'font/ttf' as const,
    sha256: face.sha256,
    bytes: face.bytes,
    license: Object.freeze({ spdx: face.license, noticePath: 'assets/fonts/FONT-LICENSES.md' }),
    required: true,
    network: 'forbidden' as const,
    identity: createExtensionIdentity({
      id: `resource:${fontResourceLocalId(face)}`,
      kind: 'resource',
      version: '1.0.0',
      compatibility: { core: '^0.1.1' },
      provenance: { owner: 'agentic-mermaid', source: 'bundled', reference: `assets/fonts/${face.file}` },
    }),
  })),
)

export const RESOURCE_MANIFEST: ResourceManifest = Object.freeze({
  version: RESOURCE_MANIFEST_VERSION,
  resources: Object.freeze(HOSTED_FONT_RESOURCES.map(resource => Object.freeze({
    identity: resource.identity,
    path: resource.path,
    mediaType: resource.mediaType,
    sha256: resource.sha256,
    bytes: resource.bytes,
    license: resource.license,
    required: resource.required,
    network: resource.network,
  }))),
})

/** Browser-safe structural checks; byte integrity is enforced by each host resolver. */
export function validateResourceManifest(manifest: unknown = RESOURCE_MANIFEST): string[] {
  return validateManifest(manifest)
}

export function hostedFontResource(file: string): HostedFontResource {
  const resource = HOSTED_FONT_RESOURCES.find(candidate => candidate.file === file)
  if (!resource) throw new Error(`Unknown bundled font resource: ${file}`)
  return resource
}

/** Compatibility projection retained for existing browser/raster consumers. */
export const HOSTED_FONT_FACES: readonly HostedFontFace[] = Object.freeze(
  HOSTED_FONT_RESOURCES.map(({ family, file, weight, style }) => Object.freeze({ family, file, weight, style })),
)

export const HOSTED_FONT_FILES = [...new Set(HOSTED_FONT_FACES.map((font) => font.file))] as readonly string[]

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function hostedFontFaceCss(prefix = '/fonts/'): string {
  return HOSTED_FONT_FACES.map((font) =>
    `@font-face { font-family: '${cssString(font.family)}'; src: url('${prefix}${font.file}') format('truetype'); font-weight: ${font.weight}; font-style: ${font.style}; font-display: swap; }`,
  ).join('\n')
}
