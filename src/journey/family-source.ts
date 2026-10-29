import { decodeXML } from 'entities'
import { encodeMermaidEntities } from '../shared/mermaid-entities.ts'

const XML_REFERENCE = /&amp;((?:amp;)*(?:#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z\d]{0,31});)|&(?:#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z\d]{0,31});/g

/** Keep every reference-produced character out of grammar and formatting.
 * Even letters can begin a keyword, and punctuation can split actors or
 * start a comment. Projection happens only after those decisions. */
export function journeyGrammarText(authored: string): string {
  return authored.replace(XML_REFERENCE, (reference, doubled: string | undefined) => {
    const decoded = doubled === undefined ? decodeXML(reference) : `&${doubled}`
    return encodeMermaidEntities(decoded, decoded)
  })
}

