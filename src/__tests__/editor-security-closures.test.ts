import { describe, expect, test } from 'bun:test'
import { deflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const sharingSource = readFileSync(join(ROOT, 'editor/js/sharing.js'), 'utf8')

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) { return values.get(key) ?? null },
    setItem(key: string, value: string) { values.set(key, String(value)) },
    removeItem(key: string) { values.delete(key) },
    clear() { values.clear() },
  }
}

function sharingHarness(options: {
  compression?: typeof CompressionStream | undefined
  decompression?: typeof DecompressionStream | undefined
  verified?: boolean
} = {}) {
  const localStorage = memoryStorage()
  const sessionStorage = memoryStorage()
  const editor = { value: 'flowchart TD\n  A --> B' }
  const state = { palette: 'paper', style: 'crisp', seed: 0, config: {} as Record<string, unknown> }
  const toasts: string[] = []
  const replacedUrls: string[] = []
  const window = {
    location: { hash: '', pathname: '/editor/', search: '' },
    history: { replaceState(_state: unknown, _title: string, url: string) { replacedUrls.push(url) } },
    __mermaid: {
      knownStyleDescriptors: () => [
        { kind: 'look', inputName: 'hand-drawn' },
        { kind: 'palette', inputName: 'paper' },
      ],
    },
  }
  const factory = new Function(
    'window', 'localStorage', 'sessionStorage', 'editor', 'state', 'document', 'showToast',
    'CompressionStream', 'DecompressionStream', 'Blob', 'Response', 'TextEncoder', 'TextDecoder',
    'Uint8Array', 'URLSearchParams', 'btoa', 'atob', 'setTimeout', 'clearTimeout',
    'hasCurrentVerifiedSvgArtifact', 'DEFAULT_EDITOR_PALETTE',
    `${sharingSource}\nreturn {
      decodeSource,
      encodeSourceCompressed,
      updateHash,
      readEditorDraft,
      saveEditorDraft,
      discardEditorDraft,
      get hashDecodeFailure() { return hashDecodeFailure; },
      get draftRestoreFailure() { return draftRestoreFailure; },
      MAX_SHARE_DECODED_BYTES,
      MAX_SHARE_ENCODED_BYTES,
      MAX_DRAFT_BYTES,
      DRAFT_STORAGE_KEY,
      sanitizeEditorStyle,
    };`,
  )
  const api = factory(
    window,
    localStorage,
    sessionStorage,
    editor,
    state,
    { getElementById() { return null } },
    (message: string) => toasts.push(message),
    Object.prototype.hasOwnProperty.call(options, 'compression') ? options.compression : globalThis.CompressionStream,
    Object.prototype.hasOwnProperty.call(options, 'decompression') ? options.decompression : globalThis.DecompressionStream,
    globalThis.Blob,
    globalThis.Response,
    globalThis.TextEncoder,
    globalThis.TextDecoder,
    globalThis.Uint8Array,
    globalThis.URLSearchParams,
    globalThis.btoa,
    globalThis.atob,
    globalThis.setTimeout,
    globalThis.clearTimeout,
    () => options.verified !== false,
    'paper',
  )
  return { api, localStorage, sessionStorage, editor, state, toasts, replacedUrls }
}

