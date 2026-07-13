import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import mermaid from 'mermaid'
import ts from 'typescript'

const ROOT = resolve(import.meta.dir, '..')
const MANIFEST_PATH = join(ROOT, 'docs/project/upstream-mermaid-manifest.json')
const FAMILY_INDEX_PATH = join(ROOT, 'src/upstream-mermaid-family-index.json')
const POLICY_PATH = join(ROOT, 'docs/project/upstream-mermaid-policy.json')
const PACKAGE_ROOT = join(ROOT, 'node_modules/mermaid')
const PACKAGE_JSON_PATH = join(PACKAGE_ROOT, 'package.json')
const CONFIG_TYPES_PATH = join(PACKAGE_ROOT, 'dist/config.type.d.ts')
const THEME_TYPES_PATH = join(PACKAGE_ROOT, 'dist/themes/theme-base.d.ts')
const DOCS_CORPUS_PATH = join(ROOT, 'eval/mermaid-docs-corpus/corpus.json')
const DOCS_SHOWCASE_PATH = join(ROOT, 'eval/mermaid-doc-showcase/manifest.json')
const SUITE_MANIFEST_PATH = join(ROOT, 'eval/mermaid-upstream-suite-bench/manifest.json')
const SUITE_CASES_PATH = join(ROOT, 'eval/mermaid-upstream-suite-bench/cases.json')
const SUITE_EXCLUSIONS_PATH = join(ROOT, 'eval/mermaid-upstream-suite-bench/exclusions.json')
const GANTT_CASES_PATH = join(ROOT, 'eval/mermaid-gantt-bench/cases.json')
const GANTT_EXCLUSIONS_PATH = join(ROOT, 'eval/mermaid-gantt-bench/exclusions.json')
const MINDMAP_GITGRAPH_PATH = join(ROOT, 'eval/mermaid-upstream-suite-bench/mindmap-gitgraph-f3dea583.json')
const OFFICIAL_SYNTAX_ROOT = join(ROOT, 'skills/agentic-mermaid-diagram-workflow/references/upstream')
const CHECK = process.argv.includes('--check')

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

function compareIds(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function filesBelow(path: string): string[] {
  if (!existsSync(path)) return []
  const out: string[] = []
  for (const name of readdirSync(path).sort()) {
    const child = join(path, name)
    const stat = statSync(child)
    if (stat.isDirectory()) out.push(...filesBelow(child))
    else if (stat.isFile()) out.push(child)
  }
  return out
}

function packagePath(path: string): string {
  return relative(PACKAGE_ROOT, path).split(sep).join('/')
}

function surface(id: string, files: string[]): { id: string; files: string[]; sha256: string } {
  const paths = [...new Set(files)].map(packagePath).sort()
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(path).update('\0').update(readFileSync(join(PACKAGE_ROOT, path))).update('\0')
  }
  return { id, files: paths, sha256: hash.digest('hex') }
}

function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function normalizedTypeText(node: ts.TypeNode | undefined, source: ts.SourceFile): string {
  return node ? node.getText(source).replace(/\s+/g, ' ').trim() : 'any'
}

function propertyName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

