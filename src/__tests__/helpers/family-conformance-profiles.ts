import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA, isBuiltinFamilyId, type BuiltinFamilyMetadata } from '../../agent/families.ts'
import { parseRegisteredMermaid } from '../../agent/parse.ts'
import type { DiagramKind } from '../../agent/types.ts'
import type { RenderOptions } from '../../types.ts'
import { compareCodePointStrings } from '../../shared/deterministic-order.ts'
import { METAMORPHIC_FAMILIES } from './metamorphic-families.ts'

const ROOT = join(import.meta.dir, '..', '..', '..')
const FAMILY_DEMOS = join(ROOT, 'docs', 'design', 'families')
const EVAL_ROOT = join(ROOT, 'eval')

export const COMPLEXITY_STRATA = [
  'minimal',
  'representative',
  'dense',
  'text-stress',
  'family-risk',
  'corpus-outlier',
] as const
export type ComplexityStratum = typeof COMPLEXITY_STRATA[number]

export interface FamilyConformanceProfile {
  readonly family: DiagramKind
  readonly riskFixture: string
  readonly riskOptions: RenderOptions
  readonly textStressSource: string
  readonly externalReferenceSource?: string
}

/**
 * Mandatory family conformance material. This is deliberately exact-closed:
 * adding a DiagramKind cannot compile until its rich/text witnesses exist.
 * Tests iterate the runtime registry; this object never opts a family into a
 * particular test.
 */
