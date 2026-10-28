import { parseZenUML } from '../../src/zenuml/native-parser.ts'
import { parseEventModeling } from '../../src/eventmodeling/parser.ts'
import { knownBuiltinFamilies, parseRegisteredMermaid, serializeMermaid } from '../../src/agent/core.ts'
import { architectureSourceLines, parseArchitectureDiagram } from '../../src/architecture/parser.ts'
import { parseBlockDiagram } from '../../src/block/parser.ts'
import { parseC4Diagram } from '../../src/c4/parser.ts'
import { parseClassDiagram } from '../../src/class/parser.ts'
import { parseErDiagram } from '../../src/er/parser.ts'
import { applyResolvedGanttFrontmatterConfig, parseGanttModel, resolveGanttFrontmatterConfig } from '../../src/gantt/parser.ts'
import { parseGitGraph } from '../../src/gitgraph/parser.ts'
import { resolveGitGraphPositionConfig } from '../../src/gitgraph/position.ts'
import { parseIshikawaDiagram } from '../../src/ishikawa/parser.ts'
import { parseJourneyDiagram } from '../../src/journey/parser.ts'
import { parseKanbanDiagram } from '../../src/kanban/parser.ts'
import { frontmatterTitle, normalizeMermaidSource, preservedMermaidFamilyText, withFrontmatterTitle } from '../../src/mermaid-source.ts'
import { withAccessibilityFields } from '../../src/shared/accessibility-directives.ts'
import { parseMindmap } from '../../src/mindmap/parser.ts'
import { parsePacketDiagram } from '../../src/packet/parser.ts'
import { parseFlowchartRenderSource, parseMermaid } from '../../src/parser.ts'
import { parsePieChart } from '../../src/pie/parser.ts'
import { pieFamilyLines } from '../../src/pie/source-title.ts'
import { parseQuadrantChart } from '../../src/quadrant/parser.ts'
import { parseRadarChart } from '../../src/radar/parser.ts'
import { resolvedFamilyRenderContextOf, resolvedRenderExecutionPlanOf, resolveRenderRequestForExecution } from '../../src/render-contract.ts'
import { parseRequirementDiagram } from '../../src/requirement/parser.ts'
import { parseSankeyDiagram } from '../../src/sankey/parser.ts'
import { resolveSequenceConfig } from '../../src/sequence/config.ts'
import { authoredSequenceLine, parseSequenceDiagram } from '../../src/sequence/parser.ts'
import { sequenceFamilySource } from '../../src/sequence/family-source.ts'
import { type ParserObservation, snapshotParserObservationValue, withParserObservation } from '../../src/shared/parser-observation.ts'
import { parseTimelineDiagram } from '../../src/timeline/parser.ts'
import { parseTreemapDiagram } from '../../src/treemap/parser.ts'
import { parseXYChart } from '../../src/xychart/parser.ts'
import { projectNativeSemantic } from './grammar-native-semantics.ts'
import type { NativeParserObservation } from './grammar-types.ts'

export interface AgenticGrammarResult {
  native: { status: 'accepted' | 'rejected' | 'unsupported'; stage?: 'request' | 'parser'; error?: string; observation: NativeParserObservation }
  envelope: { status: 'accepted' | 'rejected'; family?: string; representation?: 'structured' | 'opaque' | 'preserved'; error?: string }
  serialized?: string
}

const message = (error: unknown): string => String(error instanceof Error ? error.message : error).slice(0, 2000)
const nativeFamilies = new Set<string>(knownBuiltinFamilies())

/** The public renderer's actual normalization and native parser boundary,
 * shared by diagnostics and original-assertion adapters. It does no layout. */
export function parseNativeModel(family: string, source: string): unknown {
  const request = resolveRenderRequestForExecution(source, {}, 'svg')
  const selected = resolvedRenderExecutionPlanOf(request).family.id
  if (selected !== family) throw new Error(`Source routes to ${selected}, not requested family ${family}`)
  return nativeParserForRequest(family, request)()
}

