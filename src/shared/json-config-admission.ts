/**
 * One bounded admission contract for JSON-shaped public options and Mermaid
 * configuration. The walk is iterative so hostile depth is rejected before a
 * schema validator, config clone/merge, snapshot, or digest can recurse.
 */

import { boundedUtf8ByteLength } from './utf8.ts'

export const JSON_CONFIG_ADMISSION_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxItemsPerContainer: 4_096,
  maxAggregateTextCharacters: 5_000_000,
  maxAggregateTextBytes: 10_000_000,
  maxDiagnostics: 64,
})

export type JsonConfigAdmissionProblemCode =
  | 'JSON_DEPTH_LIMIT'
  | 'JSON_NODE_LIMIT'
  | 'JSON_ITEM_LIMIT'
  | 'JSON_TEXT_CHARACTER_LIMIT'
  | 'JSON_TEXT_BYTE_LIMIT'
  | 'JSON_DIAGNOSTIC_LIMIT'
  | 'JSON_CYCLE'
  | 'JSON_PROTOTYPE_KEY'
  | 'JSON_NON_PLAIN_OBJECT'
  | 'JSON_NON_JSON_VALUE'
  | 'JSON_SPARSE_ARRAY'

export interface JsonConfigAdmissionProblem {
  readonly code: JsonConfigAdmissionProblemCode
  readonly path: readonly (string | number)[]
  readonly message: string
}

export interface JsonConfigAdmissionOptions {
  /** Canonical object digests historically omit properties whose value is
   * undefined. Config/options admission keeps the stricter default. */
  readonly allowUndefinedObjectProperties?: boolean
}

const FORBIDDEN_PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

type VisitFrame = {
  readonly kind: 'visit'
  readonly value: unknown
  readonly path: readonly (string | number)[]
  readonly depth: number
}

type ExitFrame = {
  readonly kind: 'exit'
  readonly value: object
}

type AdmissionFrame = VisitFrame | ExitFrame

function plainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function nonJsonValueMessage(value: unknown): string {
  if (typeof value === 'number') return 'must be a finite number'
  return `must be a JSON value, not ${typeof value}`
}

/**
 * Validate one JSON-shaped tree under the shared aggregate budget. Shared
 * references are allowed, but cycles are not; every occurrence is charged so
 * a YAML alias graph cannot expand into unbounded clone work later.
 */
export function validateJsonConfigAdmission(
  value: unknown,
  initialPath: readonly (string | number)[] = [],
  options: JsonConfigAdmissionOptions = {},
): JsonConfigAdmissionProblem[] {
  const limits = JSON_CONFIG_ADMISSION_LIMITS
  const problems: JsonConfigAdmissionProblem[] = []
  const active = new WeakSet<object>()
  const stack: AdmissionFrame[] = [{ kind: 'visit', value, path: initialPath, depth: 0 }]
  let nodes = 0
  let textCharacters = 0
  let textBytes = 0
  let stopped = false

  const addProblem = (
    code: JsonConfigAdmissionProblemCode,
    path: readonly (string | number)[],
    message: string,
    terminal = false,
  ): void => {
    if (stopped) return
    if (problems.length >= limits.maxDiagnostics - 1) {
      problems.push({
        code: 'JSON_DIAGNOSTIC_LIMIT',
        path: initialPath,
        message: `exceeds the ${limits.maxDiagnostics}-diagnostic admission limit`,
      })
      stopped = true
      return
    }
    problems.push({ code, path, message })
    if (terminal) stopped = true
  }

  const chargeText = (text: string, path: readonly (string | number)[]): void => {
    if (stopped) return
    textCharacters += text.length
    if (textCharacters > limits.maxAggregateTextCharacters) {
      addProblem(
        'JSON_TEXT_CHARACTER_LIMIT',
        path,
        `exceeds the aggregate ${limits.maxAggregateTextCharacters}-character text limit`,
        true,
      )
      return
    }
    const remaining = limits.maxAggregateTextBytes - textBytes
    textBytes += boundedUtf8ByteLength(text, Math.max(0, remaining))
    if (textBytes > limits.maxAggregateTextBytes) {
      addProblem(
        'JSON_TEXT_BYTE_LIMIT',
        path,
        `exceeds the aggregate ${limits.maxAggregateTextBytes}-byte UTF-8 text limit`,
        true,
      )
    }
  }

  while (stack.length > 0 && !stopped) {
    const frame = stack.pop()!
    if (frame.kind === 'exit') {
      active.delete(frame.value)
      continue
    }

    if (frame.depth > limits.maxDepth) {
      addProblem(
        'JSON_DEPTH_LIMIT',
        frame.path,
        `exceeds maximum nesting depth ${limits.maxDepth}`,
        true,
      )
      continue
    }
    nodes++
    if (nodes > limits.maxNodes) {
      addProblem(
        'JSON_NODE_LIMIT',
        frame.path,
        `exceeds the aggregate ${limits.maxNodes}-node limit`,
        true,
      )
      continue
    }

    const current = frame.value
    if (current === null || typeof current === 'boolean') continue
    if (typeof current === 'string') {
      chargeText(current, frame.path)
      continue
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) addProblem('JSON_NON_JSON_VALUE', frame.path, nonJsonValueMessage(current))
      continue
    }
    if (typeof current !== 'object') {
      addProblem('JSON_NON_JSON_VALUE', frame.path, nonJsonValueMessage(current))
      continue
    }

    if (active.has(current)) {
      addProblem('JSON_CYCLE', frame.path, 'must be acyclic')
      continue
    }

    if (Array.isArray(current)) {
      if (current.length > limits.maxItemsPerContainer) {
        addProblem(
          'JSON_ITEM_LIMIT',
          frame.path,
          `must contain at most ${limits.maxItemsPerContainer} items`,
          true,
        )
        continue
      }
      active.add(current)
      stack.push({ kind: 'exit', value: current })
      for (let index = current.length - 1; index >= 0; index--) {
        if (!Object.prototype.hasOwnProperty.call(current, index)) {
          addProblem('JSON_SPARSE_ARRAY', [...frame.path, index], 'must not be a sparse array')
          continue
        }
        stack.push({ kind: 'visit', value: current[index], path: [...frame.path, index], depth: frame.depth + 1 })
      }
      continue
    }

    if (!plainJsonObject(current)) {
      addProblem('JSON_NON_PLAIN_OBJECT', frame.path, 'must be a plain JSON object')
      continue
    }
    const entries = Object.entries(current)
    if (entries.length > limits.maxItemsPerContainer) {
      addProblem(
        'JSON_ITEM_LIMIT',
        frame.path,
        `must contain at most ${limits.maxItemsPerContainer} properties`,
        true,
      )
      continue
    }
    active.add(current)
    stack.push({ kind: 'exit', value: current })
    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, child] = entries[index]!
      const childPath = [...frame.path, key]
      chargeText(key, childPath)
      if (FORBIDDEN_PROTOTYPE_KEYS.has(key)) {
        addProblem('JSON_PROTOTYPE_KEY', childPath, 'uses a forbidden prototype key')
        continue
      }
      if (child === undefined && options.allowUndefinedObjectProperties) continue
      stack.push({ kind: 'visit', value: child, path: childPath, depth: frame.depth + 1 })
    }
  }

  return problems
}

