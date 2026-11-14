import { parseGraphSource, parseFlowchartRenderSourceWithParser } from '../parser-flowchart.ts'
/** This private adapter is used only after the async entry selected Flowchart.
 * Other graph/body adapters continue importing the generic public parser. */
export function parseFlowchartRenderSource(authoredFamilyText: string, decodedFamilyText: string) {
  return parseFlowchartRenderSourceWithParser(parseGraphSource, authoredFamilyText, decodedFamilyText)
}
