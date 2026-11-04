#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodeXML } from 'entities'
import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
} from 'node:zlib'
import {
  BROWSER_BUILTIN_FAMILY_IDS,
  type BrowserBuiltinFamilyId,
} from '../../src/browser-lazy/generated/catalog.ts'

/** XML descendants partition shaping runs; they do not insert visible spaces.
 * Strip markup before decoding so authored tag-like characters remain text. */
function displayedTexts(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map(match => decodeXML(match[1]!.replace(/<[^>]+>/g, '')))
}

interface ImportRecord { path: string; kind: string }
interface OutputRecord {
  entryPoint?: string
  imports: ImportRecord[]
  inputs: Record<string, { bytesInOutput: number }>
}
interface Metafile {
  inputs: Record<string, unknown>
  outputs: Record<string, OutputRecord>
}
interface TransferSize { raw: number; gzip: number; brotli: number }
interface TransferBudget extends TransferSize { requests: number }
interface Budgets {
  schemaVersion: 1
  initial: TransferBudget
  families: Record<BrowserBuiltinFamilyId, TransferBudget>
}

// --root measures another checkout's build (the PR payload delta measures the
// base branch with this script); --measure-only skips this checkout's
// structural assertions and budgets and only reports transfer sizes.
// --session pie,radar reports incremental closure transfer in the requested order.
const rootFlag = process.argv.indexOf('--root')
const ROOT = rootFlag >= 0 ? resolve(process.argv[rootFlag + 1]!) : join(import.meta.dir, '../..')
const MEASURE_ONLY = process.argv.includes('--measure-only')
const META_PATH = join(ROOT, 'dist/metafile-esm.json')
const BUDGET_PATH = join(import.meta.dir, 'browser-lazy-budgets.json')
const metafile = JSON.parse(readFileSync(META_PATH, 'utf8')) as Metafile
const budgets = JSON.parse(readFileSync(BUDGET_PATH, 'utf8')) as Budgets
const outputNames = Object.keys(metafile.outputs)

function requireOne(values: string[], label: string): string {
  if (values.length !== 1) throw new Error(`${label}: expected one output, found ${values.length}`)
  return values[0]!
}

function staticClosure(entries: readonly string[]): string[] {
  const seen = new Set<string>()
  const visit = (path: string) => {
    if (seen.has(path)) return
    const output = metafile.outputs[path]
    if (!output) throw new Error(`Metafile references missing output: ${path}`)
    seen.add(path)
    for (const imported of output.imports) {
      if (imported.kind !== 'dynamic-import') visit(imported.path)
    }
  }
  for (const entry of entries) visit(entry)
  return [...seen].sort()
}

const compressed = new Map<string, TransferSize>()
function fileSize(path: string): TransferSize {
  const existing = compressed.get(path)
  if (existing) return existing
  const bytes = readFileSync(join(ROOT, path))
  const size = {
    raw: bytes.byteLength,
    gzip: gzipSync(bytes, { level: 9 }).byteLength,
    brotli: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY },
    }).byteLength,
  }
  compressed.set(path, size)
  return size
}

function transferSize(files: readonly string[]): TransferSize {
  return files.reduce<TransferSize>((total, path) => {
    const size = fileSize(path)
    return {
      raw: total.raw + size.raw,
      gzip: total.gzip + size.gzip,
      brotli: total.brotli + size.brotli,
    }
  }, { raw: 0, gzip: 0, brotli: 0 })
}

const entry = requireOne(
  outputNames.filter(path => metafile.outputs[path]!.entryPoint === 'src/browser-lazy.ts'),
  'async browser entry',
)
const dynamicImports = metafile.outputs[entry]!.imports
  .filter(imported => imported.kind === 'dynamic-import')
  .map(imported => imported.path)
