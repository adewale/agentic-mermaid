// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
// A set (one id) or an overlap of sets (two or more ids, sorted), with its relative area.
export interface VennSubset {
  sets: string[]
  size: number
  label: string | undefined
}

// A line of text shown inside the region of the given sets.
export interface VennText {
  sets: string[]
  id: string
  label: string | undefined
}

// Targets are the sorted ids of a set or overlap, or the id of a text.
export interface VennStyle {
  targets: string[]
  styles: Map<string, string>
}

export interface VennModel {
  type: 'venn'
  title: string | undefined
  subsets: VennSubset[]
  textNodes: VennText[]
  styles: VennStyle[]
}
