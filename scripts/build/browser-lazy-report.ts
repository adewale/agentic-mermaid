#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
} from 'node:zlib'
import {
  BROWSER_BUILTIN_FAMILY_IDS,
  type BrowserBuiltinFamilyId,
} from '../../src/browser-lazy/generated/catalog.ts'

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
  elkFamilies: BrowserBuiltinFamilyId[]
  initial: TransferBudget
  families: Record<BrowserBuiltinFamilyId, TransferBudget>
}

const ROOT = join(import.meta.dir, '../..')
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
const familyOutputs = Object.fromEntries(BROWSER_BUILTIN_FAMILY_IDS.map(id => [id, requireOne(
  dynamicImports.filter(path => new RegExp(`/${id}-[A-Z0-9]+\\.js$`).test(path)),
  `${id} loader`,
)])) as Record<BrowserBuiltinFamilyId, string>

if (dynamicImports.length !== BROWSER_BUILTIN_FAMILY_IDS.length + 1) {
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
const initialFiles = staticClosure([entry])
const familyFiles = Object.fromEntries(BROWSER_BUILTIN_FAMILY_IDS.map(id => [
  id,
  staticClosure([entry, renderCore, familyOutputs[id]]),
])) as Record<BrowserBuiltinFamilyId, string[]>

const observedElkFamilies = BROWSER_BUILTIN_FAMILY_IDS.filter(id => familyFiles[id].includes(elkOutput))
if (JSON.stringify(observedElkFamilies) !== JSON.stringify(budgets.elkFamilies)) {
  throw new Error(`ELK family graph drifted: expected ${budgets.elkFamilies.join(', ')}, observed ${observedElkFamilies.join(', ')}`)
}
if (observedElkFamilies.length < 2) throw new Error('ELK sharing needs at least two family consumers')

const report = {
  schemaVersion: 1 as const,
  compression: 'sum of each fetched file; gzip level 9; Brotli quality 11',
  elkChunk: elkOutput,
  initial: { requests: initialFiles.length, ...transferSize(initialFiles) },
  families: Object.fromEntries(BROWSER_BUILTIN_FAMILY_IDS.map(id => [id, {
    requests: familyFiles[id].length,
    elk: familyFiles[id].includes(elkOutput),
    ...transferSize(familyFiles[id]),
  }])) as Record<BrowserBuiltinFamilyId, TransferSize & { requests: number; elk: boolean }>,
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
checkBudget('initial', report.initial, budgets.initial)
for (const id of BROWSER_BUILTIN_FAMILY_IDS) checkBudget(id, report.families[id], budgets.families[id])
if (problems.length > 0) throw new Error(`Async browser size budgets exceeded:\n${problems.join('\n')}`)

if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
else {
  process.stdout.write(`browser lazy build verified: ${report.initial.gzip} B initial gzip; `
    + `${observedElkFamilies.length} families share one ELK chunk; `
    + `${BROWSER_BUILTIN_FAMILY_IDS.length - observedElkFamilies.length} non-ELK graphs exclude it\n`)
}
