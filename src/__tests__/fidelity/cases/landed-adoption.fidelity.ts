import {
  mutate,
  parseRegisteredMermaid,
  renderMermaidSVG,
  serializeMermaid,
  verifyMermaid,
} from '../../../agent/index.ts'
import { verifyNoExternalRefs } from '../../../index.ts'
import type {
  ApplicableFidelitySurfaceExpectation,
  FidelityCaseDefinition,
  FidelityDisposition,
  FidelityJson,
  NotApplicableFidelitySurfaceExpectation,
  ObservedFidelitySurfaceEvidence,
} from '../contract.ts'

const UPSTREAM_REVISION = 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc'

function fail(message: string): never {
  throw new Error(message)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function facts(evidence: ObservedFidelitySurfaceEvidence): Readonly<Record<string, FidelityJson>> {
  if (!isRecord(evidence.semantics)) fail('semantic evidence must be an object')
  return evidence.semantics
}

function record(value: FidelityJson, context: string): Readonly<Record<string, FidelityJson>> {
  if (!isRecord(value)) fail(`${context} must be an object`)
  return value as Readonly<Record<string, FidelityJson>>
}

function applicable(
  disposition: FidelityDisposition,
  evaluate: ApplicableFidelitySurfaceExpectation['evaluate'],
  diagnosticCodes: readonly string[] = [],
): ApplicableFidelitySurfaceExpectation {
  return { applicability: 'applicable', disposition, diagnosticCodes, evaluate }
}

function notApplicable(rationale: string): NotApplicableFidelitySurfaceExpectation {
  return { applicability: 'not-applicable', rationale }
}

function parsedOrThrow(source: string) {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) fail(`agent parse failed: ${parsed.error.map(error => error.code).join(', ')}`)
  return parsed.value
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)].map(match => [match[1]!, match[2]!]))
}

function textNodes(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]!.replace(/<[^>]+>/g, ''))
}

function tagsWithClass(svg: string, element: string, className: string): Record<string, string>[] {
  const tags = [...svg.matchAll(new RegExp(`<${element}\\b[^>]*>`, 'g'))].map(match => match[0]!)
  return tags
    .map(attributes)
    .filter(attrs => (attrs.class ?? '').split(/\s+/).includes(className))
}

function flowchartEdgeFacts(diagram: ReturnType<typeof parsedOrThrow>): FidelityJson {
  if (diagram.body.kind !== 'flowchart') return { bodyKind: diagram.body.kind, edges: [] }
  return {
    bodyKind: diagram.body.kind,
    edges: diagram.body.graph.edges.map(edge => ({
      source: edge.source,
      target: edge.target,
      label: edge.label ?? null,
    })),
  }
}

function sankeyFacts(diagram: ReturnType<typeof parsedOrThrow>): FidelityJson {
  const frontmatter = isRecord(diagram.meta.frontmatter) ? diagram.meta.frontmatter : {}
  const sankey = isRecord(frontmatter.sankey) ? frontmatter.sankey : {}
  const nodeColors = isRecord(sankey.nodeColors) ? sankey.nodeColors : {}
  return {
    bodyKind: diagram.body.kind,
    links: diagram.body.kind === 'sankey'
      ? diagram.body.links.map(link => ({ source: link.source, target: link.target, value: link.value }))
      : [],
    linkColor: typeof sankey.linkColor === 'string' ? sankey.linkColor : null,
    nodeColorA: typeof nodeColors.A === 'string' ? nodeColors.A : null,
    nodeColorB: typeof nodeColors.B === 'string' ? nodeColors.B : null,
  }
}

function matchesSankeyFacts(value: FidelityJson, expectedValue: number): boolean {
  const semanticFacts = record(value, 'sankey facts')
  const links = semanticFacts.links
  if (!Array.isArray(links) || links.length !== 1) return false
  const link = record(links[0] ?? null, 'sankey link')
  return semanticFacts.bodyKind === 'sankey'
    && semanticFacts.linkColor === 'gradient'
    && semanticFacts.nodeColorA === '#ff0000'
    && semanticFacts.nodeColorB === '#0000ff'
    && link.source === 'A'
    && link.target === 'B'
    && link.value === expectedValue
}

