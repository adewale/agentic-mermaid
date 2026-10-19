// Adapted semantic grammar types from Pele; see pele-license.txt.
export interface Requirement {
  name: string
  type: string
  requirementId: string
  text: string
  risk: string
  verifyMethod: string
  cssStyles: string[]
  classes: string[]
  directStyles?: string[]
}

export interface RequirementElement {
  name: string
  type: string
  docRef: string
  cssStyles: string[]
  classes: string[]
  directStyles?: string[]
}

export interface Relation {
  type: string
  src: string
  dst: string
}

export interface RequirementClass {
  id: string
  styles: string[]
  textStyles: string[]
}

export interface RequirementModel {
  type: 'requirement'
  direction: string
  requirements: Map<string, Requirement>
  elements: Map<string, RequirementElement>
  relations: Relation[]
  classes: Map<string, RequirementClass>
  title?: string
  accTitle?: string
  accDescr?: string
}

export interface RequirementRelation extends Relation {
  id: string
}
export interface RequirementBody {
  kind: 'requirement'
  direction: 'TB' | 'BT' | 'LR' | 'RL'
  requirements: Requirement[]
  elements: RequirementElement[]
  relations: RequirementRelation[]
  classDefs: RequirementClass[]
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
}
export type RequirementInput = Pick<Requirement, 'name'> & Partial<Omit<Requirement, 'name' | 'cssStyles'>>
export type RequirementElementInput = Pick<RequirementElement, 'name'> & Partial<Omit<RequirementElement, 'name' | 'cssStyles'>>
export type RequirementMutationOp =
  | { kind: 'set_direction'; direction: RequirementBody['direction'] }
  | { kind: 'add_requirement'; requirement: RequirementInput }
  | { kind: 'update_requirement'; id: string; changes: Partial<Omit<RequirementInput, 'name'>> }
  | { kind: 'add_element'; element: RequirementElementInput }
  | { kind: 'update_element'; id: string; changes: Partial<Omit<RequirementElementInput, 'name'>> }
  | { kind: 'rename_node'; from: string; to: string }
  | { kind: 'remove_node'; id: string; cascade?: boolean }
  | { kind: 'add_relation'; relation: Omit<RequirementRelation, 'id'> & { id?: string } }
  | { kind: 'remove_relation'; id: string }
  | { kind: 'define_class'; name: string; style: string }
  | { kind: 'set_node_class'; id: string; className: string | null }
  | { kind: 'set_node_style'; id: string; style: string | null }

export interface RequirementCard {
  id: string
  requirement?: Requirement
  element?: RequirementElement
  x: number
  y: number
  width: number
  height: number
  header: import('../shared/prepared-text.ts').PixelTextBlock
  rows: { label: string; block: import('../shared/prepared-text.ts').PixelTextBlock; y: number }[]
  paddingX: number
  headerHeight: number
  style: Record<string, string>
}
export interface PositionedRequirementDiagram {
  width: number
  height: number
  model: RequirementBody
  nodes: RequirementCard[]
  edges: (RequirementRelation & { points: import('../types.ts').Point[]; label: import('../shared/prepared-text.ts').PixelTextBlock; labelPosition: import('../types.ts').Point })[]
  title?: import('../styles.ts').PositionedDiagramTitle
  style: import('../styles.ts').ResolvedRenderStyle
}
