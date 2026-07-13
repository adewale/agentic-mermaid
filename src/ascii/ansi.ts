// ============================================================================
// ASCII renderer — color utilities
//
// Provides color output for themed ASCII diagrams.
// Supports ANSI terminal modes (16/256/truecolor) and HTML <span> tags
// for browser rendering.
// ============================================================================

import { parseHex, mixHex, luma255, toHex, tryParseCssColor } from '../shared/color-math.ts'
import { safeCssColor } from '../shared/css-color.ts'
import type { CharRole, AsciiTheme, ColorMode } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { MIX } from '../theme.ts'
import { sanitizeTerminalText } from '../terminal-security.ts'

declare const document: unknown

// ============================================================================
// Default theme — matches SVG theme colors for consistency
// ============================================================================

/**
 * Default ASCII theme derived from the SVG renderer's color palette.
 * Uses the same mixing ratios to maintain visual consistency.
 */
export const DEFAULT_ASCII_THEME: AsciiTheme = {
  fg: '#27272a',      // zinc-800 — primary text
  border: '#a1a1aa',  // zinc-400 — node borders (12% mix)
  line: '#71717a',    // zinc-500 — edge lines (35% mix)
  arrow: '#52525b',   // zinc-600 — arrowheads (60% mix)
  corner: '#71717a',  // same as line
  junction: '#a1a1aa', // same as border
}

// ============================================================================
// DiagramColors → AsciiTheme bridge
//
// Converts SVG DiagramColors into an AsciiTheme using the same MIX ratios
// that the SVG renderer uses via CSS color-mix(). This ensures visual
// consistency between SVG and ASCII output for any theme.
// ============================================================================

/** Mix fg into bg at a given percentage (replicates CSS color-mix(in srgb)). */
const mixColors = mixHex

/**
 * Derive an AsciiTheme from SVG DiagramColors using the same mixing ratios.
 * Honors optional enrichment colors (line, accent, border) when present,
 * otherwise falls back to color-mix derivation — matching SVG behavior.
 */
export function diagramColorsToAsciiTheme(colors: DiagramColors): AsciiTheme {
  const line = colors.line ?? mixColors(colors.fg, colors.bg, MIX.line)
  const border = colors.border ?? mixColors(colors.fg, colors.bg, MIX.nodeStroke)
  return {
    fg:       colors.fg,
    border,
    line,
    arrow:    colors.accent ?? mixColors(colors.fg, colors.bg, MIX.arrow),
    accent:   colors.accent,
    bg:       colors.bg,
    corner:   line,
    junction: border,
  }
}

// ============================================================================
// Color mode detection
// ============================================================================

/**
 * Detect the best color mode for the current environment.
 *
 * Terminal detection order:
 * 1. COLORTERM=truecolor or COLORTERM=24bit → truecolor
 * 2. TERM contains "256color" → ansi256
 * 3. TERM is set and not "dumb" → ansi16
 *
 * Browser: returns 'html' (uses <span> tags with inline styles).
 * Unknown/piped: returns 'none'.
 */
export interface ColorEnvironment {
  isTTY?: boolean
  env?: Record<string, string | undefined>
  browser?: boolean
}

export function detectColorMode(override?: ColorEnvironment): ColorMode {
  // Check if we're in a Node.js-like environment with process object
  // Use globalThis to safely check for process without TypeScript errors
  const proc = (globalThis as { process?: { stdout?: { isTTY?: boolean }, env?: Record<string, string | undefined> } }).process
  const browserOverride = override?.browser === true

  if (proc || override) {
    // Check if stdout is a TTY (not piped/redirected)
    const isTTY = override?.isTTY ?? proc?.stdout?.isTTY
    if (!isTTY) {
      return 'none'
    }

    const env = override?.env ?? proc?.env ?? {}
    const colorTerm = env.COLORTERM?.toLowerCase() ?? ''
    const term = env.TERM?.toLowerCase() ?? ''

    // Explicit terminal disable signals win over capability hints.
    if (term === 'dumb' || env.NO_COLOR !== undefined) return 'none'

    // True color support
    if (colorTerm === 'truecolor' || colorTerm === '24bit') {
      return 'truecolor'
    }

    // 256 color support
    if (term.includes('256color') || term.includes('256')) {
      return 'ansi256'
    }

    // Basic color support
    if (term && term !== 'dumb') {
      return 'ansi16'
    }

    return 'none'
  }

  // No process object → browser environment → use HTML color output
  if (browserOverride || typeof document !== 'undefined') {
    return 'html'
  }

  return 'none'
}