export const FAMILY_CONFORMANCE_PROFILES: Readonly<Record<DiagramKind, FamilyConformanceProfile>> = {
  flowchart: {
    family: 'flowchart', riskFixture: 'flowchart-v11-shapes-demo.mmd', riskOptions: {},
    textStressSource: 'flowchart LR\n  A["東京 café é 👩‍💻 שלום"] -->|長いラベル| B["مرحبا بالعالم"]',
    externalReferenceSource: 'flowchart LR\n  A[Docs] --> B[Done]\n  click A href "https://example.com/docs"',
  },
  state: {
    family: 'state', riskFixture: 'state-pseudostates-demo.mmd', riskOptions: {},
    textStressSource: 'stateDiagram-v2\n  state "東京 café 👩‍💻" as A\n  state "שלום é" as B\n  A --> B : 長いラベル',
  },
  sequence: {
    family: 'sequence', riskFixture: 'sequence-config-demo.mmd', riskOptions: {},
    textStressSource: 'sequenceDiagram\n  participant A as 東京 👩‍💻\n  participant B as שלום é\n  A->>B: مرحبا بالعالم',
    externalReferenceSource: 'sequenceDiagram\n  participant A as Alice\n  link A: profile @ https://example.com/alice\n  A->>A: inspect',
  },
  timeline: {
    family: 'timeline', riskFixture: 'timeline-vertical-demo.mmd', riskOptions: {},
    textStressSource: 'timeline\n  title 東京 café 👩‍💻\n  section שלום é\n    2026 : مرحبا بالعالم : 長いイベント',
  },
  class: {
    family: 'class', riskFixture: 'class-generics-demo.mmd', riskOptions: {},
    textStressSource: 'classDiagram\n  class Account {\n    +名前: string\n    +café()\n  }\n  note for Account "東京 👩‍💻 שלום é"',
    externalReferenceSource: 'classDiagram\n  class Docs\n  click Docs href "https://example.com/docs"',
  },
  er: {
    family: 'er', riskFixture: 'er-direction-demo.mmd', riskOptions: {},
    textStressSource: 'erDiagram\n  CUSTOMER ||--o{ ORDER : "東京 café 👩‍💻"\n  CUSTOMER {\n    string name "שלום é مرحبا"\n  }',
  },
  journey: {
    family: 'journey', riskFixture: 'journey-section-overlap-demo.mmd', riskOptions: {},
    textStressSource: 'journey\n  title 東京 café 👩‍💻\n  section שלום é\n    مرحبا بالعالم: 4: 利用者',
  },
  architecture: {
    family: 'architecture', riskFixture: 'architecture-align-demo.mmd', riskOptions: {},
    textStressSource: 'architecture-beta\n  group g(cloud)[東京 café 👩‍💻]\n  service a(server)[שלום é] in g\n  service b(database)[مرحبا بالعالم] in g\n  a:R --> L:b',
  },
  xychart: {
    family: 'xychart', riskFixture: 'xychart-legend-demo.mmd', riskOptions: {},
    textStressSource: 'xychart-beta\n  title "東京 café 👩‍💻"\n  x-axis [שלום, مرحبا, é]\n  y-axis 0 --> 10\n  bar [2, 5, 8]',
  },
  pie: {
    family: 'pie', riskFixture: 'pie-donut-labels-demo.mmd', riskOptions: {},
    textStressSource: 'pie title 東京 café 👩‍💻\n  "שלום é" : 4\n  "مرحبا بالعالم" : 3\n  "長いラベル" : 2',
  },
  quadrant: {
    family: 'quadrant', riskFixture: 'quadrant-styling-demo.mmd', riskOptions: {},
    textStressSource: 'quadrantChart\n  title 東京 café 👩‍💻\n  x-axis שלום --> مرحبا\n  y-axis é --> 長い\n  نقطة: [0.3, 0.7]',
  },
  gantt: {
    family: 'gantt', riskFixture: 'gantt-dependency-overlay-demo.mmd',
    riskOptions: { gantt: { dependencyArrows: true, criticalPath: true } },
    textStressSource: 'gantt\n  title 東京 café 👩‍💻\n  dateFormat YYYY-MM-DD\n  section שלום é\n  مرحبا بالعالم :a, 2026-01-01, 2d\n  長いタスク :after a, 1d',
    externalReferenceSource: 'gantt\n  dateFormat YYYY-MM-DD\n  section Links\n  Docs :docs, 2026-01-01, 1d\n  click docs href "https://example.com/docs"',
  },
  mindmap: {
    family: 'mindmap', riskFixture: 'mindmap-demo.mmd', riskOptions: {},
    textStressSource: 'mindmap\n  root((東京 café 👩‍💻))\n    שלום é\n      مرحبا بالعالم\n    長いラベル',
  },
  gitgraph: {
    family: 'gitgraph', riskFixture: 'gitgraph-demo.mmd', riskOptions: {},
    textStressSource: 'gitGraph\n  commit id:"base" msg:"東京 café 👩‍💻"\n  branch feature\n  commit id:"work" msg:"שלום é مرحبا"',
  },
  radar: {
    family: 'radar', riskFixture: 'radar-demo.mmd', riskOptions: {},
    textStressSource: 'radar-beta\n  title 東京 café 👩‍💻\n  axis a["שלום é"], b["مرحبا"], c["長い"]\n  curve now["現在 👩‍💻"]{3,4,5}\n  max 5',
  },
  sankey: {
    family: 'sankey', riskFixture: 'sankey-flows-demo.mmd', riskOptions: {},
    textStressSource: 'sankey-beta\n  東京 café 👩‍💻,שלום é,10\n  שלום é,مرحبا بالعالم,10',
  },
}

export interface ConformanceSource {
  readonly family: DiagramKind
  readonly stratum: ComplexityStratum
  readonly id: string
  readonly source: string
  readonly options: RenderOptions
  readonly origin: 'registry-example' | 'metamorphic-generator' | 'family-risk-fixture' | 'eval-corpus'
}

function allMmdFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return allMmdFiles(path)
    return entry.isFile() && entry.name.endsWith('.mmd') ? [path] : []
  })
}