const renderCore = requireOne(
  dynamicImports.filter(path => /\/render-core-[A-Z0-9]+\.js$/.test(path)),
  'shared render core',
)
const MEASURED_FAMILY_IDS = MEASURE_ONLY
  ? BROWSER_BUILTIN_FAMILY_IDS.filter(id => dynamicImports.some(path => new RegExp(`/${id}-[A-Z0-9]+\\.js$`).test(path)))
  : BROWSER_BUILTIN_FAMILY_IDS
const familyOutputs = Object.fromEntries(MEASURED_FAMILY_IDS.map(id => [id, requireOne(
  dynamicImports.filter(path => new RegExp(`/${id}-[A-Z0-9]+\\.js$`).test(path)),
  `${id} loader`,
)])) as Record<BrowserBuiltinFamilyId, string>

if (!MEASURE_ONLY && dynamicImports.length !== BROWSER_BUILTIN_FAMILY_IDS.length + 1) {
  throw new Error(`Async entry has ${dynamicImports.length} dynamic imports; expected one core plus ${BROWSER_BUILTIN_FAMILY_IDS.length} families`)
}

const forbiddenInputs = Object.keys(metafile.inputs).filter(path =>
  /(?:^|\/)(?:ascii\/|png(?:-|\/|\.ts)|browser-png\.ts|agent\/families-builtin\.ts|agent\/family-layouts\.ts|agent\/verify\.ts|agent\/mutate\.ts|agent\/[^/]+-body\.ts)/.test(path)
  || path.includes('@resvg/'))
if (forbiddenInputs.length > 0) {
  throw new Error(`SVG-only browser graph contains forbidden capabilities:\n${forbiddenInputs.join('\n')}`)
}

const elkOutputs = outputNames.filter(path =>
  Object.keys(metafile.outputs[path]!.inputs).some(input => input.includes('node_modules/elkjs/')))
const elkOutput = requireOne(elkOutputs, 'ELK implementation chunk')
const elkLoaders = outputNames.filter(path =>
  Object.keys(metafile.outputs[path]!.inputs).some(input => input.endsWith('/elk-constructor.lazy.ts')))
if (!MEASURE_ONLY && elkLoaders.length !== 1) throw new Error('ELK must have one on-demand constructor')
const initialFiles = staticClosure([entry])
const staticFamilyFiles = Object.fromEntries(MEASURED_FAMILY_IDS.map(id => [
  id,
  staticClosure([entry, renderCore, familyOutputs[id]]),
])) as Record<BrowserBuiltinFamilyId, string[]>
const agenticOutputs = outputNames.filter(path =>
  Object.keys(metafile.outputs[path]!.inputs).some(input => input.endsWith('/layout/agentic-layered-core.ts')))
const agenticLoaders = outputNames.filter(path =>
  Object.keys(metafile.outputs[path]!.inputs).some(input => input.endsWith('/layout/agentic-layered.lazy.ts')))
if (!MEASURE_ONLY && (agenticOutputs.length !== 1 || agenticLoaders.length !== 1)) throw new Error('Agentic must have one on-demand implementation and loader')
if (!MEASURE_ONLY && agenticOutputs.some(output => initialFiles.includes(output) || BROWSER_BUILTIN_FAMILY_IDS.some(id => staticFamilyFiles[id].includes(output)))) {
  throw new Error('Agentic implementation must load only when selected')
}
const forestOutputs = outputNames.filter(path => metafile.outputs[path]!.entryPoint === 'src/layout/forest-implementation.ts')
if (!MEASURE_ONLY && forestOutputs.length !== 1) throw new Error('Forest must have one shared on-demand implementation')
if (!MEASURE_ONLY && forestOutputs.some(output => initialFiles.includes(output) || MEASURED_FAMILY_IDS.some(id => staticFamilyFiles[id].includes(output)))) {
  throw new Error('Forest implementation must stay out of the initial and family static closures')
}
const agenticFamilyFiles = Object.fromEntries(MEASURED_FAMILY_IDS.map(id => [id,
  agenticLoaders.some(loader => staticFamilyFiles[id].includes(loader))
    ? staticClosure([entry, renderCore, familyOutputs[id], ...agenticOutputs, ...forestOutputs]) : undefined,
]))
const implicitForestFiles = MEASURED_FAMILY_IDS.includes('flowchart') ? staticClosure([entry, renderCore, familyOutputs.flowchart, ...forestOutputs]) : undefined
const implicitForestFallbackFiles = implicitForestFiles ? staticClosure([...implicitForestFiles, elkOutput]) : undefined
const elkFiles = staticClosure([elkOutput])
const observedElkFamilies = MEASURED_FAMILY_IDS.filter(id => staticFamilyFiles[id].includes(elkOutput)
  || elkLoaders.some(loader => staticFamilyFiles[id].includes(loader)))
