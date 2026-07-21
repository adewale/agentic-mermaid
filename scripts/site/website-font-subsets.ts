import { hostedFontResource } from '../../src/font-manifest.ts'

export const WEBSITE_INTER_SUBSET_SCHEMA_VERSION = 1
export const WEBSITE_INTER_SUBSET_AUTHORITY = 'canonical-linux-inter-subsets-v1'
export const WEBSITE_INTER_SUBSET_DIRECTORY = 'website/source/assets/fonts/inter'
export const WEBSITE_INTER_SUBSET_MANIFEST = `${WEBSITE_INTER_SUBSET_DIRECTORY}/manifest.json`
export const WEBSITE_INTER_SUBSET_HASH_LENGTH = 12
export const WEBSITE_INTER_SUBSET_MAX_FACE_BYTES = 41_000
export const WEBSITE_INTER_SUBSET_MAX_TOTAL_BYTES = 160_000
export const WEBSITE_INTER_SUBSET_REQUIREMENTS_SHA256 = '62e4d79a99706cc098541a98014e0aa0749f3796754ec8a14bb45a96aaf94fa8'

export const WEBSITE_INTER_SUBSET_TOOLCHAIN = Object.freeze({
  platform: 'linux/amd64',
  image: 'python:3.12.10-slim-bookworm@sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db',
  python: '3.12.10',
  fonttools: '4.63.0',
  brotli: '1.2.0',
  requirements: 'scripts/site/website-font-subset-requirements.txt',
})

export const WEBSITE_INTER_SUBSET_FACES = Object.freeze([
  Object.freeze({ file: 'Inter-Regular.ttf', weight: '400' }),
  Object.freeze({ file: 'Inter-Medium.ttf', weight: '500' }),
  Object.freeze({ file: 'Inter-SemiBold.ttf', weight: '600' }),
  Object.freeze({ file: 'Inter-Bold.ttf', weight: '700' }),
] as const)

/** Broad Latin plus the punctuation/symbol blocks used by public prose and
 * diagrams. Greek and Cyrillic deliberately remain full-TTF fallback probes. */
export const WEBSITE_INTER_UNICODE_RANGES = Object.freeze([
  'U+0000-00FF',
  'U+0100-024F',
  'U+1E00-1EFF',
  'U+2000-206F',
  'U+20A0-20CF',
  'U+2190-21FF',
  'U+2200-22FF',
  'U+2300-23FF',
  'U+2500-25FF',
  'U+2600-26FF',
  'U+2700-27BF',
] as const)

export const WEBSITE_INTER_SUBSET_ARGUMENTS = Object.freeze([
  '--flavor=woff2',
  '--layout-features=kern,liga,clig,calt,ccmp,locl,mark,mkmk,tnum',
  '--no-glyph-names',
  '--no-symbol-cmap',
  '--no-legacy-cmap',
  '--notdef-glyph',
  '--notdef-outline',
  '--recommended-glyphs',
  '--no-recalc-timestamp',
] as const)

export const WEBSITE_INTER_GLYPH_PROBES = Object.freeze({
  covered: Object.freeze([
    'AZaz09 éñ Āž ẞ',
    '“quotes” — … •',
    '$ € £ ¥ ₿',
    '← ↑ → ↓ ↔',
    '∞ ∑ √ ≠ ≤ ≥',
    '⌘ ⌥ ⎋',
    '■ □ ▲ △ ● ○',
    '✓ ★',
  ]),
  fullOnly: Object.freeze(['Ж', 'α']),
  unbundled: Object.freeze(['中', '🙂']),
})

export interface WebsiteInterSubsetOutput {
  source: string
  weight: string
  file: string
  sha256: string
  bytes: number
}

export interface WebsiteInterSubsetManifest {
  schemaVersion: number
  authority: string
  toolchain: typeof WEBSITE_INTER_SUBSET_TOOLCHAIN
  requirementsSha256: string
  unicodeRanges: readonly string[]
  arguments: readonly string[]
  probes: typeof WEBSITE_INTER_GLYPH_PROBES
  sources: Array<{ file: string, weight: string, sha256: string, bytes: number }>
  outputs: WebsiteInterSubsetOutput[]
  coverage: Array<{ source: string, covered: string[], fullOnly: string[], unbundled: string[] }>
  totalBytes: number
}

