import type { ExtractedLabel } from './families.ts'

// Generic best-effort label extraction is deliberately independent of the
// registry bootstrap. Built-in descriptors can reference it while the
// registry assembles complete descriptors, without creating an import-time
// mutation cycle.
export function extractLabelsGeneric(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  let i = 0
  for (const raw of lines) {
    i++
    const line = raw.trim()
    if (!line || line.startsWith('%%')) continue
    for (const m of line.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g)) {
      const text = m[1] ?? m[2] ?? ''
      if (text) out.push({ text, target: `line${i}` })
    }
    for (const m of line.matchAll(/[\[\(\{]+([^\[\]\(\)\{\}]+?)[\]\)\}]+/g)) {
      const text = (m[1] ?? '').trim()
      if (text && !text.match(/^[A-Za-z_][\w-]*$/)) out.push({ text, target: `line${i}` })
    }
    const colon = line.indexOf(':')
    if (colon >= 0 && colon < line.length - 1) {
      const after = line.slice(colon + 1).trim()
      if (after && !after.match(/^[\d.]+$/) && after.length >= 2) {
        out.push({ text: after, target: `line${i}` })
      }
    }
  }
  return out
}