function xychartFacts(diagram: ReturnType<typeof parsedOrThrow>): FidelityJson {
  if (diagram.body.kind !== 'xychart') return { bodyKind: diagram.body.kind }
  const body = diagram.body
  return {
    bodyKind: body.kind,
    title: body.title ?? null,
    horizontal: body.horizontal ?? false,
    xAxis: body.xAxis
      ? {
          name: body.xAxis.name ?? null,
          categories: body.xAxis.categories ?? null,
          range: body.xAxis.range ?? null,
        }
      : null,
    yAxis: body.yAxis
      ? {
          name: body.yAxis.name ?? null,
          categories: body.yAxis.categories ?? null,
          range: body.yAxis.range ?? null,
        }
      : null,
    series: body.series.map(series => ({
      kind: series.kind,
      name: series.name ?? null,
      values: series.values,
      pointLabels: series.pointLabels?.map(label => label ?? null) ?? null,
    })),
  }
}

function matchesXychartFacts(value: FidelityJson, secondValue: number): boolean {
  const semanticFacts = record(value, 'xychart facts')
  const xAxis = record(semanticFacts.xAxis ?? null, 'xychart x axis')
  const yAxis = record(semanticFacts.yAxis ?? null, 'xychart y axis')
  const yRange = record(yAxis.range ?? null, 'xychart y range')
  const series = semanticFacts.series
  if (!Array.isArray(series) || series.length !== 1) return false
  const first = record(series[0] ?? null, 'xychart series')
  return semanticFacts.bodyKind === 'xychart'
    && semanticFacts.title === 'Revenue; Q1'
    && semanticFacts.horizontal === true
    && JSON.stringify(xAxis.categories) === JSON.stringify(['Jan', 'Feb'])
    && yAxis.name === 'USD'
    && yRange.min === 0
    && yRange.max === 100
    && first.kind === 'bar'
    && first.name === 'Online'
    && JSON.stringify(first.values) === JSON.stringify([10, secondValue])
}

function sankeyRenderFacts(svg: string): FidelityJson {
  const gradientTags = [...svg.matchAll(/<linearGradient\b[^>]*>[\s\S]*?<\/linearGradient>/g)].map(match => match[0]!)
  const gradientTag = gradientTags[0] ?? ''
  const opening = gradientTag.match(/^<linearGradient\b[^>]*>/)?.[0] ?? ''
  const gradientAttributes = attributes(opening)
  const stops = [...gradientTag.matchAll(/<stop\b[^>]*\/>/g)].map(match => attributes(match[0]!))
  const links = tagsWithClass(svg, 'path', 'sankey-link')
  return {
    gradientCount: gradientTags.length,
    gradient: {
      id: gradientAttributes.id ?? null,
      units: gradientAttributes.gradientUnits ?? null,
      x1: gradientAttributes.x1 ?? null,
      x2: gradientAttributes.x2 ?? null,
      stops: stops.map(stop => ({ offset: stop.offset ?? null, color: stop['stop-color'] ?? null })),
    },
    links: links.map(link => ({
      source: link['data-source'] ?? null,
      target: link['data-target'] ?? null,
      stroke: link.stroke ?? null,
      blendMode: link.style?.match(/mix-blend-mode:([^;]+)/)?.[1] ?? null,
    })),
    externalReferences: verifyNoExternalRefs(svg).refs,
  }
}

const sankeyGradientSource = `${[
  '---',
  'config:',
  '  sankey:',
  '    linkColor: gradient',
  '    nodeColors:',
  '      A: "#ff0000"',
  '      B: "#0000ff"',
  '---',
  'sankey-beta',
  '  A,B,1',
].join('\n')}\n`

