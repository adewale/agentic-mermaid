/** Shared authored C4 semantics. Pixel and terminal projections consume this
 * model without rewriting identities or deriving one layout from the other. */
export type C4Variant = 'C4Context' | 'C4Container' | 'C4Component' | 'C4Dynamic' | 'C4Deployment'
export type C4Direction = 'LR' | 'RL' | 'TB' | 'BT'
export type C4ElementKind = 'person' | 'system' | 'container' | 'component'
export type C4Shape = 'person' | 'rectangle' | 'database' | 'queue'
export type C4BoundaryKind = 'boundary' | 'enterprise' | 'system' | 'container' | 'deployment'

export interface C4SourceSpan { start: number; end: number; line: number; column: number }
export interface C4ArgumentInput { name?: string; value: string }
export interface C4Argument extends C4ArgumentInput { raw: string }
export interface C4Style {
  bgColor?: string
  fontColor?: string
  borderColor?: string
  textColor?: string
  lineColor?: string
  lineStyle?: string
  shape?: string
  shadowing?: string
  offsetX?: string
  offsetY?: string
  [property: string]: string | undefined
}

interface C4Declaration {
  id: string
  /** Exact declaration macro; aliases remain distinct from their interpretation. */
  macro: string
  label: string
  parentId?: string
  tags: string[]
  link?: string
  /** Resolved link extension; authored link remains independent. */
  effectiveLink?: string
  sprite?: string
  style: C4Style
  args: C4Argument[]
  statementId: string
}
export interface C4Element extends C4Declaration {
  kind: C4ElementKind
  external: boolean
  shape: C4Shape
  technology?: string
  description?: string
}
export interface C4Boundary extends C4Declaration {
  kind: C4BoundaryKind
  type?: string
  description?: string
  alignment?: 'left' | 'right'
}
export interface C4Relationship {
  id: string
  macro: string
  /** Authored endpoints, before Rel_Back interpretation. */
  from: string
  to: string
  /** Effective endpoints used by both projections. */
  source: string
  target: string
  label: string
  technology?: string
  description?: string
  tags: string[]
  link?: string
  effectiveLink?: string
  sprite?: string
  style: C4Style
  args: C4Argument[]
  statementId: string
  /** Explicit RelIndex value, independent of authored interaction order. */
  index?: string
  /** One-based interaction number; repeated endpoint pairs remain separate. */
  order: number
  bidirectional: boolean
  reversed: boolean
  direction?: C4Direction
}
export interface C4LayoutHint { from: string; to: string; direction: C4Direction; statementId: string }
export interface C4LayoutHints {
  direction?: C4Direction
  shapesPerRow?: number
  boundariesPerRow?: number
  hints: C4LayoutHint[]
}
export interface C4Directive {
  id: string
  name: string
  args: C4Argument[]
  category: 'element-style' | 'relationship-style' | 'element-tag' | 'relationship-tag' | 'layout' | 'legend' | 'link' | 'unknown'
  statementId: string
}
export interface C4Statement {
  id: string
  kind: 'header' | 'title' | 'accessibility' | 'element' | 'boundary-open' | 'boundary-close' | 'relationship' | 'directive' | 'trivia' | 'unknown'
  raw: string
  span: C4SourceSpan
  entityId?: string
  /** Canonical authored fields at parse time, used only to retain unchanged raw source. */
  signature?: string
}
export interface C4Diagnostic {
  code: string
  message: string
  severity: 'warning' | 'error'
  statementId?: string
}
/** A reader diagnostic on an authored statement. */
export interface C4SyntaxDiagnostic extends C4Diagnostic {
  /** Stable `c4_<construct>` name, reported as verify's `syntax`. */
  syntax: string
}
export interface C4Body {
  kind: 'c4'
  variant: C4Variant
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
  elements: C4Element[]
  boundaries: C4Boundary[]
  relationships: C4Relationship[]
  directives: C4Directive[]
  statements: C4Statement[]
  diagnostics: C4SyntaxDiagnostic[]
  layout: C4LayoutHints
  legend?: { visible: boolean; entries: { id: string; label: string; kind: 'element' | 'relationship'; style: C4Style }[] }
}
export type C4Diagram = C4Body

export interface C4ElementInput {
  id: string
  label: string
  macro?: string
  kind?: C4ElementKind
  external?: boolean
  shape?: C4Shape
  technology?: string
  description?: string
  parentId?: string
  tags?: string[]
  link?: string
  sprite?: string
}
export interface C4BoundaryInput {
  id: string
  label: string
  macro?: string
  kind?: C4BoundaryKind
  type?: string
  description?: string
  parentId?: string
  tags?: string[]
  link?: string
  sprite?: string
}
export interface C4RelationshipInput {
  id?: string
  from: string
  to: string
  label: string
  macro?: string
  technology?: string
  description?: string
  tags?: string[]
  link?: string
  sprite?: string
  index?: string
}
export type C4MutationOp =
  | { kind: 'add_element'; element: C4ElementInput }
  | { kind: 'update_element'; id: string; changes: Partial<Omit<C4ElementInput, 'id' | 'parentId'>> }
  | { kind: 'rename_element'; from: string; to: string }
  | { kind: 'reparent_element'; id: string; parentId: string | null }
  | { kind: 'remove_element'; id: string; cascade?: boolean }
  | { kind: 'add_boundary'; boundary: C4BoundaryInput }
  | { kind: 'update_boundary'; id: string; changes: Partial<Omit<C4BoundaryInput, 'id' | 'parentId'>> }
  | { kind: 'rename_boundary'; from: string; to: string }
  | { kind: 'reparent_boundary'; id: string; parentId: string | null }
  | { kind: 'remove_boundary'; id: string; cascade?: boolean }
  | { kind: 'add_relationship'; relationship: C4RelationshipInput }
  | { kind: 'update_relationship'; id: string; changes: Partial<Omit<C4RelationshipInput, 'id'>> }
  | { kind: 'remove_relationship'; id: string }
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_variant'; variant: C4Variant }
  | { kind: 'add_directive'; name: string; args: C4ArgumentInput[] }
  | { kind: 'update_directive'; id: string; args: C4ArgumentInput[] }
  | { kind: 'remove_directive'; id: string }
