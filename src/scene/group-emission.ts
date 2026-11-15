import { decodeXML } from 'entities'
import { visitSvgFirstTagAttributes } from '../svg-structure.ts'
import { parseSvgTransform, transformMatrix } from './transforms.ts'
import type { GroupMark } from './ir.ts'

const GROUP_HOOK = /^(?:class|data-[a-z][a-z0-9-]*|role|aria-[a-z]+|tabindex|pointer-events|transform|style)$/
const GROUP_OPEN = /^\s*<g\b[^>]*>(?:<title>[^<]*<\/title>)?$/
/** Custom properties only: values a family scopes to the group for its marks' var() paints. */
const CUSTOM_PROPERTIES = /^\s*(?:--[A-Za-z0-9_-]+\s*:[^;]*(?:;\s*|$))*$/
/** A group's open tag carries hooks, and the transform its typed field
 * declares; paint belongs to the marks inside it, which the writer paints. */
export function assertInertGroup({ id, open, close, join, transform, paint }: Pick<GroupMark, 'id' | 'open' | 'close' | 'join' | 'transform' | 'paint'>) {
  if (close !== '</g>' || !/^\s*$/.test(join)) throw new TypeError(`Group "${id}" close and join must not add artwork`)
  const names = new Set<string>()
  let rawTransform: string | undefined
  const tag = GROUP_OPEN.test(open) ? visitSvgFirstTagAttributes(open, 'g', (name, value) => {
    if (names.has(name)) throw new TypeError(`Group "${id}" open has a duplicate "${name}"`)
    names.add(name)
    if ((name === 'opacity' || name === 'fill') && paint?.[name] !== undefined && decodeXML(value) === paint[name]) return
    if (!GROUP_HOOK.test(name)) throw new TypeError(`Group "${id}" open sets "${name}"; paint and geometry belong to typed marks`)
    if (name === 'style' && !CUSTOM_PROPERTIES.test(decodeXML(value))) {
      throw new TypeError(`Group "${id}" open style may only set custom properties; paint belongs to typed marks`)
    }
    if (name === 'transform') rawTransform = value
  }) : undefined
  if (['opacity', 'fill'].some(name => names.has(name) !== ((paint as Record<string, unknown> | undefined)?.[name] !== undefined))) throw new TypeError(`Group "${id}" open disagrees with its typed paint`)
  if (tag !== 'g') throw new TypeError(`Group "${id}" open must be one <g> tag with an optional <title>`)
  const written = rawTransform === undefined ? undefined : decodeXML(rawTransform)
  const matrix = written === undefined ? undefined : parseSvgTransform(written)
  const typed = transform ? transformMatrix(transform) : undefined
  if (written !== undefined && !matrix) throw new TypeError(`Group "${id}" open has an unsupported transform`)
  if (!!matrix !== !!typed || matrix && typed && matrix.some((value, index) => Math.abs(value - typed[index]!) > 1e-9 * Math.max(1, Math.abs(value)))) {
    throw new TypeError(`Group "${id}" open transform disagrees with its typed transform`)
  }
  return { matrix: matrix && Object.freeze(matrix), style: names.has('style') }
}

