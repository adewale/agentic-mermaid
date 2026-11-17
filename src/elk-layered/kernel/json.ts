/*******************************************************************************
 * Copyright (c) 2017, 2019 Kiel University and others.
 * GWT JSON value access semantics: Copyright 2007 Google Inc., Apache-2.0,
 * http://www.apache.org/licenses/LICENSE-2.0.
 * TypeScript adaptation: EPL-2.0.
 * SPDX-License-Identifier: EPL-2.0 AND Apache-2.0
 *******************************************************************************/
export type JsonObject = Record<string, unknown>

export function isJsonObject(value: unknown): value is JsonObject { return value !== null && (typeof value === 'object' || typeof value === 'function') && !Array.isArray(value) }

// JsonAdapter / GWT JSONParser.createObject. Retain valueOf accessor and call
// effects without allocating a wrapper for every primitive read.
export function jsonValue(value: unknown): unknown {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    const object = value as { valueOf?: (() => unknown) | null }
    const primitive = object.valueOf ? object.valueOf() : object
    if (primitive !== value) return jsonValue(primitive)
  }
  if (typeof value === 'bigint' || typeof value === 'symbol') throw new Error("Unexpected typeof result '" + typeof value + "'; please report this bug to the GWT team")
  return value
}
export function readMember(object: object, key: string): unknown {
  const value = (object as { hasOwnProperty(key: string): boolean }).hasOwnProperty(String(key)) ? (object as JsonObject)[key] : undefined
  return jsonValue(value)
}
export function objectMember(object: object, key: string): JsonObject | null { const value = readMember(object, key); return isJsonObject(value) ? value : null }
export function arrayMember(object: object, key: string): unknown[] | null { const value = readMember(object, key); return Array.isArray(value) ? value : null }
export function numberMember(object: object, key: string): number {
  if (!(key in object)) return 0
  const value = readMember(object, key)
  if (value === undefined) throw new TypeError("Cannot read properties of null (reading 'isNumber')")
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
export function primitiveString(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw new Error('Severe implementation error in the Json to ElkGraph importer.')
}
export function elementKey(object: object): string | number {
  if (!('id' in object)) throw new Error('Every element must have an id.')
  const value = readMember(object, 'id')
  if (typeof value === 'string') return value
  if (typeof value === 'number' && value % 1 === 0) return Math.max(-2147483648, Math.min(2147483647, value)) | 0
  throw new Error("Id must be a string or an integer: '" + jsonText(value) + "'.")
}
export function elementId(object: object): string { return String(elementKey(object)) }
function jsonText(value: unknown): string {
  if (value == null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) { let result = '['; for (let i = 0; i < value.length; i++) { if (i > 0) result += ','; result += jsonText(jsonValue(value[i])) }; return result + ']' }
  const object = value as JsonObject
  let result = '{', first = true
  for (const key in object) if ((object as unknown as { hasOwnProperty(key: string): boolean }).hasOwnProperty(key)) { if (first) first = false; else result += ', '; result += JSON.stringify(key) + ':' + jsonText(readMember(object, key)) }
  return result + '}'
}

// JSONObject.put observes the old value before writing, including its getter
// and valueOf effects. Reflect.set also retains the original non-strict write
// behavior for a read-only member while letting a user setter's error escape.
export function writeMember(object: object, key: string, value: unknown): void { readMember(object, key); Reflect.set(object, key, value) }