/** Public dot-paths projected from MermaidConfig and the interfaces it references. */
function configKeyInventory(path: string): Array<{ id: string; type: string; optional: boolean }> {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const interfaces = new Map<string, ts.InterfaceDeclaration>()
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) interfaces.set(statement.name.text, statement)
  }
  const root = interfaces.get('MermaidConfig')
  if (!root) throw new Error('Mermaid config types do not declare MermaidConfig')
  const entries = new Map<string, { id: string; type: string; optional: boolean }>()

  const collectType = (prefix: string, node: ts.TypeNode | undefined, stack: readonly string[]): void => {
    if (!node) return
    if (ts.isTypeLiteralNode(node)) {
      collectMembers(prefix, node.members, stack)
      return
    }
    if (ts.isParenthesizedTypeNode(node)) {
      collectType(prefix, node.type, stack)
      return
    }
    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      for (const child of node.types) collectType(prefix, child, stack)
      return
    }
    if (!ts.isTypeReferenceNode(node)) return
    const reference = node.typeName.getText(source).split('.').at(-1) ?? ''
    if (['Partial', 'Required', 'Readonly'].includes(reference)) {
      collectType(prefix, node.typeArguments?.[0], stack)
      return
    }
    collectInterface(prefix, reference, stack)
  }

  const collectMembers = (prefix: string, members: ts.NodeArray<ts.TypeElement>, stack: readonly string[]): void => {
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !member.name) continue
      const name = propertyName(member.name)
      if (!name) continue
      const id = prefix ? `${prefix}.${name}` : name
      entries.set(id, { id, type: normalizedTypeText(member.type, source), optional: Boolean(member.questionToken) })
      collectType(id, member.type, stack)
    }
  }

  const collectInterface = (prefix: string, name: string, stack: readonly string[]): void => {
    const declaration = interfaces.get(name)
    if (!declaration || stack.includes(name)) return
    const nextStack = [...stack, name]
    for (const heritage of declaration.heritageClauses ?? []) {
      for (const inherited of heritage.types) collectType(prefix, inherited, nextStack)
    }
    collectMembers(prefix, declaration.members, nextStack)
  }

  collectInterface('', 'MermaidConfig', [])
  return [...entries.values()].sort(compareIds)
}

function themeTypeInventory(path: string): Map<string, string> {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const entries = new Map<string, string>()
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== 'Theme') continue
    for (const member of statement.members) {
      if (!ts.isPropertyDeclaration(member) || !member.name) continue
      const name = propertyName(member.name)
      if (name) entries.set(name, normalizedTypeText(member.type, source))
    }
  }
  if (entries.size === 0) throw new Error('Mermaid base theme types do not declare Theme properties')
  return entries
}

function valueKind(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function runtimeValueHash(value: unknown): string {
  if (value === undefined) return sha256('undefined')
  if (typeof value === 'function') return sha256(`function:${value.name}`)
  return sha256(canonicalJson(value as Json))
}

function repoPath(path: string): string {
  return relative(ROOT, path).split(sep).join('/')
}

function packagePathFromAbsolute(path: string): string {
  return relative(PACKAGE_ROOT, path).split(sep).join('/')
}

function lockIntegrity(version: string): string {
  const lock = readFileSync(join(ROOT, 'bun.lock'), 'utf8')
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = lock.match(new RegExp(`"mermaid": \\["mermaid@${escaped}"[^\\n]*"(sha512-[^"]+)"\\]`))
  if (!match) throw new Error(`Cannot find mermaid@${version} integrity in bun.lock`)
  return match[1]!
}

if (!existsSync(PACKAGE_JSON_PATH)) throw new Error('Install dependencies before generating the upstream manifest')
const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8')) as Record<string, any>
const packageJsonBytes = readFileSync(PACKAGE_JSON_PATH)
const packageJson = JSON.parse(packageJsonBytes.toString('utf8')) as Record<string, any>
const version = String(packageJson.version)
if (policy.schemaVersion !== 2) throw new Error('Unsupported upstream policy version')
if (String(policy.pin?.version) !== version) {
  throw new Error(`Installed mermaid@${version} does not match audited policy pin ${String(policy.pin?.version)}`)
}
const commit = String(policy.pin?.commit ?? '')
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error(`Mermaid ${version} policy requires an audited 40-hex upstream commit`)
}

