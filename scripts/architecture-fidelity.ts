import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { samples } from './site/samples-data.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../src/index.ts'

type DiagramKind = 'architecture' | 'sequence' | 'class' | 'er' | 'xychart'
type CapabilityId =
  | 'types-module'
  | 'parser-module'
  | 'layout-module'
  | 'renderer-module'
  | 'ascii-module'
  | 'svg-public-api'
  | 'ascii-public-api'
  | 'parser-test'
  | 'integration-test'
  | 'ascii-test'
  | 'demo-category'
  | 'readme-section'
  | 'svg-runtime-sample'
  | 'ascii-runtime-sample'

interface DiagramSpec {
  kind: DiagramKind
  dir: string
  asciiModule: string
  testPrefix: string
  category: string
  readmeHeading: string
  svgDetectMarker: string
  asciiDetectMarker: string
}

interface Capability {
  id: CapabilityId
  label: string
  check: (spec: DiagramSpec) => boolean
}

const specs: Record<DiagramKind, DiagramSpec> = {
  architecture: {
    kind: 'architecture',
    dir: 'architecture',
    asciiModule: 'architecture.ts',
    testPrefix: 'architecture',
    category: 'Architecture',
    readmeHeading: '### Architecture Diagrams',
    svgDetectMarker: 'architecture-beta',
    asciiDetectMarker: 'architecture-beta',
  },
  sequence: {
    kind: 'sequence',
    dir: 'sequence',
    asciiModule: 'sequence.ts',
    testPrefix: 'sequence',
    category: 'Sequence',
    readmeHeading: '### Sequence Diagrams',
    svgDetectMarker: 'sequencediagram',
    asciiDetectMarker: 'sequencediagram',
  },
  class: {
    kind: 'class',
    dir: 'class',
    asciiModule: 'class-diagram.ts',
    testPrefix: 'class',
    category: 'Class',
    readmeHeading: '### Class Diagrams',
    svgDetectMarker: 'classdiagram',
    asciiDetectMarker: 'classdiagram',
  },
  er: {
    kind: 'er',
    dir: 'er',
    asciiModule: 'er-diagram.ts',
    testPrefix: 'er',
    category: 'ER',
    readmeHeading: '### ER Diagrams',
    svgDetectMarker: 'erdiagram',
    asciiDetectMarker: 'erdiagram',
  },
  xychart: {
    kind: 'xychart',
    dir: 'xychart',
    asciiModule: 'xychart.ts',
    testPrefix: 'xychart',
    category: 'XY Chart',
    readmeHeading: '### XY Charts',
    svgDetectMarker: 'xychart',
    asciiDetectMarker: 'xychart',
  },
}

const repoRoot = new URL('.', import.meta.url)
const srcIndex = readText('src/index.ts')
const asciiIndex = readText('src/ascii/index.ts')
const readme = readText('README.md')

const capabilities: Capability[] = [
  { id: 'types-module', label: 'diagram types module', check: (spec) => hasFile(`src/${spec.dir}/types.ts`) },
  { id: 'parser-module', label: 'diagram parser module', check: (spec) => hasFile(`src/${spec.dir}/parser.ts`) },
  { id: 'layout-module', label: 'diagram layout module', check: (spec) => hasFile(`src/${spec.dir}/layout.ts`) },
  { id: 'renderer-module', label: 'diagram SVG renderer module', check: (spec) => hasFile(`src/${spec.dir}/renderer.ts`) },
  { id: 'ascii-module', label: 'diagram ASCII renderer module', check: (spec) => hasFile(`src/ascii/${spec.asciiModule}`) },
  {
    id: 'svg-public-api',
    label: 'SVG public API routing',
    check: (spec) => srcIndex.includes(`case '${spec.kind}'`) && srcIndex.toLowerCase().includes(spec.svgDetectMarker),
  },
  {
    id: 'ascii-public-api',
    label: 'ASCII public API routing',
    check: (spec) => asciiIndex.includes(`case '${spec.kind}'`) && asciiIndex.toLowerCase().includes(spec.asciiDetectMarker),
  },
  { id: 'parser-test', label: 'parser test coverage', check: (spec) => hasFile(`src/__tests__/${spec.testPrefix}-parser.test.ts`) },
  { id: 'integration-test', label: 'SVG integration test coverage', check: (spec) => hasFile(`src/__tests__/${spec.testPrefix}-integration.test.ts`) },
  { id: 'ascii-test', label: 'ASCII integration test coverage', check: (spec) => hasFile(`src/__tests__/${spec.testPrefix}-ascii.test.ts`) },
  { id: 'demo-category', label: 'visual sample suite coverage', check: (spec) => getSamplesForCategory(spec.category).length > 0 },
  { id: 'readme-section', label: 'README diagram section', check: (spec) => readme.includes(spec.readmeHeading) },
  { id: 'svg-runtime-sample', label: 'runtime SVG sample renders', check: (spec) => renderFirstSample(spec, 'svg') },
  { id: 'ascii-runtime-sample', label: 'runtime ASCII sample renders', check: (spec) => renderFirstSample(spec, 'ascii') },
]

