import { withParserSource } from './shared/parser-source.ts'
import { parseUsecase } from './usecase/grammar/parser.ts'
import { assertUsecaseWork } from './usecase/parser.ts'
import { assertDiagramWorkLimit } from './shared/diagram-limits.ts'
import { parseAgentflow } from './agentflow/parser.ts'
import { PeleError } from './usecase/grammar/support.ts'
import { sourceLineStarts, sourcePointAt } from './shared/source-spans.ts'
// Public, layout-free access to the same typed models used by the renderers.
import { expandInlineNamespaceStatement, parseClassDiagram as parseClassLines } from './class/parser.ts'
import { parseErDiagram as parseErLines } from './er/parser.ts'
import { authoredSequenceColumn, authoredSequenceLine, parseSequenceDiagram as parseSequenceLines } from './sequence/parser.ts'
import { sequenceFamilySource } from './sequence/family-source.ts'
import { resolveSequenceConfig } from './sequence/config.ts'
import { detectDiagramTypeFromFirstLine, getFrontmatterScalar, normalizeMermaidSource, preservedMermaidFamilySource, withFrontmatterTitle, type NormalizedMermaidSource } from './mermaid-source.ts'
import { withAccessibilityFields } from './shared/accessibility-directives.ts'
import { MermaidSyntaxError } from './shared/syntax-error.ts'

export type { ClassDiagram, ClassMember, ClassNode as ClassDiagramNode, ClassRelationship, ClassNamespace } from './class/types.ts'
export type { ErDiagram, ErEntity as ErDiagramEntity, ErAttribute as ErDiagramAttribute, ErRelationship, ErGroup } from './er/types.ts'
export type {
  SequenceDiagram, Actor as SequenceActor, Message as SequenceDiagramMessage,
  Note as SequenceDiagramNote, Block as SequenceDiagramBlock, SequenceActorType,
  SequenceMessageHead, SequenceBoxGroup, SequenceActivationEvent,
} from './sequence/types.ts'
export { MermaidSyntaxError } from './shared/syntax-error.ts'
export type { MermaidSyntaxErrorLocation } from './shared/syntax-error.ts'
export type { UsecaseModel, GraphStatement as UsecaseStatement } from './usecase/grammar/types.ts'
export type { AgentflowBody as AgentflowModel, AgentflowMapping } from './agentflow/types.ts'

function sourceFor(source: string, diagramType: 'class' | 'er' | 'sequence' | 'usecase' | 'agentflow', header: string) {
  const normalized = normalizeMermaidSource(source, {}, 'render')
  if (detectDiagramTypeFromFirstLine(normalized.firstLine) !== diagramType) {
    throw new MermaidSyntaxError(`Expected ${header} header`, { diagramType })
  }
  return normalized
}

/** Parse UseCase declarations and source occurrences without layout or the
 * editor's opaque fallback. Spans index the returned model.source: the authored
 * family payload after frontmatter and universal init directives are removed. */
export function parseUsecaseModel(source: string) {
  assertDiagramWorkLimit('sourceCharacters', source.length)
  const normalized = sourceFor(source, 'usecase', 'usecase-beta')
  const payload = preservedMermaidFamilySource(normalized, 'authored')
  try {
    const model = parseUsecase(payload.text)
    assertUsecaseWork(model)
    return withFrontmatterTitle(model, normalized.frontmatter)
  }
  catch (error) {
    if (!(error instanceof PeleError)) throw error
    const offset = sourceLineStarts(payload.text)[error.location.line - 1]! + error.location.column - 1
    const point = sourcePointAt(sourceLineStarts(source), payload.sourceOffset(offset))
    throw new MermaidSyntaxError(error.message, { diagramType: 'usecase', line: point.line, column: point.col })
  }
}

/** Parse AgentFlow graph, metadata and complete container ranges. Mapping
 * coordinates address the authored family payload after wrapper/init removal. */
export function parseAgentflowModel(source: string) {
  const normalized = sourceFor(source, 'agentflow', 'agentflow-beta')
  return parseAgentflow(preservedMermaidFamilySource(normalized, 'authored').text)
}

function parseAtSource<T>(source: NormalizedMermaidSource, diagramType: 'class' | 'er', parse: () => T): T {
  return withParserSource(source, () => diagramType === 'class' ? source.familyLines.flatMap(expandInlineNamespaceStatement) : source.familyLines, parse)
}

/** Parse complete Mermaid source, including front matter, without running layout. */
export function parseClassDiagram(source: string) {
  const normalized = sourceFor(source, 'class', 'classDiagram')
  return withFrontmatterTitle(withAccessibilityFields(parseAtSource(normalized, 'class', () => parseClassLines(
    normalized.familyLines, normalized.authoredFamilyLines ?? normalized.familyLines,
  )), normalized.accessibility), normalized.frontmatter)
}

/** Parse ER attributes into separate type, name, key and comment fields. */
export function parseErDiagram(source: string) {
  const normalized = sourceFor(source, 'er', 'erDiagram')
  const diagram = withFrontmatterTitle(withAccessibilityFields(
    parseAtSource(normalized, 'er', () => parseErLines(normalized.familyLines)), normalized.accessibility,
  ), normalized.frontmatter)
  const direction = getFrontmatterScalar<string>(normalized.frontmatter, ['er', 'layoutDirection'])
  if (!diagram.direction && typeof direction === 'string' && /^(TB|TD|BT|LR|RL)$/i.test(direction)) diagram.direction = direction.toUpperCase() as import('./types.ts').Direction
  return diagram
}

/** Parse sequence notes, activations, boxes, lifecycle bindings and messages. */
export function parseSequenceDiagram(source: string) {
  const normalized = sourceFor(source, 'sequence', 'sequenceDiagram')
  const family = sequenceFamilySource(normalized, 'decoded')
  const coordinates = family === normalized ? family : { ...normalized, familyLines: family.familyLines }
  return withFrontmatterTitle(withAccessibilityFields(parseSequenceLines(family.familyLines, {
    ...resolveSequenceConfig(normalized.frontmatter), authoredLine: authoredSequenceLine(coordinates), authoredColumn: authoredSequenceColumn(coordinates),
  }), normalized.accessibility), normalized.frontmatter)
}