// Derive the actual core inventory from Mermaid's installed detector registry.
// The policy supplies only grouping, labels/maturity, header probes, and our
// support classification. Every detector and header claim is verified here.
mermaid.initialize({ startOnLoad: false })
const registeredDetectorIds = mermaid.getRegisteredDiagramsMetadata().map(item => item.id)
const coreFamilies = (policy.families as any[]).filter(family => family.source === 'core')
const externalFamilies = (policy.families as any[]).filter(family => family.source === 'external-first-party')
const watchRuntimeIds = new Set(['error', 'info', '---'])
const claimedDetectorIds = coreFamilies.flatMap(family => family.upstreamDetectorIds as string[])
const actualPublicDetectorIds = registeredDetectorIds.filter(id => !watchRuntimeIds.has(id))
const sorted = (values: readonly string[]) => [...values].sort().join('\0')
if (sorted(claimedDetectorIds) !== sorted(actualPublicDetectorIds)) {
  const claimed = new Set(claimedDetectorIds)
  const actual = new Set(actualPublicDetectorIds)
  const added = actualPublicDetectorIds.filter(id => !claimed.has(id))
  const removed = claimedDetectorIds.filter(id => !actual.has(id))
  throw new Error(`Upstream detector policy is stale (unassigned: ${added.join(', ') || 'none'}; missing: ${removed.join(', ') || 'none'})`)
}
if (new Set(claimedDetectorIds).size !== claimedDetectorIds.length) throw new Error('Upstream detector policy assigns a detector more than once')
for (const family of coreFamilies) {
  const allowed = new Set<string>(family.upstreamDetectorIds)
  for (const header of family.headers as Array<{ value: string }>) {
    let detected: string
    try { detected = mermaid.detectType(header.value, {}) }
    catch { throw new Error(`Upstream header probe "${header.value}" no longer detects family "${family.id}"`) }
    if (!allowed.has(detected)) throw new Error(`Upstream header probe "${header.value}" detects "${detected}", not "${family.id}"`)
  }
}

const policyFamilies = policy.families as Array<Record<string, any>>
const policyFamilyIds = policyFamilies.map(family => String(family.id))
const officialSyntaxPages = policy.officialSyntaxPages as Record<string, string>
if (!officialSyntaxPages || typeof officialSyntaxPages !== 'object' || Array.isArray(officialSyntaxPages)) {
  throw new Error('Upstream policy must map every family to one official syntax page')
}
if (sorted(Object.keys(officialSyntaxPages)) !== sorted(policyFamilyIds)) {
  throw new Error('Official syntax page policy must account for every upstream family exactly once')
}
const claimedSyntaxPages = Object.values(officialSyntaxPages)
if (new Set(claimedSyntaxPages).size !== claimedSyntaxPages.length) {
  throw new Error('Official syntax page policy assigns a page more than once')
}
const actualSyntaxPages = readdirSync(OFFICIAL_SYNTAX_ROOT)
  .filter(name => name.endsWith('.md') && name !== 'examples.md')
  .sort()
if (sorted(claimedSyntaxPages) !== sorted(actualSyntaxPages)) {
  const claimed = new Set(claimedSyntaxPages)
  const actual = new Set(actualSyntaxPages)
  const unassigned = actualSyntaxPages.filter(path => !claimed.has(path))
  const missing = claimedSyntaxPages.filter(path => !actual.has(path))
  throw new Error(`Official syntax page policy is stale (unassigned: ${unassigned.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})`)
}
for (const [familyId, page] of Object.entries(officialSyntaxPages)) {
  if (basename(page) !== page || !page.endsWith('.md')) throw new Error(`Official syntax page for ${familyId} must be a Markdown basename`)
  if (!existsSync(join(OFFICIAL_SYNTAX_ROOT, page))) throw new Error(`Official syntax page for ${familyId} does not exist: ${page}`)
}
const externalDetectorIds = externalFamilies.flatMap(family => family.upstreamDetectorIds as string[])
if (externalFamilies.length === 0
  || new Set(externalDetectorIds).size !== externalDetectorIds.length
  || externalDetectorIds.some(id => actualPublicDetectorIds.includes(id))) {
  throw new Error('External first-party family policy is empty, duplicated, or overlaps the installed core registry')
}
for (const family of externalFamilies) {
  if (!(family.headers as unknown[])?.length || !officialSyntaxPages[String(family.id)]) {
    throw new Error(`External first-party family ${String(family.id)} lacks a header or official syntax page`)
  }
}

