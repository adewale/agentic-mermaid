import { mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { verifyNoExternalRefs } from '../../../index.ts'
import type { ApplicableFidelitySurfaceExpectation, FidelityCaseDefinition, FidelityDisposition, FidelityJson, NotApplicableFidelitySurfaceExpectation, ObservedFidelitySurfaceEvidence } from '../contract.ts'

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

function applicable(disposition: FidelityDisposition, evaluate: ApplicableFidelitySurfaceExpectation['evaluate'], diagnosticCodes: readonly string[] = []): ApplicableFidelitySurfaceExpectation {
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

function svgNumber(candidate: FidelityJson): number | null {
  if (typeof candidate !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(candidate)) return null
  const parsed = Number(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

function textNodes(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]!.replace(/<[^>]+>/g, ''))
}

function tagsWithClass(svg: string, element: string, className: string): Record<string, string>[] {
  const tags = [...svg.matchAll(new RegExp(`<${element}\\b[^>]*>`, 'g'))].map(match => match[0]!)
  return tags.map(attributes).filter(attrs => (attrs.class ?? '').split(/\s+/).includes(className))
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
    links: diagram.body.kind === 'sankey' ? diagram.body.links.map(link => ({ source: link.source, target: link.target, value: link.value })) : [],
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
  return semanticFacts.bodyKind === 'sankey' && semanticFacts.linkColor === 'gradient' && semanticFacts.nodeColorA === '#ff0000' && semanticFacts.nodeColorB === '#0000ff' && link.source === 'A' && link.target === 'B' && link.value === expectedValue
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
  return (
    semanticFacts.bodyKind === 'xychart' &&
    semanticFacts.title === 'Revenue; Q1' &&
    semanticFacts.horizontal === true &&
    xAxis.name === null &&
    JSON.stringify(xAxis.categories) === JSON.stringify(['Jan', 'Feb']) &&
    xAxis.range === null &&
    yAxis.name === 'USD' &&
    yAxis.categories === null &&
    yRange.min === 0 &&
    yRange.max === 100 &&
    first.kind === 'bar' &&
    first.name === 'Online' &&
    JSON.stringify(first.values) === JSON.stringify([10, secondValue]) &&
    first.pointLabels === null
  )
}

function matchesXychartBars(value: FidelityJson, expectedValues: readonly [string, string]): boolean {
  if (!Array.isArray(value) || value.length !== expectedValues.length) return false
  const dimensions = value.map((bar, index) => {
    const actual = record(bar, `xychart rendered bar ${index}`)
    if (actual.label !== (index === 0 ? 'Jan' : 'Feb') || actual.value !== expectedValues[index]) return null
    const numericWidth = svgNumber(actual.width ?? null)
    const numericHeight = svgNumber(actual.height ?? null)
    const numericValue = Number(expectedValues[index])
    if (numericWidth === null || numericHeight === null || !Number.isFinite(numericValue) || numericWidth <= 0 || numericHeight <= 0 || numericValue <= 0 || numericWidth >= numericHeight) return null
    return { width: numericWidth, height: numericHeight, value: numericValue }
  })
  if (dimensions.some(dimension => dimension === null)) return false
  const [first, second] = dimensions as [{ width: number; height: number; value: number }, { width: number; height: number; value: number }]
  return Math.abs(first.height - second.height) <= 0.01 && Math.abs(first.width / first.value - second.width / second.value) <= 0.001
}

function pathEndpoints(path: FidelityJson): FidelityJson {
  if (typeof path !== 'string') return null
  const coordinates = path.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)?.map(Number) ?? []
  if (coordinates.length < 4 || coordinates.some(coordinate => !Number.isFinite(coordinate))) return null
  return {
    startX: coordinates[0]!,
    startY: coordinates[1]!,
    endX: coordinates.at(-2)!,
    endY: coordinates.at(-1)!,
  }
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
      y1: gradientAttributes.y1 ?? null,
      x2: gradientAttributes.x2 ?? null,
      y2: gradientAttributes.y2 ?? null,
      stops: stops.map(stop => ({ offset: stop.offset ?? null, color: stop['stop-color'] ?? null })),
    },
    links: links.map(link => ({
      source: link['data-source'] ?? null,
      target: link['data-target'] ?? null,
      stroke: link.stroke ?? null,
      blendMode: link.style?.match(/mix-blend-mode:([^;]+)/)?.[1] ?? null,
      pathEndpoints: pathEndpoints(link.d ?? null),
    })),
    externalReferences: verifyNoExternalRefs(svg).refs,
  }
}

