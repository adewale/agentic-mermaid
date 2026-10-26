import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

type Manifest = Record<string, unknown>
type DependencyKind = 'dependency' | 'optional' | 'peer'
interface FileIdentity {
  path: string
  kind: 'file' | 'symlink-file' | 'symlink-directory'
  sha256?: string
  bytes?: number
  target?: string
  resolvedTarget?: string
  cycleTo?: string
}
interface DependencyNode {
  realRoot: string
  logicalRoots: string[]
  name: string | null
  version: string | null
  manifest: Manifest
  files: FileIdentity[]
}
interface DependencyEdge {
  from: string
  name: string
  kind: DependencyKind
  requested: string
  optional: boolean
  resolution: { logicalRoot: string; realRoot: string; search: 'realpath' | 'logical' } | null
}
export interface InstalledDependencyClosure {
  schemaVersion: 1
  root: { logicalRoot: string; realRoot: string; name: string | null; version: string | null }
  nodes: DependencyNode[]
  edges: DependencyEdge[]
}
const ordered = <T>(items: T[], key: (item: T) => string) => items.sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0))
const within = (directory: string, path: string) => {
  const name = relative(directory, path)
  return !name || (!name.startsWith('..' + sep) && name !== '..' && !isAbsolute(name))
}
function readManifest(root: string): Manifest {
  const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw Error(`Invalid installed package manifest: ${root}`)
  return manifest as Manifest
}
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
function declarations(manifest: Manifest): { name: string; kind: DependencyKind; requested: string; optional: boolean }[] {
  const entries = (key: string) => {
    const value = manifest[key] ?? {}
    // Legacy npm packages (for example Jison's underscore dependency) published
    // empty arrays. They declare no edges; preserve the original manifest.
    if (Array.isArray(value) && value.length === 0) return {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`Invalid ${key} in installed package manifest`)
    const result = value as Record<string, unknown>
    for (const [name, range] of Object.entries(result)) {
      if (!/^(?:@[^/\\\s.][^/\\\s]*\/)?[^/\\\s.][^/\\\s]*$/.test(name) || name === '..' || typeof range !== 'string') throw Error(`Invalid installed dependency declaration: ${name}`)
    }
    return result as Record<string, string>
  }
  const dependencies = entries('dependencies'),
    optional = entries('optionalDependencies'),
    peers = entries('peerDependencies'),
    result: ReturnType<typeof declarations> = []
  for (const name of [...new Set([...Object.keys(dependencies), ...Object.keys(optional)])].sort()) {
    const isOptional = Object.hasOwn(optional, name)
    result.push({ name, kind: isOptional ? 'optional' : 'dependency', requested: (isOptional ? optional[name] : dependencies[name])!, optional: isOptional })
  }
  const metadata = manifest.peerDependenciesMeta as Record<string, { optional?: boolean }> | undefined
  for (const name of Object.keys(peers).sort()) result.push({ name, kind: 'peer', requested: peers[name]!, optional: metadata?.[name]?.optional === true })
  return result
}
function findInstalledPackage(logicalRoot: string, realRoot: string, name: string): DependencyEdge['resolution'] {
  const searched = new Set<string>()
  for (const [start, search] of [
    [realRoot, 'realpath'],
    [logicalRoot, 'logical'],
  ] as const) {
    let directory = start
    for (;;) {
      // Node skips an extra node_modules level while ascending package directories.
      if (directory.split(sep).at(-1) !== 'node_modules') {
        const candidate = join(directory, 'node_modules', name)
        if (!searched.has(candidate)) {
          searched.add(candidate)
          if (existsSync(candidate)) {
            if (!statSync(candidate).isDirectory()) throw Error(`Installed dependency is not a package directory: ${candidate}`)
            return { logicalRoot: candidate, realRoot: realpathSync(candidate), search }
          }
        }
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  return null
}

/** Capture installed dependency bytes, not a lockfile's unverified declarations.
 * The candidate itself contributes graph edges only; its source is never hashed. */
export function captureInstalledDependencyClosure(packageRoot: string): InstalledDependencyClosure {
  const logicalRoot = resolve(packageRoot),
    realRoot = realpathSync(logicalRoot),
    rootManifest = readManifest(realRoot)
  const nodes = new Map<string, DependencyNode>(),
    edges: DependencyEdge[] = [],
    pending = [{ logicalRoot, realRoot, manifest: rootManifest }],
    visited = new Set<string>()
  const rootOwned = (path: string) => within(realRoot, path) && !within(join(realRoot, 'node_modules'), path)
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index]!
    if (visited.has(current.realRoot)) continue
    visited.add(current.realRoot)
    for (const declaration of declarations(current.manifest)) {
      const resolution = findInstalledPackage(current.logicalRoot, current.realRoot, declaration.name)
      if (!resolution && declaration.kind === 'dependency') throw Error(`Missing required installed dependency ${declaration.name} from ${current.realRoot}`)
      edges.push({ from: current.realRoot, ...declaration, resolution })
      if (!resolution || resolution.realRoot === realRoot) continue
      if (rootOwned(resolution.realRoot) || within(resolution.realRoot, realRoot)) throw Error(`Dependency points at candidate-owned source: ${resolution.realRoot}`)
      const known = nodes.get(resolution.realRoot)
      if (known) {
        if (!known.logicalRoots.includes(resolution.logicalRoot)) known.logicalRoots.push(resolution.logicalRoot)
        continue
      }
      const manifest = readManifest(resolution.realRoot)
      nodes.set(resolution.realRoot, { realRoot: resolution.realRoot, logicalRoots: [resolution.logicalRoot], name: text(manifest.name), version: text(manifest.version), manifest, files: [] })
      pending.push({ ...resolution, manifest })
    }
  }
  const admitted = [...nodes.keys()]
  for (const node of nodes.values()) {
    const walk = (directory: string, prefix: string, ancestors: Map<string, string>) => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const path = join(directory, entry.name),
          name = prefix ? prefix + '/' + entry.name : entry.name,
          stat = lstatSync(path)
        if (stat.isSymbolicLink()) {
          const target = readlinkSync(path),
            resolvedTarget = realpathSync(path)
          const admittedTarget = admitted.some(
            root =>
              within(root, resolvedTarget) &&
              !relative(root, resolvedTarget)
                .split(sep)
                .some(part => part === 'node_modules' || part === '.git'),
          )
          if (rootOwned(resolvedTarget) || !admittedTarget) throw Error(`Dependency symlink leaves admitted fetched packages: ${path}`)
          if (statSync(path).isDirectory()) {
            const cycleTo = ancestors.get(resolvedTarget)
            node.files.push({ path: name, kind: 'symlink-directory', target, resolvedTarget, ...(cycleTo !== undefined ? { cycleTo } : {}) })
            if (cycleTo === undefined) walk(resolvedTarget, name, new Map([...ancestors, [resolvedTarget, name]]))
          } else if (statSync(path).isFile()) {
            const bytes = readFileSync(path)
            node.files.push({ path: name, kind: 'symlink-file', target, resolvedTarget, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength })
          } else throw Error(`Unsupported dependency symlink target: ${path}`)
        } else if (stat.isDirectory()) {
          walk(path, name, new Map([...ancestors, [realpathSync(path), name]]))
        } else if (stat.isFile()) {
          const bytes = readFileSync(path)
          node.files.push({ path: name, kind: 'file', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength })
        } else throw Error(`Unsupported installed package file: ${path}`)
      }
    }
    walk(node.realRoot, '', new Map([[node.realRoot, '']]))
    node.logicalRoots.sort()
    ordered(node.files, file => file.path)
  }
  return { schemaVersion: 1, root: { logicalRoot, realRoot, name: text(rootManifest.name), version: text(rootManifest.version) }, nodes: ordered([...nodes.values()], node => node.realRoot), edges: ordered(edges, edge => `${edge.from}\0${edge.name}\0${edge.kind}`) }
}
