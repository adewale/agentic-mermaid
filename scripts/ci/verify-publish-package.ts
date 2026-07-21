#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

interface PackFile { path: string }
interface PackResult { files?: PackFile[] }
interface PackageJson {
  exports?: Record<string, string | Record<string, string>>
  bin?: Record<string, string>
}

const REQUIRED_PACKAGE_FILES = [
  'package.json',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'LICENSES/Apache-2.0.txt',
  'server.json',
] as const

export function publishPackageProblems(packageJson: PackageJson, files: readonly string[]): string[] {
  const present = new Set(files)
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
  for (const path of files) {
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
  const packed = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
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
  const files = result[0]?.files?.map(file => file.path) ?? []
  const problems = publishPackageProblems(packageJson, files)
  if (problems.length > 0) {
    process.stderr.write(problems.map(problem => `- ${problem}`).join('\n') + '\n')
    process.exit(1)
  }
  process.stdout.write(`publish package verified: ${files.length} files; exports, bins, legal, and registry metadata present\n`)
}
