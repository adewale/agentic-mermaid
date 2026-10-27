import type { ParserObservation } from '../../src/shared/parser-observation.ts'
import { projectNativeDomains, projectReferenceDomains } from './grammar-native-domains.ts'
import { projectNativeC4, projectReferenceC4 } from './grammar-native-c4.ts'
import { projectNativeGraphs, projectReferenceGraphs } from './grammar-native-graphs.ts'
import { projectNativeLines, projectReferenceLines } from './grammar-native-lines.ts'
import { projectNativeNumeric, projectReferenceNumeric } from './grammar-native-numeric.ts'
import { projectNativeSequence, projectReferenceSequence } from './grammar-native-sequence.ts'
import { projectNativeStable, projectReferenceStable } from './grammar-native-stable.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'

/** Per-family independent RESULT adapters. These projections do not emit or
 * substitute for native token, statement, or builder-operation observations.
 */
export function projectNativeSemantic(family: string, model: unknown, events: readonly ParserObservation[] = []): NativeSemanticProjection | undefined {
  return projectNativeDomains(family, model) ?? projectNativeC4(family, model) ?? projectNativeGraphs(family, model) ?? projectNativeSequence(family, model) ?? projectNativeNumeric(family, model) ?? projectNativeLines(family, model) ?? projectNativeStable(family, model, events)
}

export function projectReferenceSemantic(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  return projectReferenceDomains(family, reply) ?? projectReferenceC4(family, reply) ?? projectReferenceGraphs(family, reply) ?? projectReferenceSequence(family, reply) ?? projectReferenceNumeric(family, reply) ?? projectReferenceLines(family, reply) ?? projectReferenceStable(family, reply)
}
