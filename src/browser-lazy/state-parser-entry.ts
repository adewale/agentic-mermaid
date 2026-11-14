import { parseGraphSource } from '../graph-source-parser.ts'
import { STATE_GRAPH_GRAMMAR } from '../parser-state.ts'

/** Selected only after the public async header dispatcher chose State. */
export function parseMermaid(text: string) { return parseGraphSource(text, undefined, STATE_GRAPH_GRAMMAR) }
