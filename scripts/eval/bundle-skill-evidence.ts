import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { contentTreeDigest, stableDigest } from './prepare-skill-evidence.ts'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function filesUnder(path: string): string[] {
  const info = lstatSync(path)
  if (info.isSymbolicLink()) throw new Error(`evidence bundle contains a symbolic link: ${path}`)
  if (info.isFile()) return [path]
  if (!info.isDirectory()) throw new Error(`evidence bundle contains a non-file entry: ${path}`)
  return readdirSync(path, { withFileTypes: true })
    .flatMap(entry => {
      const child = join(path, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`evidence bundle contains a symbolic link: ${child}`)
      if (!entry.isDirectory() && !entry.isFile()) throw new Error(`evidence bundle contains a non-file entry: ${child}`)
      return entry.isDirectory() ? filesUnder(child) : [child]
    })
    .sort()
}

function fileDigest(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

export function evidencePayloadManifest(root: string): { contentDigest: string; files: Array<{ path: string; digest: string; bytes: number }> } {
  const files = filesUnder(root)
    .filter(path => basename(path) !== 'bundle-manifest.json')
    .map(path => ({
      path: relative(root, path),
      digest: fileDigest(path),
      bytes: statSync(path).size,
    }))
  const hash = createHash('sha256')
  for (const file of files) hash.update(file.path).update('\0').update(file.digest).update('\0').update(String(file.bytes)).update('\0')
  return { contentDigest: `sha256:${hash.digest('hex')}`, files }
}

export function verifyEvidenceBundle(root: string): { contentDigest: string; files: Array<{ path: string; digest: string; bytes: number }> } {
  const resolvedRoot = resolve(root)
  const manifestPath = join(resolvedRoot, 'bundle-manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`missing evidence bundle manifest: ${manifestPath}`)
  const declared = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    schemaVersion?: number
    contentDigest?: string
    files?: Array<{ path: string; digest: string; bytes: number }>
  }
  if (declared.schemaVersion !== 1 || typeof declared.contentDigest !== 'string' || !Array.isArray(declared.files)) {
    throw new Error(`invalid evidence bundle manifest: ${manifestPath}`)
  }
  const actual = evidencePayloadManifest(resolvedRoot)
  if (actual.contentDigest !== declared.contentDigest || JSON.stringify(actual.files) !== JSON.stringify(declared.files)) {
    throw new Error(`evidence bundle payload does not match ${manifestPath}`)
  }
  const archivedPath = (archiveRoot: string, child: string, label: string): string => {
    const path = resolve(archiveRoot, child)
    const contained = relative(archiveRoot, path)
    if (!contained || contained === '..' || contained.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(contained)) {
      throw new Error(`${label} escapes archived input root: ${child}`)
    }
    return path
  }
  for (const name of ['baseline', 'candidate'] as const) {
    const armRoot = join(resolvedRoot, name)
    const receipt = JSON.parse(readFileSync(join(armRoot, 'preparation.json'), 'utf8')) as {
      workspaceRoot: string
      workspaceDigest: string
      fixtureRoot: string
      fixtureDigest: string
      treatmentRoot: string
      treatmentPaths: string[]
      treatmentDigest: string
      preparedTasksDigest: string
    }
    const tasks = readFileSync(join(armRoot, 'tasks.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { input_files?: string[] })
    if (stableDigest(tasks) !== receipt.preparedTasksDigest) throw new Error(`${name} bundled tasks do not match preparation receipt`)
    const archivedWorkspace = join(resolvedRoot, 'inputs/workspace')
    if (contentTreeDigest([archivedWorkspace], archivedWorkspace, new Set(['.git'])) !== receipt.workspaceDigest) {
      throw new Error(`${name} bundled workspace does not match preparation receipt`)
    }
    const archivedFixtures = join(resolvedRoot, 'inputs/fixtures')
    const fixturePaths = [...new Set(tasks.flatMap(task => task.input_files ?? []))].map(path => {
      const child = relative(receipt.fixtureRoot, resolve(path))
      if (!child || child === '..' || child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(child)) {
        throw new Error(`${name} task fixture escapes preparation root: ${path}`)
      }
      return archivedPath(archivedFixtures, child, `${name} task fixture`)
    })
    if (contentTreeDigest(fixturePaths, archivedFixtures) !== receipt.fixtureDigest) {
      throw new Error(`${name} bundled fixtures do not match preparation receipt`)
    }
    const archivedTreatment = join(resolvedRoot, `inputs/${name}-treatment`)
    const treatmentPaths = receipt.treatmentPaths.map(path => archivedPath(archivedTreatment, path, `${name} treatment path`))
    if (contentTreeDigest(treatmentPaths, archivedTreatment) !== receipt.treatmentDigest) {
      throw new Error(`${name} bundled treatment does not match preparation receipt`)
    }
  }
  return actual
}

export function bundleSkillEvidence(inputs: { baseline: string; candidate: string; comparison: string; runnerManifest: string; sourceTasks: string; cohort: string; baselineTreatment: string; candidateTreatment: string; workspace: string; fixtures: string; outRoot: string }): string {
  const outRoot = resolve(inputs.outRoot)
  mkdirSync(outRoot, { recursive: true })
  const stage = mkdtempSync(join(outRoot, '.evidence-stage-'))
  try {
    cpSync(resolve(inputs.baseline), join(stage, 'baseline'), { recursive: true })
    cpSync(resolve(inputs.candidate), join(stage, 'candidate'), { recursive: true })
    cpSync(resolve(inputs.comparison), join(stage, 'comparison.json'))
    cpSync(resolve(inputs.runnerManifest), join(stage, 'runner-manifest.json'))
    cpSync(resolve(inputs.sourceTasks), join(stage, 'source-tasks.jsonl'))
    cpSync(resolve(inputs.cohort), join(stage, 'cohort.json'))
    cpSync(resolve(inputs.baselineTreatment), join(stage, 'inputs/baseline-treatment'), { recursive: true })
    cpSync(resolve(inputs.candidateTreatment), join(stage, 'inputs/candidate-treatment'), { recursive: true })
    cpSync(resolve(inputs.workspace), join(stage, 'inputs/workspace'), { recursive: true })
    cpSync(resolve(inputs.fixtures), join(stage, 'inputs/fixtures'), { recursive: true })
    const payload = evidencePayloadManifest(stage)
    const id = payload.contentDigest.slice('sha256:'.length)
    const target = join(outRoot, id)
    if (existsSync(target)) throw new Error(`evidence bundle already exists: ${target}`)
    writeFileSync(join(stage, 'bundle-manifest.json'), `${JSON.stringify({ schemaVersion: 1, ...payload }, null, 2)}\n`)
    renameSync(stage, target)
    return target
  } catch (error) {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.main) {
  const verify = option('--verify')
  if (verify) {
    const verified = verifyEvidenceBundle(verify)
    console.log(`Verified evidence bundle ${resolve(verify)} (${verified.contentDigest}, ${verified.files.length} files)`)
    process.exit(0)
  }
  const baseline = option('--baseline')
  const candidate = option('--candidate')
  const comparison = option('--comparison')
  const runnerManifest = option('--runner-manifest')
  const sourceTasks = option('--source-tasks')
  const cohort = option('--cohort')
  const baselineTreatment = option('--baseline-treatment')
  const candidateTreatment = option('--candidate-treatment')
  const workspace = option('--workspace')
  const fixtures = option('--fixtures')
  const outRoot = option('--out-root')
  if (!baseline || !candidate || !comparison || !runnerManifest || !sourceTasks || !cohort || !baselineTreatment || !candidateTreatment || !workspace || !fixtures || !outRoot) {
    throw new Error('usage: bundle-skill-evidence.ts --verify DIR | --baseline DIR --candidate DIR --comparison FILE --runner-manifest FILE --source-tasks FILE --cohort FILE --baseline-treatment DIR --candidate-treatment DIR --workspace DIR --fixtures DIR --out-root DIR')
  }
  const target = bundleSkillEvidence({ baseline, candidate, comparison, runnerManifest, sourceTasks, cohort, baselineTreatment, candidateTreatment, workspace, fixtures, outRoot })
  console.log(`Wrote content-addressed evidence bundle ${target}`)
}
