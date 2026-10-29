import { EDITOR_EXAMPLES } from '../../editor/examples.ts'

/** Store each catalog key once; restore the complete records before UI use. */
export function editorExamplesDataJs(): string {
  const rows = EDITOR_EXAMPLES.map(({ id, label, category, diagramType, glyph, description, source, options }) => {
    const row: unknown[] = [id, label, category, diagramType, glyph, description, source]
    if (options !== undefined) row.push(options)
    return row
  })
  return `var EDITOR_EXAMPLES = ${JSON.stringify(rows)}.map(([id,label,category,diagramType,glyph,description,source,options]) => ({id,label,category,diagramType,glyph,description,source,...(options === undefined ? {} : {options})}));`
}
