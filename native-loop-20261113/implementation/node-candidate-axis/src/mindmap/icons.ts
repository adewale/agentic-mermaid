import { resolveArchitectureIcon } from '../architecture/icons.ts'

export interface MindmapIconGlyph {
  viewBox: '0 0 24 24'
  paths: readonly string[]
  source: 'bundled-symbol' | '@iconify-json/mdi@1.2.3'
}

const LOCAL_ICONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  book: Object.freeze([
    'M3 5.5C6 4.5 9 4.8 12 6V20C9 18.8 6 18.5 3 19.5Z',
    'M21 5.5C18 4.5 15 4.8 12 6V20C15 18.8 18 18.5 21 19.5Z',
  ]),
  skull: Object.freeze([
    'M5 11A7 7 0 1 1 19 11C19 15 17 17 15 18V21H9V18C7 17 5 15 5 11Z',
    'M8 11A1.5 1.5 0 1 0 11 11A1.5 1.5 0 1 0 8 11ZM13 11A1.5 1.5 0 1 0 16 11A1.5 1.5 0 1 0 13 11Z',
    'M10 17V20M12 17V20M14 17V20',
  ]),
})

/**
 * Resolve only bounded local data. Font-awesome/MDI class spellings normalize
 * to semantic names; no ambient font, network, filesystem, or dynamic import
 * can affect the resulting SVG.
 */
export function resolveMindmapIcon(raw: string): MindmapIconGlyph | null {
  const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const meaningful = tokens.findLast(token => !['fa', 'fas', 'far', 'fab', 'mdi'].includes(token)) ?? ''
  const name = meaningful.replace(/^(?:fa-|mdi-)/, '')
  const localName = name === 'book-open' ? 'book' : name === 'skull-outline' ? 'skull' : name
  const local = LOCAL_ICONS[localName]
  if (local) return { viewBox: '0 0 24 24', paths: local, source: 'bundled-symbol' }

  const architecture = resolveArchitectureIcon(raw) ?? resolveArchitectureIcon(`mdi:${name}`)
  return architecture
    ? { viewBox: architecture.viewBox, paths: [architecture.path], source: architecture.source }
    : null
}