function nativeParserForRequest(family: string, request: ReturnType<typeof resolveRenderRequestForExecution>): () => unknown {
  const normalized = request.source
  const context = resolvedFamilyRenderContextOf(request)
  const lines = normalized.familyLines
  return (): unknown => {
    switch (family) {
      case 'zenuml': {
        const source = preservedMermaidFamilyText(normalized)
        const body = parseZenUML(source)
        if (body.unsupportedSource !== undefined) throw Error('Unmodeled ZenUML source remains preserved')
        return withFrontmatterTitle(withAccessibilityFields(body, normalized.accessibility), normalized.frontmatter)
      }
      case 'flowchart':
        return parseFlowchartRenderSource(normalizeMermaidSource(normalized.originalText).familyBody, normalized.familyBody)
      case 'state':
        return parseMermaid(normalized.familyText)
      case 'c4': {
        const authored = normalizeMermaidSource(normalized.originalText)
        return parseC4Diagram(authored.originalText.slice((authored.wrapperSource ?? '').length))
      }
      // As the render hooks do, the envelope's accessibility and the
      // frontmatter title join the family's own reading.
      case 'architecture':
        return withFrontmatterTitle(withAccessibilityFields(parseArchitectureDiagram(architectureSourceLines(normalized)), normalized.accessibility), normalized.frontmatter)
      case 'class':
        return parseClassDiagram(lines, normalizeMermaidSource(normalized.originalText).familyLines)
      case 'er':
        return withFrontmatterTitle(withAccessibilityFields(parseErDiagram(lines), normalized.accessibility), normalized.frontmatter)
      case 'gantt': {
        const config = (context.familyConfig as { config?: ReturnType<typeof resolveGanttFrontmatterConfig> } | undefined)?.config ?? resolveGanttFrontmatterConfig(undefined)
        return applyResolvedGanttFrontmatterConfig(parseGanttModel(lines), config)
      }
      case 'gitgraph': {
        const config = resolveGitGraphPositionConfig(normalized.config.gitGraph, normalized.config.themeVariables)
        return parseGitGraph(normalized.familyBody, { mainBranchName: config.mainBranchName, mainBranchOrder: config.mainBranchOrder })
      }
      case 'journey':
        return parseJourneyDiagram(lines, normalized.accessibility)
      case 'mindmap':
        return parseMindmap(normalized.familyBody)
      case 'pie':
        return parsePieChart(pieFamilyLines(normalized))
      case 'quadrant':
        return parseQuadrantChart(lines)
      case 'radar':
        return parseRadarChart(normalized.lines)
      case 'sankey':
        return parseSankeyDiagram(normalized.body.split(/\r?\n/))
      case 'sequence': {
        const family = sequenceFamilySource(normalized, 'decoded')
        const config = (context.familyConfig as { sequence?: ReturnType<typeof resolveSequenceConfig> } | undefined)?.sequence ?? {}
        return withFrontmatterTitle(withAccessibilityFields(parseSequenceDiagram(family.familyLines, { ...config, authoredLine: authoredSequenceLine(family) }), normalized.accessibility), normalized.frontmatter)
      }
      case 'timeline':
        return parseTimelineDiagram(lines, normalized.accessibility)
      case 'xychart':
        return parseXYChart(lines)
      case 'eventmodeling': return withFrontmatterTitle(withAccessibilityFields(parseEventModeling(normalized.authoredFamilyBody ?? normalized.familyBody), normalized.accessibility), normalized.frontmatter)
      case 'packet': {
        const body = parsePacketDiagram(normalized.familyBody, normalized.accessibility)
        body.title ??= frontmatterTitle(normalized.frontmatter)
        return body
      }
      case 'kanban':
        return parseKanbanDiagram(normalized.familyBody, normalized.accessibility)
      case 'requirement': {
        const body = parseRequirementDiagram(normalized.familyBody)
        body.title ??= frontmatterTitle(normalized.frontmatter)
        return body
      }
      case 'block':
        return parseBlockDiagram(normalized.familyBody)
      case 'treemap': {
        const body = parseTreemapDiagram(normalized.familyBody)
        body.title ??= frontmatterTitle(normalized.frontmatter)
        return body
      }
      case 'ishikawa':
        return parseIshikawaDiagram(normalized.familyBody)
      default:
        throw new Error(`Missing renderer-parser adapter for native family ${family}`)
    }
  }
}

function unavailable(reason: string): NativeParserObservation {
  return { statements: { status: 'unavailable', reason }, tokens: { status: 'unavailable', reason }, mutations: { status: 'unavailable', reason } }
}

/** Actual renderer request normalization followed by the selected native parser.
 * Native fragments/statements and builder operations are observed in its own
 * implementation, never synthesized by re-lexing canonical Mermaid output.
 */