const suiteManifest = readJson(SUITE_MANIFEST_PATH)
const suiteRevision = String(suiteManifest.upstream?.revision ?? '')
const docsShowcase = readJson(DOCS_SHOWCASE_PATH)
const mindmapGitgraph = readJson(MINDMAP_GITGRAPH_PATH)

interface SemanticSourceArtifact {
  id: string
  kind: 'examples' | 'syntax-features' | 'official-doc' | 'accounting' | 'config-schema' | 'theme-schema'
  scope: 'repository' | 'installed-package'
  path: string
  sha256: string
  upstreamRevision?: string
}

function repositoryArtifact(
  id: string,
  kind: SemanticSourceArtifact['kind'],
  path: string,
  upstreamRevision?: string,
): SemanticSourceArtifact {
  const entry: SemanticSourceArtifact = {
    id,
    kind,
    scope: 'repository',
    path: repoPath(path),
    sha256: sha256(readFileSync(path)),
  }
  if (upstreamRevision) entry.upstreamRevision = upstreamRevision
  return entry
}

function packageArtifact(
  id: string,
  kind: SemanticSourceArtifact['kind'],
  path: string,
): SemanticSourceArtifact {
  return {
    id,
    kind,
    scope: 'installed-package',
    path: packagePathFromAbsolute(path),
    sha256: sha256(readFileSync(path)),
    upstreamRevision: commit,
  }
}

interface OfficialSyntaxPage {
  familyId: string
  file: string
  path: string
  markdown: string
  artifactId: string
  url: string
}

interface LifecycleDeclaration {
  status: 'declared'
  version: string
  evidence: 'official-title'
}

interface LifecycleNotDeclared {
  status: 'not-declared'
}

