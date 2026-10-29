import { projectNativeEventModeling, projectReferenceEventModeling } from './grammar-native-eventmodeling.ts'
import type { ParserObservation } from '../../src/shared/parser-observation.ts'
import { projectNativeC4, projectReferenceC4 } from './grammar-native-c4.ts'
import { projectNativeGraphs, projectReferenceGraphs } from './grammar-native-graphs.ts'
import { projectNativeLines, projectReferenceLines } from './grammar-native-lines.ts'
import { projectNativeNumeric, projectReferenceNumeric } from './grammar-native-numeric.ts'
import { projectNativeSequence, projectReferenceSequence } from './grammar-native-sequence.ts'
import { projectNativeStable, projectReferenceStable } from './grammar-native-stable.ts'
import type { GrammarReferenceReply, NativeSemanticProjection } from './grammar-types.ts'
import { zenUMLMeaning } from '../../src/zenuml/native-body.ts'
import type { ZenUMLBody } from '../../src/zenuml/native-types.ts'

/** Per-family independent RESULT adapters. These projections do not emit or
 * substitute for native token, statement, or builder-operation observations.
 */
export function projectNativeSemantic(family: string, model: unknown, events: readonly ParserObservation[] = []): NativeSemanticProjection | undefined {
  // Editing addresses are not authored grammar. This native-only comparison
  // retains the actual recursive model; the public core exposes no AST oracle.
  if (family === 'zenuml') return { fields: ['participants', 'starter', 'statements', 'metadata'], value: JSON.parse(zenUMLMeaning(model as ZenUMLBody)) }
  return projectNativeEventModeling(family, model) ?? projectNativeC4(family, model) ?? projectNativeGraphs(family, model) ?? projectNativeSequence(family, model) ?? projectNativeNumeric(family, model) ?? projectNativeLines(family, model) ?? projectNativeStable(family, model, events)
}

export function projectReferenceSemantic(family: string, reply: GrammarReferenceReply): NativeSemanticProjection | undefined {
  return projectReferenceEventModeling(family, reply) ?? projectReferenceC4(family, reply) ?? projectReferenceGraphs(family, reply) ?? projectReferenceSequence(family, reply) ?? projectReferenceNumeric(family, reply) ?? projectReferenceLines(family, reply) ?? projectReferenceStable(family, reply)
}