const sankeyGradientEndpoints: FidelityCaseDefinition = {
  id: 'sankey.links.typed-gradient-endpoints',
  family: 'sankey',
  featureId: 'official-doc:sankey:section:links-coloring',
  source: sankeyGradientSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/sankey.html#links-coloring',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: applicable('native', evidence => (matchesSankeyFacts(facts(evidence).diagram ?? null, 1) ? 'native' : 'absent')),
    render: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      const gradient = record(semanticFacts.gradient ?? null, 'gradient')
      const stops = gradient.stops
      const links = semanticFacts.links
      if (!Array.isArray(stops) || stops.length !== 2 || !Array.isArray(links) || links.length !== 1) return 'absent'
      const sourceStop = record(stops[0] ?? null, 'source stop')
      const targetStop = record(stops[1] ?? null, 'target stop')
      const link = record(links[0] ?? null, 'sankey rendered link')
      return semanticFacts.gradientCount === 1
        && gradient.units === 'userSpaceOnUse'
        && Number(gradient.x1) < Number(gradient.x2)
        && sourceStop.offset === '0%'
        && sourceStop.color === '#ff0000'
        && targetStop.offset === '100%'
        && targetStop.color === '#0000ff'
        && link.source === 'A'
        && link.target === 'B'
        && link.stroke === 'url(#sankey-gradient-1)'
        && Array.isArray(semanticFacts.externalReferences)
        && semanticFacts.externalReferences.length === 0
        ? 'native'
        : 'absent'
    }),
    serialize: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.serializedSource === sankeyGradientSource
        && semanticFacts.reserializedSource === sankeyGradientSource
        && matchesSankeyFacts(semanticFacts.reparsedDiagram ?? null, 1)
        ? 'native'
        : 'absent'
    }),
    mutate: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.mutationOk === true
        && typeof semanticFacts.serializedSource === 'string'
        && semanticFacts.serializedSource.includes('  A,B,2\n')
        && semanticFacts.serializedSource.startsWith('---\nconfig:\n  sankey:')
        && matchesSankeyFacts(semanticFacts.reparsedDiagram ?? null, 2)
        ? 'native'
        : typeof semanticFacts.errorCode === 'string'
          ? 'diagnosed'
          : 'absent'
    }),
  },
  observe: () => {
    const parsed = parsedOrThrow(sankeyGradientSource)
    const svg = renderMermaidSVG(sankeyGradientSource)
    const serializedSource = serializeMermaid(parsed)
    const reparsed = parsedOrThrow(serializedSource)
    const mutation = mutate(parsed, { kind: 'set_link_value', source: 'A', target: 'B', value: 2 })
    const mutatedSource = mutation.ok ? serializeMermaid(mutation.value) : ''
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { diagram: sankeyFacts(parsed) },
      },
      render: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: sankeyRenderFacts(svg),
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: {
          serializedSource,
          reserializedSource: serializeMermaid(reparsed),
          reparsedDiagram: sankeyFacts(reparsed),
        },
      },
      mutate: {
        status: 'observed',
        diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: {
          mutationOk: mutation.ok,
          errorCode: mutation.ok ? null : mutation.error.code,
          serializedSource: mutatedSource,
          reparsedDiagram: mutation.ok ? sankeyFacts(parsedOrThrow(mutatedSource)) : null,
        },
      },
    }
  },
}

function sankeyCompositingCase(
  id: string,
  background: string | undefined,
  expectedDisposition: FidelityDisposition,
): FidelityCaseDefinition {
  return {
    id,
    family: 'sankey',
    featureId: 'official-doc:sankey:section:links-coloring',
    source: sankeyGradientSource,
    upstreamReference: 'https://mermaid.ai/open-source/syntax/sankey.html#links-coloring',
    upstreamRevision: UPSTREAM_REVISION,
    expected: {
      agent: notApplicable('Ribbon compositing is a renderer/backend implication, not an agent-domain construct.'),
      render: applicable(expectedDisposition, evidence => {
        const semanticFacts = facts(evidence)
        const modes = semanticFacts.blendModes
        if (!Array.isArray(modes) || modes.length !== 1 || modes.some(mode => typeof mode !== 'string')) return 'absent'
        if (modes.every(mode => mode === 'multiply')) return 'native'
        if (modes.every(mode => mode === 'normal')) return 'absent'
        fail(`unrecognized Sankey blend modes: ${JSON.stringify(modes)}`)
      }),
      serialize: notApplicable('Backend compositing does not change or serialize Mermaid source.'),
      mutate: notApplicable('Backend compositing has no structured mutation operation.'),
    },
    observe: () => {
      const svg = renderMermaidSVG(sankeyGradientSource, background ? { bg: background } : {})
      const links = tagsWithClass(svg, 'path', 'sankey-link')
      return {
        render: {
          status: 'observed',
          diagnosticCodes: [],
          semantics: {
            background: background ?? null,
            blendModes: links.map(link => link.style?.match(/mix-blend-mode:([^;]+)/)?.[1] ?? null),
          },
        },
      }
    },
  }
}

const sankeyLightMultiply = sankeyCompositingCase(
  'sankey.links.light-background-multiply',
  '#ffffff',
  'native',
)

