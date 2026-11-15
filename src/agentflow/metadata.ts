import { type MetadataEntries, parseMetadataBody } from '../shared/metadata-yaml.ts'

// Trailing-comma normalization adapted from Mermaid12.2.0 agentflowDb.ts,
// revision1fb7869866dd619168d840291c9c54b4f129758b (MIT).
function stripLineTrailingCommas(body: string): string {
  let inSingle = false
  let inDouble = false
  let flowDepth = 0
  let blockScalarIndent: number | undefined
  const out: string[] = []
  for (const line of body.split('\n')) {
    if (blockScalarIndent !== undefined) {
      const indent = line.length - line.trimStart().length
      if (line.trim() === '' || indent > blockScalarIndent) {
        // Block scalar content is verbatim text — commas are content.
        out.push(line)
        continue
      }
      blockScalarIndent = undefined
    }
    let commentStart = -1
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inDouble) {
        if (ch === '\\') {
          i++
        } else if (ch === '"') {
          inDouble = false
        }
      } else if (inSingle) {
        if (ch === "'") {
          inSingle = false
        }
      } else if (ch === '"') {
        inDouble = true
      } else if (ch === "'") {
        inSingle = true
      } else if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
        commentStart = i
        break
      } else if (ch === '[' || ch === '{') {
        flowDepth++
      } else if (ch === ']' || ch === '}') {
        flowDepth = Math.max(0, flowDepth - 1)
      }
    }
    if (inSingle || inDouble || flowDepth > 0) {
      // The line ends inside a quoted scalar or flow collection — any
      // trailing comma is content or a separator, not a stray.
      out.push(line)
      continue
    }
    const code = commentStart >= 0 ? line.slice(0, commentStart) : line
    const comment = commentStart >= 0 ? line.slice(commentStart) : ''
    if (/:\s*[>|][\d+-]*\s*$/.test(code)) {
      // `key: |` / `key: >` opens a block scalar; its deeper-indented lines
      // are verbatim content.
      blockScalarIndent = line.length - line.trimStart().length
      out.push(line)
      continue
    }
    out.push(code.replace(/,([\t ]*)$/, '$1') + comment)
  }
  return out.join('\n')
}

export function readAgentflowMetadata(body: string): MetadataEntries {
  if (!body.trim()) return { ok: true, entries: new Map() }
  const original = parseMetadataBody(body, 'flowchart')
  if (original.ok || !body.includes('\n')) return original
  const stripped = stripLineTrailingCommas(body)
  if (stripped === body) return original
  const retried = parseMetadataBody(stripped, 'flowchart')
  return retried.ok ? retried : original
}
