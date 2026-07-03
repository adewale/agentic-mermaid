// Loop 8 P: PNG in-process determinism.
//
// Renders the same fixture multiple times in one process and asserts byte-
// identical output via SHA-256. Critic 5 mandate: do a warm-up render
// FIRST (don't include in the comparison set) to factor out resvg/napi
// init differences. Also assert length-stable to defend against partial-
// buffer truncation masquerading as hash collision.
//
// Cross-runtime determinism (bun vs node) is in agent-determinism.test.ts.

import { describe, test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { renderMermaidPNG } from '../agent/png.ts'

const FIXTURE = `flowchart LR
  A[Start] --> B{Decision}
  B -->|yes| C[Yes path]
  B -->|no| D[No path]
  C --> E[End]
  D --> E`

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('PNG in-process determinism', () => {
  test('5 renders of same fixture produce byte-identical output', async () => {
    // Warm-up render — eliminates first-call WASM/napi init differences
    await renderMermaidPNG(FIXTURE)

    const renders: Uint8Array[] = []
    for (let i = 0; i < 5; i++) {
      renders.push(await renderMermaidPNG(FIXTURE))
    }
    const hashes = renders.map(sha256)
    const lengths = renders.map(r => r.length)

    // All 5 hashes identical via Set size === 1
    expect(new Set(hashes).size).toBe(1)
    // Length-stable defends against partial-buffer truncation
    expect(new Set(lengths).size).toBe(1)
  })

  test('determinism holds across different fixtures (no cross-talk)', async () => {
    const a = await renderMermaidPNG('flowchart LR\n  A --> B')
    const b = await renderMermaidPNG('flowchart LR\n  X --> Y')
    expect(sha256(a)).not.toBe(sha256(b))
    // Re-render the first one — should match its earlier hash
    const a2 = await renderMermaidPNG('flowchart LR\n  A --> B')
    expect(sha256(a)).toBe(sha256(a2))
  })

  test('determinism holds across scale variants', async () => {
    const s1a = await renderMermaidPNG('flowchart LR\n  A --> B', { scale: 1 })
    const s1b = await renderMermaidPNG('flowchart LR\n  A --> B', { scale: 1 })
    const s2a = await renderMermaidPNG('flowchart LR\n  A --> B', { scale: 2 })
    expect(sha256(s1a)).toBe(sha256(s1b))
    expect(sha256(s1a)).not.toBe(sha256(s2a))
  })
})

describe('styled PNG', () => {
  test('style + seed thread through to rasterization deterministically', async () => {
    const a = await renderMermaidPNG(FIXTURE, { style: 'hand-drawn', seed: 1 })
    const b = await renderMermaidPNG(FIXTURE, { style: 'hand-drawn', seed: 1 })
    expect(sha256(a)).toBe(sha256(b))
    expect(a.length).toBe(b.length)
    // A different seed re-rolls the ink; crisp differs from styled entirely.
    const reseeded = await renderMermaidPNG(FIXTURE, { style: 'hand-drawn', seed: 2 })
    expect(sha256(a)).not.toBe(sha256(reseeded))
    const crisp = await renderMermaidPNG(FIXTURE)
    expect(sha256(a)).not.toBe(sha256(crisp))
  })
})
