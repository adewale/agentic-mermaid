import { parserObservationActive, observeParserMutation } from '../shared/parser-observation.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
// Adapted from Pele (458322a5b8abb1ae57ddf127c32017ab9fb14a92), copyright (c) 2026 kepano.
// MIT license; see pele-license.txt in this directory.
import { PeleError } from './errors.ts'
import type { Relation, Requirement, RequirementClass, RequirementElement, RequirementModel } from './types.ts'
export const RequirementType = {
  REQUIREMENT: 'Requirement',
  FUNCTIONAL_REQUIREMENT: 'Functional Requirement',
  INTERFACE_REQUIREMENT: 'Interface Requirement',
  PERFORMANCE_REQUIREMENT: 'Performance Requirement',
  PHYSICAL_REQUIREMENT: 'Physical Requirement',
  DESIGN_CONSTRAINT: 'Design Constraint',
} as const
export const RiskLevel = { LOW_RISK: 'Low', MED_RISK: 'Medium', HIGH_RISK: 'High' } as const
export const VerifyType = {
  VERIFY_ANALYSIS: 'Analysis',
  VERIFY_DEMONSTRATION: 'Demonstration',
  VERIFY_INSPECTION: 'Inspection',
  VERIFY_TEST: 'Test',
} as const
export const Relationships = {
  CONTAINS: 'contains',
  COPIES: 'copies',
  DERIVES: 'derives',
  SATISFIES: 'satisfies',
  VERIFIES: 'verifies',
  REFINES: 'refines',
  TRACES: 'traces',
} as const
// Applying a class copies its declarations onto each node, so a short text can ask for
// hundreds of millions of copies. Past this many the diagram is refused.
const MAX_STYLE_COPIES = 1000000
export class RequirementDb implements RequirementModel {
  readonly type = 'requirement' as const
  direction = 'TB'
  requirements = new Map<string, Requirement>()
  elements = new Map<string, RequirementElement>()
  relations: Relation[] = []
  classes = new Map<string, RequirementClass>()
  /** Authored inline declarations, including targets that drawing skips. */
  authoredStyles = new Map<string, string[]>()
  title: string | undefined
  accTitle: string | undefined
  accDescr: string | undefined
  // The grammar reports a body's fields before the requirement or element they belong to.
  private newId = ''
  private newText = ''
  private newRisk = ''
  private newVerifyMethod = ''
  private newElementType = ''
  private newDocRef = ''
  private styleCopies = 0
  private copy(target: string[], styles: string[]): void {
    this.styleCopies += styles.length
    if (this.styleCopies > MAX_STYLE_COPIES) {
      throw new PeleError('Requirement diagram applies too many style declarations.', 'limit', { type: 'requirement' })
    }
    for (const style of styles) target.push(style)
  }
  setDirection(dir: string): void {
    this.direction = dir
    if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setDirection', dir)
  }
  addRequirement(name: string, type: string): Requirement {
    let requirement = this.requirements.get(name)
    if (requirement === undefined) {
      assertDiagramWorkLimit('nodes', this.requirements.size + this.elements.size + 1)
      requirement = {
        name,
        type,
        requirementId: this.newId,
        text: this.newText,
        risk: this.newRisk,
        verifyMethod: this.newVerifyMethod,
        cssStyles: [],
        classes: ['default'],
      }
      this.requirements.set(name, requirement)
      if (parserObservationActive('requirement')) observeParserMutation('requirement', 'addRequirement', requirement)
    }
    this.newId = this.newText = this.newRisk = this.newVerifyMethod = ''
    return requirement
  }
  setNewReqId(id: string): void {
    this.newId = id
    if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setNewReqId', id)
  }
  setNewReqText(text: string): void {
    this.newText = text
    if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setNewReqText', text)
  }
  setNewReqRisk(risk: string): void {
    this.newRisk = risk
    if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setNewReqRisk', risk)
  }
  setNewReqVerifyMethod(verifyMethod: string): void {
    this.newVerifyMethod = verifyMethod
    if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setNewReqVerifyMethod', verifyMethod)
  }
  addElement(name: string): RequirementElement {
    let element = this.elements.get(name)
    if (element === undefined) {
      assertDiagramWorkLimit('nodes', this.requirements.size + this.elements.size + 1)
      element = { name, type: this.newElementType, docRef: this.newDocRef, cssStyles: [], classes: ['default'] }
      this.elements.set(name, element)
      if (parserObservationActive('requirement')) observeParserMutation('requirement', 'addElement', element)
    }
    this.newElementType = this.newDocRef = ''
    return element
  }
  setNewElementType(type: string): void {
    this.newElementType = type
    if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setNewElementType', type)
  }
  setNewElementDocRef(docRef: string): void {
    this.newDocRef = docRef
    if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setNewElementDocRef', docRef)
  }
  addRelationship(type: string, src: string, dst: string): void {
    assertDiagramWorkLimit('edges', this.relations.length + 1)
    this.relations.push({ type, src, dst })
    if (parserObservationActive('requirement')) observeParserMutation('requirement', 'addRelationship', { type, src, dst })
  }
  private node(id: string): Requirement | RequirementElement | undefined {
    return this.requirements.get(id) ?? this.elements.get(id)
  }
  setCssStyle(ids: string[], styles: string[]): void {
    for (const id of ids) {
      const authored = this.authoredStyles.get(id) ?? []
      this.copy(authored, styles)
      this.authoredStyles.set(id, authored)
    }
    for (const id of ids) {
      const node = this.node(id)
      // Mermaid stops at the first unknown id, leaving the rest of the list unstyled.
      if (!styles || !node) return
      ;(node.directStyles ??= []).push(...styles.flatMap(s => s.split(',')))
      for (const s of styles) {
        this.copy(node.cssStyles, s.includes(',') ? s.split(',') : [s])
        if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setCssStyle', { id, style: s, node })
      }
    }
  }
  setClass(ids: string[], classNames: string[]): void {
    for (const id of ids) {
      const node = this.node(id)
      if (!node) continue
      for (const name of classNames) {
        node.classes.push(name)
        if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setClass', { id, className: name })
        const styles = this.classes.get(name)?.styles
        if (styles) this.copy(node.cssStyles, styles)
      }
    }
  }
  defineClass(ids: string[], style: string[]): void {
    for (const id of ids) {
      let styleClass = this.classes.get(id)
      if (styleClass === undefined) {
        styleClass = { id, styles: [], textStyles: [] }
        this.classes.set(id, styleClass)
      }
      for (const s of style) {
        if (s.includes('color')) styleClass.textStyles.push(s.replace('fill', 'bgFill'))
        styleClass.styles.push(s)
      }
      if (parserObservationActive('requirement')) observeParserMutation('requirement', 'defineClass', styleClass)
      const split = style.flatMap(s => s.split(','))
      for (const requirement of this.requirements.values()) {
        if (requirement.classes.includes(id)) this.copy(requirement.cssStyles, split)
      }
      for (const element of this.elements.values()) {
        if (element.classes.includes(id)) this.copy(element.cssStyles, split)
      }
    }
  }
  setAccTitle(text: string): void {
    this.accTitle = text.replace(/^\s+/g, '')
    if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setAccTitle', this.accTitle)
  }
  setAccDescription(text: string): void {
    this.accDescr = text.replace(/\n\s+/g, '\n')
    if (parserObservationActive('requirement')) observeParserMutation('requirement', 'setAccDescription', this.accDescr)
  }
}
