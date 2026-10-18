import type { C4Boundary, C4Element, C4Shape } from './types.ts'
import { drawableAuthoredCssPaint } from '../shared/css-color.ts'
import { AuthoredStyleColorError } from '../shared/style-props.ts'

const SHAPE_OVERRIDES: ReadonlyMap<string, C4Shape> = new Map([
  ['person', 'person'], ['box', 'rectangle'], ['rectangle', 'rectangle'], ['cylinder', 'database'],
  ['database', 'database'], ['db', 'database'], ['queue', 'queue'], ['pipe', 'queue'],
])
/** A bounded visual override. Tags and sprites remain semantic metadata. */
export function c4ShapeOverride(value: string | undefined): C4Shape | undefined {
  return value === undefined ? undefined : SHAPE_OVERRIDES.get(value.trim().toLowerCase())
}
/** Authored role, macro shape and external status remain independent of paint. */
export function effectiveC4Shape(item: C4Element): C4Shape {
  return c4ShapeOverride(item.style.shape) ?? item.shape
}

export type C4ConfigInput = Readonly<Record<string, unknown>>
export interface C4Config {
  marginX: number; marginY: number; gap: number; padding: number
  minimumWidth: number; minimumHeight: number; boundaryPadding: number
  rowGap: number; shapesPerRow: number; boundariesPerRow: number; wrapWidth?: number
  input: C4ConfigInput; themeVariables: C4ConfigInput
}
const number = (value: unknown, fallback: number, minimum = 0): number => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > 10000) throw new RangeError(`Invalid C4 numeric configuration ${JSON.stringify(value)}; expected a finite number from ${minimum} to 10000`)
  return value
}
const integer = (value: unknown, fallback: number): number => { const result = number(value, fallback, 1); if (!Number.isSafeInteger(result)) throw new RangeError(`Invalid C4 row count ${JSON.stringify(value)}; expected a positive integer`); return result }
export function resolveC4Config(input: C4ConfigInput = {}, themeVariables: C4ConfigInput = {}): C4Config {
  return { marginX: number(input.diagramMarginX, 24), marginY: number(input.diagramMarginY, 24),
    gap: number(input.c4ShapeMargin, 56), padding: number(input.c4ShapePadding, 16, 4),
    minimumWidth: number(input.width, 150, 24), minimumHeight: number(input.height, 76, 24),
    boundaryPadding: number(input.boxMargin, 24, 12), rowGap: number(input.nextLinePaddingX, 56),
    shapesPerRow: integer(input.c4ShapeInRow, 3), boundariesPerRow: integer(input.c4BoundaryInRow, 2),
    ...(input.wrap === false ? {} : { wrapWidth: number(input.wrapPadding, 260, 40) }), input, themeVariables }
}
export function c4ConfigType(item: C4Element | C4Boundary): string {
  if (!('external' in item)) return item.kind === 'deployment' ? 'node' : 'boundary'
  return `${item.external ? 'external_' : ''}${item.kind}${item.shape === 'database' ? '_db' : item.shape === 'queue' ? '_queue' : ''}`
}
export function c4Appearance(item: C4Element | C4Boundary, config: C4Config): { fill?: string; stroke?: string; text?: string; fontSize?: number; fontWeight?: number; fontFamily?: string; dashed: boolean } {
  const key = c4ConfigType(item), { input, themeVariables } = config
  const color = (value: unknown, property: string) => {
    if (value === undefined) return undefined
    const admitted = drawableAuthoredCssPaint(value, property !== 'color')
    if (admitted === undefined) throw new AuthoredStyleColorError(`C4 ${item.id}`, property, String(value), `UpdateElementStyle(${item.id})`)
    return admitted
  }
  const size = input[`${key}FontSize`], weight = input[`${key}FontWeight`]
  return { fill: color(item.style.bgColor ?? input[`${key}_bg_color`] ?? themeVariables[`${key}_bg_color`], 'fill'),
    stroke: color(item.style.borderColor ?? input[`${key}_border_color`] ?? themeVariables[`${key}_border_color`], 'stroke'),
    text: color(item.style.fontColor ?? item.style.textColor, 'color'),
    ...(size === undefined ? {} : { fontSize: number(size, 13, 1) }),
    ...(weight === undefined ? {} : { fontWeight: number(typeof weight === 'string' && /^\d+$/.test(weight) ? Number(weight) : weight, 500, 1) }),
    dashed: item.style.lineStyle === undefined ? ('external' in item && item.external) : item.style.lineStyle === 'dashed' || item.style.lineStyle === 'dotted' }
}

const C4_CONFIG_TYPES = ['person', 'external_person', ...['system', 'container', 'component'].flatMap(kind => ['', 'external_'].flatMap(prefix => ['', '_db', '_queue'].map(shape => `${prefix}${kind}${shape}`))), 'boundary', 'node']
export const C4_CONFIG_KEYS: readonly string[] = Object.freeze(['diagramMarginX', 'diagramMarginY', 'c4ShapeMargin', 'c4ShapePadding', 'width', 'height', 'boxMargin', 'nextLinePaddingX', 'c4ShapeInRow', 'c4BoundaryInRow', 'wrap', 'wrapPadding', ...C4_CONFIG_TYPES.flatMap(kind => [`${kind}FontSize`, `${kind}FontWeight`, `${kind}_bg_color`, `${kind}_border_color`])])
