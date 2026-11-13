import { safeCssFontFamily } from './css-font.ts'
export interface ConfigValueRule { expected: string; valid: (value: unknown) => boolean }
export const rule = (expected: string, valid: ConfigValueRule['valid']): ConfigValueRule => ({ expected, valid })
export const positive = rule('a finite positive number', value => typeof value === 'number' && Number.isFinite(value) && value > 0)
export const nonNegative = rule('a finite non-negative number', value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
export const finite = rule('a finite number', value => typeof value === 'number' && Number.isFinite(value))
export const boolean = rule('a boolean', value => typeof value === 'boolean')
export const stringValue = rule('a string', value => typeof value === 'string')
export const nonEmptyString = rule('a non-empty string', value => typeof value === 'string' && value.trim().length > 0)
/** A font-family list that is safe to place in CSS (no fetching functions). */
export const safeFontFamily = rule('a CSS font-family list without url(), @import or other functions besides var()', value => safeCssFontFamily(value) !== undefined)
export const stringArray = rule('a non-empty array of strings', value => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string'))
export const oneOf = (...values: string[]): ConfigValueRule => rule(`one of: ${values.join(', ')}`, value => typeof value === 'string' && values.includes(value))
export const oneOfInsensitive = (...values: string[]): ConfigValueRule => rule(`one of: ${values.join(', ')} (case-insensitive)`, value =>
  typeof value === 'string' && values.some(candidate => candidate.toLowerCase() === value.toLowerCase()),
)
export const range = (min: number, max: number, leftClosed = true): ConfigValueRule => rule(
  `a finite number ${leftClosed ? 'from' : 'greater than'} ${min} through ${max}`,
  value => typeof value === 'number' && Number.isFinite(value) && (leftClosed ? value >= min : value > min) && value <= max,
)
export const boundedPositive = (max: number): ConfigValueRule => rule(
  `a finite positive number no greater than ${max}`,
  value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max,
)
export const boundedNonNegative = (max: number): ConfigValueRule => rule(
  `a finite non-negative number no greater than ${max}`,
  value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max,
)
export const positiveCssSize = rule('a finite positive number or non-empty CSS size string', value =>
  (typeof value === 'number' && Number.isFinite(value) && value > 0) || (typeof value === 'string' && value.trim().length > 0),
)
export const numericLike = (minimum: number, exclusive = false): ConfigValueRule => rule(
  `a numeric value${exclusive ? ` greater than ${minimum}` : ` of at least ${minimum}`}`,
  value => {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/i.test(value.trim()) ? Number.parseFloat(value) : Number.NaN
    return Number.isFinite(parsed) && (exclusive ? parsed > minimum : parsed >= minimum)
  },
)
