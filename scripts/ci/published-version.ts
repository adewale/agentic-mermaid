#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

interface PackResult {
  filename?: string
}

export interface PublishedVersionIdentity {
  name: string
  version: string
  localTreeHash: string
  publishedTreeHash: string | null
}

/**
 * npm versions are immutable. A version already on the registry is safe only
 * when its extracted package tree is identical (the idempotent retry case).
 */
export function publishedVersionProblem(identity: PublishedVersionIdentity): string | null {
  if (identity.publishedTreeHash === null || identity.publishedTreeHash === identity.localTreeHash) return null
  return `${identity.name}@${identity.version} is already published with different package contents; bump the package version before merging`
}

function missingRegistryVersion(output: string): boolean {
  return /(?:E404|404 Not Found|No match found for version|is not in this registry)/i.test(output)
}

function pack(root: string, destination: string, spec?: string): string {
  mkdirSync(destination, { recursive: true })
  const args = ['pack', ...(spec ? [spec] : []), '--ignore-scripts', '--json', '--pack-destination', destination]
  const packed = spawnSync('npm', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout || `npm pack exited ${packed.status}`)
  let result: PackResult[]
  try {
    result = JSON.parse(packed.stdout) as PackResult[]
  } catch {
    throw new Error(`npm pack returned invalid JSON:\n${packed.stdout}`)
  }
  const filename = result[0]?.filename
  if (typeof filename !== 'string' || basename(filename) !== filename || !filename.endsWith('.tgz')) {
    throw new Error(`npm pack reported an unsafe filename: ${String(filename)}`)
  }
  return join(destination, filename)
}

function extractPackage(tarball: string, destination: string): string {
  mkdirSync(destination, { recursive: true })
  const extracted = spawnSync('tar', ['-xf', tarball, '-C', destination], { encoding: 'utf8' })
  if (extracted.status !== 0) throw new Error(extracted.stderr || extracted.stdout || `tar exited ${extracted.status}`)
  const packageRoot = join(destination, 'package')
  if (!lstatSync(packageRoot).isDirectory()) throw new Error(`npm tarball has no package directory: ${tarball}`)
  return packageRoot
}

/** Canonical content identity independent of npm/tar implementation details. */
function packageTreeHash(root: string): string {
  const hash = createHash('sha256')
  const update = (value: string | Buffer): void => {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value
    hash.update(String(bytes.length)).update(':').update(bytes)
  }
  const visit = (directory: string, prefix = ''): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry)
      const relative = prefix ? `${prefix}/${entry}` : entry
      const stat = lstatSync(path)
      if (stat.isDirectory()) {
        update(`directory:${relative}`)
        visit(path, relative)
      } else if (stat.isFile()) {
        update(`file:${relative}:executable=${stat.mode & 0o111 ? 'yes' : 'no'}`)
        update(readFileSync(path))
      } else if (stat.isSymbolicLink()) {
        update(`symlink:${relative}`)
        update(readlinkSync(path))
      } else {
        throw new Error(`Unsupported package entry type: ${relative}`)
      }
    }
  }
  visit(root)
  return hash.digest('hex')
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..', '..')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string }
  const viewed = spawnSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
  const registryOutput = `${viewed.stdout}\n${viewed.stderr}`.trim()
  if (viewed.status !== 0) {
    if (missingRegistryVersion(registryOutput)) {
      process.stdout.write(`ok   ${pkg.name}@${pkg.version} is not published yet\n`)
      process.exit(0)
    }
    throw new Error(`Could not prove whether ${pkg.name}@${pkg.version} is already published:\n${registryOutput}`)
  }
  const publishedVersion = JSON.parse(viewed.stdout) as unknown
  if (publishedVersion !== pkg.version) {
    throw new Error(`npm view returned an invalid version for ${pkg.name}@${pkg.version}: ${viewed.stdout}`)
  }

  const destination = mkdtempSync(join(tmpdir(), 'agentic-mermaid-published-version-'))
  try {
    const localTarball = pack(root, join(destination, 'local-pack'))
    const publishedTarball = pack(root, join(destination, 'published-pack'), `${pkg.name}@${pkg.version}`)
    const localTreeHash = packageTreeHash(extractPackage(localTarball, join(destination, 'local-tree')))
    const publishedTreeHash = packageTreeHash(extractPackage(publishedTarball, join(destination, 'published-tree')))
    const problem = publishedVersionProblem({ ...pkg, localTreeHash, publishedTreeHash })
    if (problem) throw new Error(problem)
    process.stdout.write(`ok   ${pkg.name}@${pkg.version} is already published with byte-identical package contents (${localTreeHash})\n`)
  } finally {
    rmSync(destination, { recursive: true, force: true })
  }
}