// Preserve the existing default-render payload contract: ELK consumers still
// pay for ELK when it is selected. Also report the static/native closure so
// demand loading cannot masquerade as a smaller default ELK render.
const familyFiles = Object.fromEntries(MEASURED_FAMILY_IDS.map(id => [id,
  staticClosure([entry, renderCore, familyOutputs[id], ...(observedElkFamilies.includes(id) ? [elkOutput] : [])]),
])) as Record<BrowserBuiltinFamilyId, string[]>
const yamlOutputs = outputNames.filter(path =>
  Object.keys(metafile.outputs[path]!.inputs).some(input => input.includes('node_modules/yaml/')))
if (yamlOutputs.length === 0) throw new Error('YAML parser has no emitted implementation')
const yamlRuntimeOutputs = outputNames.filter(path =>
  Object.hasOwn(metafile.outputs[path]!.inputs, 'src/shared/mermaid-yaml-runtime.ts'))
// Baseline measurement also accepts the older eager package edge. New builds
// start at the actual provider so a separate wrapper chunk cannot be omitted.
const yamlProviderOutputs = yamlRuntimeOutputs.length ? yamlRuntimeOutputs : yamlOutputs
const yamlFiles = staticClosure(yamlProviderOutputs)
if (yamlOutputs.some(path => !yamlFiles.includes(path))) throw new Error('YAML provider closure omits part of its parser')

// A family can still demand ELK after its initial static download. Preserve
// that transfer in the existing ceilings, deriving consumers from the emitted
// constructor seam rather than maintaining a second family roster. The older
// non-lazy constructor also identifies consumers when measuring a baseline.
const elkConstructorOutputs = outputNames.filter(path =>
  Object.keys(metafile.outputs[path]!.inputs).some(input => /^src\/elk-constructor(?:\.lazy)?\.ts$/.test(input)))
if (elkConstructorOutputs.length === 0) throw new Error('ELK implementation has no emitted constructor seam')
const elkFamilies = MEASURED_FAMILY_IDS.filter(id =>
  elkConstructorOutputs.some(path => staticFamilyFiles[id].includes(path)))
