import { safeCssColor } from './shared/css-color.ts'
import type { ColorMode } from './ascii/types.ts'
import { visualWidth } from './ascii/width.ts'
import { boundedUtf8ByteLength } from './shared/utf8.ts'

/** External terminal renderers cross a bounded text boundary just as external
 * SVG renderers cross the final SVG budget. These are artifact limits, not
 * layout controls: callers still use targetWidth for a smaller requested
 * display-cell width. */
export const EXTERNAL_TERMINAL_OUTPUT_LIMITS = Object.freeze({
  maxBytes: 2_000_000,
  maxLines: 100_000,
  maxLineCells: 100_000,
})

export class TerminalOutputAdmissionError extends TypeError {
  readonly code = 'TERMINAL_OUTPUT_ADMISSION_FAILED'

  constructor(message: string) {
    super(message)
    this.name = 'TerminalOutputAdmissionError'
  }
}

const ANSI_16_SGR = /\x1b\[(?:0|3[0-7]|9[0-7])m/g
const ANSI_COMPONENT = '(?:0|[1-9]\\d?|1\\d{2}|2[0-4]\\d|25[0-5])'
const ANSI_256_SGR = new RegExp(`\\x1b\\[(?:0|38;5;${ANSI_COMPONENT})m`, 'g')
const ANSI_TRUECOLOR_SGR = new RegExp(
  `\\x1b\\[(?:0|38;2;${ANSI_COMPONENT};${ANSI_COMPONENT};${ANSI_COMPONENT})m`,
  'g',
)
const NON_STRUCTURAL_TERMINAL_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/

function withoutAllowedSgr(value: string, colorMode: ColorMode): string {
  const grammar = allowedSgrGrammar(colorMode)
  return grammar ? value.replace(grammar, '') : value
}

function allowedSgrGrammar(colorMode: ColorMode): RegExp | undefined {
  switch (colorMode) {
    case 'ansi16': return ANSI_16_SGR
    case 'ansi256': return ANSI_256_SGR
    case 'truecolor': return ANSI_TRUECOLOR_SGR
    default: return undefined
  }
}

function assertAnsiStateNeutral(value: string, colorMode: ColorMode): void {
  const grammar = allowedSgrGrammar(colorMode)
  if (!grammar) return
  let sawColor = false
  let finalTokenIsReset = true
  for (const match of value.matchAll(new RegExp(grammar.source, 'g'))) {
    finalTokenIsReset = match[0] === '\x1b[0m'
    if (!finalTokenIsReset) sawColor = true
  }
  if (sawColor && !finalTokenIsReset) {
    throw new TerminalOutputAdmissionError(
      `External family terminal output leaves ANSI color state active for color mode "${colorMode}"`,
    )
  }
}

/** Remove renderer-owned wrappers and decode the one HTML escaping layer for
 * display-cell measurement. The HTML scanner below has already reduced the
 * markup language to exact inert color spans before this runs. */
export function terminalOutputLineWidth(line: string, colorMode: ColorMode): number {
  return visualWidth(terminalOutputPlainText(line, colorMode))
}

function terminalOutputPlainText(value: string, colorMode: ColorMode): string {
  if (colorMode === 'none') return value
  if (colorMode !== 'html') return withoutAllowedSgr(value, colorMode)
  return value
    .replace(/<span style="color:[^"<>&]+">|<\/span>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Final admission for output owned by an installed external family. HTML is
 * secured before it is measured; ANSI modes accept only the exact SGR color
 * grammar emitted by ascii/ansi.ts. OSC, DCS, cursor controls, C1 controls,
 * tabs and carriage returns therefore fail closed in every encoding. */
export function admitExternalTerminalOutput(value: unknown, colorMode: ColorMode): string {
  if (typeof value !== 'string') {
    throw new TerminalOutputAdmissionError('External family terminal renderer must return a string')
  }
  const limits = EXTERNAL_TERMINAL_OUTPUT_LIMITS
  if (boundedUtf8ByteLength(value, limits.maxBytes) > limits.maxBytes) {
    throw new TerminalOutputAdmissionError(
      `External family terminal output exceeds the ${limits.maxBytes}-byte limit`,
    )
  }
  const output = colorMode === 'html' ? secureTerminalHtmlOutput(value) : value
  if (output !== value && boundedUtf8ByteLength(output, limits.maxBytes) > limits.maxBytes) {
    throw new TerminalOutputAdmissionError(
      `Secured external family terminal output exceeds the ${limits.maxBytes}-byte limit`,
    )
  }

  const controlScan = withoutAllowedSgr(output, colorMode)
  if (NON_STRUCTURAL_TERMINAL_CONTROL.test(controlScan)) {
    throw new TerminalOutputAdmissionError(
      `External family terminal output contains a disallowed control sequence for color mode "${colorMode}"`,
    )
  }
  assertAnsiStateNeutral(output, colorMode)

  const visible = terminalOutputPlainText(output, colorMode).trim()
  if (visible.length === 0 || visualWidth(visible) === 0) {
    throw new TerminalOutputAdmissionError(
      `External family terminal output has no visible content for color mode "${colorMode}"`,
    )
  }

  let lineCount = 1
  for (let index = output.indexOf('\n'); index >= 0; index = output.indexOf('\n', index + 1)) {
    if (++lineCount > limits.maxLines) {
      throw new TerminalOutputAdmissionError(
        `External family terminal output exceeds the ${limits.maxLines}-line limit`,
      )
    }
  }
  const lines = output.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (terminalOutputLineWidth(lines[index]!, colorMode) > limits.maxLineCells) {
      throw new TerminalOutputAdmissionError(
        `External family terminal output line ${index + 1} exceeds the ${limits.maxLineCells}-cell limit`,
      )
    }
  }
  return output
}

/**
 * Replace untrusted terminal controls with a visible, single-cell ASCII glyph.
 * Structural source lines may retain CR/LF until parsing; rendered text may not.
 */
export function sanitizeTerminalText(
  value: string,
  preserveLineBreaks = false,
): string {
  let result = ''
  for (const character of value) {
    const code = character.codePointAt(0)!
    const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f)
    if (character === '\t') result += ' '
    else if (!control || (preserveLineBreaks && (character === '\n' || character === '\r'))) result += character
    else result += '?'
  }
  return result
}