function sourceProxyComplexity(source: string): number {
  const lines = source.split(/\r?\n/)
  const indentation = lines.reduce((sum, line) => sum + Math.floor((/^\s*/.exec(line)?.[0].length ?? 0) / 2), 0)
  const structure = (source.match(/-->|==>|->>|-->>|\|\||\{\{|\b(?:section|subgraph|state|class|group|service|commit|curve)\b/g) ?? []).length
  return source.length + lines.length * 32 + indentation * 16 + structure * 64
}

let corpusOutlierCache: Record<DiagramKind, { path: string; source: string }> | undefined

export function collectCorpusOutliers(): Record<DiagramKind, { path: string; source: string }> {
  if (corpusOutlierCache) return corpusOutlierCache
  const selected = new Map<DiagramKind, { path: string; source: string; score: number }>()
  for (const path of allMmdFiles(EVAL_ROOT).sort(compareCodePointStrings)) {
    const source = readFileSync(path, 'utf8')
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind === 'opaque' || !isBuiltinFamilyId(parsed.value.kind)) continue
    const family = parsed.value.kind
    const score = sourceProxyComplexity(source)
    const current = selected.get(family)
    if (!current || score > current.score || (score === current.score && compareCodePointStrings(path, current.path) < 0)) {
      selected.set(family, { path, source, score })
    }
  }
  const missing = BUILTIN_FAMILY_METADATA.map(entry => entry.id).filter(id => !selected.has(id))
  if (missing.length > 0) throw new Error(`Eval corpus has no structured source for: ${missing.join(', ')}`)
  corpusOutlierCache = Object.fromEntries(BUILTIN_FAMILY_METADATA.map(({ id }) => {
    const entry = selected.get(id)!
    return [id, { path: entry.path, source: entry.source }]
  })) as Record<DiagramKind, { path: string; source: string }>
  return corpusOutlierCache
}

function metadataFor(family: DiagramKind): BuiltinFamilyMetadata {
  const metadata = BUILTIN_FAMILY_METADATA.find(entry => entry.id === family)
  if (!metadata) throw new Error(`Missing built-in family metadata for ${family}`)
  return metadata
}

export function conformanceSourceFor(family: DiagramKind, stratum: ComplexityStratum): ConformanceSource {
  const profile = FAMILY_CONFORMANCE_PROFILES[family]
  const generator = METAMORPHIC_FAMILIES[family]
  const [min, max] = generator.kRange
  switch (stratum) {
    case 'minimal': return {
      family, stratum, id: `${family}:minimal`, source: metadataFor(family).example, options: {}, origin: 'registry-example',
    }
    case 'representative': return {
      family, stratum, id: `${family}:representative`, source: generator.build(Math.floor((min + max) / 2), 'rep'), options: {}, origin: 'metamorphic-generator',
    }
    case 'dense': {
      let source = generator.build(max, 'dense')
      if (generator.addPrimary) source += generator.addPrimary.snippet(max, 'dense')
      if (generator.addRelation) source += generator.addRelation(max, 'dense')
      return { family, stratum, id: `${family}:dense`, source, options: {}, origin: 'metamorphic-generator' }
    }
    case 'text-stress': return {
      family, stratum, id: `${family}:text-stress`, source: profile.textStressSource, options: {}, origin: 'family-risk-fixture',
    }
    case 'family-risk': return {
      family, stratum, id: `${family}:family-risk`, source: readFileSync(join(FAMILY_DEMOS, profile.riskFixture), 'utf8'),
      options: profile.riskOptions, origin: 'family-risk-fixture',
    }
    case 'corpus-outlier': {
      const outlier = collectCorpusOutliers()[family]
      return { family, stratum, id: `${family}:corpus-outlier:${outlier.path.slice(ROOT.length + 1)}`, source: outlier.source, options: {}, origin: 'eval-corpus' }
    }
  }
}

export function allConformanceSources(): ConformanceSource[] {
  return BUILTIN_FAMILY_METADATA.flatMap(({ id }) => COMPLEXITY_STRATA.map(stratum => conformanceSourceFor(id, stratum)))
}
