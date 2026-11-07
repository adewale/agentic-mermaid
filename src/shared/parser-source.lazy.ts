import { DeferredDependencyError } from '../layout/certification-error.ts'
import { LocatedParserError } from './syntax-error.ts'
export { familyParserLines } from './family-parser-lines.ts'

type ParserSource = typeof import('./parser-source.ts')
let implementation: ParserSource | undefined
let pending: Promise<void> | undefined
function load(): Promise<void> {
  return pending ??= import('./parser-source.ts').then(module => { implementation = module }).catch(error => { pending = undefined; throw error })
}
function loaded(): ParserSource {
  if (!implementation) throw new DeferredDependencyError('Authored parser positions', load)
  return implementation
}

// Successful parsing needs no authored-position reconstruction. A demand for
// positions resumes through the browser renderer's bounded dependency replay.
export const withParserSource: ParserSource['withParserSource'] = (source, grammar, parse) => {
  try { return parse() } catch (error) {
    if (!(error instanceof LocatedParserError)) throw error
    return loaded().withParserSource(source, grammar, () => { throw error })
  }
}
export const authoredSyntaxLocation: ParserSource['authoredSyntaxLocation'] = (...args) => loaded().authoredSyntaxLocation(...args)
export const authoredParserPositions: ParserSource['authoredParserPositions'] = (...args) => {
  let position: ReturnType<ParserSource['authoredParserPositions']> | undefined
  return (index, column) => (position ??= loaded().authoredParserPositions(...args))(index, column)
}
export const authoredParserLine: ParserSource['authoredParserLine'] = (...args) => {
  let position: ReturnType<ParserSource['authoredParserLine']> | undefined
  return index => (position ??= loaded().authoredParserLine(...args))(index)
}
export const authoredParserColumn: ParserSource['authoredParserColumn'] = (...args) => {
  let position: ReturnType<ParserSource['authoredParserColumn']> | undefined
  return (index, column) => (position ??= loaded().authoredParserColumn(...args))(index, column)
}
