import { decodeHTML } from 'entities'

const displayText = (markup: string): string =>
  decodeHTML(markup.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()

/** Reject a renderer's unsupported-input code block, including framed terminal fallbacks.
 * This is a source-echo guard, not an endpoint or owned-ink correspondence oracle. */
export function isRenderedSourceEcho(source: string, output: string, format: 'svg' | 'terminal', svgPrimaryRuns?: readonly string[]): boolean {
  const compact = (value: string) => value.replace(/\s+/gu, '').toLowerCase()
  const input = compact(source)
  if (!input) return false
  // A bare family header can legitimately have an empty drawing or family caption.
  const trimmed = source.trim()
  if (!trimmed.includes('\n') && trimmed.split(/\s+/u).length <= 2 && !/[;:\[\]{}<>|]/u.test(trimmed)) return false
  let ink: string
  if (format === 'svg') {
    if (svgPrimaryRuns !== undefined) return compact(svgPrimaryRuns.join(' ')).includes(input)
    const visible = output.replace(/<!--[\s\S]*?-->/g, '').replace(/<(metadata|defs|desc|title|style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    ink = [...visible.matchAll(/<(text|tspan|foreignObject)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(match => displayText(match[2]!)).join(' ')
  } else {
    ink = output
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')
      .map(line => line.replace(/^\s*[│┃|]\s?/, '').replace(/\s*[│┃|]\s*$/, ''))
      .filter(line => !/^[\s┌┐└┘├┤┬┴┼─━┏┓┗┛╭╮╰╯+|=-]*$/.test(line))
      .join(' ')
  }
  return compact(ink).includes(input)
}
