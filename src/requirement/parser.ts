import { observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
import { RequirementDb as Database, Relationships, type RequirementDb, RequirementType, RiskLevel, VerifyType } from './db.ts'
// Adapted from Pele (458322a5b8abb1ae57ddf127c32017ab9fb14a92), copyright (c) 2026 kepano.
// MIT license; see pele-license.txt in this directory.
import { syntaxError } from './errors.ts'
import { tokenize } from './lexer.ts'
import { T, TOKEN_NAMES } from './tokens.ts'
import type { RequirementBody } from './types.ts'
import { checkedAuthoredStyle, parseStyleProps } from '../shared/style-props.ts'

// What the keyword tokens stand for, from REQUIREMENT to TRACES in token order.
const VALUES: readonly string[] = [
  RequirementType.REQUIREMENT,
  RequirementType.FUNCTIONAL_REQUIREMENT,
  RequirementType.INTERFACE_REQUIREMENT,
  RequirementType.PERFORMANCE_REQUIREMENT,
  RequirementType.PHYSICAL_REQUIREMENT,
  RequirementType.DESIGN_CONSTRAINT,
  RiskLevel.LOW_RISK,
  RiskLevel.MED_RISK,
  RiskLevel.HIGH_RISK,
  VerifyType.VERIFY_ANALYSIS,
  VerifyType.VERIFY_DEMONSTRATION,
  VerifyType.VERIFY_INSPECTION,
  VerifyType.VERIFY_TEST,
  '',
  Relationships.CONTAINS,
  Relationships.COPIES,
  Relationships.DERIVES,
  Relationships.SATISFIES,
  Relationships.VERIFIES,
  Relationships.REFINES,
  Relationships.TRACES,
]
function isStylePart(t: number): boolean {
  return t === T.ALPHA || t === T.COLON || t === T.BRKT || t === T.MINUS || t === T.SEMICOLON
}
export interface RequirementStyleDirective { prefix: string; styles: string[] }

export function parseRequirementDiagram(input: string | string[], onStyle?: (directive: RequirementStyleDirective) => void, onRequiredLineBreak?: (offset: number) => void): RequirementBody {
  const authored = Array.isArray(input) ? input.join('\n') : input
  const source = authored.replace(/^[^\S\r\n]*requirement[^\S\r\n]*(?=\r\n?|\n|$)/i, 'requirementDiagram')
  const headerDelta = source.length - authored.length
  const db = new Database()
  parseRequirement(source.endsWith('\n') ? source : source + '\n', db, onStyle, onRequiredLineBreak ? offset => onRequiredLineBreak(offset - headerDelta) : undefined)
  for (const definition of db.classes.values()) checkedAuthoredStyle(parseStyleProps(definition.styles.join(',')), `classDef ${definition.id}`)
  for (const [id, styles] of db.authoredStyles) {
    checkedAuthoredStyle(parseStyleProps(styles.join(',')), `style ${id}`)
  }
  // An unknown target stops applying the rest of its target list, so the
  // effective node declarations can differ from the final authored ones.
  for (const node of [...db.requirements.values(), ...db.elements.values()]) {
    checkedAuthoredStyle(parseStyleProps((node.directStyles ?? []).join(',')), `style ${node.name}`)
  }
  return {
    kind: 'requirement',
    direction: db.direction as RequirementBody['direction'],
    requirements: [...db.requirements.values()],
    elements: [...db.elements.values()],
    relations: db.relations.map((r, i) => ({ ...r, id: `relation-${i + 1}` })),
    classDefs: [...db.classes.values()],
    title: db.title,
    accessibilityTitle: db.accTitle,
    accessibilityDescription: db.accDescr,
  }
}
export function parseRequirement(src: string, db: RequirementDb, onStyle?: (directive: RequirementStyleDirective) => void, onRequiredLineBreak?: (offset: number) => void): void {
  const { types, texts, starts } = tokenize(src)
  let i = 0
  const fields: number[] = []
  const values: string[] = []
  // Fails with Jison's wording, naming the token types `from` to `to` and any others as expected.
  const fail = (from: number, to: number = from, ...others: number[]): never => {
    const t = types[i]!
    if (t === T.ERROR) throw syntaxError('requirement', src, starts[i]!, '', true)
    for (let k = to; k >= from; k--) others.unshift(k)
    const expected = others.map(type => `'${TOKEN_NAMES[type]!}'`).join(', ')
    throw syntaxError('requirement', src, starts[i]!, `Expecting ${expected}, got '${TOKEN_NAMES[t]!}'`)
  }
  const expect = (type: number): string => {
    if (types[i]! !== type) fail(type)
    // The pin's whitespace token can swallow this required boundary after
    // a quoted value/keyword/brace. An unquoted string already owns its
    // trailing spaces, so it never takes that whitespace-token path.
    if (type === T.NEWLINE && types[i - 1] !== T.unqString) onRequiredLineBreak?.(starts[i]!)
    return texts[i++]!
  }
  // The value of the next token if it is a keyword in the given range of token types.
  const keyword = (from: number, to: number): string => {
    const t = types[i]!
    if (t < from || t > to) fail(from, to)
    i++
    return VALUES[t - T.REQUIREMENT]!
  }
  const string = (): string => {
    const t = types[i]!
    if (t !== T.unqString && t !== T.qString) fail(T.qString, T.unqString)
    return texts[i++]!
  }
  const directive = (): boolean => {
    const begin = i
    const t = types[i]!
    if (t === T.acc_title) {
      i++
      db.setAccTitle(expect(T.acc_title_value).trim())
    } else if (t === T.acc_descr) {
      i++
      db.setAccDescription(expect(T.acc_descr_value).trim())
    } else if (t === T.acc_descr_multiline_value) {
      db.setAccDescription(texts[i++]!.trim())
    } else {
      return false
    }
    if (parserObservationActive('requirement')) observeParserStatement('requirement', TOKEN_NAMES[t]!, src.slice(starts[begin]!, starts[i] ?? src.length), { offset: starts[begin]!, endOffset: starts[i] ?? src.length, unit: 'physical' })
    return true
  }
  const idList = (): string[] => {
    const list: string[] = []
    while (true) {
      const t = types[i]!
      if (t !== T.ALPHA && t !== T.unqString && t !== T.qString) fail(T.qString, T.unqString, T.ALPHA)
      list.push(texts[i++]!)
      if (types[i]! !== T.COMMA) return list
      i++
    }
  }
  const stylesOpt = (): string[] => {
    const styles: string[] = []
    while (true) {
      if (!isStylePart(types[i]!)) fail(T.ALPHA, T.SEMICOLON, T.MINUS, T.BRKT)
      let style = texts[i++]!
      while (isStylePart(types[i]!)) {
        // Value whitespace can separate numeric lengths or a font family.
        // Preserve it before admission decides whether the strict writer can
        // spell that meaning; property/colon spacing remains canonical.
        const previousEnd = starts[i - 1]! + texts[i - 1]!.length
        if (style.includes(':') && !style.endsWith(':') && starts[i]! > previousEnd) style += src.slice(previousEnd, starts[i]!)
        style += texts[i++]!
      }
      styles.push(style)
      if (types[i]! !== T.COMMA) return styles
      i++
    }
  }
  const classList = (): string[] | undefined => {
    let classes: string[] | undefined
    if (types[i]! === T.STYLE_SEPARATOR) {
      i++
      classes = idList()
      expect(T.STRUCT_START)
    } else if (types[i]! === T.STRUCT_START) {
      i++
    } else {
      fail(T.STRUCT_START, T.STRUCT_START, T.STYLE_SEPARATOR)
    }
    expect(T.NEWLINE)
    return classes
  }
  // Reads a body up to its closing brace. The grammar is right recursive, so Mermaid applies
  // the fields last to first and the first of two repeated fields wins.
  const body = (requirement: boolean): void => {
    fields.length = 0
    values.length = 0
    while (true) {
      const t = types[i]!
      if (t === T.STRUCT_STOP) {
        i++
        break
      }
      if (t === T.NEWLINE) {
        i++
        continue
      }
      if (requirement ? t < T.ID || t > T.VERIFYMTHD : t !== T.TYPE && t !== T.DOCREF) {
        if (requirement) fail(T.ID, T.VERIFYMTHD, T.NEWLINE, T.STRUCT_STOP)
        fail(T.TYPE, T.DOCREF, T.NEWLINE, T.STRUCT_STOP)
      }
      const begin = i
      i++
      expect(T.COLONSEP)
      values.push(t === T.RISK ? keyword(T.LOW_RISK, T.HIGH_RISK) : t === T.VERIFYMTHD ? keyword(T.VERIFY_ANALYSIS, T.VERIFY_TEST) : string())
      fields.push(t)
      expect(T.NEWLINE)
      if (parserObservationActive('requirement')) observeParserStatement('requirement', TOKEN_NAMES[t]!, src.slice(starts[begin]!, starts[i] ?? src.length), { offset: starts[begin]!, endOffset: starts[i] ?? src.length, unit: 'physical' })
    }
    for (let k = fields.length - 1; k >= 0; k--) {
      const value = values[k]!
      switch (fields[k]!) {
        case T.ID:
          db.setNewReqId(value)
          break
        case T.TEXT:
          db.setNewReqText(value)
          break
        case T.RISK:
          db.setNewReqRisk(value)
          break
        case T.VERIFYMTHD:
          db.setNewReqVerifyMethod(value)
          break
        case T.TYPE:
          db.setNewElementType(value)
          break
        default:
          db.setNewElementDocRef(value)
      }
    }
  }
  while (directive()) {
    if (types[i]! === T.NEWLINE) i++
  }
  if (types[i]! !== T.RD) fail(T.RD, T.RD, T.acc_title, T.acc_descr, T.acc_descr_multiline_value)
  const header = i++
  expect(T.NEWLINE)
  if (parserObservationActive('requirement')) observeParserStatement('requirement', 'header', src.slice(starts[header]!, starts[i] ?? src.length), { offset: starts[header]!, endOffset: starts[i] ?? src.length, unit: 'physical' })
  while (true) {
    const begin = i
    const t = types[i]!
    if (t === T.EOF) return
    if (t !== T.NEWLINE && t !== T.acc_title && t !== T.acc_descr && t !== T.acc_descr_multiline_value && parserObservationActive('requirement')) observeParserStatement('requirement', TOKEN_NAMES[t]!, texts[begin]!, { offset: starts[begin]!, endOffset: starts[begin]! + texts[begin]!.length, unit: 'physical' })
    if (t === T.NEWLINE) {
      i++
    } else if (directive()) {
      continue
    } else if (t >= T.direction_tb && t <= T.direction_lr) {
      i++
      db.setDirection(t === T.direction_tb ? 'TB' : t === T.direction_bt ? 'BT' : t === T.direction_rl ? 'RL' : 'LR')
    } else if (t >= T.REQUIREMENT && t <= T.DESIGN_CONSTRAINT) {
      const type = keyword(T.REQUIREMENT, T.DESIGN_CONSTRAINT)
      const name = string()
      const classes = classList()
      body(true)
      db.addRequirement(name, type)
      if (classes) db.setClass([name], classes)
    } else if (t === T.ELEMENT) {
      i++
      const name = string()
      const classes = classList()
      body(false)
      db.addElement(name)
      if (classes) db.setClass([name], classes)
    } else if (t === T.STYLE) {
      i++
      const ids = idList()
      const prefix = src.slice(starts[begin]!, starts[i]!)
      const styles = stylesOpt()
      onStyle?.({ prefix, styles })
      db.setCssStyle(ids, styles)
    } else if (t === T.CLASSDEF) {
      i++
      const ids = idList()
      const prefix = src.slice(starts[begin]!, starts[i]!)
      const styles = stylesOpt()
      onStyle?.({ prefix, styles })
      db.defineClass(ids, styles)
    } else if (t === T.CLASS) {
      i++
      const ids = idList()
      db.setClass(ids, idList())
    } else if (t === T.unqString || t === T.qString) {
      const id = texts[i++]!
      const next = types[i]!
      if (next === T.STYLE_SEPARATOR) {
        i++
        db.setClass([id], idList())
      } else if (next === T.END_ARROW_L || next === T.LINE) {
        i++
        const relationship = keyword(T.CONTAINS, T.TRACES)
        expect(next === T.LINE ? T.END_ARROW_R : T.LINE)
        const other = string()
        if (next === T.LINE) db.addRelationship(relationship, id, other)
        else db.addRelationship(relationship, other, id)
      } else {
        fail(T.STYLE_SEPARATOR, T.STYLE_SEPARATOR, T.END_ARROW_L, T.LINE)
      }
    } else {
      fail(
        T.NEWLINE,
        T.EOF,
        T.acc_title,
        T.acc_descr,
        T.acc_descr_multiline_value,
        T.direction_tb,
        T.direction_bt,
        T.direction_rl,
        T.direction_lr,
        T.REQUIREMENT,
        T.FUNCTIONAL_REQUIREMENT,
        T.INTERFACE_REQUIREMENT,
        T.PERFORMANCE_REQUIREMENT,
        T.PHYSICAL_REQUIREMENT,
        T.DESIGN_CONSTRAINT,
        T.ELEMENT,
        T.CLASSDEF,
        T.CLASS,
        T.STYLE,
        T.unqString,
        T.qString,
      )
    }
  }
}