// ============================================================================
// Hex color parsing
// ============================================================================

// ============================================================================
// ANSI escape code generation
// ============================================================================

/** ANSI escape sequence prefix */
const ESC = '\x1b['
/** Reset all attributes */
const RESET = `${ESC}0m`

/**
 * Generate ANSI foreground color escape sequence for 24-bit true color.
 * Format: ESC[38;2;R;G;Bm
 */
function truecolorFg(hex: string): string {
  const [r, g, b] = parseHex(hex)
  return `${ESC}38;2;${r};${g};${b}m`
}

/**
 * Find the closest 256-color palette index for an RGB color.
 * The 256-color palette has:
 * - 0-15: Standard colors (duplicates of 16-color)
 * - 16-231: 6x6x6 color cube (216 colors)
 * - 232-255: Grayscale ramp (24 shades)
 */
function rgbTo256(r: number, g: number, b: number): number {
  // Check if it's close to grayscale
  const avg = (r + g + b) / 3
  const maxDiff = Math.max(Math.abs(r - avg), Math.abs(g - avg), Math.abs(b - avg))

  if (maxDiff < 10) {
    // Use grayscale ramp (232-255)
    // Each step is ~10.625 (256/24)
    const gray = Math.round((avg / 255) * 23)
    return 232 + Math.min(23, Math.max(0, gray))
  }

  // Use 6x6x6 color cube (16-231)
  // Each channel maps to 0-5: 0, 95, 135, 175, 215, 255
  const toIndex = (v: number): number => {
    if (v < 48) return 0
    if (v < 115) return 1
    return Math.min(5, Math.floor((v - 35) / 40))
  }

  const ri = toIndex(r)
  const gi = toIndex(g)
  const bi = toIndex(b)

  return 16 + (36 * ri) + (6 * gi) + bi
}

/**
 * Generate ANSI foreground color escape sequence for 256-color mode.
 * Format: ESC[38;5;Nm
 */
function ansi256Fg(hex: string): string {
  const [r, g, b] = parseHex(hex)
  const index = rgbTo256(r, g, b)
  return `${ESC}38;5;${index}m`
}

/**
 * Map an RGB color to the closest 16-color ANSI code.
 * Returns the foreground color escape sequence.
 *
 * Standard 16 colors:
 * 0=black, 1=red, 2=green, 3=yellow, 4=blue, 5=magenta, 6=cyan, 7=white
 * 8-15 = bright versions
 */
function ansi16Fg(hex: string): string {
  const [r, g, b] = parseHex(hex)
  const luma = luma255(r, g, b)

  // Determine brightness (use bright colors for better visibility)
  const bright = luma > 100 ? 0 : 60 // 60 = bright variant offset

  // Determine base color based on dominant channel
  let code: number
  if (r > 180 && g < 100 && b < 100) code = 31 // red
  else if (g > 180 && r < 100 && b < 100) code = 32 // green
  else if (r > 150 && g > 150 && b < 100) code = 33 // yellow
  else if (b > 180 && r < 100 && g < 100) code = 34 // blue
  else if (r > 150 && b > 150 && g < 100) code = 35 // magenta
  else if (g > 150 && b > 150 && r < 100) code = 36 // cyan
  else if (luma > 200) code = 37 // white
  else if (luma < 50) code = 30 // black
  else code = 37 // default to white for grays

  return `${ESC}${code + bright}m`
}

// ============================================================================
// HTML color output (for browser rendering)
// ============================================================================

/** Escape characters that would break HTML output. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Wrap text in a <span> with an inline color style. */
function htmlSpan(hex: string, text: string): string {
  const color = safeCssColor(hex)
  return color
    ? `<span style="color:${color}">${escapeHtml(text)}</span>`
    : escapeHtml(text)
}

/** Defense in depth for direct per-series colors that do not use AsciiTheme. */
function concreteTerminalHex(color: string): string | undefined {
  const safe = safeCssColor(color)
  const parsed = safe ? tryParseCssColor(safe) : null
  return parsed ? toHex(parsed[0], parsed[1], parsed[2]) : undefined
}

// ============================================================================
// Role → color mapping
// ============================================================================

/**
 * Get the color for a character role from the theme.
 */
function getRoleColor(role: CharRole, theme: AsciiTheme): string {
  switch (role) {
    case 'text': return theme.fg
    case 'border': return theme.border
    case 'line': return theme.line
    case 'arrow': return theme.arrow
    case 'corner': return theme.corner ?? theme.line
    case 'junction': return theme.junction ?? theme.border
    default: return theme.fg
  }
}