const sankeyGradientSource = `${['---', 'config:', '  sankey:', '    linkColor: gradient', '    nodeColors:', '      A: "#ff0000"', '      B: "#0000ff"', '---', 'sankey-beta', '  A,B,1'].join('\n')}\n`

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
      const endpoints = record(link.pathEndpoints ?? null, 'sankey link endpoints')
      const x1 = svgNumber(gradient.x1 ?? null)
      const y1 = svgNumber(gradient.y1 ?? null)
      const x2 = svgNumber(gradient.x2 ?? null)
      const y2 = svgNumber(gradient.y2 ?? null)
      return semanticFacts.gradientCount === 1 &&
        typeof gradient.id === 'string' &&
        gradient.id.length > 0 &&
        gradient.units === 'userSpaceOnUse' &&
        x1 !== null &&
        y1 !== null &&
        x2 !== null &&
        y2 !== null &&
        x1 === endpoints.startX &&
        y1 === endpoints.startY &&
        x2 === endpoints.endX &&
        y2 === endpoints.endY &&
        endpoints.startX !== endpoints.endX &&
        sourceStop.offset === '0%' &&
        sourceStop.color === '#ff0000' &&
        targetStop.offset === '100%' &&
        targetStop.color === '#0000ff' &&
        link.source === 'A' &&
        link.target === 'B' &&
        link.stroke === `url(#${gradient.id})` &&
        Array.isArray(semanticFacts.externalReferences) &&
        semanticFacts.externalReferences.length === 0
        ? 'native'
        : 'absent'
    }),
    serialize: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.serializedSource === sankeyGradientSource && semanticFacts.reserializedSource === sankeyGradientSource && matchesSankeyFacts(semanticFacts.reparsedDiagram ?? null, 1) ? 'native' : 'absent'
    }),
    mutate: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.mutationOk === true && typeof semanticFacts.serializedSource === 'string' && semanticFacts.serializedSource.includes('  A,B,2\n') && semanticFacts.serializedSource.startsWith('---\nconfig:\n  sankey:') && matchesSankeyFacts(semanticFacts.reparsedDiagram ?? null, 2)
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

function sankeyCompositingCase(id: string, background: string, expectedDisposition: FidelityDisposition): FidelityCaseDefinition {
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
        if (semanticFacts.background !== background) fail(`unexpected Sankey render background: ${JSON.stringify(semanticFacts.background)}`)
        const links = semanticFacts.links
        if (!Array.isArray(links) || links.length !== 1) fail(`expected one Sankey composited link: ${JSON.stringify(links)}`)
        const link = record(links[0] ?? null, 'Sankey composited link')
        if (link.blendMode === 'multiply' && link.opacity === '0.5') return 'native'
        if (link.blendMode === 'normal' && link.opacity === '0.5') return 'absent'
        fail(`unrecognized Sankey compositing: ${JSON.stringify(link)}`)
      }),
      serialize: notApplicable('Backend compositing does not change or serialize Mermaid source.'),
      mutate: notApplicable('Backend compositing has no structured mutation operation.'),
    },
    observe: () => {
      const svg = renderMermaidSVG(sankeyGradientSource, { bg: background })
      const rootStyle = attributes(svg.match(/^<svg\b[^>]*>/)?.[0] ?? '').style ?? ''
      const links = tagsWithClass(svg, 'path', 'sankey-link')
      return {
        render: {
          status: 'observed',
          diagnosticCodes: [],
          semantics: {
            background: rootStyle.match(/(?:^|;)background:([^;]+)/)?.[1] ?? null,
            links: links.map(link => ({
              blendMode: link.style?.match(/mix-blend-mode:([^;]+)/)?.[1] ?? null,
              opacity: link.opacity ?? null,
            })),
          },
        },
      }
    },
  }
}

const sankeyLightMultiply = sankeyCompositingCase('sankey.links.light-background-multiply', '#ffffff', 'native')

