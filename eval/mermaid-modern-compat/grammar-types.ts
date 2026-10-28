import type { ParserObservation } from '../../src/shared/parser-observation.ts'
import type { Json } from './reference.ts'

export type GrammarToken = [kind: string, image: string]
export type GrammarAction = Json[]
export type GrammarObservation<T> = { status: 'available'; method: string; value: T } | { status: 'unavailable'; reason: string }

export interface NativeParserObservation {
  statements: GrammarObservation<ParserObservation[]>
  tokens: GrammarObservation<ParserObservation[]>
  mutations: GrammarObservation<ParserObservation[]>
  /** Native parser result, separate from the operations actually observed. */
  model?: Json
  semantic?: NativeSemanticProjection
  instrumentationErrors?: string[]
  control?: { same: boolean; observedAccepted: boolean; unobservedAccepted: boolean; observedError?: string; unobservedError?: string }
}

export interface NativeSemanticProjection {
  fields: string[]
  value: Json
}

export interface GrammarReferenceRequest {
  family: string
  source: string
}

export interface GrammarReferenceReply {
  requestedFamily: string
  /** The actual upstream definition selected within this family; malformed/cross-family headers use prepare()'s fallback. */
  type: string
  /** Upstream header detection, when possible, reported separately from forced grammar selection. */
  detectedType?: string
  /** Acceptance by that selected grammar and its actual model builder, after upstream preprocessing. */
  accepted: boolean
  error?: string
  preparedSource?: string
  engine: 'jison' | 'langium' | 'chevrotain' | 'zenuml-core' | 'unavailable'
  parserIdentity?: Record<string, string>
  grammarSources: string[]
  tokens: GrammarObservation<GrammarToken[]>
  actions: GrammarObservation<GrammarAction[]>
  ast: GrammarObservation<Json>
  snapshot?: { data: Record<string, Json>; errors: Record<string, string> }
  instrumentationErrors?: string[]
}

export interface GrammarReferencePreparation {
  family: string
  type: string
  engine: GrammarReferenceReply['engine']
  grammarSources: string[]
  tokenInstrumentation: string
  actionInstrumentation: string
  astInstrumentation: string
  parserIdentity?: Record<string, string>
}