const sankeyDarkNormalDivergence = sankeyCompositingCase(
  'sankey.links.dark-background-normal-alpha-divergence',
  '#071823',
  'absent',
)

const xychartSharedParserSource = 'xychart-beta horizontal; title "Revenue; Q1"; x-axis ["Jan", "Feb"]; y-axis "USD" 0 --> 100; bar "Online" [10, 20]\n'

const xychartSharedParser: FidelityCaseDefinition = {
  id: 'xychart.syntax.shared-parser-semantics',
  family: 'xychart',
  featureId: 'official-doc:xychart:section:syntax',
  source: xychartSharedParserSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/xyChart.html#syntax',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: applicable('native', evidence => (matchesXychartFacts(facts(evidence).diagram ?? null, 20) ? 'native' : 'absent')),
    render: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      const bars = semanticFacts.bars
      const texts = semanticFacts.texts
      if (!Array.isArray(bars) || bars.length !== 2 || !Array.isArray(texts)) return 'absent'
      const first = record(bars[0] ?? null, 'first bar')
      const second = record(bars[1] ?? null, 'second bar')
      return first.label === 'Jan'
        && first.value === '10'
        && Number(first.width) < Number(first.height)
        && second.label === 'Feb'
        && second.value === '20'
        && Number(second.width) < Number(second.height)
        && ['Revenue; Q1', 'USD', 'Online', 'Jan', 'Feb'].every(text => texts.includes(text))
        ? 'native'
        : 'absent'
    }),
    serialize: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return typeof semanticFacts.serializedSource === 'string'
        && semanticFacts.serializedSource !== xychartSharedParserSource
        && semanticFacts.reserializedSource === semanticFacts.serializedSource
        && matchesXychartFacts(semanticFacts.reparsedDiagram ?? null, 20)
        ? 'native'
        : 'absent'
    }),
    mutate: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      const bars = semanticFacts.renderedBars
      if (!Array.isArray(bars) || bars.length !== 2) return 'absent'
      const second = record(bars[1] ?? null, 'mutated second bar')
      return semanticFacts.mutationOk === true
        && semanticFacts.reserializedSource === semanticFacts.serializedSource
        && matchesXychartFacts(semanticFacts.reparsedDiagram ?? null, 25)
        && second.label === 'Feb'
        && second.value === '25'
        ? 'native'
        : typeof semanticFacts.errorCode === 'string'
          ? 'diagnosed'
          : 'absent'
    }),
  },
  observe: () => {
    const parsed = parsedOrThrow(xychartSharedParserSource)
    const svg = renderMermaidSVG(xychartSharedParserSource)
    const serializedSource = serializeMermaid(parsed)
    const reparsed = parsedOrThrow(serializedSource)
    const mutation = mutate(parsed, { kind: 'set_data_point', seriesIndex: 0, index: 1, value: 25 })
    const mutatedSource = mutation.ok ? serializeMermaid(mutation.value) : ''
    const mutatedSvg = mutation.ok ? renderMermaidSVG(mutatedSource) : ''
    const barFacts = (rendered: string) => tagsWithClass(rendered, 'rect', 'xychart-bar').map(bar => ({
      label: bar['data-label'] ?? null,
      value: bar['data-value'] ?? null,
      width: bar.width ?? null,
      height: bar.height ?? null,
    }))
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { diagram: xychartFacts(parsed) },
      },
      render: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { bars: barFacts(svg), texts: textNodes(svg) },
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: {
          serializedSource,
          reserializedSource: serializeMermaid(reparsed),
          reparsedDiagram: xychartFacts(reparsed),
        },
      },
      mutate: {
        status: 'observed',
        diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: {
          mutationOk: mutation.ok,
          errorCode: mutation.ok ? null : mutation.error.code,
          serializedSource: mutatedSource,
          reserializedSource: mutation.ok ? serializeMermaid(parsedOrThrow(mutatedSource)) : '',
          reparsedDiagram: mutation.ok ? xychartFacts(parsedOrThrow(mutatedSource)) : null,
          renderedBars: barFacts(mutatedSvg),
        },
      },
    }
  },
}

const xychartUnknownStatementSource = `${['xychart-beta', '  bar [1, 2]', '  frob official-data-lost'].join('\n')}\n`

