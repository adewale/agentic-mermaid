export interface MermaidMarkdownBlock {
  readonly source: string
  /** Physical Markdown line containing the first source line (one-based). */
  readonly startLine: number
}

/** Top-level CommonMark fences, including longer fences used around examples.
 * Track every code fence so a Markdown example cannot become a live diagram. */
export function mermaidMarkdownBlocks(markdown: string): MermaidMarkdownBlock[] {
  const lines = markdown.split(/\r?\n/)
  const result: MermaidMarkdownBlock[] = []
  let fence: { char: string; length: number; start: number; mermaid: boolean } | undefined
  for (let index = 0; index < lines.length; index++) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]!)
    if (!match) continue
    const marks = match[1]!, info = match[2]!.trim()
    if (fence) {
      if (marks[0] !== fence.char || marks.length < fence.length || info) continue
      if (fence.mermaid) result.push({ source: lines.slice(fence.start + 1, index).join('\n'), startLine: fence.start + 2 })
      fence = undefined
    } else if (marks[0] !== '`' || !info.includes('`')) {
      fence = { char: marks[0]!, length: marks.length, start: index, mermaid: /^mermaid(?:\s|$)/i.test(info) }
    }
  }
  // An unclosed fence extends to EOF in static Markdown. Streaming hosts must
  // decide when a block is complete before invoking verification.
  if (fence?.mermaid) result.push({ source: lines.slice(fence.start + 1).join('\n'), startLine: fence.start + 2 })
  return result
}