const sankeyDarkNormalDivergence = sankeyCompositingCase('sankey.links.dark-background-normal-alpha-divergence', '#071823', 'absent')

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
      const texts = semanticFacts.texts
      return matchesXychartBars(semanticFacts.bars ?? null, ['10', '20']) && Array.isArray(texts) && ['Revenue; Q1', 'USD', 'Online', 'Jan', 'Feb'].every(text => texts.includes(text)) ? 'native' : 'absent'
    }),
    serialize: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return typeof semanticFacts.serializedSource === 'string' && semanticFacts.serializedSource !== xychartSharedParserSource && semanticFacts.reserializedSource === semanticFacts.serializedSource && matchesXychartFacts(semanticFacts.reparsedDiagram ?? null, 20) ? 'native' : 'absent'
    }),
    mutate: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.mutationOk === true && semanticFacts.reserializedSource === semanticFacts.serializedSource && matchesXychartFacts(semanticFacts.reparsedDiagram ?? null, 25) && matchesXychartBars(semanticFacts.renderedBars ?? null, ['10', '25'])
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
    const barFacts = (rendered: string) =>
      tagsWithClass(rendered, 'rect', 'xychart-bar').map(bar => ({
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
      evidence => {
        const semanticFacts = facts(evidence)
        return semanticFacts.bodyKind === 'opaque' && semanticFacts.bodyFamily === 'xychart' && semanticFacts.bodySource === xychartUnknownStatementSource ? 'source-preserved' : 'absent'
      },
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
    const renderDiagnosticCodes = renderErrorMessage === null ? [] : verification.warnings.map(warning => warning.code).filter(code => code === 'RENDER_FAILED')
    const mutation = mutate(parsed, { kind: 'set_title', title: 'Changed' })
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: verification.warnings.map(warning => warning.code).filter(code => code === 'UNSUPPORTED_SYNTAX'),
        semantics: {
          bodyKind: parsed.body.kind,
          bodyFamily: parsed.body.kind === 'opaque' ? parsed.body.family : null,
          bodySource: parsed.body.kind === 'opaque' ? parsed.body.source : null,
        },
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
  return (
    semanticFacts.bodyKind === 'flowchart' &&
    Array.isArray(edges) &&
    edges.length === expected.length &&
    edges.every((edge, index) => {
      const actual = record(edge, `flowchart edge ${index}`)
      const wanted = expected[index]!
      return actual.source === wanted.source && actual.target === wanted.target && actual.label === wanted.label
    })
  )
}

function flowchartRenderFacts(rendered: string): FidelityJson {
  const edges = [...rendered.matchAll(/<(?:path|polyline)\b[^>]*(?:data-from|data-to)="[^"]+"[^>]*>/g)]
    .map(match => attributes(match[0]!))
    .filter(edge => edge['data-from'] && edge['data-to'])
    .map(edge => ({ source: edge['data-from']!, target: edge['data-to']!, label: edge['data-label'] ?? null }))
  const labelGroups = [...rendered.matchAll(/<g\b[^>]*class="[^"]*\bedge-label\b[^"]*"[^>]*>[\s\S]*?<\/g>/g)].map(match => {
    const opening = match[0].match(/^<g\b[^>]*>/)?.[0] ?? ''
    const group = attributes(opening)
    return {
      source: group['data-from'] ?? null,
      target: group['data-to'] ?? null,
      label: group['data-label'] ?? null,
      visibleText: textNodes(match[0]).join(''),
    }
  })
  return { edges, labelGroups }
}

function matchesRenderedFlowchart(value: FidelityJson, expected: readonly Readonly<Record<string, string>>[]): boolean {
  const rendered = record(value, 'rendered flowchart facts')
  const edges = rendered.edges
  const labelGroups = rendered.labelGroups
  return Array.isArray(edges) &&
    edges.length === expected.length &&
    edges.every((edge, index) => {
      const actual = record(edge, `rendered flowchart edge ${index}`)
      const wanted = expected[index]!
      return actual.source === wanted.source && actual.target === wanted.target && actual.label === wanted.label
    }) &&
    Array.isArray(labelGroups) &&
    labelGroups.length === expected.length &&
    labelGroups.every((group, index) => {
      const actual = record(group, `rendered flowchart label ${index}`)
      const wanted = expected[index]!
      return actual.source === wanted.source && actual.target === wanted.target && actual.label === wanted.label && actual.visibleText === wanted.label
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
    agent: applicable('native', evidence => (matchesFlowchartEdges(facts(evidence).diagram ?? null, [{ source: 'A', target: 'B', label: ' a ' }]) ? 'native' : 'absent')),
    render: applicable('native', evidence =>
      matchesRenderedFlowchart(facts(evidence).rendered ?? null, [{ source: 'A', target: 'B', label: ' a ' }]) ? 'native' : 'absent',
    ),
    serialize: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      return semanticFacts.serializedSource === flowchartBoundaryWhitespaceSource && semanticFacts.reserializedSource === flowchartBoundaryWhitespaceSource && matchesFlowchartEdges(semanticFacts.reparsedDiagram ?? null, [{ source: 'A', target: 'B', label: ' a ' }]) ? 'native' : 'absent'
    }),
    mutate: applicable('native', evidence => {
      const semanticFacts = facts(evidence)
      const expectedEdges = [
        { source: 'A', target: 'B', label: ' a ' },
        { source: 'B', target: 'A', label: ' b ' },
      ]
      return semanticFacts.mutationOk === true &&
        typeof semanticFacts.serializedSource === 'string' &&
        semanticFacts.serializedSource.includes('B -->|" b "| A') &&
        semanticFacts.reserializedSource === semanticFacts.serializedSource &&
        matchesFlowchartEdges(semanticFacts.mutatedDiagram ?? null, expectedEdges) &&
        matchesFlowchartEdges(semanticFacts.reparsedDiagram ?? null, expectedEdges) &&
        matchesRenderedFlowchart(semanticFacts.rendered ?? null, [
          { source: 'A', target: 'B', label: ' a ' },
          { source: 'B', target: 'A', label: ' b ' },
        ])
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
    const mutatedSvg = mutatedReparse ? renderMermaidSVG(mutatedSource) : ''
    return {
      agent: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { diagram: flowchartEdgeFacts(parsed) },
      },
      render: {
        status: 'observed',
        diagnosticCodes: [],
        semantics: { rendered: flowchartRenderFacts(svg) },
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
          rendered: flowchartRenderFacts(mutatedSvg),
        },
      },
    }
  },
}

export const fidelityCases: readonly FidelityCaseDefinition[] = Object.freeze([sankeyGradientEndpoints, sankeyLightMultiply, sankeyDarkNormalDivergence, xychartSharedParser, xychartUnknownStatementSeam, flowchartBoundaryWhitespaceMutation])