export function inspectAgenticGrammar(family: string, source: string, options: { observe?: boolean } = {}): AgenticGrammarResult {
  if (!nativeFamilies.has(family)) return { native: { status: 'unsupported', observation: unavailable('No native parser for this family') }, envelope: inspectEnvelope(source).envelope }
  let native: AgenticGrammarResult['native']
  let stage: 'request' | 'parser' = 'request'
  try {
    // The same waist as the public renderer: entities decode, the family is
    // selected, and authored Class/Pie views remain available. It does no
    // layout. Calling a low-level parser on raw encoded text would measure a
    // different input language from the one a consumer can actually render.
    const request = resolveRenderRequestForExecution(source, {}, 'svg')
    const selected = resolvedRenderExecutionPlanOf(request).family.id
    if (selected !== family) throw new Error(`Source routes to ${selected}, not requested family ${family}`)
    const parse = nativeParserForRequest(family, request)
    stage = 'parser'
    const events: ParserObservation[] = []
    const attempt = (run: () => unknown): { accepted: boolean; raw?: unknown; model?: ReturnType<typeof snapshotParserObservationValue>; error?: string } => {
      try {
        const raw = run()
        return { accepted: true, raw, model: snapshotParserObservationValue(raw) }
      } catch (error) {
        return { accepted: false, error: message(error) }
      }
    }
    if (options.observe === false) {
      const result = attempt(parse)
      native = { status: result.accepted ? 'accepted' : 'rejected', stage, ...(result.error ? { error: result.error } : {}), observation: unavailable('Observation was not requested') }
    } else {
      const observed = attempt(() => withParserObservation(family, event => events.push(event), parse))
      const control = attempt(parse)
      const same = observed.accepted === control.accepted && observed.error === control.error && JSON.stringify(observed.model) === JSON.stringify(control.model)
      let semantic: ReturnType<typeof projectNativeSemantic>, projectionError: string | undefined
      if (observed.accepted) {
        try {
          semantic = projectNativeSemantic(family, observed.raw, events)
        } catch (error) {
          projectionError = message(error)
        }
      }
      const observation: NativeParserObservation = {
        statements: { status: 'available', method: 'Actual native consumed classified statements; positions identify the parser-supplied physical or normalized view', value: events.filter(event => event.unit === 'statement') },
        tokens:
          family === 'flowchart' || family === 'c4'
            ? {
                status: 'available',
                method: family === 'c4' ? 'Actual forward C4 scanner chunks; physical UTF16 offsets and Unicode-code-point columns, not Mermaid terminals' : 'Actual native consumed compound node/link fragments, not Mermaid terminal kinds; positions unavailable where the consumer has only a remaining suffix',
                value: events.filter(event => event.unit === 'token'),
              }
            : { status: 'unavailable', reason: 'This native parser exposes classified statements, not a homologous lexer token stream' },
        mutations: { status: 'available', method: 'Actual native builder writes/operations in execution order; values copied at call time, including parent and membership fields', value: events.filter(event => event.unit === 'mutation') },
        ...(observed.model !== undefined ? { model: observed.model } : {}),
        ...(semantic ? { semantic } : {}),
        ...(projectionError ? { instrumentationErrors: [`Native semantic projection: ${projectionError}`] } : {}),
        control: { same, observedAccepted: observed.accepted, unobservedAccepted: control.accepted, ...(observed.error ? { observedError: observed.error } : {}), ...(control.error ? { unobservedError: control.error } : {}) },
      }
      native = { status: observed.accepted ? 'accepted' : 'rejected', stage, ...(observed.error ? { error: observed.error } : {}), observation }
    }
  } catch (error) {
    native = { status: 'rejected', stage, error: message(error), observation: unavailable('The public request was refused before this native parser could run') }
  }
  return { native, ...inspectEnvelope(source) }
}

function inspectEnvelope(source: string): Omit<AgenticGrammarResult, 'native'> {
  try {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok)
      return {
        envelope: {
          status: 'rejected',
          error: parsed.error
            .map(error => error.message)
            .join('; ')
            .slice(0, 2000),
        },
      }
    const diagram = parsed.value
    const representation = diagram.body.kind === 'preserved' || diagram.body.kind === 'zenuml' && diagram.body.unsupportedSource !== undefined ? 'preserved' : diagram.body.kind === 'opaque' ? 'opaque' : 'structured'
    return {
      envelope: { status: 'accepted', family: diagram.kind, representation },
      // Preserved/opaque bytes are not evidence of native model fidelity.
      ...(representation === 'structured' ? { serialized: serializeMermaid(diagram) } : {}),
    }
  } catch (error) {
    return { envelope: { status: 'rejected', error: message(error) } }
  }
}