const xychartUnknownStatementSeam: FidelityCaseDefinition = {
  id: 'xychart.syntax.unknown-statement-render-seam',
  family: 'xychart',
  featureId: 'official-doc:xychart:section:syntax',
  source: xychartUnknownStatementSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/xyChart.html#syntax',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: applicable(
      'source-preserved',
      evidence => (facts(evidence).bodyKind === 'opaque' ? 'source-preserved' : 'native'),
      ['UNSUPPORTED_SYNTAX'],
    ),
    render: applicable('absent', evidence => {
      const semanticFacts = facts(evidence)
      if (typeof semanticFacts.errorMessage === 'string' && evidence.diagnosticCodes.includes('RENDER_FAILED')) return 'diagnosed'
      const bars = semanticFacts.bars
      const texts = semanticFacts.texts
      if (!Array.isArray(bars) || bars.length !== 2 || !Array.isArray(texts)) fail('unknown-statement render evidence is malformed')
      const first = record(bars[0] ?? null, 'unknown-statement first bar')
      const second = record(bars[1] ?? null, 'unknown-statement second bar')
      if (first.value === '1' && second.value === '2' && !texts.includes('official-data-lost')) return 'absent'
      if (texts.includes('official-data-lost')) return 'source-preserved'
      fail('unknown-statement render behavior changed without a recognized disposition')
    }),
    serialize: applicable('source-preserved', evidence => (facts(evidence).serializedSource === xychartUnknownStatementSource ? 'source-preserved' : 'absent')),
    mutate: applicable(
      'diagnosed',
      evidence => {
        const semanticFacts = facts(evidence)
        if (semanticFacts.mutationOk === true) return 'native'
        return semanticFacts.errorCode === 'INVALID_OP' && semanticFacts.rejectedOpaqueBody === true ? 'diagnosed' : 'absent'
      },
      ['INVALID_OP'],
    ),
  },
  observe: () => {
    const parsed = parsedOrThrow(xychartUnknownStatementSource)
    const verification = verifyMermaid(parsed)
    let rendered = ''
    let renderErrorMessage: string | null = null
    try {
      rendered = renderMermaidSVG(xychartUnknownStatementSource)
    } catch (error) {
      renderErrorMessage = error instanceof Error ? error.message : String(error)
    }
    const renderDiagnosticCodes = renderErrorMessage === null
      ? []
      : verification.warnings.map(warning => warning.code).filter(code => code === 'RENDER_FAILED')
    const mutation = mutate(parsed, { kind: 'set_title', title: 'Changed' })
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: verification.warnings.map(warning => warning.code).filter(code => code === 'UNSUPPORTED_SYNTAX'),
        semantics: { bodyKind: parsed.body.kind },
      },
      render: {
        status: 'observed',
        diagnosticCodes: renderDiagnosticCodes,
        semantics: {
          errorMessage: renderErrorMessage,
          bars: tagsWithClass(rendered, 'rect', 'xychart-bar').map(bar => ({
            label: bar['data-label'] ?? null,
            value: bar['data-value'] ?? null,
          })),
          texts: textNodes(rendered),
        },
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { serializedSource: serializeMermaid(parsed) },
      },
      mutate: {
        status: 'observed',
        diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: {
          mutationOk: mutation.ok,
          errorCode: mutation.ok ? null : mutation.error.code,
          rejectedOpaqueBody: mutation.ok ? false : mutation.error.message.includes('body kind opaque'),
        },
      },
    }
  },
}

const flowchartBoundaryWhitespaceSource = `${['flowchart TD', '  A -->|" a "| B'].join('\n')}\n`

function matchesFlowchartEdges(value: FidelityJson, expected: readonly Readonly<Record<string, string>>[]): boolean {
  const semanticFacts = record(value, 'flowchart facts')
  const edges = semanticFacts.edges
  return semanticFacts.bodyKind === 'flowchart'
    && Array.isArray(edges)
    && edges.length === expected.length
    && edges.every((edge, index) => {
      const actual = record(edge, `flowchart edge ${index}`)
      const wanted = expected[index]!
      return actual.source === wanted.source && actual.target === wanted.target && actual.label === wanted.label
    })
}

