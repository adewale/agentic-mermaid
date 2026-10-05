/**
 * The one YAML reader for Mermaid frontmatter and `@{…}` metadata bodies.
 *
 * Pinned Mermaid 11.16 reads frontmatter (`frontmatter.ts`) and flowchart and
 * sequence `@{}` bodies with one call: js-yaml `load` under its
 * `JSON_SCHEMA`, and a YAML error rejects the diagram. This module is that
 * reader, on the bundled `yaml` package: its YAML 1.2 core schema with the
 * integer and float resolution replaced by js-yaml's (`0b…`, `_` digit
 * separators, signed hex/octal; `-.5` stays a string). An unresolvable tag is
 * an error, as in js-yaml.
 *
 * It is kept apart from the `@{…}` block lexers (shared/metadata-yaml.ts) so
 * the source normalizer every render loads carries only the reader; the
 * lexers ride with the flowchart and sequence parsers.
 */

import YAML, { type ScalarTag, type SchemaOptions, type Tags } from 'yaml'
import { stringifyNumber } from 'yaml/util'

// ---- js-yaml JSON_SCHEMA scalar resolution ---------------------------------

const JS_YAML_INT_RE = /^[-+]?(?:0b[01_]*[01]|0x[0-9a-fA-F_]*[0-9a-fA-F]|0o[0-7_]*[0-7]|0|0[0-9](?:[0-9_]*[0-9])?|[1-9](?:[0-9_]*[0-9])?)$/
const JS_YAML_FLOAT_RE = /^(?!.*_$)(?:[-+]?[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/

function resolveJsYamlInt(source: string, onError: (message: string) => void): number {
  if (!JS_YAML_INT_RE.test(source)) {
    onError(`cannot resolve ${JSON.stringify(source)} as an integer`)
    return Number.NaN
  }
  let value = source.replace(/_/g, '')
  const sign = value[0] === '-' ? -1 : 1
  if (value[0] === '-' || value[0] === '+') value = value.slice(1)
  const radix = value[1] === 'b' ? 2 : value[1] === 'x' ? 16 : value[1] === 'o' ? 8 : 10
  return sign * Number.parseInt(radix === 10 ? value : value.slice(2), radix)
}

function resolveJsYamlFloat(source: string, onError: (message: string) => void): number {
  if (!JS_YAML_FLOAT_RE.test(source)) {
    onError(`cannot resolve ${JSON.stringify(source)} as a float`)
    return Number.NaN
  }
  let value = source.replace(/_/g, '').toLowerCase()
  const sign = value[0] === '-' ? -1 : 1
  if (value[0] === '-' || value[0] === '+') value = value.slice(1)
  if (value === '.inf') return sign * Number.POSITIVE_INFINITY
  if (value === '.nan') return Number.NaN
  return sign * Number.parseFloat(value)
}

const JS_YAML_INT: ScalarTag = {
  identify: value => typeof value === 'number' && Number.isInteger(value),
  default: true,
  tag: 'tag:yaml.org,2002:int',
  test: JS_YAML_INT_RE,
  resolve: resolveJsYamlInt,
  stringify: stringifyNumber,
}

const JS_YAML_FLOAT: ScalarTag = {
  identify: value => typeof value === 'number',
  default: true,
  tag: 'tag:yaml.org,2002:float',
  test: JS_YAML_FLOAT_RE,
  resolve: resolveJsYamlFloat,
  stringify: stringifyNumber,
}

const MERMAID_YAML_OPTIONS: SchemaOptions = {
  schema: 'core',
  customTags: (tags: Tags): Tags => [
    ...tags.filter(tag => typeof tag === 'string' || (tag.tag !== JS_YAML_INT.tag && tag.tag !== JS_YAML_FLOAT.tag)),
    JS_YAML_INT,
    JS_YAML_FLOAT,
  ],
}

export type MermaidYamlResult = { ok: true; value: unknown } | { ok: false; message: string }

const COMMENT_SPACING = 'Comments must be separated from other tokens by white space characters'

/** js-yaml reads a `#` right after a flow indicator or a quoted scalar
 * (`a,#c`, `"x"#c`) as a comment. The yaml package parses it the same way but
 * reports it; only after a block scalar header (`|#`) is it an error in both. */
function jsYamlAccepts(error: YAML.YAMLError, text: string): boolean {
  return error.code === 'MISSING_CHAR' && error.message.startsWith(COMMENT_SPACING)
    && !/[|>][-+0-9]*$/.test(text.slice(0, error.pos[0]))
}

/** js-yaml rejects a block mapping line that starts with `:` (no key); the
 * yaml package reads it as an empty key. A flow mapping allows it in both. */
function hasEmptyBlockKey(parsed: YAML.Document, text: string): boolean {
  let found = false
  YAML.visit(parsed, {
    Pair(_key, pair, path) {
      const map = path[path.length - 1]
      const key = pair.key
      const at = YAML.isScalar(key) && key.source === '' && key.range?.[0] === key.range?.[1] ? key.range![0] : -1
      if (at >= 0 && YAML.isMap(map) && !map.flow && /^[ \t]*:/.test(text.slice(at))
        && /^[ \t]*$/.test(text.slice(text.lastIndexOf('\n', at - 1) + 1, at))) {
        found = true
        return YAML.visit.BREAK
      }
      return undefined
    },
  })
  return found
}

/** A quote opens a scalar only where YAML starts a node: at a line's first
 * token, after a flow indicator, or after `:`, `-` or `?` and a space. */
const QUOTED_SCALAR_START_RE = /(?:^|[[{,]|[:?-][ \t])[ \t]*$/
/** A block scalar header (`|`, `>-`, `|2`…) ending a line's node position. */
const BLOCK_SCALAR_HEADER_RE = /(?:^|[:?-][ \t])[ \t]*[|>][-+0-9]*[ \t]*(?:#.*)?$/

/**
 * js-yaml reads a quoted scalar's continuation lines at any indentation (its
 * own docs put a multi-line `themeCSS: "…` closing quote under the key); the
 * yaml package wants them indented past the enclosing block. Line folding
 * drops a continuation line's leading white space, so indenting those lines
 * further changes no value. Block scalar content is left alone. Returns the
 * re-indented text, or undefined when no quoted scalar spans lines.
 */
function indentQuotedContinuations(text: string): string | undefined {
  const lines = text.split('\n')
  const indentOf = (line: string) => line.match(/^[ \t]*/)![0]
  let quote: '"' | "'" | undefined
  let indent = ''
  let blockIndent: number | undefined
  let changed = false
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]!
    if (blockIndent !== undefined) {
      if (line.trim() === '' || indentOf(line).length > blockIndent) continue
      blockIndent = undefined
    }
    if (quote) {
      lines[row] = indent + line
      changed = true
    }
    let at = 0
    for (; at < line.length; at++) {
      const character = line[at]!
      if (quote === '"') {
        if (character === '\\') at++
        else if (character === '"') quote = undefined
      } else if (quote === "'") {
        if (character === "'" && line[at + 1] === "'") at++
        else if (character === "'") quote = undefined
      } else if (character === '#' && (at === 0 || /[ \t]/.test(line[at - 1]!))) {
        break
      } else if ((character === '"' || character === "'") && QUOTED_SCALAR_START_RE.test(line.slice(0, at))) {
        quote = character
        indent = `${indentOf(line)} `
      }
    }
    if (!quote && BLOCK_SCALAR_HEADER_RE.test(line)) blockIndent = indentOf(line).length
  }
  return changed ? lines.join('\n') : undefined
}

function readYamlDocument(text: string): MermaidYamlResult {
  const parsed = YAML.parseDocument(text, { ...MERMAID_YAML_OPTIONS, logLevel: 'silent' })
  const problem = parsed.errors.find(error => !jsYamlAccepts(error, text)) ?? parsed.warnings[0]
  if (problem) return { ok: false, message: problem.message.split('\n')[0]! }
  if (hasEmptyBlockKey(parsed, text)) return { ok: false, message: 'a block mapping entry has no key' }
  // js-yaml names a null key `null` (String(null)); the yaml package, ``.
  YAML.visit(parsed, {
    Pair(_key, pair) {
      if (YAML.isScalar(pair.key) && pair.key.value === null) pair.key = new YAML.Scalar('null')
    },
  })
  try {
    return { ok: true, value: parsed.toJS() }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** Parse one YAML document as upstream's js-yaml `JSON_SCHEMA` load does.
 * An empty document is `null`. Errors and warnings (an unknown tag, say) are
 * both failures, since js-yaml throws on each. */
export function parseMermaidYaml(source: string): MermaidYamlResult {
  // js-yaml's loader ends its input with a line break when it lacks one.
  const text = source.length > 0 && !/[\n\r]$/.test(source) ? `${source}\n` : source
  const result = readYamlDocument(text)
  if (result.ok) return result
  const reindented = indentQuotedContinuations(text)
  const retried = reindented === undefined ? undefined : readYamlDocument(reindented)
  return retried?.ok ? retried : result
}

/** Write a value as YAML that `parseMermaidYaml` (and upstream) reads back:
 * a string that would resolve as a number, boolean or null is quoted. */
export function stringifyMermaidYaml(value: unknown): string {
  return YAML.stringify(value, MERMAID_YAML_OPTIONS)
}