const budgetedFamilyFiles = Object.fromEntries(MEASURED_FAMILY_IDS.map(id => [
  id,
  staticClosure([...staticFamilyFiles[id], ...yamlFiles, ...(elkFamilies.includes(id) ? elkFiles : [])]),
])) as Record<BrowserBuiltinFamilyId, string[]>
if (!MEASURE_ONLY) {
  if (yamlRuntimeOutputs.length !== 1) throw new Error('YAML must have one demand-loaded provider')
  if ([...yamlRuntimeOutputs, ...yamlOutputs].some(path => initialFiles.includes(path)
    || BROWSER_BUILTIN_FAMILY_IDS.some(id => familyFiles[id].includes(path)))) {
    throw new Error('YAML must load only on demand, never with the initial download or a family')
  }
  if (initialFiles.includes(elkOutput) || BROWSER_BUILTIN_FAMILY_IDS.some(id => staticFamilyFiles[id].includes(elkOutput))) {
    throw new Error('ELK must load only when selected, never in the initial or family static closure')
  }
  // The complete HTML5 named-reference table (~23 KB gzip) is fetched on
  // demand (shared/html-entity-table.lazy.ts), only for a diagram that uses a
  // named code beyond XML's five. Keep it out of the initial download and out
  // of every family's static transfer closure.
  const htmlEntityOutputs = outputNames.filter(path =>
    Object.keys(metafile.outputs[path]!.inputs).some(input =>
      input.includes('entities/dist/') && input.endsWith('/generated/decode-data-html.js')))
  if (htmlEntityOutputs.length !== 1 || initialFiles.includes(htmlEntityOutputs[0]!)
    || BROWSER_BUILTIN_FAMILY_IDS.some(id => familyFiles[id].includes(htmlEntityOutputs[0]!))) {
    throw new Error('HTML5 named-reference table must load only on demand, never with the initial download or a family')
  }
  // Source-level tests do not exercise the build-only CJS alias or the lazy
  // table swap. Execute the emitted ESM entry so a broken on-demand decoder
  // fails this mandatory build gate.
  const { renderMermaidSVGAsync } = await import(pathToFileURL(join(ROOT, 'dist/browser-lazy/index.js')).href)
  // The first render demands YAML, named entities and cyclic placement. It
  // proves all three dependency awaits complete under the bounded replay.
  const wrapped = await renderMermaidSVGAsync('---\ntitle: YAML demand\n---\nflowchart LR\n  A["x#hearts;y"] --> B\n  B --> A', { security: 'strict' })
  if (!displayedTexts(wrapped).includes('YAML demand') || !displayedTexts(wrapped).includes('x♥y')) {
    throw new Error('Built lazy rendering failed combined YAML/entity/placement demand')
  }
  for (const [family, source] of [
    ['flowchart', 'flowchart LR\n  A["x#hearts;y"] --> B'],
    ['er', 'erDiagram\n  A ||--o{ B : "x#hearts;y"'],
  ] as const) {
    if (!displayedTexts(await renderMermaidSVGAsync(source)).includes('x♥y')) {
      throw new Error(`Built ${family} lazy decoder failed HTML5 named reference #hearts;`)
    }
  }
  for (const [name, displayed] of [['NotEqualTilde', '≂̸'], ['notit', '¬it;']] as const) {
    const svg = await renderMermaidSVGAsync(`pie\n  "A#${name};B" : 1\n`)
    if (!displayedTexts(svg).includes(`A${displayed}B (100.0%)`)) {
      throw new Error(`Built Pie lazy decoder failed HTML5 named reference #${name};`)
    }
  }

  if (initialFiles.includes(elkOutput) || MEASURED_FAMILY_IDS.some(id => staticFamilyFiles[id].includes(elkOutput))) {
    throw new Error(`ELK must load only when placement demands it, never in a family static closure: ${observedElkFamilies.join(', ')}`)
  }
}

const sessionFlag = process.argv.indexOf('--session')
const session = sessionFlag < 0 ? undefined : (() => {
  const ids = process.argv[sessionFlag + 1]?.split(',') ?? []
  if (!ids.length || ids.some(id => !MEASURED_FAMILY_IDS.includes(id as BrowserBuiltinFamilyId))) throw new Error('--session requires comma-separated built-in family IDs present in this build')
  const fetched = new Set(initialFiles)
  const stages = ids.map(id => {
    const added = familyFiles[id as BrowserBuiltinFamilyId].filter(file => !fetched.has(file))
    for (const file of added) fetched.add(file)
    return { family: id, incremental: { requests: added.length, ...transferSize(added) }, cumulative: { requests: fetched.size, ...transferSize([...fetched]) } }
  })
  return { families: ids, scope: 'selected family closures; additional YAML/HTML entity demands and actual network scheduling are separate', stages }
})()