/** Escape untrusted text for an HTML data context. Quotes do not create markup
 * there, while escaping ampersands first preserves authored entity text. */
function escapeTerminalHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Apply the final HTML-output security boundary without double-escaping the
 * exact allowlisted color-span shape emitted by ascii/ansi.ts.
 *
 * Family renderers intentionally own very different cell layouts. Some emit
 * every cell through the styled-line helper, while others concatenate labels
 * around styled bars or markers. Treating their completed strings as trusted
 * made the latter class vulnerable to authored HTML. This scanner preserves
 * only a closed, attribute-exact span with a validated non-fetching color and
 * a body containing no raw markup. Even if authored text mimics that exact
 * harmless form, it cannot add attributes, nested elements, or active content.
 * Everything else is text and is escaped once.
 */
export function secureTerminalHtmlOutput(value: string): string {
  const trustedSpan = /<span style="color:([^"<>&]+)">([^<>]*)<\/span>/g
  let output = ''
  let cursor = 0

  for (const match of value.matchAll(trustedSpan)) {
    const index = match.index ?? 0
    output += escapeTerminalHtmlText(value.slice(cursor, index))
    const color = safeCssColor(match[1])
    // Trusted color helpers emit only the three canonical text entities. Raw
    // numeric/named entities could decode to terminal controls in a browser,
    // so a span containing any other ampersand is rendered as inert text.
    const canonicalBody = !/&(?!amp;|lt;|gt;)/.test(match[2]!)
    output += color === match[1] && canonicalBody
      ? match[0]
      : escapeTerminalHtmlText(match[0])
    cursor = index + match[0].length
  }

  return output + escapeTerminalHtmlText(value.slice(cursor))
}
