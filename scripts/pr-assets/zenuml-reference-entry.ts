import mermaid from 'mermaid'
import zenuml from '@mermaid-js/mermaid-zenuml'
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
await mermaid.registerExternalDiagrams([zenuml])
let sequence = 0
export async function render(source: string): Promise<string> {
  return (await mermaid.render(`zenuml-control-${++sequence}`, source)).svg
}