const report = {
  ...(session ? { session } : {}),
  schemaVersion: 1 as const,
  compression: 'sum of each fetched file; gzip level 9; Brotli quality 11',
  familyClosure: 'selected ELK transfer; static excludes on-demand providers; YAML and HTML entity downloads remain explicit',
  budgetedFamilyClosure: 'static imports plus complete YAML transfer for frontmatter/directives and ELK transfer for families that can demand its constructor',
  yamlChunks: yamlProviderOutputs,
  yamlTransfer: transferSize(yamlFiles),
  familyCost: 'selected ELK includes its solver; nativeSolver includes the shared forest implementation; omitted-layout Flowchart indexed forest and its ELK fallback union are reported and budgeted separately; static excludes on-demand dependencies; HTML5 tables remain additional',
  ...(implicitForestFiles && implicitForestFallbackFiles ? { omittedLayoutFlowchart: { indexedForest: { requests: implicitForestFiles.length, ...transferSize(implicitForestFiles) }, indexedForestThenElk: { requests: implicitForestFallbackFiles.length, ...transferSize(implicitForestFallbackFiles) } } } : {}),
  elkChunk: elkOutput,
  elkTransfer: transferSize(elkFiles),
  initial: { requests: initialFiles.length, ...transferSize(initialFiles) },
  budgetedFamilies: Object.fromEntries(MEASURED_FAMILY_IDS.map(id => [id, {
    requests: budgetedFamilyFiles[id].length, elk: budgetedFamilyFiles[id].includes(elkOutput), ...transferSize(budgetedFamilyFiles[id]),
  }])) as Record<BrowserBuiltinFamilyId, TransferSize & { requests: number; elk: boolean }>,
  families: Object.fromEntries(MEASURED_FAMILY_IDS.map(id => [id, {
    requests: familyFiles[id].length,
    elk: familyFiles[id].includes(elkOutput),
    ...transferSize(familyFiles[id]),
    static: { requests: staticFamilyFiles[id].length, ...transferSize(staticFamilyFiles[id]) },
    ...(agenticFamilyFiles[id] ? { nativeSolver: { requests: agenticFamilyFiles[id]!.length, ...transferSize(agenticFamilyFiles[id]!) } } : {}),
  }])) as Record<BrowserBuiltinFamilyId, TransferSize & { requests: number; elk: boolean; static: TransferSize & { requests: number }; nativeSolver?: TransferSize & { requests: number } }>,
}

const problems: string[] = []
function checkBudget(label: string, actual: TransferSize & { requests: number }, budget: TransferBudget) {
  if (actual.requests > budget.requests) {
    problems.push(`${label} requests: ${actual.requests} > ${budget.requests}`)
  }
  for (const encoding of ['raw', 'gzip', 'brotli'] as const) {
    if (actual[encoding] > budget[encoding]) {
      problems.push(`${label} ${encoding}: ${actual[encoding]} > ${budget[encoding]}`)
    }
  }
}
if (!MEASURE_ONLY) {
  checkBudget('initial', report.initial, budgets.initial)
  for (const id of BROWSER_BUILTIN_FAMILY_IDS) checkBudget(id, report.budgetedFamilies[id], budgets.families[id])
  if (report.omittedLayoutFlowchart) {
    const forestBudget = staticClosure([...implicitForestFiles!, ...yamlFiles])
    checkBudget('flowchart omitted-layout forest plus YAML', { requests: forestBudget.length, ...transferSize(forestBudget) }, budgets.families.flowchart)
    const fallbackBudget = staticClosure([...implicitForestFallbackFiles!, ...yamlFiles])
    checkBudget('flowchart omitted-layout forest then ELK plus YAML', { requests: fallbackBudget.length, ...transferSize(fallbackBudget) }, budgets.families.flowchart)
  }
}
if (problems.length > 0) throw new Error(`Async browser size budgets exceeded:\n${problems.join('\n')}`)

if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write(`browser lazy build verified: ${report.initial.gzip} B initial gzip; `
    + `${observedElkFamilies.length} families budget the shared on-demand ELK transfer; `
    + `${MEASURED_FAMILY_IDS.length - observedElkFamilies.length} family graphs exclude it\n`)
}
