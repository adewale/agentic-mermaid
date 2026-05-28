// Tests for parseMermaid (agent surface)

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'

describe('parseMermaid (agent)', () => {
  test('parses a minimal flowchart', () => {
    const r = parseMermaid('flowchart TD\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.kind).toBe('flowchart')
    expect(r.value.body.kind).toBe('flowchart')
    if (r.value.body.kind !== 'flowchart') return
    expect(r.value.body.graph.nodes.has('A')).toBe(true)
    expect(r.value.body.graph.nodes.has('B')).toBe(true)
    expect(r.value.body.graph.edges).toHaveLength(1)
  })

  test('extracts YAML frontmatter into meta', () => {
    const src = `---
title: My Diagram
config:
  theme: dark
---
flowchart TD
  A --> B`
    const r = parseMermaid(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.meta.frontmatter).toBeDefined()
    expect(r.value.meta.frontmatter?.title).toBe('My Diagram')
  })

  test('captures init directives in meta', () => {
    const src = `%%{init: {"theme":"forest"}}%%
flowchart TD
  A --> B`
    const r = parseMermaid(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.meta.initDirectives).toHaveLength(1)
    expect(r.value.meta.initDirectives[0]!.parsed.theme).toBe('forest')
  })

  test('captures comments in meta with line numbers', () => {
    const src = `flowchart TD
%% this is a comment
  A --> B
%% another one`
    const r = parseMermaid(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.meta.comments).toHaveLength(2)
    expect(r.value.meta.comments[0]!.text).toBe('this is a comment')
  })

  test('captures accTitle and accDescr in meta', () => {
    const src = `flowchart TD
  accTitle: Login Flow
  accDescr: shows authentication
  A --> B`
    const r = parseMermaid(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.meta.accessibility.title).toBe('Login Flow')
    expect(r.value.meta.accessibility.descr).toBe('shows authentication')
  })

  test('captures multiline accDescr block', () => {
    const src = `flowchart TD
  accDescr {
    line one
    line two
  }
  A --> B`
    const r = parseMermaid(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.meta.accessibility.descr).toContain('line one')
    expect(r.value.meta.accessibility.descr).toContain('line two')
  })

  test('returns ParseError[] on empty source', () => {
    const r = parseMermaid('')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.length).toBeGreaterThan(0)
  })

  test('returns ParseError[] on unrecognized header', () => {
    const r = parseMermaid('notADiagram\n  X')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error[0]!.code).toBe('UNKNOWN_HEADER')
  })

  test('detects non-flowchart families as opaque', () => {
    const r = parseMermaid('sequenceDiagram\n  Alice->>Bob: Hi')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.kind).toBe('sequence')
    expect(r.value.body.kind).toBe('opaque')
  })

  test('detects timeline as opaque', () => {
    const r = parseMermaid('timeline\n  2020 : A')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.kind).toBe('timeline')
  })

  test('preserves canonicalSource for round-trip', () => {
    const r = parseMermaid('flowchart TD\n  A --> B')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.canonicalSource).toContain('flowchart TD')
    expect(r.value.canonicalSource).toContain('A --> B')
  })

  test('populates source map with node positions', () => {
    const r = parseMermaid('flowchart TD\n  A --> B\n  B --> C')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.source.nodes.has('A')).toBe(true)
    expect(r.value.source.nodes.has('B')).toBe(true)
    expect(r.value.source.nodes.has('C')).toBe(true)
  })
})
