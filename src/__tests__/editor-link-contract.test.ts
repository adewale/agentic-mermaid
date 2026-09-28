import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { deflateRawSync } from 'node:zlib'

import {
  decodeEditorStateHash,
  editorStateHref,
  EDITOR_SHARE_STATE_KEYS,
  hostedEditorStateHref,
} from '../../scripts/site/editor-state-url.ts'
import { SHARED_RENDER_OPTION_FIELDS } from '../render-contract.ts'
import { evaluateBrowserScript } from './browser-script-harness.ts'

const ROOT = join(import.meta.dir, '..', '..')
const SKIP_DIRECTORIES = new Set(['.git', 'coverage', 'dist', 'node_modules', 'public'])

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  })
}

function repoPath(path: string): string {
  return relative(ROOT, path).replaceAll('\\', '/')
}

describe('editor link producer/consumer contract', () => {
  test('the build-time encoder emits only bounded canonical state', () => {
    const href = editorStateHref({ source: 'flowchart TD\n  A --> B', palette: 'paper', style: 'crisp', seed: 0 })
    expect(href.startsWith('/editor/#deflate:')).toBe(true)
    expect(decodeEditorStateHash(href.split('#')[1]!)).toEqual({
      source: 'flowchart TD\n  A --> B',
      palette: 'paper',
      style: 'crisp',
      seed: 0,
    })
    expect(() => editorStateHref({ source: 'flowchart TD\n  A --> B', theme: 'paper' } as any))
      .toThrow('Unknown editor share state field: theme')
  })

  test('every checked-in hosted editor deep link uses the current codec and schema', () => {
    const links: Array<{ path: string; href: string }> = []
    for (const path of markdownFiles(ROOT)) {
      const text = readFileSync(path, 'utf8')
      for (const match of text.matchAll(/https:\/\/agentic-mermaid\.dev\/editor\/?#[^)\s"'<>]+/g)) {
        links.push({ path: repoPath(path), href: match[0] })
      }
    }

    expect(links.length).toBeGreaterThan(0)
    for (const { path, href } of links) {
      const url = new URL(href)
      expect(url.pathname, `${path}: canonical editor path`).toBe('/editor/')
      expect(url.hash.startsWith('#deflate:'), `${path}: canonical editor codec`).toBe(true)
      const state = decodeEditorStateHash(url.hash.slice(1))
      expect(state.source.trim().length, `${path}: decoded source`).toBeGreaterThan(0)
      expect(Object.keys(state).filter(key => !EDITOR_SHARE_STATE_KEYS.includes(key as any)), `${path}: state fields`).toEqual([])
      // The contract a stale link breaks is that the CURRENT codec and schema
      // can still read it — which the path, `#deflate:` prefix, and state-field
      // checks above already enforce. Comparing the re-encoded href byte-for-
      // byte additionally pinned the DEFLATE output, and identical input
      // compresses to different bytes across zlib builds, so a link that
      // decodes perfectly failed here purely for being encoded elsewhere.
      // Round-trip through the state instead: an old codec fails the prefix
      // check, an old schema fails the field check, and a link the current
      // encoder cannot reproduce semantically fails here.
      const reencoded = new URL(hostedEditorStateHref(state))
      expect(decodeEditorStateHash(reencoded.hash.slice(1)), `${path}: canonical round-trip`).toEqual(state)
    }
  })

  test('the live-editor development skill teaches the current source of truth', () => {
    const skill = readFileSync(join(ROOT, 'skills/agentic-mermaid-live-editor/SKILL.md'), 'utf8')
    expect(skill).toContain('editor/js/sharing.js')
    expect(skill).toContain('state.palette')
    expect(skill).toContain('deflate:')
    expect(skill).not.toContain('state.theme')
    expect(skill).not.toContain('JSON.stringify({ source, theme })')
    expect(skill).not.toMatch(/\bbtoa\(|\batob\(/)
  })

  test('the browser consumer and build-time producer admit the same state fields', async () => {
    const consumer = browserShareConsumer()
    expect(Array.from(consumer.api.EDITOR_SHARE_STATE_KEYS)).toEqual(Array.from(EDITOR_SHARE_STATE_KEYS))

    // Every field the producer can emit is accepted and restored by the browser.
    const complete = {
      source: 'flowchart TD\n  Shared --> Link',
      palette: 'paper',
      style: 'hand-drawn',
      seed: 7,
      config: { padding: 24 },
    }
    expect(Object.keys(complete).sort()).toEqual(Array.from(EDITOR_SHARE_STATE_KEYS).sort())
    consumer.window.location.hash = editorStateHref(complete).split('/editor/')[1]!
    expect(await consumer.api.getHashSource()).toBe(complete.source)
    expect(consumer.api.hashDecodeFailure).toBeNull()
    expect(consumer.state).toEqual({ palette: 'paper', style: 'hand-drawn', seed: 7, config: { padding: 24 } })

    // A field outside the shared schema (the producer refuses to emit one) is
    // refused by the consumer rather than partially applied.
    expect(() => editorStateHref({ ...complete, theme: 'paper' } as any)).toThrow('Unknown editor share state field: theme')
    const extended = browserShareConsumer()
    extended.window.location.hash = '#deflate:' + deflateRawSync(Buffer.from(JSON.stringify({ ...complete, theme: 'paper' }))).toString('base64url')
    expect(await extended.api.getHashSource()).toBeNull()
    expect(extended.api.hashDecodeFailure).toBe('corrupt')
  })
})

function browserShareConsumer() {
  const window = {
    location: { hash: '', pathname: '/editor/', search: '' },
    history: { replaceState() {} },
    __mermaid: {
      SHARED_RENDER_OPTION_FIELDS,
      knownStyleDescriptors: () => [{ kind: 'look', inputName: 'hand-drawn' }],
    },
  }
  const state = { palette: '', style: 'crisp', seed: 0, config: {} as Record<string, unknown> }
  const api = evaluateBrowserScript<{
    EDITOR_SHARE_STATE_KEYS: readonly string[]
    getHashSource(): Promise<string | null>
    readonly hashDecodeFailure: string | null
  }>(readFileSync(join(ROOT, 'editor/js/sharing.js'), 'utf8'), {
    window,
    state,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    editorPaletteInput: (value: unknown) => (value === 'paper' ? 'paper' : ''),
    DEFAULT_EDITOR_PALETTE: 'paper',
  }, '{ EDITOR_SHARE_STATE_KEYS, getHashSource, get hashDecodeFailure() { return hashDecodeFailure; } }')
  return { api, window, state }
}