function officialLifecycle(markdown: string): {
  introduction: LifecycleDeclaration | LifecycleNotDeclared
  deprecation: LifecycleDeclaration | LifecycleNotDeclared
} {
  const title = markdown.split(/\r?\n/).find(line => /^#\s+/.test(line)) ?? ''
  const introduction = title.match(/\(v?(\d+\.\d+(?:\.\d+)?)\+\)/i)
  const deprecation = title.match(/deprecated(?:\s+since)?\s+v?(\d+\.\d+(?:\.\d+)?)/i)
  return {
    introduction: introduction
      ? { status: 'declared', version: introduction[1]!, evidence: 'official-title' }
      : { status: 'not-declared' },
    deprecation: deprecation
      ? { status: 'declared', version: deprecation[1]!, evidence: 'official-title' }
      : { status: 'not-declared' },
  }
}

const officialPages: OfficialSyntaxPage[] = policyFamilyIds.map(familyId => {
  const file = officialSyntaxPages[familyId]!
  const path = join(OFFICIAL_SYNTAX_ROOT, file)
  return {
    familyId,
    file,
    path,
    markdown: readFileSync(path, 'utf8'),
    artifactId: `official-doc:${familyId}`,
    url: `https://mermaid.ai/open-source/syntax/${file.replace(/\.md$/, '.html')}`,
  }
})

const manifestFamilies = policyFamilies.map(family => {
  const page = officialPages.find(candidate => candidate.familyId === family.id)!
  return {
    ...family,
    officialSyntaxPage: {
      path: repoPath(page.path),
      url: page.url,
      artifact: page.artifactId,
    },
    lifecycle: officialLifecycle(page.markdown),
  }
})

const sourceArtifacts = [
  repositoryArtifact('docs-corpus', 'examples', DOCS_CORPUS_PATH),
  repositoryArtifact('docs-showcase', 'examples', DOCS_SHOWCASE_PATH, String(docsShowcase.upstreamRevision ?? '')),
  repositoryArtifact('suite-accounting', 'accounting', SUITE_MANIFEST_PATH, suiteRevision),
  repositoryArtifact('suite-cases', 'syntax-features', SUITE_CASES_PATH, suiteRevision),
  repositoryArtifact('suite-exclusions', 'syntax-features', SUITE_EXCLUSIONS_PATH, suiteRevision),
  repositoryArtifact('gantt-cases', 'syntax-features', GANTT_CASES_PATH),
  repositoryArtifact('gantt-exclusions', 'syntax-features', GANTT_EXCLUSIONS_PATH),
  repositoryArtifact('mindmap-gitgraph-blocks', 'syntax-features', MINDMAP_GITGRAPH_PATH, String(mindmapGitgraph.upstream?.commit ?? '')),
  ...officialPages.map(page => repositoryArtifact(page.artifactId, 'official-doc', page.path, commit)),
  packageArtifact('config-types', 'config-schema', CONFIG_TYPES_PATH),
  packageArtifact('theme-types', 'theme-schema', THEME_TYPES_PATH),
].sort(compareIds)

function syntaxFeature(
  artifact: string,
  item: Record<string, any>,
  options: { family?: string; status?: string } = {},
): Record<string, Json> {
  const localId = String(item.id ?? '')
  if (!localId) throw new Error(`Semantic syntax artifact ${artifact} has an entry without an id`)
  const families = (Array.isArray(item.families)
    ? item.families
    : item.family
      ? [item.family]
      : options.family
        ? [options.family]
        : [])
    .map(String)
    .sort()
  if (families.length === 0) throw new Error(`Semantic syntax feature ${artifact}:${localId} has no family`)
  const status = String(options.status ?? item.classification ?? (item.reason ? 'excluded' : 'executable'))
  const entry: Record<string, Json> = {
    id: `${artifact}:${localId}`,
    artifact,
    families,
    status,
    fingerprint: sha256(canonicalJson(item as Json)),
  }
  if (item.reason) entry.reason = String(item.reason)
  if (typeof item.source === 'string') entry.sourceSha256 = sha256(item.source)
  return entry
}

function headingSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || sha256(value).slice(0, 12)
}

