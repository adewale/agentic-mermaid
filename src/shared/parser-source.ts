import { sequenceGrammarSource } from '../sequence/family-source.ts'
import { preservedMermaidFamilySource } from '../mermaid-source.ts'
import { splitHeaderStatement } from '../mermaid-source-wrapper.ts'
import { installedFamilyStatementEnds } from '../agent/family-router.ts'
import { scanAccessibilityDirectives } from './accessibility-directives.ts'
import { scanSequenceStatementLines } from '../sequence/statements.ts'
import { sourceLineStarts, sourcePointAt } from './source-spans.ts'
import { LocatedParserError } from './syntax-error.ts'

import { createParserSource } from './parser-source-kernel.ts'
const bindings = [sequenceGrammarSource, preservedMermaidFamilySource, splitHeaderStatement, installedFamilyStatementEnds, scanAccessibilityDirectives, scanSequenceStatementLines, sourceLineStarts, sourcePointAt, (error: unknown): error is LocatedParserError => error instanceof LocatedParserError] as const
export const { authoredParserLine, authoredSyntaxLocation, withParserSource, authoredParserColumn } = createParserSource(bindings)