const implementationMatrix = Object.fromEntries(
  Object.values(specs).map((spec) => [
    spec.kind,
    Object.fromEntries(capabilities.map((cap) => [cap.id, cap.check(spec)])),
  ]),
) as Record<DiagramKind, Record<CapabilityId, boolean>>

const comparisonKinds = (Object.keys(specs) as DiagramKind[]).filter((kind) => kind !== 'architecture')
const weights = Object.fromEntries(
  capabilities.map((cap) => [
    cap.id,
    comparisonKinds.filter((kind) => implementationMatrix[kind][cap.id]).length / comparisonKinds.length,
  ]),
) as Record<CapabilityId, number>

const architectureMatrix = implementationMatrix.architecture
const weightedMax = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
const weightedScore = capabilities.reduce(
  (sum, cap) => sum + (architectureMatrix[cap.id] ? weights[cap.id] : 0),
  0,
)
const fidelityScore = weightedMax === 0 ? 100 : (weightedScore / weightedMax) * 100

const baselineCaps = capabilities.filter((cap) => weights[cap.id] === 1)
const matchedBaseline = baselineCaps.filter((cap) => architectureMatrix[cap.id])

const architectureSamples = getSamplesForCategory(specs.architecture.category)
const artifactsDir = join(tmpdir(), 'beautiful-mermaid-architecture-fidelity')
rmSync(artifactsDir, { recursive: true, force: true })
mkdirSync(artifactsDir, { recursive: true })

for (let i = 0; i < architectureSamples.length; i++) {
  const sample = architectureSamples[i]!
  const slug = slugify(sample.title)
  const svg = renderMermaidSVG(sample.source, sample.options)
  const ascii = renderMermaidASCII(sample.source)
  writeFileSync(join(artifactsDir, `${String(i + 1).padStart(2, '0')}-${slug}.svg`), svg)
  writeFileSync(join(artifactsDir, `${String(i + 1).padStart(2, '0')}-${slug}.txt`), ascii)
}

const report = {
  fidelityScore: Number(fidelityScore.toFixed(1)),
  comparedAgainst: comparisonKinds,
  baselineCapabilities: baselineCaps.map((cap) => cap.label),
  matchedBaselineCapabilities: matchedBaseline.map((cap) => cap.label),
  architectureSampleCount: architectureSamples.length,
  architectureArtifactsDir: artifactsDir,
  matrix: implementationMatrix,
  weights,
}

writeFileSync(join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2))

console.log(`Architecture fidelity score: ${report.fidelityScore}/100`)
console.log(`Compared against: ${comparisonKinds.join(', ')}`)
console.log(`Baseline capabilities matched: ${matchedBaseline.length}/${baselineCaps.length}`)
console.log(`Architecture samples rendered: ${architectureSamples.length}`)
console.log(`Artifacts: ${artifactsDir}`)

for (const cap of capabilities) {
  const status = architectureMatrix[cap.id] ? 'yes' : 'no'
  const prevalence = Math.round(weights[cap.id] * 100)
  console.log(`- ${cap.label}: ${status} (${prevalence}% prevalence across existing implementations)`)
}

function readText(path: string): string {
  return readFileSync(new URL(path, repoRoot), 'utf8')
}

function hasFile(path: string): boolean {
  return existsSync(new URL(path, repoRoot))
}

function getSamplesForCategory(category: string) {
  return samples.filter((sample) => sample.category === category)
}

function renderFirstSample(spec: DiagramSpec, mode: 'svg' | 'ascii'): boolean {
  const sample = getSamplesForCategory(spec.category)[0]
  if (!sample) return false

  try {
    if (mode === 'svg') {
      const svg = renderMermaidSVG(sample.source, sample.options)
      return svg.includes('<svg') && svg.includes('</svg>')
    }

    const ascii = renderMermaidASCII(sample.source)
    return ascii.trim().length > 0
  } catch {
    return false
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
