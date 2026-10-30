export interface MermaidMarkdownBlock {
  readonly source: string
  /** Physical Markdown line containing the first source line (one-based). */
  readonly startLine: number
}

const HTML_BLOCK_TAG = /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[\t >]|\/>|$)/i
const COMPLETE_HTML_TAG = /^ {0,3}(?:<[a-z][a-z\d-]*(?:\s+[a-z_:][a-z\d_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[a-z][a-z\d-]*\s*>)\s*$/i

/** CommonMark HTML blocks own their contents until a terminator or blank line.
 * Complete custom tags cannot interrupt an ordinary paragraph. */
function htmlBlockEnd(line: string, paragraph: boolean): RegExp | undefined {
  const raw = /^ {0,3}<(script|pre|style|textarea)(?=\s|>|$)/i.exec(line)
  if (raw) return new RegExp(`</${raw[1]}>`, 'i')
  if (/^ {0,3}<!--/.test(line)) return /-->/
  if (/^ {0,3}<\?/.test(line)) return /\?>/
  if (/^ {0,3}<![A-Z]/.test(line)) return />/
  if (/^ {0,3}<!\[CDATA\[/.test(line)) return /\]\]>/
  if (HTML_BLOCK_TAG.test(line) || (!paragraph && COMPLETE_HTML_TAG.test(line))) return /^\s*$/
}

/** Top-level fences, including longer fences around examples. This is not a
 * Markdown AST: hosts must extract nested list/blockquote fences themselves. */
export function mermaidMarkdownBlocks(markdown: string): MermaidMarkdownBlock[] {
  const lines = markdown.split(/\r?\n/)
  const result: MermaidMarkdownBlock[] = []
  let fence: { char: string; length: number; start: number; mermaid: boolean } | undefined
  let htmlEnd: RegExp | undefined
  let paragraph = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (!fence) {
      htmlEnd ??= htmlBlockEnd(line, paragraph)
      if (htmlEnd) {
        if (htmlEnd.test(line)) htmlEnd = undefined
        paragraph = false
        continue
      }
    }
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (!match) {
      if (!fence) {
        const boundary = /^ {0,3}(?:#{1,6}(?:\s|$)|(?:\*\s*){3,}$|(?:_\s*){3,}$|(?:-\s*){3,}$)/.test(line)
        const setext = paragraph && /^ {0,3}(?:=+|-+)\s*$/.test(line)
        const emptyList = !paragraph && /^ {0,3}(?:[-+*]|\d{1,9}[.)])\s*$/.test(line)
        const emptyQuote = /^ {0,3}>[ \t]*$/.test(line)
        paragraph = !/^\s*$/.test(line) && !boundary && !setext && !emptyList && !emptyQuote && (paragraph || !/^(?: {4}| {0,3}\t)/.test(line))
      }
      continue
    }
    const marks = match[1]!, info = match[2]!.trim()
    if (fence) {
      if (marks[0] !== fence.char || marks.length < fence.length || info) continue
      if (fence.mermaid) result.push({ source: lines.slice(fence.start + 1, index).join('\n'), startLine: fence.start + 2 })
      fence = undefined
      paragraph = false
    } else if (marks[0] !== '`' || !info.includes('`')) {
      fence = { char: marks[0]!, length: marks.length, start: index, mermaid: /^mermaid(?:\s|$)/i.test(info) }
    } else paragraph = true
  }
  // An unclosed fence extends to EOF in static Markdown. Streaming hosts must
  // decide when a block is complete before invoking verification.
  if (fence?.mermaid) result.push({ source: lines.slice(fence.start + 1).join('\n'), startLine: fence.start + 2 })
  return result
}