const flowchartBoundaryWhitespaceMutation: FidelityCaseDefinition = {
  id: 'flowchart.links.boundary-whitespace-mutation-closure',
  family: 'flowchart',
  featureId: 'official-doc:flowchart:section:text-on-links',
  source: flowchartBoundaryWhitespaceSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/flowchart.html#text-on-links',
  upstreamRevision: UPSTREAM_REVISION,
  expected: {
    agent: applicable('native', evidence => (matchesFlowchartEdges(facts(evidence).diagram ?? null, [
      { source: 'A', target: 'B', label: ' a ' },
    ]) ? 'native' : 'absent')),
    render: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      const texts = semanticFacts.texts
      const edges = semanticFacts.edges
      return Array.isArray(texts)
        && texts.includes(' a ')
        && Array.isArray(edges)
        && edges.some(edge => isRecord(edge) && edge.source === 'A' && edge.target === 'B')
        ? 'native'
        : 'absent'
    }),
    serialize: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.serializedSource === flowchartBoundaryWhitespaceSource
        && semanticFacts.reserializedSource === flowchartBoundaryWhitespaceSource
        && matchesFlowchartEdges(semanticFacts.reparsedDiagram ?? null, [
          { source: 'A', target: 'B', label: ' a ' },
        ])
        ? 'native'
        : 'absent'
    }),
    mutate: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      const expectedEdges = [
        { source: 'A', target: 'B', label: ' a ' },
        { source: 'B', target: 'A', label: ' b ' },
      ]
      const texts = semanticFacts.renderedTexts
      return semanticFacts.mutationOk === true
        && typeof semanticFacts.serializedSource === 'string'
        && semanticFacts.serializedSource.includes('B -->|" b "| A')
        && semanticFacts.reserializedSource === semanticFacts.serializedSource
        && matchesFlowchartEdges(semanticFacts.mutatedDiagram ?? null, expectedEdges)
        && matchesFlowchartEdges(semanticFacts.reparsedDiagram ?? null, expectedEdges)
        && Array.isArray(texts)
        && texts.includes(' a ')
        && texts.includes(' b ')
        ? 'native'
        : typeof semanticFacts.errorCode === 'string'
          ? 'diagnosed'
          : 'absent'
    }),
  },
  observe: () => {
    const parsed = parsedOrThrow(flowchartBoundaryWhitespaceSource)
    const svg = renderMermaidSVG(flowchartBoundaryWhitespaceSource)
    const serializedSource = serializeMermaid(parsed)
    const reparsed = parsedOrThrow(serializedSource)
    const mutation = mutate(parsed, { kind: 'add_edge', from: 'B', to: 'A', label: ' b ' })
    const mutatedSource = mutation.ok ? serializeMermaid(mutation.value) : ''
    const mutatedReparse = mutation.ok ? parsedOrThrow(mutatedSource) : null
    const renderedEdges = (rendered: string) => [...rendered.matchAll(/<(?:path|polyline)\b[^>]*(?:data-from|data-to)="[^"]+"[^>]*>/g)]
      .map(match => attributes(match[0]!))
      .filter(edge => edge['data-from'] && edge['data-to'])
      .map(edge => ({ source: edge['data-from']!, target: edge['data-to']! }))
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { diagram: flowchartEdgeFacts(parsed) },
      },
      render: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { edges: renderedEdges(svg), texts: textNodes(svg) },
      },
      serialize: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: {
          serializedSource,
          reserializedSource: serializeMermaid(reparsed),
          reparsedDiagram: flowchartEdgeFacts(reparsed),
        },
      },
      mutate: {
        status: 'observed',
        diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: {
          mutationOk: mutation.ok,
          errorCode: mutation.ok ? null : mutation.error.code,
          serializedSource: mutatedSource,
          reserializedSource: mutatedReparse ? serializeMermaid(mutatedReparse) : '',
          mutatedDiagram: mutation.ok ? flowchartEdgeFacts(mutation.value) : null,
          reparsedDiagram: mutatedReparse ? flowchartEdgeFacts(mutatedReparse) : null,
          renderedTexts: mutatedReparse ? textNodes(renderMermaidSVG(mutatedSource)) : [],
        },
      },
    }
  },
}

export const fidelityCases: readonly FidelityCaseDefinition[] = Object.freeze([
  sankeyGradientEndpoints,
  sankeyLightMultiply,
  sankeyDarkNormalDivergence,
  xychartSharedParser,
  xychartUnknownStatementSeam,
  flowchartBoundaryWhitespaceMutation,
])
