/*******************************************************************************
 * Copyright (c) 2009, 2015, 2022 Kiel University and others.
 * GWT decimal parsing: Copyright 2008 Google Inc., Apache-2.0,
 * http://www.apache.org/licenses/LICENSE-2.0.
 * TypeScript adaptation: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 *******************************************************************************/
import { resolveOptionId } from './option-ids.ts'
import { objectMember, primitiveString, readMember } from './json.ts'

export interface Insets { top: number; right: number; bottom: number; left: number }
export type Options = Map<string, string | null | (string | null)[]>
export type Direction = 'RIGHT' | 'LEFT' | 'DOWN' | 'UP'

export function importOptions(object: object): Options {
  const raw = objectMember(object, 'layoutOptions') ?? objectMember(object, 'properties')
  return raw === null ? new Map() : importOptionObject(raw)
}
export function importOptionObject(raw: object): Options {
  const result: Options = new Map()
  for (const key in raw) if ((raw as unknown as { hasOwnProperty(key: string): boolean }).hasOwnProperty(key)) {
    const value = primitiveString(readMember(raw, key)), id = resolveOptionId(key)
    if (id === null) continue
    const canonical = id.startsWith('org.eclipse.elk.') ? id.substring(16) : id, previous = result.get(canonical)
    if (result.has(canonical)) result.set(canonical, Array.isArray(previous) ? [...previous, value] : [previous as string | null, value])
    else result.set(canonical, value)
  }
  return result
}
// Duplicate suffix aliases are parsed in their authored order. An invalid
// later value does not replace a valid earlier property assignment.
function resolveOption<T>(options: Options, key: string, fallback: T, parse: (value: string) => T | undefined, allowEmpty = false): T {
  const values = options.get(key)
  if (Array.isArray(values)) {
    for (let index = values.length - 1; index >= 0; index--) { const value = values[index]; if (value == null || value === 'null' || (!allowEmpty && value.length === 0)) continue; const parsed = parse(value); if (parsed !== undefined) return parsed }
  } else if (values != null && values !== 'null' && (allowEmpty || values.length !== 0)) {
    const parsed = parse(values)
    if (parsed !== undefined) return parsed
  }
  return fallback
}
const decimal = /^\s*[+-]?(NaN|Infinity|((\d+\.?\d*)|(\.\d+))([eE][+-]?\d+)?[dDfF]?)\s*$/
function parseInteger(value: string): number | undefined { if (!/^[+-]?\d+$/.test(value)) return undefined; const result = Number.parseInt(value, 10); return result < -2147483648 || result > 2147483647 ? undefined : result }
function parseEnum<T extends string>(value: string, choices: readonly T[]): T | undefined { if (choices.includes(value as T)) return value as T; const index = parseInteger(value); return index !== undefined && index >= 0 && index < choices.length ? choices[index] : undefined }
export function stringOption(options: Options, key: string, fallback: string): string { return resolveOption(options, key, fallback, value => value) }
export function numberOption(options: Options, key: string, fallback: number): number { return resolveOption(options, key, fallback, value => decimal.test(value) ? Number.parseFloat(value) : undefined) }
export function optionalNumberOption(options: Options, key: string): number | undefined { return resolveOption<number | undefined>(options, key, undefined, value => decimal.test(value) ? Number.parseFloat(value) : undefined) }
export function optionalIntegerOption(options: Options, key: string): number | undefined { return resolveOption<number | undefined>(options, key, undefined, parseInteger) }
export function integerOption(options: Options, key: string, fallback: number): number { return resolveOption(options, key, fallback, parseInteger) }
export function booleanOption(options: Options, key: string, fallback: boolean): boolean { return resolveOption(options, key, fallback, value => value.toLowerCase() === 'true' ? true : value.toLowerCase() === 'false' ? false : undefined) }
export function enumOption<T extends string>(options: Options, key: string, choices: readonly T[], fallback: T): T { return resolveOption(options, key, fallback, value => parseEnum(value, choices)) }
export function setOption(options: Options, key: string, choices: readonly string[], fallback: readonly string[]): Set<string> {
  return resolveOption(options, key, new Set(fallback), value => {
    const result = new Set<string>()
    for (const token of value.split(/[\[\]\s,]+/)) {
      if (token.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').length === 0) continue
      const selected = parseEnum(token, choices)
      if (selected === undefined) return undefined
      result.add(selected)
    }
    return result
  }, true)
}
export function paddingOption(options: Options, fallback: Insets, key = 'padding'): Insets {
  return resolveOption(options, key, { ...fallback }, value => {
    const result = { top: 0, right: 0, bottom: 0, left: 0 }
    let start = 0, end = value.length
    while (start < value.length && "([{\"' \t\r\n".includes(value.charAt(start))) start++
    while (end > 0 && ")]}\"' \t\r\n".includes(value.charAt(end - 1))) end--
    if (start < end) {
      const tokens = value.substring(start, end).split(/,|;/)
      while (tokens.length > 0 && tokens.at(-1) === '') tokens.pop()
      for (const token of tokens) {
        const pair = token.split('=')
        if (token.length > 0) while (pair.length > 0 && pair.at(-1) === '') pair.pop()
        if (pair.length !== 2) return undefined
        const raw = pair[1]!.trim()
        if (!decimal.test(raw)) return undefined
        const key = pair[0]!.trim(), parsed = Number.parseFloat(raw)
        if (key === 'top' || key === 'right' || key === 'bottom' || key === 'left') result[key] = parsed
      }
    }
    return result
  })
}
export function vectorOption(options: Options, key: string): { x: number; y: number } { return optionalVectorOption(options, key) ?? { x: 0, y: 0 } }
export function optionalVectorOption(options: Options, key: string): { x: number; y: number } | undefined {
  return resolveOption<{ x: number; y: number } | undefined>(options, key, undefined, value => {
    let start = 0, end = value.length
    while (start < value.length && "([{\"' \t\r\n".includes(value.charAt(start))) start++
    while (end > 0 && ")]}\"' \t\r\n".includes(value.charAt(end - 1))) end--
    if (start >= end) return undefined
    const tokens = value.substring(start, end).split(/,|;|\r|\n/)
    while (tokens.at(-1) === '') tokens.pop()
    if (tokens.length !== 2) return undefined
    const numbers = tokens.map(token => token.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, ''))
    if (numbers.some(token => !decimal.test(token))) return undefined
    return { x: Number.parseFloat(numbers[0]!), y: Number.parseFloat(numbers[1]!) }
  })
}
