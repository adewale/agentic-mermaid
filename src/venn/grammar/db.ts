// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import { GrammarReadError } from '../../shared/grammar-reader-error.ts'
import type { VennModel, VennStyle, VennSubset, VennText } from './types.ts'
import { observeParserMutation, type ParserObservationSource } from '../../shared/parser-observation.ts'

// Mermaid takes one pair of quotes off an id, label or style value.
export function normalizeText(text: string): string {
  const trimmed = text.trim()
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed
}

function normalizeIds(ids: string[]): string[] {
  return ids.map(normalizeText).sort()
}

export class VennDb implements VennModel {
  readonly type = 'venn' as const
  title: string | undefined
  subsets: VennSubset[] = []
  textNodes: VennText[] = []
  styles: VennStyle[] = []
  statementSource?: ParserObservationSource
  private known = new Set<string>()
  private current: string[] | undefined
  // Whether an indented `text` line belongs to the set or union before it. The lexer reads this.
  private indent = false

  setDiagramTitle(title: string): void {
    this.title = title
    observeParserMutation('venn', 'set-title', title, this.statementSource)
  }

  // A set without a size gets 10, and an overlap of n sets 10 / n².
  addSubsetData(ids: string[], label: string | undefined, size: number | undefined): void {
    const sets = normalizeIds(ids)
    this.current = sets
    if (sets.length === 1) this.known.add(sets[0]!)
    this.subsets.push({ sets, size: size ?? 10 / ids.length ** 2, label: label ? normalizeText(label) : undefined })
    observeParserMutation('venn', 'add-subset', this.subsets[this.subsets.length - 1], this.statementSource)
  }

  addTextData(ids: string[], id: string, label: string | undefined): void {
    this.textNodes.push({ sets: normalizeIds(ids), id: normalizeText(id), label: label ? normalizeText(label) : undefined })
    observeParserMutation('venn', 'add-text', this.textNodes[this.textNodes.length - 1], this.statementSource)
  }

  addStyleData(ids: string[], data: [string, string][]): void {
    const styles = new Map<string, string>()
    for (const [key, value] of data) styles.set(key, value ? normalizeText(value) : value)
    this.styles.push({ targets: normalizeIds(ids), styles })
    observeParserMutation('venn', 'add-style', this.styles[this.styles.length - 1], this.statementSource)
  }

  validateUnionIdentifiers(ids: string[]): void {
    const unknown = ids.map(normalizeText).filter(id => !this.known.has(id))
    if (unknown.length > 0) {
      throw new GrammarReadError(`unknown set identifier: ${unknown.join(', ')}`, 'semantic', { type: 'venn' })
    }
  }

  getCurrentSets(): string[] | undefined {
    return this.current
  }

  getIndentMode(): boolean {
    return this.indent
  }

  setIndentMode(enabled: boolean): void {
    this.indent = enabled
  }
}