/**
 * Generate the ANSI escape sequence for a role color.
 */
export function getAnsiColor(role: CharRole, theme: AsciiTheme, mode: ColorMode): string {
  if (mode === 'none') return ''

  const hex = concreteTerminalHex(getRoleColor(role, theme))
  if (!hex) return ''

  switch (mode) {
    case 'truecolor': return truecolorFg(hex)
    case 'ansi256': return ansi256Fg(hex)
    case 'ansi16': return ansi16Fg(hex)
    default: return ''
  }
}

/**
 * Get the ANSI reset sequence.
 */
export function getAnsiReset(mode: ColorMode): string {
  return mode === 'none' ? '' : RESET
}

/**
 * Wrap a character with ANSI color codes based on its role.
 */
export function colorizeChar(
  char: string,
  role: CharRole | null,
  theme: AsciiTheme,
  mode: ColorMode,
): string {
  char = sanitizeTerminalText(char)
  if (mode === 'none' || role === null || char === ' ') {
    return char
  }

  const colorCode = getAnsiColor(role, theme, mode)
  return `${colorCode}${char}${RESET}`
}

/**
 * Colorize an entire line efficiently by grouping consecutive same-role characters.
 * This reduces the number of escape sequences (ANSI) or span tags (HTML) in the output.
 */
export function colorizeLine(
  chars: string[],
  roles: (CharRole | null)[],
  theme: AsciiTheme,
  mode: ColorMode,
): string {
  chars = chars.map(char => sanitizeTerminalText(char))
  if (mode === 'none') {
    return chars.join('')
  }

  if (mode === 'html') {
    return colorizeLineHtml(chars, roles, theme)
  }

  let result = ''
  let currentRole: CharRole | null = null
  let buffer = ''

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!
    const role = roles[i] ?? null

    // Whitespace doesn't need coloring
    if (char === ' ') {
      // Flush any buffered characters (with or without color)
      if (buffer.length > 0) {
        if (currentRole !== null) {
          result += getAnsiColor(currentRole, theme, mode) + buffer + RESET
        } else {
          result += buffer
        }
        buffer = ''
        currentRole = null
      }
      result += char
      continue
    }

    // Same role as previous — accumulate
    if (role === currentRole) {
      buffer += char
      continue
    }

    // Role changed — flush buffer (with or without color) and start new
    if (buffer.length > 0) {
      if (currentRole !== null) {
        result += getAnsiColor(currentRole, theme, mode) + buffer + RESET
      } else {
        result += buffer
      }
    }
    buffer = char
    currentRole = role
  }

  // Flush remaining buffer
  if (buffer.length > 0 && currentRole !== null) {
    result += getAnsiColor(currentRole, theme, mode) + buffer + RESET
  } else if (buffer.length > 0) {
    result += buffer
  }

  return result
}

/**
 * HTML-specific line colorization.
 * Groups consecutive same-role characters into <span> tags with inline color styles.
 * Whitespace is emitted bare (no wrapping) to keep output compact.
 */
function colorizeLineHtml(
  chars: string[],
  roles: (CharRole | null)[],
  theme: AsciiTheme,
): string {
  let result = ''
  let currentRole: CharRole | null = null
  let buffer = ''

  const flush = () => {
    if (buffer.length === 0) return
    if (currentRole !== null) {
      result += htmlSpan(getRoleColor(currentRole, theme), buffer)
    } else {
      result += escapeHtml(buffer)
    }
    buffer = ''
    currentRole = null
  }

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!
    const role = roles[i] ?? null

    if (char === ' ') {
      flush()
      result += ' '
      continue
    }

    if (role === currentRole) {
      buffer += char
      continue
    }

    flush()
    buffer = char
    currentRole = role
  }

  flush()
  return result
}

/**
 * Colorize a text string with a direct hex color.
 * Used by renderers that need per-cell color control (e.g. multi-series xychart).
 * Handles all output modes: ANSI (16/256/truecolor) and HTML.
 */
export function colorizeText(text: string, hex: string, mode: ColorMode): string {
  text = sanitizeTerminalText(text)
  if (mode === 'none' || text.length === 0) return text
  if (mode === 'html') return htmlSpan(hex, text)
  const concrete = concreteTerminalHex(hex)
  if (!concrete) return text
  let code: string
  switch (mode) {
    case 'truecolor': code = truecolorFg(concrete); break
    case 'ansi256': code = ansi256Fg(concrete); break
    case 'ansi16': code = ansi16Fg(concrete); break
    default: return text
  }
  return `${code}${text}${RESET}`
}
