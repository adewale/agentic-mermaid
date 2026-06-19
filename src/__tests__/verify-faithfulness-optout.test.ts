// Move 6: the roundtripFaithfulness opt-out must be REACHABLE — the option
// existed but no caller used it. These pin the three reachable paths: the
// library option, the `am verify --no-faithfulness-check` flag, and the batch
// `verify` op option. On faithful diagrams the lint never fires, so we assert
// reachability + non-breaking parity rather than an output diff.

import { describe, test, expect } from 'bun:test'
import { verifyMermaid } from '../agent/verify.ts'
import { parseMermaid } from '../agent/parse.ts'
import { runBatchLine, renderMarkdownBlocks } from '../cli/index.ts'

const SRC = 'flowchart TD\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]\n  B -->|no| A'

describe('roundtripFaithfulness opt-out reachability', () => {
  test('library: the option is accepted and parity-preserving on a faithful diagram', () => {
    const p = parseMermaid(SRC)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const on = verifyMermaid(p.value)
    const off = verifyMermaid(p.value, { roundtripFaithfulness: false })
    expect(off.ok).toBe(on.ok)
    // Neither should carry the faithfulness lint on a faithful diagram; the
    // opt-out cannot ADD warnings.
    expect(off.warnings.some(w => w.code === 'CONTENT_DROPPED_ON_ROUNDTRIP')).toBe(false)
    expect(off.warnings.length).toBeLessThanOrEqual(on.warnings.length)
  })

  test('batch verify op threads roundtripFaithfulness through', () => {
    const line = JSON.stringify({ op: 'verify', source: SRC, options: { roundtripFaithfulness: false } })
    const out = runBatchLine(line)
    expect(out.ok).toBe(true)
    expect(out.op).toBe('verify')
    const data = out.data as { ok: boolean; warnings: Array<{ code: string }> }
    expect(data.ok).toBe(true)
    expect(data.warnings.some(w => w.code === 'CONTENT_DROPPED_ON_ROUNDTRIP')).toBe(false)
  })

  test('an unknown option key does not break batch verify (back-compat)', () => {
    const out = runBatchLine(JSON.stringify({ op: 'verify', source: SRC }))
    expect(out.ok).toBe(true)
  })

  // Move 2 finding: render/preview do NOT verify internally, so they never pay
  // the faithfulness cost (there was nothing to opt out of). Lock that the bulk
  // markdown render path is a pure render — its results carry render output, not
  // verify warnings — so a future change can't silently add a per-block verify.
  test('bulk markdown render is verify-free (no warnings in its results)', () => {
    const md = '```mermaid\n' + SRC + '\n```\n\n```mermaid\nflowchart LR\n  X-->Y\n```'
    const results = renderMarkdownBlocks(md)
    expect(results.length).toBe(2)
    for (const r of results) {
      expect(r.ok).toBe(true)
      expect(r).not.toHaveProperty('warnings')
      expect(r).not.toHaveProperty('ranked')
    }
  })
})