describe('editor share-link resource limits', () => {
  test('new share links emit the canonical palette vocabulary', async () => {
    const { api, replacedUrls } = sharingHarness()
    await api.updateHash()
    const encoded = replacedUrls.at(-1)!.split('#')[1]!
    const payload = JSON.parse(await api.decodeSource(encoded))
    expect(payload).toMatchObject({ palette: 'paper' })
    expect(payload).not.toHaveProperty('theme')
  })

  test('round-trips accepted compressed payloads and reports corrupt input', async () => {
    const { api } = sharingHarness()
    const source = JSON.stringify({ source: 'flowchart TD\n  Alpha --> Beta', config: { bg: '#fff' } })
    const encoded = await api.encodeSourceCompressed(source)
    expect(encoded).toStartWith('deflate:')
    expect(await api.decodeSource(encoded)).toBe(source)
    expect(api.hashDecodeFailure).toBeNull()

    expect(await api.decodeSource('deflate:not-valid-***')).toBe('')
    expect(api.hashDecodeFailure).toBe('corrupt')
  })

  test('rejects an oversized encoded hash before base64 decoding', async () => {
    const { api } = sharingHarness()
    expect(await api.decodeSource('A'.repeat(api.MAX_SHARE_ENCODED_BYTES + 1))).toBe('')
    expect(api.hashDecodeFailure).toBe('too-large')
  })

  test('stream-aborts a compact decompression bomb at the decoded byte cap', async () => {
    const { api } = sharingHarness()
    const expanded = Buffer.from('x'.repeat(api.MAX_SHARE_DECODED_BYTES + 1))
    const encoded = 'deflate:' + deflateRawSync(expanded).toString('base64url')
    expect(encoded.length).toBeLessThan(1_000)
    expect(await api.decodeSource(encoded)).toBe('')
    expect(api.hashDecodeFailure).toBe('too-large')
  })

  test('does not reinterpret deflate links when DecompressionStream is missing', async () => {
    const normal = sharingHarness()
    const encoded = await normal.api.encodeSourceCompressed('{"source":"flowchart TD\\nA --> B"}')
    const unsupported = sharingHarness({ decompression: undefined })
    expect(await unsupported.api.decodeSource(encoded)).toBe('')
    expect(unsupported.api.hashDecodeFailure).toBe('unsupported')
  })

  test('reports when the browser cannot create a canonical compressed share link', async () => {
    const { api, replacedUrls, toasts } = sharingHarness({ compression: undefined })
    expect(await api.updateHash()).toBe(false)
    expect(replacedUrls.at(-1)).toBe('/editor/')
    expect(toasts).toContain(
      'This browser cannot create compressed share links (missing CompressionStream). Export or copy the source instead.',
    )
  })

  test('a too-large edit clears a stale share URL instead of misrepresenting the source', async () => {
    const { api, editor, replacedUrls, toasts } = sharingHarness()
    editor.value = 'x'.repeat(api.MAX_SHARE_DECODED_BYTES + 1)
    await api.updateHash()
    expect(replacedUrls.at(-1)).toBe('/editor/')
    expect(toasts).toContain('This diagram is too large for a share URL. Export or copy the source instead.')
  })

  test('share links require a current verified artifact and styles use the registered look roster', async () => {
    const { api, replacedUrls, toasts } = sharingHarness({ verified: false })
    expect(await api.updateHash()).toBe(false)
    expect(replacedUrls).toEqual([])
    expect(toasts).toContain('Render and verify this diagram before copying a share link.')

    expect(api.sanitizeEditorStyle('crisp')).toBe('crisp')
    expect(api.sanitizeEditorStyle('hand-drawn')).toBe('hand-drawn')
    expect(api.sanitizeEditorStyle('paper')).toBe('')
    expect(api.sanitizeEditorStyle('future-unregistered-look')).toBe('')
  })
})

describe('editor bounded, session-scoped draft persistence', () => {
  test('oversized drafts are cleared before JSON.parse', () => {
    const { api, sessionStorage } = sharingHarness()
    sessionStorage.setItem(api.DRAFT_STORAGE_KEY, 'x'.repeat(api.MAX_DRAFT_BYTES + 1))
    expect(api.readEditorDraft()).toBeNull()
    expect(api.draftRestoreFailure).toBe('too-large')
    expect(sessionStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()
  })

  test('writes only to session storage and removes any stale persistent copy', () => {
    const { api, localStorage, sessionStorage, editor } = sharingHarness()
    localStorage.setItem(api.DRAFT_STORAGE_KEY, '{"source":"stale"}')
    api.saveEditorDraft()
    expect(localStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()
    expect(JSON.parse(sessionStorage.getItem(api.DRAFT_STORAGE_KEY)!)).toMatchObject({ source: editor.value })

    api.discardEditorDraft()
    expect(localStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()
    expect(sessionStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()
  })

  test('oversized current drafts fail visibly and cannot leave a stale restore', () => {
    const { api, sessionStorage, editor, toasts } = sharingHarness()
    editor.value = 'flowchart TD\n  Small --> Draft'
    api.saveEditorDraft()
    editor.value = 'x'.repeat(api.MAX_DRAFT_BYTES + 1)
    api.saveEditorDraft()
    expect(sessionStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()
    expect(toasts).toContain('This diagram is too large for browser autosave. Export or copy the source to keep it.')
  })
})
