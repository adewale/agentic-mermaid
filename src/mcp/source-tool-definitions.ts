import { PURE_COMPUTE_ANNOTATIONS, RENDER_WARNINGS_NOTE, mcpRenderToolInputSchema } from './tool-surface.ts'
import { terminalOutputOptionSchema } from '../terminal-contract.ts'

// Each render tool defines its options with one shared schema, whose style
// description names the registered Looks and Palettes, so render_svg,
// render_ascii and render_png describe options the same way.
export const TEXT_RENDER_TOOLS = [
  {
    name: 'render_svg',
    title: 'Render Mermaid as SVG',
    description: `Render a Mermaid source string to themeable SVG. Returns { ok, svg, receipt, warnings }.
Layout is deterministic: identical input produces identical geometry. The direct tool
boundary forces security:'strict' and embedFontImport:false.
${RENDER_WARNINGS_NOTE}`,
    inputSchema: mcpRenderToolInputSchema(),
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
  {
    name: 'render_ascii',
    title: 'Render Mermaid as text',
    description: `Render a Mermaid source string to text. Returns { ok, text, receipt, warnings }.
useAscii true → plain ASCII (+,-,|); false/absent → Unicode box drawing (┌,─,│).
targetWidth sets a hard terminal display-cell bound; impossible bounds return a typed error.
${RENDER_WARNINGS_NOTE} Terminal projection notes (TERMINAL_* codes) are
evidence in receipt.diagnostics, not warnings.`,
    inputSchema: mcpRenderToolInputSchema({
      useAscii: { ...terminalOutputOptionSchema('useAscii'), description: 'true = ASCII characters, false = Unicode (default).' },
      targetWidth: { ...terminalOutputOptionSchema('targetWidth'), description: 'Hard maximum line width in terminal display cells.' },
    }),
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
]

export const VERIFY_TOOL = {
    name: 'verify',
    title: 'Verify Mermaid diagram',
    description: `Parse and verify source, structure, and renderability. This runs the graphical pipeline. Returns
{ ok, family, summary, warnings, layout: { bounds, nodes, edges } } for valid
diagrams and { ok: false, errors, warnings } for parse failures (an unknown header
gives { ok: false, error, warnings }); warnings use the same codes as library/CLI
verify, so a source that does not parse is RENDER_FAILED there too. \`family\` is the detected
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
