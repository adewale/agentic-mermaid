import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { maintainedMarkdownFiles } from './docs/maintained-docs.ts'

export interface ReleasePreparation { version: string; date?: string }
type RunGenerator = (script: string) => void

function versionParts(version: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Version must be a stable major.minor.patch')
  const parts = version.split('.').map(Number)
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('Version components exceed the safe integer range')
  return parts
}

function compareVersions(a: string, b: string): number {
  const left = versionParts(a), right = versionParts(b)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! > right[i]! ? 1 : -1
  return 0
}

export function parseReleasePreparation(args: readonly string[]): ReleasePreparation {
  const [version, ...rest] = args
  if (!version || rest.length !== 0 && (rest.length !== 2 || rest[0] !== '--date' || !rest[1])) {
    throw new Error('Usage: bun run release:prepare VERSION [--date YYYY-MM-DD]')
  }
  versionParts(version)
  return { version, ...(rest[1] ? { date: rest[1] } : {}) }
}

function prepareChangelog(text: string, options: ReleasePreparation): string {
  const { version, date } = options
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
    throw new Error('Date must be a valid YYYY-MM-DD calendar date')
  }
  const unreleased = /^## Unreleased\r?\n/gm
  const heading = unreleased.exec(text)
  if (!heading || unreleased.exec(text)) throw new Error('CHANGELOG.md must have exactly one Unreleased section')
  const start = heading.index + heading[0].length
  const body = text.slice(start)
  const next = /^## /m.exec(body)
  const notes = body.slice(0, next?.index ?? body.length).trim()
  const tail = next ? body.slice(next.index) : ''
  const latest = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/m.exec(tail)
  if (latest && compareVersions(version, latest[1]!) <= 0) {
    if (version === latest[1] && !notes && (!date || date === latest[2])) return text
    throw new Error('Prepare a version newer than the latest changelog release')
  }
  if (!date) return text
  if (!notes) throw new Error('Unreleased must contain release notes before adding a date')
  return `${text.slice(0, start)}\n## ${version} — ${date}\n\n${notes}\n\n${tail}`
}

function generatedFiles(root: string): string[] {
  const directory = 'src/browser-lazy/generated'
  const visit = (relative: string): string[] => existsSync(join(root, relative))
    ? readdirSync(join(root, relative), { withFileTypes: true }).flatMap(entry => {
      const path = `${relative}/${entry.name}`
      return entry.isDirectory() ? visit(path) : entry.isFile() ? [path] : []
    }) : []
  return visit(directory)
}

/** Update existing projections and invoke their generators. The caller keeps
 * its prior edits if validation or generation fails. No publication or Git
 * mutation belongs to this preparation boundary. */
export function prepareRelease(root: string, options: ReleasePreparation, generate?: RunGenerator): string[] {
  root = resolve(root)
  versionParts(options.version)
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  const pkg = JSON.parse(read('package.json'))
  if (compareVersions(options.version, pkg.version) < 0) throw new Error('Release preparation cannot downgrade the source version')
  const server = JSON.parse(read('server.json'))
  if (!Array.isArray(server.packages) || !server.packages[0]) throw new Error('server.json has no package version projection')
  const source = read('src/version.ts')
  const versionDeclaration = /export const PACKAGE_VERSION = (['"])[^'"\n]+\1/g
  if ([...source.matchAll(versionDeclaration)].length !== 1) throw new Error('src/version.ts must declare PACKAGE_VERSION once')
  const changelog = prepareChangelog(read('CHANGELOG.md'), options)
  const edits = new Map([
    ['package.json', `${JSON.stringify({ ...pkg, version: options.version }, null, 2)}\n`],
    ['server.json', `${JSON.stringify({ ...server, version: options.version, packages: server.packages.map((entry: object, index: number) => index === 0 ? { ...entry, version: options.version } : entry) }, null, 2)}\n`],
    ['src/version.ts', source.replace(versionDeclaration, `export const PACKAGE_VERSION = '${options.version}'`)],
    ['CHANGELOG.md', changelog],
  ])
  const paths = new Set([...edits.keys(), ...maintainedMarkdownFiles(root), ...generatedFiles(root), 'src/cli/agent-instructions.ts'])
  const before = new Map([...paths].map(path => [path, existsSync(join(root, path)) ? read(path) : undefined]))
  const write = (path: string, value: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), value)
  }
  try {
    for (const [path, value] of edits) if (before.get(path) !== value) write(path, value)
    const run = generate ?? (script => execFileSync(process.execPath, ['run', script], { cwd: root, stdio: 'inherit' }))
    for (const script of ['generate:browser-families', 'doc-blocks', 'agent-doc-artifacts']) run(script)
  } catch (error) {
    for (const path of generatedFiles(root)) if (!before.has(path)) rmSync(join(root, path))
    for (const [path, value] of before) {
      if (value === undefined) rmSync(join(root, path), { force: true })
      else if (!existsSync(join(root, path)) || read(path) !== value) write(path, value)
    }
    throw error
  }
  return [...new Set([...paths, ...generatedFiles(root)])]
    .filter(path => (existsSync(join(root, path)) ? read(path) : undefined) !== before.get(path)).sort()
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === '--help') {
      console.log('bun run release:prepare VERSION [--date YYYY-MM-DD]\nWithout --date, notes remain Unreleased. Preparation never publishes.')
    } else {
      const paths = prepareRelease(resolve(import.meta.dir, '..'), parseReleasePreparation(args))
      console.log(paths.length ? `Prepared source; review these paths with git diff:\n${paths.join('\n')}` : 'Release preparation is already current.')
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