export function formatJsonConfigAdmissionPath(path: readonly (string | number)[]): string {
  let result = '$'
  for (const part of path) {
    if (typeof part === 'number') result += `[${part}]`
    else if (/^[A-Za-z_$][\w$]*$/.test(part)) result += `.${part}`
    else result += `[${JSON.stringify(part)}]`
  }
  return result
}

export class JsonConfigAdmissionError extends TypeError {
  readonly code = 'JSON_CONFIG_ADMISSION_FAILED'

  constructor(
    readonly context: string,
    readonly problems: readonly JsonConfigAdmissionProblem[],
  ) {
    super(`${context} failed JSON/config admission: ${problems.map(problem =>
      `${formatJsonConfigAdmissionPath(problem.path)} ${problem.message}`).join('; ')}`)
    this.name = 'JsonConfigAdmissionError'
  }
}

export function assertJsonConfigAdmission(
  value: unknown,
  context: string,
  options: JsonConfigAdmissionOptions = {},
): void {
  const problems = validateJsonConfigAdmission(value, [], options)
  if (problems.length > 0) throw new JsonConfigAdmissionError(context, problems)
}

/**
 * Reject over-budget source config text and pathological flow nesting before a
 * YAML/fallback parser can create a recursively walked object. Braces inside
 * quoted strings and YAML comments do not affect the structural depth.
 */
export function assertJsonConfigSourceTextAdmission(
  value: string,
  context: string,
  options: { readonly trackFlowDepth?: boolean } = {},
): void {
  const limits = JSON_CONFIG_ADMISSION_LIMITS
  const problems: JsonConfigAdmissionProblem[] = []
  if (value.length > limits.maxAggregateTextCharacters) {
    problems.push({
      code: 'JSON_TEXT_CHARACTER_LIMIT', path: [],
      message: `exceeds the aggregate ${limits.maxAggregateTextCharacters}-character text limit`,
    })
  } else if (boundedUtf8ByteLength(value, limits.maxAggregateTextBytes) > limits.maxAggregateTextBytes) {
    problems.push({
      code: 'JSON_TEXT_BYTE_LIMIT', path: [],
      message: `exceeds the aggregate ${limits.maxAggregateTextBytes}-byte UTF-8 text limit`,
    })
  }

  if (problems.length === 0 && options.trackFlowDepth) {
    const openings: string[] = []
    let quote: '"' | "'" | undefined
    let escaped = false
    let comment = false
    for (let index = 0; index < value.length; index++) {
      const char = value[index]!
      if (comment) {
        if (char === '\n' || char === '\r') comment = false
        continue
      }
      if (quote) {
        if (quote === '"' && escaped) { escaped = false; continue }
        if (quote === '"' && char === '\\') { escaped = true; continue }
        if (quote === "'" && char === "'" && value[index + 1] === "'") { index++; continue }
        if (char === quote) quote = undefined
        continue
      }
      if (char === '"' || char === "'") { quote = char; continue }
      if (char === '#') { comment = true; continue }
      if (char === '{' || char === '[') {
        openings.push(char)
        if (openings.length > limits.maxDepth) {
          problems.push({
            code: 'JSON_DEPTH_LIMIT', path: [],
            message: `exceeds maximum nesting depth ${limits.maxDepth}`,
          })
          break
        }
      } else if (char === '}' || char === ']') openings.pop()
    }
  }

  if (problems.length > 0) throw new JsonConfigAdmissionError(context, problems)
}

/** Cap adapter/schema diagnostics with the same public admission limit. */
export function limitJsonConfigDiagnostics(messages: readonly string[], prefix: string): string[] {
  const maximum = JSON_CONFIG_ADMISSION_LIMITS.maxDiagnostics
  if (messages.length <= maximum) return [...messages]
  return [
    ...messages.slice(0, maximum - 1),
    `${prefix} exceeds the ${maximum}-diagnostic admission limit`,
  ]
}
