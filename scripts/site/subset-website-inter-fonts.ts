import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { compareCodePointStrings } from '../../src/shared/deterministic-order.ts'
import {
  WEBSITE_INTER_GLYPH_PROBES,
  WEBSITE_INTER_SUBSET_ARGUMENTS,
  WEBSITE_INTER_SUBSET_AUTHORITY,
  WEBSITE_INTER_SUBSET_DIRECTORY,
  WEBSITE_INTER_SUBSET_FACES,
  WEBSITE_INTER_SUBSET_HASH_LENGTH,
  WEBSITE_INTER_SUBSET_MANIFEST,
  WEBSITE_INTER_SUBSET_REQUIREMENTS_SHA256,
  WEBSITE_INTER_SUBSET_SCHEMA_VERSION,
  WEBSITE_INTER_SUBSET_TOOLCHAIN,
  WEBSITE_INTER_UNICODE_RANGES,
  expectedWebsiteInterSources,
  validateWebsiteInterSubsetManifest,
  type WebsiteInterSubsetManifest,
} from './website-font-subsets.ts'

const ROOT = join(import.meta.dir, '..', '..')
const FONT_PARENT = join(ROOT, 'website', 'source', 'assets', 'fonts')
const COMMITTED = join(ROOT, WEBSITE_INTER_SUBSET_DIRECTORY)
const REQUIREMENTS = join(ROOT, WEBSITE_INTER_SUBSET_TOOLCHAIN.requirements)
const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : ''
if (!mode) throw new Error('Usage: bun run scripts/site/subset-website-inter-fonts.ts --write|--check')

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

function exactFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).map(entry => {
    if (!entry.isFile()) throw new Error(`Unexpected non-file in subset directory: ${entry.name}`)
    return entry.name
  }).sort(compareCodePointStrings)
}

