import { parseZenUML } from '../zenuml/native-parser.ts'
import { projectZenUMLSequence } from '../zenuml/native-sequence.ts'
import { renderSequenceDiagramTerminal } from './sequence.ts'
import type { AsciiConfig, AsciiTheme, ColorMode } from './types.ts'

/** The same projection supplies semantic owners to the cell compositor. */
export function renderZenUMLTerminal(source: string, config: AsciiConfig, colorMode?: ColorMode, theme?: AsciiTheme, targetWidth?: number) {
  return renderSequenceDiagramTerminal(projectZenUMLSequence(parseZenUML(source)), config, colorMode, theme, {}, targetWidth)
}
