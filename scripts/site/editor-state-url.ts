import { deflateRawSync, inflateRawSync } from 'node:zlib'

export const EDITOR_STATE_HASH_PREFIX = 'deflate:'
export const EDITOR_SHARE_STATE_KEYS = Object.freeze(['source', 'palette', 'style', 'seed', 'config'] as const)
export const MAX_EDITOR_SHARE_DECODED_BYTES = 256 * 1024
export const MAX_EDITOR_SHARE_ENCODED_BYTES = 384 * 1024

export interface EditorShareState {
  source: string
  palette?: string
  style?: string
  seed?: number
  config?: Record<string, unknown>
}

function assertEditorShareState(value: unknown): asserts value is EditorShareState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Editor share state must be an object')
  }
  const state = value as Record<string, unknown>
  const allowed = new Set<string>(EDITOR_SHARE_STATE_KEYS)
  const unknown = Object.keys(state).filter(key => !allowed.has(key))
  if (unknown.length) throw new TypeError(`Unknown editor share state field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`)
  if (typeof state.source !== 'string' || !state.source.trim()) throw new TypeError('Editor share state source must be a non-empty string')
  if (state.palette !== undefined && typeof state.palette !== 'string') throw new TypeError('Editor share state palette must be a string')
  if (state.style !== undefined && typeof state.style !== 'string') throw new TypeError('Editor share state style must be a string')
  if (state.seed !== undefined && (typeof state.seed !== 'number' || !Number.isFinite(state.seed))) {
    throw new TypeError('Editor share state seed must be a finite number')
  }
  if (state.config !== undefined && (!state.config || typeof state.config !== 'object' || Array.isArray(state.config))) {
    throw new TypeError('Editor share state config must be an object')
  }
}

export function encodeEditorStateHash(state: EditorShareState): string {
  assertEditorShareState(state)
  const payload = Buffer.from(JSON.stringify(state), 'utf8')
  if (payload.byteLength > MAX_EDITOR_SHARE_DECODED_BYTES) throw new RangeError('Editor share state exceeds the decoded size limit')
  const encoded = EDITOR_STATE_HASH_PREFIX + deflateRawSync(payload).toString('base64url')
  if (Buffer.byteLength(encoded, 'utf8') > MAX_EDITOR_SHARE_ENCODED_BYTES) throw new RangeError('Editor share state exceeds the encoded size limit')
  return encoded
}

export function decodeEditorStateHash(hash: string): EditorShareState {
  if (!hash.startsWith(EDITOR_STATE_HASH_PREFIX)) throw new TypeError('Editor share state hash is not canonical')
  if (Buffer.byteLength(hash, 'utf8') > MAX_EDITOR_SHARE_ENCODED_BYTES) throw new RangeError('Editor share state exceeds the encoded size limit')
  const encodedPayload = hash.slice(EDITOR_STATE_HASH_PREFIX.length)
  if (!encodedPayload || !/^[A-Za-z0-9_-]+$/.test(encodedPayload) || encodedPayload.length % 4 === 1) {
    throw new TypeError('Editor share state hash has an invalid base64url payload')
  }
  const payload = inflateRawSync(Buffer.from(encodedPayload, 'base64url'), {
    maxOutputLength: MAX_EDITOR_SHARE_DECODED_BYTES,
  })
  const state: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
  assertEditorShareState(state)
  return state
}

export function editorStateHref(state: EditorShareState, editorBase = '/editor/'): string {
  return `${editorBase}#${encodeEditorStateHash(state)}`
}

export function hostedEditorStateHref(state: EditorShareState): string {
  return editorStateHref(state, 'https://agentic-mermaid.dev/editor/')
}
