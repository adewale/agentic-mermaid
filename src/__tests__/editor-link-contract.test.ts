import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import {
  decodeEditorStateHash,
  editorStateHref,
  EDITOR_SHARE_STATE_KEYS,
  hostedEditorStateHref,
} from '../../scripts/site/editor-state-url.ts'

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
      expect(hostedEditorStateHref(state), `${path}: canonical round-trip`).toBe(href)
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

  test('the browser consumer and build-time producer admit the same state fields', () => {
    const sharing = readFileSync(join(ROOT, 'editor/js/sharing.js'), 'utf8')
    const manifest = sharing.match(/var EDITOR_SHARE_STATE_KEYS = Object\.freeze\(\[([^\]]+)]\);/)
    expect(manifest, 'browser state-field manifest').not.toBeNull()
    const browserKeys = Array.from(manifest![1]!.matchAll(/'([^']+)'/g), match => match[1])
    expect(browserKeys).toEqual(Array.from(EDITOR_SHARE_STATE_KEYS))
  })
})
