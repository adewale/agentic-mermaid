import { knownStyleDescriptors } from '../scene/style-registry.ts'
import { PURE_COMPUTE_ANNOTATIONS, mcpRenderOptionSchemaProperties } from './tool-surface.ts'
import { terminalOutputOptionSchema } from '../terminal-contract.ts'

// Keep direct-tool discovery aligned with the style registry. This description is
// the only built-in look menu available to clients that do not call execute.
const BUILTIN_LOOK_NAMES = knownStyleDescriptors()
  .filter(descriptor => descriptor.kind === 'look')
  .map(descriptor => descriptor.inputName)
const BUILTIN_PALETTE_NAMES = knownStyleDescriptors()
  .filter(descriptor => descriptor.kind === 'palette')
  .map(descriptor => descriptor.inputName)


export const TEXT_RENDER_TOOLS = [
  {
    name: 'render_svg',
    title: 'Render Mermaid as SVG',
    description: `Render a Mermaid source string to themeable SVG. Returns { ok, svg }.
Layout is deterministic: identical input produces identical geometry. The direct tool
boundary forces security:'strict' and embedFontImport:false.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        ...mcpRenderOptionSchemaProperties(
          `Shared advanced RenderOptions object. Styles accept a registered Look (${BUILTIN_LOOK_NAMES.join(', ')}), Palette (${BUILTIN_PALETTE_NAMES.join(', ')}), inline record, or left-to-right stack.`,
        ),
      },
      required: ['source'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
  {
    name: 'render_ascii',
    title: 'Render Mermaid as text',
    description: `Render a Mermaid source string to text. Returns { ok, text }.
useAscii true → plain ASCII (+,-,|); false/absent → Unicode box drawing (┌,─,│).
targetWidth sets a hard terminal display-cell bound; impossible bounds return a typed error.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        useAscii: { ...terminalOutputOptionSchema('useAscii'), description: 'true = ASCII characters, false = Unicode (default).' },
        targetWidth: { ...terminalOutputOptionSchema('targetWidth'), description: 'Hard maximum line width in terminal display cells.' },
        ...mcpRenderOptionSchemaProperties('Shared advanced RenderOptions object, including style/palette/config/security.'),
      },
      required: ['source'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
]

export const VERIFY_TOOL = {
    name: 'verify',
    title: 'Verify Mermaid diagram',
    description: `Parse and verify source, structure, and renderability. This runs the graphical pipeline. Returns
{ ok, family, summary, warnings, layout: { bounds, nodes, edges } } for valid
diagrams and { ok: false, errors } for parse failures. \`family\` is the detected
diagram family and \`summary\` a one-line description — check them: ok:true only
means the diagram is structurally valid, not that it is the kind you intended.
Warnings use the layout-rubric codes.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
      },
      required: ['source'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  }
