import { withParserSource } from './shared/parser-source.ts'
// Public, layout-free access to the same typed models used by the renderers.
import { expandInlineNamespaceStatement, parseClassDiagram as parseClassLines } from './class/parser.ts'
import { parseErDiagram as parseErLines } from './er/parser.ts'
import { authoredSequenceColumn, authoredSequenceLine, parseSequenceDiagram as parseSequenceLines } from './sequence/parser.ts'
import { sequenceFamilySource } from './sequence/family-source.ts'
import { resolveSequenceConfig } from './sequence/config.ts'
import { detectDiagramTypeFromFirstLine, getFrontmatterScalar, normalizeMermaidSource, withFrontmatterTitle, type NormalizedMermaidSource } from './mermaid-source.ts'
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

function sourceFor(source: string, diagramType: 'class' | 'er' | 'sequence', header: string) {
  const normalized = normalizeMermaidSource(source, {}, 'render')
  if (detectDiagramTypeFromFirstLine(normalized.firstLine) !== diagramType) {
    throw new MermaidSyntaxError(`Expected ${header} header`, { diagramType })
  }
  return normalized
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