function officialSyntaxFeatures(page: OfficialSyntaxPage): Array<Record<string, Json>> {
  const lines = page.markdown.split(/\r?\n/)
  const headings: Array<{ line: number; text: string }> = []
  let inFence = false
  for (let line = 0; line < lines.length; line += 1) {
    if (/^```/.test(lines[line]!)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = lines[line]!.match(/^#{1,6}\s+(.+?)\s*$/)
    if (match) headings.push({ line, text: match[1]! })
  }
  if (headings.length === 0) throw new Error(`Official syntax page ${page.file} has no headings`)
  const slugCounts = new Map<string, number>()
  return headings.map((heading, index) => {
    const baseSlug = headingSlug(heading.text)
    const occurrence = (slugCounts.get(baseSlug) ?? 0) + 1
    slugCounts.set(baseSlug, occurrence)
    const slug = occurrence === 1 ? baseSlug : `${baseSlug}-${occurrence}`
    const section = lines.slice(heading.line, headings[index + 1]?.line ?? lines.length).join('\n').trim()
    return {
      id: `${page.artifactId}:section:${slug}`,
      artifact: page.artifactId,
      families: [page.familyId],
      status: 'documented',
      fingerprint: sha256(section),
      sourceSha256: sha256(section),
    }
  })
}

const syntaxFeatureCandidates = [
  ...(readJson(SUITE_CASES_PATH) as Record<string, any>[]).map(item => syntaxFeature('suite-cases', item)),
  ...(readJson(SUITE_EXCLUSIONS_PATH) as Record<string, any>[]).map(item => syntaxFeature('suite-exclusions', item, { status: 'excluded' })),
  ...(readJson(GANTT_CASES_PATH) as Record<string, any>[]).map(item => syntaxFeature('gantt-cases', item, { family: 'gantt' })),
  ...(readJson(GANTT_EXCLUSIONS_PATH) as Record<string, any>[]).map(item => syntaxFeature('gantt-exclusions', item, { family: 'gantt', status: 'divergence' })),
  ...(mindmapGitgraph.blocks as Record<string, any>[]).map(item => syntaxFeature('mindmap-gitgraph-blocks', item)),
  ...officialPages.flatMap(officialSyntaxFeatures),
]
const syntaxFeatureGroups = new Map<string, Map<string, Record<string, Json>>>()
for (const feature of syntaxFeatureCandidates) {
  const id = String(feature.id)
  const canonical = canonicalJson(feature as Json)
  const group = syntaxFeatureGroups.get(id) ?? new Map<string, Record<string, Json>>()
  group.set(canonical, feature)
  syntaxFeatureGroups.set(id, group)
}
const syntaxFeatures = [...syntaxFeatureGroups.entries()].flatMap(([baseId, variants]) => {
  const entries = [...variants.values()]
  if (entries.length === 1) return entries
  return entries.map(entry => ({ ...entry, id: `${baseId}#${String(entry.fingerprint).slice(0, 12)}` }))
}).sort((a, b) => compareIds({ id: String(a.id) }, { id: String(b.id) }))

interface ExampleEntry {
  id: string
  family: string
  origin: string
  index: number
  sourceSha256: string
  artifacts: string[]
  officialDocs?: string
}

const examplesById = new Map<string, ExampleEntry>()
function addExamples(artifact: string, values: readonly Record<string, any>[]): void {
  for (const value of values) {
    const family = String(value.family ?? '')
    const origin = String(value.origin ?? '')
    const index = Number(value.index)
    const source = String(value.source ?? '')
    if (!family || !origin || !Number.isInteger(index) || !source) throw new Error(`Example artifact ${artifact} has an invalid entry`)
    const sourceSha256 = sha256(source)
    if (value.sourceSha256 && value.sourceSha256 !== sourceSha256) throw new Error(`Example ${family}:${origin}#${index} has a stale sourceSha256`)
    const id = `${family}:${origin}#${index}`
    const existing = examplesById.get(id)
    if (existing) {
      if (existing.sourceSha256 !== sourceSha256) throw new Error(`Example ${id} has conflicting source across artifacts`)
      existing.artifacts = [...new Set([...existing.artifacts, artifact])].sort()
      if (value.officialDocs) existing.officialDocs = String(value.officialDocs)
      continue
    }
    const entry: ExampleEntry = { id, family, origin, index, sourceSha256, artifacts: [artifact] }
    if (value.officialDocs) entry.officialDocs = String(value.officialDocs)
    examplesById.set(id, entry)
  }
}

function officialExamples(page: OfficialSyntaxPage): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  const seenSources = new Set<string>()
  const fence = /^```mermaid(?:-example)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```[^\S\r\n]*$/gm
  for (const match of page.markdown.matchAll(fence)) {
    const source = match[1]!.trim()
    if (!source) continue
    const sourceHash = sha256(source)
    if (seenSources.has(sourceHash)) continue
    seenSources.add(sourceHash)
    out.push({
      family: page.familyId,
      origin: `official-syntax/${page.file}`,
      index: out.length,
      source,
      sourceSha256: sourceHash,
      officialDocs: page.url,
    })
  }
  if (out.length === 0) throw new Error(`Official syntax page ${page.file} has no Mermaid examples`)
  return out
}
addExamples('docs-corpus', readJson(DOCS_CORPUS_PATH))
addExamples('docs-showcase', docsShowcase.cases)
for (const page of officialPages) addExamples(page.artifactId, officialExamples(page))
const examples = [...examplesById.values()].sort(compareIds)

