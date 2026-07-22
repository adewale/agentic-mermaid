#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'

interface PackFile { path: string }
interface PackResult { filename?: string; files?: PackFile[]; integrity?: string }
interface PackageJson {
  exports?: Record<string, string | Record<string, string>>
  bin?: Record<string, string>
}
interface ExpectedManifest { schemaVersion: 1; files: string[] }

const REQUIRED_PACKAGE_FILES = [
  'package.json',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'LICENSES/Apache-2.0.txt',
  'server.json',
] as const

export function publishPackageProblems(
  packageJson: PackageJson,
  files: readonly string[],
  expectedFiles: readonly string[] = files,
): string[] {
  const present = new Set(files)
  const expected = new Set(expectedFiles)
  const required = new Set<string>(REQUIRED_PACKAGE_FILES)
  for (const target of Object.values(packageJson.bin ?? {})) required.add(stripDotSlash(target))
  for (const entry of Object.values(packageJson.exports ?? {})) {
    if (typeof entry === 'string') required.add(stripDotSlash(entry))
    else for (const target of Object.values(entry)) required.add(stripDotSlash(target))
  }

  const problems = [...required]
    .filter(path => !present.has(path))
    .sort()
    .map(path => `npm package is missing required file: ${path}`)
  for (const path of expected) {
    if (!present.has(path)) problems.push(`npm package is missing expected file: ${path}`)
  }
  for (const path of files) {
    if (!expected.has(path)) problems.push(`npm package has unexpected file: ${path}`)
    if (path.endsWith('.map')) problems.push(`npm package must not ship source maps: ${path}`)
    if (path === 'skill-evals/private' || path.startsWith('skill-evals/private/')) {
      problems.push(`npm package leaked private evaluation material: ${path}`)
    }
    if (path === 'website' || path.startsWith('website/')) {
      problems.push(`npm package leaked website-only material: ${path}`)
    }
  }
  return problems.sort()
}

function stripDotSlash(path: string): string {
  return path.replace(/^\.\//, '')
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..', '..')
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson
  const expected = JSON.parse(readFileSync(join(import.meta.dir, 'publish-package-files.json'), 'utf8')) as ExpectedManifest
  if (expected.schemaVersion !== 1 || !Array.isArray(expected.files) || expected.files.length === 0) {
    throw new Error('publish-package-files.json must contain a non-empty schemaVersion 1 file manifest')
  }
  const destinationFlag = process.argv.indexOf('--pack-destination')
  const destinationValue = destinationFlag >= 0 ? process.argv[destinationFlag + 1] : undefined
  if (!destinationValue) throw new Error('Usage: verify-publish-package.ts --pack-destination <empty-directory>')
  const destination = resolve(root, destinationValue)
  mkdirSync(destination, { recursive: true })
  if (readdirSync(destination).length !== 0) throw new Error(`Pack destination must be empty: ${destination}`)

  const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (packed.status !== 0) {
    process.stderr.write(packed.stderr || packed.stdout || `npm pack exited ${packed.status}\n`)
    process.exit(packed.status ?? 1)
  }
  let result: PackResult[]
  try {
    result = JSON.parse(packed.stdout) as PackResult[]
  } catch {
    process.stderr.write(`npm pack returned invalid JSON:\n${packed.stdout}\n`)
    process.exit(1)
  }
  const packResult = result[0]
  const files = packResult?.files?.map(file => file.path) ?? []
  const problems = publishPackageProblems(packageJson, files, expected.files)
  if (problems.length > 0) {
    process.stderr.write(problems.map(problem => `- ${problem}`).join('\n') + '\n')
    process.exit(1)
  }
  if (!packResult?.filename || !packResult.integrity) throw new Error('npm pack did not report a filename and integrity')
  if (basename(packResult.filename) !== packResult.filename || !/^[a-z0-9][a-z0-9._-]*\.tgz$/i.test(packResult.filename)) {
    throw new Error(`npm pack reported an unsafe filename: ${packResult.filename}`)
  }
  const packedTarball = join(destination, packResult.filename)
  if (!existsSync(packedTarball) || !lstatSync(packedTarball).isFile()) {
    throw new Error(`npm pack did not create a regular file at ${packedTarball}`)
  }
  if (readdirSync(destination).length !== 1) throw new Error('npm pack created unexpected destination entries')

  // Credentialed consumers never interpret an artifact-controlled path. The
  // package name and version remain inside package/package.json in this tarball.
  const filename = 'package.tgz'
  const tarball = join(destination, filename)
  renameSync(packedTarball, tarball)
  const sha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex')
  writeFileSync(join(destination, 'package.sha256'), `${sha256}  ${filename}\n`)
  writeFileSync(join(destination, 'package-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    filename,
    integrity: packResult.integrity,
    sha256,
    files,
  }, null, 2) + '\n')
  process.stdout.write(`publish package verified: ${files.length} exact files; ${filename}; sha256 ${sha256}\n`)
}