mkdirSync(FONT_PARENT, { recursive: true })
const requirementsSha256 = sha256(readFileSync(REQUIREMENTS))
if (requirementsSha256 !== WEBSITE_INTER_SUBSET_REQUIREMENTS_SHA256) throw new Error('Inter subset requirements digest differs from the pinned authority')
// Keep staging outside the website fingerprint trees so a concurrent website
// build never observes generator scratch files; ROOT shares the destination's
// filesystem, so the final directory rename remains atomic.
const stageRoot = mkdtempSync(join(ROOT, '.inter-subsets-stage-'))
const generated = join(stageRoot, 'generated')
try {
  const policy = {
    faces: WEBSITE_INTER_SUBSET_FACES,
    unicodeRanges: WEBSITE_INTER_UNICODE_RANGES,
    arguments: WEBSITE_INTER_SUBSET_ARGUMENTS,
    probes: WEBSITE_INTER_GLYPH_PROBES,
  }
  const policyPath = join(stageRoot, 'policy.json')
  writeFileSync(policyPath, stableJson(policy))
  const user = typeof process.getuid === 'function' && typeof process.getgid === 'function'
    ? ['--user', `${process.getuid()}:${process.getgid()}`]
    : []
  const docker = Bun.spawnSync([
    'docker', 'run', '--rm', '--pull=missing', '--platform', WEBSITE_INTER_SUBSET_TOOLCHAIN.platform,
    ...user,
    '--env', 'HOME=/tmp',
    '--volume', `${ROOT}:/work:ro`,
    '--volume', `${stageRoot}:/output`,
    '--workdir', '/work',
    WEBSITE_INTER_SUBSET_TOOLCHAIN.image,
    'sh', '-eu', '-c',
    'python -m pip install --disable-pip-version-check --no-cache-dir --no-deps --require-hashes --target /output/toolchain -r /work/scripts/site/website-font-subset-requirements.txt >/dev/null && PYTHONPATH=/output/toolchain python /work/scripts/site/subset-website-inter-fonts.py /output/policy.json /output/generated',
  ], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
  if (docker.exitCode !== 0) throw new Error(`canonical Inter subset container failed with exit ${docker.exitCode}`)

  const sources = expectedWebsiteInterSources()
  for (const source of sources) {
    const bytes = readFileSync(join(ROOT, 'assets', 'fonts', source.file))
    if (bytes.byteLength !== source.bytes || sha256(bytes) !== source.sha256) throw new Error(`${source.file}: source bytes differ from font resource manifest`)
  }
  const coverage = JSON.parse(readFileSync(join(generated, 'coverage.json'), 'utf8')) as WebsiteInterSubsetManifest['coverage']
  const observedToolchain = JSON.parse(readFileSync(join(generated, 'toolchain.json'), 'utf8')) as { python: string, fonttools: string, brotli: string }
  const expectedToolchain = {
    python: WEBSITE_INTER_SUBSET_TOOLCHAIN.python,
    fonttools: WEBSITE_INTER_SUBSET_TOOLCHAIN.fonttools,
    brotli: WEBSITE_INTER_SUBSET_TOOLCHAIN.brotli,
  }
  if (JSON.stringify(observedToolchain) !== JSON.stringify(expectedToolchain)) throw new Error(`Observed subset toolchain differs: ${JSON.stringify(observedToolchain)}`)
  rmSync(join(generated, 'coverage.json'))
  rmSync(join(generated, 'toolchain.json'))
  const outputs = WEBSITE_INTER_SUBSET_FACES.map(face => {
    const temporary = join(generated, face.file.replace(/\.ttf$/, '.woff2'))
    const bytes = readFileSync(temporary)
    if (bytes.subarray(0, 4).toString('ascii') !== 'wOF2') throw new Error(`${basename(temporary)} is not WOFF2`)
    const digest = sha256(bytes)
    const file = face.file.replace(/\.ttf$/, `.subset-${digest.slice(0, WEBSITE_INTER_SUBSET_HASH_LENGTH)}.woff2`)
    renameSync(temporary, join(generated, file))
    return { source: face.file, weight: face.weight, file, sha256: digest, bytes: bytes.byteLength }
  })
  const manifest: WebsiteInterSubsetManifest = {
    schemaVersion: WEBSITE_INTER_SUBSET_SCHEMA_VERSION,
    authority: WEBSITE_INTER_SUBSET_AUTHORITY,
    toolchain: WEBSITE_INTER_SUBSET_TOOLCHAIN,
    requirementsSha256,
    unicodeRanges: WEBSITE_INTER_UNICODE_RANGES,
    arguments: WEBSITE_INTER_SUBSET_ARGUMENTS,
    probes: WEBSITE_INTER_GLYPH_PROBES,
    sources,
    outputs,
    coverage,
    totalBytes: outputs.reduce((sum, output) => sum + output.bytes, 0),
  }
  const problems = validateWebsiteInterSubsetManifest(manifest)
  if (problems.length) throw new Error(`Generated Inter subset manifest is invalid:\n${problems.join('\n')}`)
  writeFileSync(join(generated, basename(WEBSITE_INTER_SUBSET_MANIFEST)), stableJson(manifest))

  if (mode === 'check') {
    if (!existsSync(COMMITTED)) throw new Error(`Missing committed subset directory: ${WEBSITE_INTER_SUBSET_DIRECTORY}`)
    const expectedFiles = exactFiles(generated)
    const committedFiles = exactFiles(COMMITTED)
    if (JSON.stringify(committedFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error(`Inter subset file set is stale: ${committedFiles.join(', ')} != ${expectedFiles.join(', ')}`)
    }
    for (const file of expectedFiles) {
      if (!readFileSync(join(COMMITTED, file)).equals(readFileSync(join(generated, file)))) throw new Error(`${file}: canonical bytes differ`)
    }
    console.log(`Inter subset manifest and ${outputs.length} canonical WOFF2 files pass`)
  } else {
    const backup = `${COMMITTED}.backup-${process.pid}`
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true })
    if (existsSync(COMMITTED)) renameSync(COMMITTED, backup)
    try {
      renameSync(generated, COMMITTED)
      rmSync(backup, { recursive: true, force: true })
    } catch (error) {
      if (existsSync(COMMITTED)) rmSync(COMMITTED, { recursive: true, force: true })
      if (existsSync(backup)) renameSync(backup, COMMITTED)
      throw error
    }
    console.log(`wrote ${WEBSITE_INTER_SUBSET_DIRECTORY}: ${outputs.map(output => `${output.file} (${output.bytes} B)`).join(', ')}`)
  }
} finally {
  rmSync(stageRoot, { recursive: true, force: true })
}