const configKeys = configKeyInventory(CONFIG_TYPES_PATH)
const themeTypes = themeTypeInventory(THEME_TYPES_PATH)
const resolvedThemeVariables = mermaid.mermaidAPI.getConfig().themeVariables as Record<string, unknown>
const themeVariables = Object.keys(resolvedThemeVariables)
  .filter(id => typeof resolvedThemeVariables[id] !== 'function')
  .sort()
  .map(id => ({
    id,
    type: themeTypes.get(id) ?? valueKind(resolvedThemeVariables[id]),
    defaultSha256: runtimeValueHash(resolvedThemeVariables[id]),
  }))

if (syntaxFeatures.length === 0 || examples.length === 0 || configKeys.length === 0 || themeVariables.length === 0) {
  throw new Error('Semantic upstream inventory is unexpectedly empty')
}

const diagramFiles = filesBelow(join(PACKAGE_ROOT, 'dist/diagrams')).filter(path => path.endsWith('.d.ts'))
const surfaces = [
  surface('detectors', [
    join(PACKAGE_ROOT, 'dist/diagram-api/detectType.d.ts'),
    join(PACKAGE_ROOT, 'dist/diagram-api/diagram-orchestration.d.ts'),
    ...diagramFiles.filter(path => /detector/i.test(path)),
  ]),
  surface('configuration', [
    join(PACKAGE_ROOT, 'dist/config.d.ts'),
    join(PACKAGE_ROOT, 'dist/config.type.d.ts'),
    join(PACKAGE_ROOT, 'dist/defaultConfig.d.ts'),
  ]),
  surface('themes', filesBelow(join(PACKAGE_ROOT, 'dist/themes')).filter(path => path.endsWith('.d.ts') && !path.includes('.spec.'))),
  surface('grammar', diagramFiles.filter(path => /(?:parser|\.jison|db\.d\.ts$|types\.d\.ts$)/i.test(path))),
]
for (const item of surfaces) if (item.files.length === 0) throw new Error(`Upstream surface "${item.id}" has no installed inputs`)

const manifest: Record<string, any> = {
  schemaVersion: 4,
  provenance: {
    package: 'mermaid',
    version,
    repository: 'mermaid-js/mermaid',
    tag: `mermaid@${version}`,
    commit,
    npmIntegrity: lockIntegrity(version),
    packageJsonSha256: sha256(packageJsonBytes),
    inventorySha256: '',
    inputs: policy.pin.inputs,
  },
  families: manifestFamilies,
  watchEntries: policy.watchEntries,
  surfaces,
  semanticInventory: {
    sourceArtifacts,
    syntaxFeatures,
    examples,
    configKeys,
    themeVariables,
  },
}
manifest.provenance.inventorySha256 = sha256(canonicalJson({
  schemaVersion: manifest.schemaVersion,
  families: manifest.families,
  watchEntries: manifest.watchEntries,
  surfaces: manifest.surfaces,
  semanticInventory: manifest.semanticInventory,
} as Json))

const generated = `${JSON.stringify(manifest, null, 2)}\n`
const familyIndex = {
  schemaVersion: 1,
  provenance: {
    version: manifest.provenance.version,
    commit: manifest.provenance.commit,
    inventorySha256: manifest.provenance.inventorySha256,
  },
  families: manifest.families,
}
const generatedFamilyIndex = `${JSON.stringify(familyIndex, null, 2)}\n`
const current = readFileSync(MANIFEST_PATH, 'utf8')
if (CHECK) {
  const currentFamilyIndex = readFileSync(FAMILY_INDEX_PATH, 'utf8')
  if (current !== generated || currentFamilyIndex !== generatedFamilyIndex) {
    console.error('upstream Mermaid manifest artifacts are stale; run bun run upstream-manifest')
    process.exit(1)
  }
} else {
  writeFileSync(MANIFEST_PATH, generated)
  writeFileSync(FAMILY_INDEX_PATH, generatedFamilyIndex)
}
