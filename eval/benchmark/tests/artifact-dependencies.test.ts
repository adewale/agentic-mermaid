import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureInstalledDependencyClosure } from '../portable/artifact-dependencies.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'installed-dependency-closure-')))
  roots.push(directory)
  const root = join(directory, 'candidate')
  const install = (path: string, name: string, fields: Record<string, unknown> = {}) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...fields }))
    writeFileSync(join(path, 'index.js'), 'export const value=1\n')
    return path
  }
  return { directory, root, install }
}
describe('actual installed dependency closure', () => {
  test.each(['dependencies', 'optionalDependencies', 'peerDependencies'])('retains empty legacy %s arrays as no edges but rejects nonempty arrays', field => {
    const f = fixture()
    f.install(f.root, 'candidate', { dependencies: { legacy: '*' } })
    const legacy = f.install(join(f.root, 'node_modules/legacy'), 'legacy', { [field]: [] })
    const admitted = captureInstalledDependencyClosure(f.root)
    expect(admitted.nodes).toHaveLength(1)
    expect(admitted.edges.map(edge => edge.name)).toEqual(['legacy'])
    expect(admitted.nodes[0]?.manifest[field]).toEqual([])
    f.install(legacy, 'legacy', { [field]: ['unbound-dependency'] })
    expect(() => captureInstalledDependencyClosure(f.root)).toThrow(`Invalid ${field}`)
  })

  test('captures same-version implementation changes without relying on a lockfile or hashing the candidate', () => {
    const f = fixture()
    f.install(f.root, 'candidate', { dependencies: { peer: '^1.0.0' } })
    const dependency = f.install(join(f.root, 'node_modules/peer'), 'peer')
    const first = captureInstalledDependencyClosure(f.root)
    expect(first.nodes).toHaveLength(1)
    expect(first.nodes[0]?.files.map(file => file.path)).toEqual(['index.js', 'package.json'])
    writeFileSync(join(f.root, 'index.js'), 'export const candidateChanged=true\n')
    expect(captureInstalledDependencyClosure(f.root)).toEqual(first)
    writeFileSync(join(dependency, 'index.js'), 'export const value=2\n')
    const second = captureInstalledDependencyClosure(f.root)
    expect(second.nodes[0]?.version).toBe('1.0.0')
    expect(second.nodes[0]?.files.find(file => file.path === 'index.js')?.sha256).not.toBe(first.nodes[0]?.files.find(file => file.path === 'index.js')?.sha256)
    expect(JSON.stringify(second)).not.toContain('candidateChanged')
  })
  test('resolves symlinked packages and their actual nested dependencies and file targets', () => {
    const f = fixture()
    f.install(f.root, 'candidate', { dependencies: { linked: '*' } })
    const external = f.install(join(f.directory, 'fetched-linked'), 'linked', { dependencies: { nested: '*' } })
    f.install(join(external, 'node_modules/nested'), 'nested', { version: '2.0.0' })
    f.install(join(f.root, 'node_modules/nested'), 'nested', { version: '9.0.0' })
    symlinkSync(external, join(f.root, 'node_modules/linked'))
    symlinkSync('index.js', join(external, 'entry.js'))
    const result = captureInstalledDependencyClosure(f.root)
    expect(result.nodes.map(node => node.version).sort()).toEqual(['1.0.0', '2.0.0'])
    expect(result.nodes.find(node => node.name === 'linked')?.logicalRoots).toEqual([join(f.root, 'node_modules/linked')])
    const alias = result.nodes.find(node => node.name === 'linked')?.files.find(file => file.path === 'entry.js')
    expect(alias?.kind).toBe('symlink-file')
    expect(alias?.target).toBe('index.js')
    expect(alias?.resolvedTarget).toBe(join(external, 'index.js'))
    expect(alias?.sha256).toBe(result.nodes.find(node => node.name === 'linked')?.files.find(file => file.path === 'index.js')?.sha256)
  })
  test('terminates dependency cycles and excludes nested node_modules and Git storage from file scans', () => {
    const f = fixture()
    f.install(f.root, 'candidate', { dependencies: { a: '*' } })
    const a = f.install(join(f.root, 'node_modules/a'), 'a', { dependencies: { b: '*' } })
    f.install(join(f.root, 'node_modules/b'), 'b', { dependencies: { a: '*' } })
    mkdirSync(join(a, '.git'))
    writeFileSync(join(a, '.git/private'), 'not runtime bytes')
    f.install(join(a, 'node_modules/unused'), 'unused')
    const result = captureInstalledDependencyClosure(f.root)
    expect(result.nodes).toHaveLength(2)
    expect(result.edges.map(edge => edge.name)).toEqual(['a', 'b', 'a'])
    expect(result.nodes.flatMap(node => node.files).some(file => file.path.startsWith('.git/') || file.path.startsWith('node_modules/'))).toBe(false)
    expect(captureInstalledDependencyClosure(f.root)).toEqual(result)
  })
  test('records missing optional and peer packages and invalidates when an optional package appears', () => {
    const f = fixture()
    f.install(f.root, 'candidate', { optionalDependencies: { optional: '*' }, peerDependencies: { peer: '*' }, peerDependenciesMeta: { peer: { optional: true } } })
    const first = captureInstalledDependencyClosure(f.root)
    expect(first.edges.map(edge => [edge.name, edge.kind, edge.resolution])).toEqual([
      ['optional', 'optional', null],
      ['peer', 'peer', null],
    ])
    f.install(join(f.root, 'node_modules/optional'), 'optional')
    const second = captureInstalledDependencyClosure(f.root)
    expect(second.nodes).toHaveLength(1)
    expect(second).not.toEqual(first)
  })
  test('captures linked directories without following cycles or aliases into Git storage', () => {
    const f = fixture()
    f.install(f.root, 'candidate', { dependencies: { peer: '*' } })
    const peer = f.install(join(f.root, 'node_modules/peer'), 'peer')
    mkdirSync(join(peer, 'lib'))
    writeFileSync(join(peer, 'lib/entry.js'), 'export const value=1\n')
    symlinkSync('lib', join(peer, 'dist'))
    symlinkSync('..', join(peer, 'lib/back'))
    const first = captureInstalledDependencyClosure(f.root)
    expect(first.nodes[0]?.files.find(file => file.path === 'dist/entry.js')?.sha256).toBe(first.nodes[0]?.files.find(file => file.path === 'lib/entry.js')?.sha256)
    expect(first.nodes[0]?.files.find(file => file.path === 'dist/back')?.cycleTo).toBe('')
    mkdirSync(join(peer, '.git'))
    writeFileSync(join(peer, '.git/HEAD'), 'do not fingerprint Git storage')
    symlinkSync('.git', join(peer, 'metadata'))
    expect(() => captureInstalledDependencyClosure(f.root)).toThrow('leaves admitted fetched packages')
  })
  test('fails closed for a missing required package and prevents dependency paths from hashing candidate source', () => {
    const f = fixture()
    f.install(f.root, 'candidate', { dependencies: { missing: '*' } })
    expect(() => captureInstalledDependencyClosure(f.root)).toThrow('Missing required installed dependency')
    const source = f.install(join(f.root, 'src/local'), 'missing')
    mkdirSync(join(f.root, 'node_modules'))
    symlinkSync(source, join(f.root, 'node_modules/missing'))
    expect(() => captureInstalledDependencyClosure(f.root)).toThrow('candidate-owned source')
  })
  test('rejects a dependency file symlink into candidate-owned source', () => {
    const f = fixture()
    f.install(f.root, 'candidate', { dependencies: { peer: '*' } })
    const peer = f.install(join(f.root, 'node_modules/peer'), 'peer')
    symlinkSync(join(f.root, 'index.js'), join(peer, 'candidate.js'))
    expect(() => captureInstalledDependencyClosure(f.root)).toThrow('leaves admitted fetched packages')
    expect(readFileSync(join(f.root, 'index.js'), 'utf8')).toBe('export const value=1\n')
  })
})