export function expectedWebsiteInterSources() {
  return WEBSITE_INTER_SUBSET_FACES.map(face => {
    const resource = hostedFontResource(face.file)
    return { file: face.file, weight: face.weight, sha256: resource.sha256, bytes: resource.bytes }
  })
}

export function validateWebsiteInterSubsetManifest(value: WebsiteInterSubsetManifest): string[] {
  const problems: string[] = []
  if (value.schemaVersion !== WEBSITE_INTER_SUBSET_SCHEMA_VERSION) problems.push(`schemaVersion ${value.schemaVersion}`)
  if (value.authority !== WEBSITE_INTER_SUBSET_AUTHORITY) problems.push(`authority ${value.authority}`)
  if (JSON.stringify(value.toolchain) !== JSON.stringify(WEBSITE_INTER_SUBSET_TOOLCHAIN)) problems.push('toolchain drift')
  if (value.requirementsSha256 !== WEBSITE_INTER_SUBSET_REQUIREMENTS_SHA256) problems.push('requirements digest drift')
  if (JSON.stringify(value.unicodeRanges) !== JSON.stringify(WEBSITE_INTER_UNICODE_RANGES)) problems.push('unicode range drift')
  if (JSON.stringify(value.arguments) !== JSON.stringify(WEBSITE_INTER_SUBSET_ARGUMENTS)) problems.push('argument drift')
  if (JSON.stringify(value.probes) !== JSON.stringify(WEBSITE_INTER_GLYPH_PROBES)) problems.push('probe drift')
  if (JSON.stringify(value.sources) !== JSON.stringify(expectedWebsiteInterSources())) problems.push('source manifest drift')
  if (value.outputs.length !== WEBSITE_INTER_SUBSET_FACES.length) problems.push(`expected ${WEBSITE_INTER_SUBSET_FACES.length} outputs, got ${value.outputs.length}`)
  for (const face of WEBSITE_INTER_SUBSET_FACES) {
    const output = value.outputs.find(candidate => candidate.source === face.file)
    if (!output) { problems.push(`missing output for ${face.file}`); continue }
    if (output.weight !== face.weight) problems.push(`${face.file}: weight ${output.weight}`)
    if (!/^[a-f0-9]{64}$/.test(output.sha256)) problems.push(`${face.file}: invalid sha256`)
    if (!Number.isSafeInteger(output.bytes) || output.bytes <= 0) problems.push(`${face.file}: invalid byte count ${output.bytes}`)
    if (!new RegExp(`^${face.file.replace('.ttf', '')}\\.subset-[a-f0-9]{${WEBSITE_INTER_SUBSET_HASH_LENGTH}}\\.woff2$`).test(output.file)) problems.push(`${face.file}: invalid content-addressed name ${output.file}`)
    if (!output.file.includes(output.sha256.slice(0, WEBSITE_INTER_SUBSET_HASH_LENGTH))) problems.push(`${face.file}: filename/hash mismatch`)
    if (output.bytes > WEBSITE_INTER_SUBSET_MAX_FACE_BYTES) problems.push(`${face.file}: ${output.bytes} exceeds ${WEBSITE_INTER_SUBSET_MAX_FACE_BYTES}`)
  }
  const labelProbe = (values: readonly string[]) => Array.from(new Set(Array.from(values.join(''), character => character.codePointAt(0)!)))
    .sort((left, right) => left - right).map(codepoint => `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`)
  const expectedCoverage = WEBSITE_INTER_SUBSET_FACES.map(face => ({
    source: face.file,
    covered: labelProbe(WEBSITE_INTER_GLYPH_PROBES.covered),
    fullOnly: labelProbe(WEBSITE_INTER_GLYPH_PROBES.fullOnly),
    unbundled: labelProbe(WEBSITE_INTER_GLYPH_PROBES.unbundled),
  }))
  if (JSON.stringify(value.coverage) !== JSON.stringify(expectedCoverage)) problems.push('coverage proof drift')
  const total = value.outputs.reduce((sum, output) => sum + output.bytes, 0)
  if (value.totalBytes !== total) problems.push(`totalBytes ${value.totalBytes} != ${total}`)
  if (total > WEBSITE_INTER_SUBSET_MAX_TOTAL_BYTES) problems.push(`total ${total} exceeds ${WEBSITE_INTER_SUBSET_MAX_TOTAL_BYTES}`)
  return problems
}
