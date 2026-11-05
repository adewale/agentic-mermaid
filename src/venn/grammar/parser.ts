// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import { GrammarReadError, syntaxError } from '../../shared/grammar-reader-error.ts'
import type { VennDb } from './db.ts'
import { T, TOKEN_NAMES, VennLexer } from './lexer.ts'
import { parserObservationActive, observeParserToken, observeParserStatement } from '../../shared/parser-observation.ts'

const STATEMENT = "'EOF', 'NEWLINE', 'TITLE', 'SET', 'UNION', 'TEXT', 'INDENT_TEXT', 'STYLE'"
const VALUE = "'NUMERIC', 'IDENTIFIER', 'STRING', 'HEXCOLOR', 'RGBCOLOR', 'RGBACOLOR'"

// Ports Mermaid's venn grammar. A token is read only when the grammar has to look at one to
// decide, because the lexer asks the model whether an indented `text` continues a set, and the
// statements are what tell the model so.
export function parseVenn(src: string, db: VennDb): void {
  const lexer = new VennLexer(src, db)
  let type = -1
  const observed = parserObservationActive('venn')
  const lineStarts = observed ? [0, ...Array.from(src.matchAll(/\n/g), match => match.index + 1)] : []
  const location = (offset: number) => {
    let low = 0,
      high = lineStarts.length
    while (low + 1 < high) {
      const mid = (low + high) >>> 1
      if (lineStarts[mid]! <= offset) low = mid
      else high = mid
    }
    return { line: low + 1, column: offset - lineStarts[low]! + 1, offset, unit: 'normalized' as const }
  }

  const peek = (): number => (type === -1 ? (type = lexer.next()) : type)

  const fail = (expected: string): never => {
    if (peek() === T.ERROR) throw syntaxError('venn', src, lexer.start, '', true)
    throw syntaxError('venn', src, lexer.start, `Expecting ${expected}, got '${TOKEN_NAMES[type]}'`)
  }

  const take = (): string => {
    if (observed) observeParserToken('venn', TOKEN_NAMES[type] ?? String(type), lexer.text, location(lexer.start))
    type = -1
    return lexer.text
  }

  const expect = (wanted: number): string => {
    if (peek() !== wanted) fail(`'${TOKEN_NAMES[wanted]}'`)
    return take()
  }

  const identifier = (): string => {
    if (peek() !== T.IDENTIFIER && type !== T.STRING) fail("'IDENTIFIER', 'STRING'")
    return take()
  }

  const identifiers = (): string[] => {
    const list = [identifier()]
    while (peek() === T.COMMA) {
      take()
      list.push(identifier())
    }
    return list
  }

  const subset = (ids: string[], union: boolean): void => {
    const label = peek() === T.BRACKET_LABEL ? take() : undefined
    let size: number | undefined
    if (peek() === T.COLON) {
      take()
      size = parseFloat(expect(T.NUMERIC))
    }
    if (union) {
      if (ids.length < 2) throw new GrammarReadError('union requires multiple identifiers', 'semantic', { type: 'venn' })
      db.validateUnionIdentifiers(ids)
    }
    db.addSubsetData(ids, label, size)
    db.setIndentMode(true)
  }

  // The id of a text, and the label in brackets that an id which is not a number may carry.
  const text = (sets: () => string[]): void => {
    const kind = peek()
    if (kind !== T.IDENTIFIER && kind !== T.STRING && kind !== T.NUMERIC) fail("'NUMERIC', 'IDENTIFIER', 'STRING'")
    const id = take()
    const label = kind !== T.NUMERIC && peek() === T.BRACKET_LABEL ? take() : undefined
    db.addTextData(sets(), id, label)
  }

  const style = (): void => {
    const ids = identifiers()
    const styles: [string, string][] = []
    for (;;) {
      const key = expect(T.IDENTIFIER)
      expect(T.COLON)
      let value: string
      if (peek() === T.STRING) value = take()
      else {
        const parts: string[] = []
        while (peek() === T.IDENTIFIER || (type >= T.NUMERIC && type <= T.RGBACOLOR)) parts.push(take())
        if (parts.length === 0) fail(VALUE)
        value = parts.join(' ')
      }
      styles.push([key, value])
      if (peek() !== T.COMMA) break
      take()
    }
    db.addStyleData(ids, styles)
  }

  while (peek() === T.NEWLINE) take()
  expect(T.VENN)
  for (;;) {
    const statement = peek()
    if (statement === T.EOF) return
    if (statement < T.NEWLINE || statement > T.STYLE || statement === T.VENN) fail(STATEMENT)
    if (observed && statement !== T.NEWLINE) {
      db.statementSource = location(lexer.start)
      observeParserStatement('venn', TOKEN_NAMES[statement] ?? String(statement), lexer.text, db.statementSource)
    }
    take()
    if (statement === T.TITLE) db.setDiagramTitle(lexer.text.slice(6))
    else if (statement === T.SET) subset([identifier()], false)
    else if (statement === T.UNION) subset(identifiers(), true)
    else if (statement === T.TEXT) {
      const ids = identifiers()
      text(() => ids)
    } else if (statement === T.INDENT_TEXT) {
      text(() => {
        const current = db.getCurrentSets()
        if (!current) throw new GrammarReadError('text requires set', 'semantic', { type: 'venn' })
        return current
      })
    } else if (statement === T.STYLE) style()
  }
}
