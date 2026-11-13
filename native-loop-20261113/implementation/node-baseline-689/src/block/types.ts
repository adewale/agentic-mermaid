// Adapted semantic grammar types from Pele; see pele-license.txt.
// One shape for blocks, edges, and the statements that set columns, classes, and styles, as in Mermaid.
export interface Block {
  id: string
  type?: string
  label?: string
  children?: Block[]
  columns?: number
  widthInColumns?: number
  // Number of cells a `space` statement asked for.
  width?: number
  directions?: string[]
  classes?: string[]
  styles?: string[]
  colorIndex?: number
  start?: string
  end?: string
  arrowTypeStart?: string
  arrowTypeEnd?: string
  thickness?: string
  pattern?: string
  css?: string
  styleClass?: string
  stylesStr?: string
}

// A statement with links is a list: block, edge, block, and so on.
export type Statement = Block | Block[]

export interface BlockClassDef {
  id: string
  styles: string[]
  textStyles: string[]
}

export interface BlockModel {
  type: 'block'
  root: Block
  blocks: Block[]
  edges: Block[]
  classes: Map<string, BlockClassDef>
  byId: Map<string, Block>
  title?: string
  // Never set: the grammar reads accTitle and accDescr but has no statement that accepts them.
  accTitle?: string
  accDescr?: string
}

export interface BlockBody {
  kind: 'block'
  root: Block
  edges: Block[]
  classDefs: BlockClassDef[]
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
}
export interface BlockInput {
  id: string
  label?: string
  type?: string
  widthInColumns?: number
  columns?: number
  directions?: string[]
  classes?: string[]
  styles?: string[]
  width?: number
  children?: BlockInput[]
}
export type BlockMutationOp =
  | { kind: 'set_columns'; columns: number; parentId?: string }
  | { kind: 'add_block'; block: BlockInput; parentId?: string; index?: number }
  | { kind: 'update_block'; id: string; changes: Partial<Omit<BlockInput, 'id'>> }
  | { kind: 'rename_block'; from: string; to: string }
  | { kind: 'remove_block'; id: string; cascade?: boolean }
  | { kind: 'move_block'; id: string; parentId?: string; index?: number }
  | { kind: 'add_edge'; from: string; to: string; label?: string; style?: 'solid' | 'dotted' | 'thick'; arrowStart?: string; arrowEnd?: string }
  | { kind: 'remove_edge'; id: string }
  | { kind: 'define_class'; name: string; style: string }
  | { kind: 'set_node_class'; id: string; className: string | null }
  | { kind: 'set_node_style'; id: string; style: string | null }

export interface PositionedBlock {
  id: string
  block: Block
  parentId?: string
  x: number
  y: number
  width: number
  height: number
  label: import('../shared/prepared-text.ts').PixelTextBlock
  style: Record<string, string>
}
export interface PositionedBlockDiagram {
  width: number
  height: number
  model: BlockBody
  nodes: PositionedBlock[]
  edges: (Block & { points: import('../types.ts').Point[]; labelBlock: import('../shared/prepared-text.ts').PixelTextBlock; labelPosition: import('../types.ts').Point })[]
  title?: import('../styles.ts').PositionedDiagramTitle
  style: import('../styles.ts').ResolvedRenderStyle
}
