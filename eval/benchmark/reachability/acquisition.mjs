// Verify frozen archives, extracted bytes and the shared host-active runtime graph.
// This inspects inputs without installing packages or importing renderer code.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const options = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  if (!['--candidate', '--baseline', '--candidate-sha', '--baseline-sha', '--lock', '--out'].includes(key) || !value || value.startsWith('--') || options.has(key)) throw Error(`Invalid option ${key}`)
  options.set(key, value)
}
for (const key of ['--candidate', '--baseline', '--candidate-sha', '--baseline-sha', '--lock', '--out']) {
  if (!options.has(key)) throw Error(`Provide ${key}`)
}
const candidateSha = options.get('--candidate-sha')
const baselineSha = options.get('--baseline-sha')
for (const sha of [candidateSha, baselineSha]) if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Source identities must be full Git SHAs')
const lockPath = resolve(options.get('--lock'))
const outPath = resolve(options.get('--out'))
if (existsSync(outPath)) throw Error(`Refusing to overwrite frozen receipt ${outPath}`)
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const same = (a, b, message) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(message) }
function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw Error(`${binary} failed (${result.status}): ${result.stderr || result.error?.message}`)
  return result.stdout.trim()
}
// bun.lock is JSON with trailing commas. Change punctuation only outside strings.
function parseLock(text) {
  let result = '', quoted = false, escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      result += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') quoted = false
    } else if (ch === '"') { quoted = true; result += ch }
    else if (ch === ',' && /^[\s]*[}\]]/.test(text.slice(i + 1))) continue
    else result += ch
  }
  return JSON.parse(result)
}
const lockBytes = readFileSync(lockPath), lock = parseLock(lockBytes.toString('utf8'))
function listFiles(root, excludeNodeModules = false) {
  const files = []
  function visit(directory, relative = '') {
    for (const name of readdirSync(directory).sort()) {
      if (excludeNodeModules && name === 'node_modules') continue
      const path = join(directory, name), rel = relative ? `${relative}/${name}` : name
      const stat = lstatSync(path)
      if (stat.isDirectory()) visit(path, rel)
      else if (stat.isFile()) files.push(rel)
      else throw Error(`Unexpected non-regular file: ${path}`)
    }
  }
  visit(root)
  return files.sort()
}
function inventory(root, files) {
  return files.map(path => { const bytes = readFileSync(join(root, path)); return { path, bytes: bytes.length, sha256: sha256(bytes) } })
}
function verifyArtifact(directory, sourceRevision) {
  const archive = join(directory, 'package.tgz'), root = join(directory, 'package')
  const bytes = readFileSync(archive)
  const digest = sha256(bytes), integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const names = run('tar', ['-tzf', archive]).split('\n')
  for (const name of names) if (!name.startsWith('package/') || name.split('/').some(part => part === '..') || name.includes('\\')) throw Error(`Unsafe archive member ${name}`)
  const archivedFiles = names.filter(name => !name.endsWith('/')).map(name => name.slice('package/'.length)).sort()
  const manifestFiles = archivedFiles
  same(listFiles(root, true), manifestFiles, `${directory}: extracted/manifest file-set mismatch`)
  const scratch = mkdtempSync(join(tmpdir(), 'am-acquisition-'))
  let fileInventory
  try {
    run('tar', ['-xzf', archive, '-C', scratch])
    same(listFiles(join(scratch, 'package')), manifestFiles, `${directory}: independent extraction mismatch`)
    fileInventory = inventory(root, manifestFiles)
    same(fileInventory, inventory(join(scratch, 'package'), manifestFiles), `${directory}: extracted bytes differ from archive`)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
  return { sourceRevision, root, archive: { path: archive, bytes: bytes.length, sha256: digest, integrity }, verifiedFileCount: fileInventory.length, files: fileInventory, package: json(join(root, 'package.json')) }
}
function packageRoot(from, name) {
  let current = from
  while (true) {
    const path = join(current, 'node_modules', name, 'package.json')
    if (existsSync(path)) return realpathSync(dirname(path))
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}
function platformAllows(values, actual) {
  if (!values) return true
  const list = Array.isArray(values) ? values : [values]
  if (list.includes(`!${actual}`)) return false
  const positive = list.filter(value => !value.startsWith('!'))
  return !positive.length || positive.includes(actual)
}
function runtimeGraph(artifact) {
  const nodes = new Map(), edges = [], skippedOptional = []
  const rootDependencies = artifact.package.dependencies ?? {}
  same(rootDependencies, lock.workspaces[''].dependencies, 'Artifact roots differ from frozen lock workspace dependencies')
  const visit = (fromRoot, fromId, name, requested, optional = false) => {
    const actualRoot = packageRoot(fromRoot, name)
    if (!actualRoot) {
      if (optional) {
        const matches = Object.entries(lock.packages).filter(([, value]) => value[0].startsWith(`${name}@`))
        if (matches.length !== 1) throw Error(`Cannot classify missing optional dependency ${name}`)
        const metadata = matches[0][1][2]
        if (platformAllows(metadata.os, process.platform) && platformAllows(metadata.cpu, process.arch)) throw Error(`Host-active optional dependency missing: ${name}`)
        skippedOptional.push({ from: fromId, name, requested, reason: 'not applicable to this host', os: metadata.os, cpu: metadata.cpu })
        return
      }
      throw Error(`Missing required dependency ${name} from ${fromRoot}`)
    }
    const pkg = json(join(actualRoot, 'package.json'))
    if (pkg.name !== name) throw Error(`Resolved wrong package for ${name}`)
    const id = `${name}@${pkg.version}`
    const matches = Object.entries(lock.packages).filter(([, value]) => value[0] === id)
    const integrities = [...new Set(matches.map(([, value]) => value.at(-1)))]
    if (!matches.length || integrities.length !== 1 || !/^sha512-/.test(integrities[0])) throw Error(`Missing or ambiguous lock integrity for ${id}`)
    if (!platformAllows(pkg.os, process.platform) || !platformAllows(pkg.cpu, process.arch)) throw Error(`Incompatible installed package ${id}`)
    edges.push({ from: fromId, name, requested, optional, to: id, resolvedPath: actualRoot })
    if (nodes.has(id)) {
      if (nodes.get(id).resolvedPath !== actualRoot) throw Error(`Multiple installed copies of ${id}; inspect before comparing`)
      return
    }
    const files = inventory(actualRoot, listFiles(actualRoot, true))
    nodes.set(id, { id, name, version: pkg.version, resolvedPath: actualRoot, integrity: integrities[0], integritySource: 'frozen bun.lock metadata; registry archive not re-downloaded', lockKeys: matches.map(([key]) => key).sort(), installedFileCount: files.length, installedBytes: files.reduce((total, file) => total + file.bytes, 0), installedFileInventorySha256: sha256(JSON.stringify(files)) })
    for (const [dependency, range] of Object.entries(pkg.dependencies ?? {})) visit(actualRoot, id, dependency, range)
    for (const [dependency, range] of Object.entries(pkg.optionalDependencies ?? {})) visit(actualRoot, id, dependency, range, true)
  }
  for (const [name, range] of Object.entries(rootDependencies)) visit(artifact.root, 'agentic-mermaid', name, range)
  return { rootDependencies, nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: edges.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), skippedOptional: skippedOptional.sort((a, b) => a.name.localeCompare(b.name)), peerDependencies: 'No runtime-closure peer dependencies are auto-installed by this inspection; none are declared by the enrolled packages.' }
}
const startedAt = new Date().toISOString()
const candidate = verifyArtifact(resolve(options.get('--candidate')), candidateSha)
const baseline = verifyArtifact(resolve(options.get('--baseline')), baselineSha)
const candidateGraph = runtimeGraph(candidate), baselineGraph = runtimeGraph(baseline)
same(candidateGraph, baselineGraph, 'Candidate/baseline runtime dependency graph differs')
const nativeResvg = candidateGraph.nodes.find(node => node.name.startsWith(`@resvg/resvg-js-${process.platform}-${process.arch}`))
if (!nativeResvg) throw Error('Host-active resvg native package was not enrolled')
for (const artifact of [candidate, baseline]) delete artifact.package
const report = {
  schemaVersion: 1, status: 'passed', startedAt, finishedAt: new Date().toISOString(),
  policy: 'Original verified archives retained; all extracted package file bytes equal independently extracted archive bytes. Both package roots resolve the same frozen host-active runtime dependency closure through shared node_modules. This is offline inspected acquisition, not a separate fresh npm install or registry-tarball integrity recomputation.',
  environment: { node: process.versions.node, executable: process.execPath, platform: process.platform, arch: process.arch, bun: run('bun', ['--version']), npm: run('npm', ['--version']) },
  lock: { path: lockPath, sha256: sha256(lockBytes), lockfileVersion: lock.lockfileVersion },
  candidate, baseline, dependencyGraphIdentical: true, candidateGraph, baselineGraph, hostActiveResvg: nativeResvg,
  limits: ['Full installed dependency bytes are bound by per-package inventories; sha512 integrity values are declared by the frozen lock, not independently recomputed from original dependency archives.', 'Optional packages for other operating systems or architectures are excluded explicitly.', 'Acquisition is independent of performance and rendering correctness qualification.'],
}
mkdirSync(dirname(outPath), { recursive: true })
if (existsSync(outPath)) throw Error(`Refusing to overwrite frozen receipt ${outPath}`)
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ status: report.status, out: outPath, candidateFiles: candidate.verifiedFileCount, baselineFiles: baseline.verifiedFileCount, dependencyNodes: candidateGraph.nodes.length, dependencyEdges: candidateGraph.edges.length, node: report.environment.node, bun: report.environment.bun, npm: report.environment.npm, hostActiveResvg: nativeResvg.id }))
