import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CustomStyleCatalogEntry {
  readonly id: string
  readonly style: string
  /** Optional family-specific Mermaid fixture; defaults to catalog.sample. */
  readonly sample?: string
  readonly screenshot: string
  readonly alt: string
  readonly summary: string
  readonly docsOnly?: boolean
  readonly renderOptions?: Readonly<{ shadow?: boolean }>
}

export interface CustomStyleCatalog {
  readonly version: 1
  readonly sample: string
  readonly examples: readonly CustomStyleCatalogEntry[]
}

export const CUSTOM_STYLE_ROOT = join(import.meta.dir, '..', '..', 'examples', 'styles')
export const CUSTOM_STYLE_SCREENSHOT_ROOT = join(import.meta.dir, '..', '..', 'docs', 'assets', 'style-cookbook')

function loadCatalog(): CustomStyleCatalog {
  const value = JSON.parse(readFileSync(join(CUSTOM_STYLE_ROOT, 'catalog.json'), 'utf8')) as Partial<CustomStyleCatalog>
  if (value.version !== 1 || typeof value.sample !== 'string' || !Array.isArray(value.examples)) {
    throw new Error('examples/styles/catalog.json must be a version 1 custom-style catalog')
  }
  const seen = {
    id: new Set<string>(),
    style: new Set<string>(),
    screenshot: new Set<string>(),
  }
  const examples = value.examples.map((entry, index) => {
    for (const field of ['id', 'style', 'screenshot', 'alt', 'summary'] as const) {
      if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') {
        throw new Error(`custom-style catalog entry ${index} requires a non-empty ${field}`)
      }
    }
    if (entry.sample !== undefined && (typeof entry.sample !== 'string' || entry.sample.trim() === '')) {
      throw new Error(`custom-style catalog entry ${index} sample must be a non-empty string`)
    }
    for (const field of ['id', 'style', 'screenshot'] as const) {
      if (seen[field].has(entry[field])) {
        throw new Error(`duplicate custom-style catalog ${field} "${entry[field]}"`)
      }
      seen[field].add(entry[field])
    }
    if (entry.renderOptions !== undefined) {
      const keys = Object.keys(entry.renderOptions)
      if (keys.some(key => key !== 'shadow') || (entry.renderOptions.shadow !== undefined && typeof entry.renderOptions.shadow !== 'boolean')) {
        throw new Error(`custom-style catalog entry "${entry.id}" has invalid renderOptions`)
      }
    }
    return Object.freeze({
      ...entry,
      ...(entry.renderOptions ? { renderOptions: Object.freeze({ ...entry.renderOptions }) } : {}),
    })
  })
  return Object.freeze({ version: 1, sample: value.sample, examples: Object.freeze(examples) })
}

export const CUSTOM_STYLE_CATALOG = loadCatalog()

export function customStylePath(entry: CustomStyleCatalogEntry): string {
  return join(CUSTOM_STYLE_ROOT, entry.style)
}

export function customStyleScreenshotPath(entry: CustomStyleCatalogEntry): string {
  return join(CUSTOM_STYLE_SCREENSHOT_ROOT, entry.screenshot)
}

export function customStyleSamplePath(entry?: CustomStyleCatalogEntry): string {
  return join(CUSTOM_STYLE_ROOT, entry?.sample ?? CUSTOM_STYLE_CATALOG.sample)
}
