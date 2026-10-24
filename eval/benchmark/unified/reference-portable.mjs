/** Observable text/identity values, never canonical source, family/kind enum
 * strings or narrated fact sentences. This is existential semantic retention,
 * not identity, multiplicity, visibility or full parser equivalence. */
export function semanticLabelValues(root) {
  const values = new Set(), seen = new Set()
  const textField = /^(?:id|from|to|name|label|text|title|descr|description|message|task|event|events|actor|actors|people|caption|content|members|sections|categories|quadrants|tags|displayText|getDiagramTitle|getTitle|getAccTitle|getAccDescription|getSections)$/
  const sourceField = /source|canonical|wrapper|raw|span|location|provenance|config|style|css/i
  function visit(value, key, eligible = false) {
    if (typeof value === 'string') {
      if (eligible && value.trim()) {
        values.add(value)
        for (const line of value.split(/<br\s*\/?\s*>|\\n|\n/gi)) if (line.trim()) values.add(line.trim())
      }
      return
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (value instanceof Map) for (const entry of value.values()) visit(entry, key, eligible)
    else if (Array.isArray(value)) for (const entry of value) visit(entry, key, eligible)
    else {
      if (value.labelType === 'markdown' || value.kind === 'markdown' || value.format === 'markdown') {
        for (const field of ['label', 'text']) if (typeof value[field] === 'string') {
          const plain = value[field].replace(/^`|`$/g, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/_([^_]+)_/g, '$1')
          values.add(plain)
          for (const line of plain.split(/<br\s*\/?\s*>|\\n|\n/gi)) if (line.trim()) values.add(line.trim())
        }
      }
      if (key === 'namespaces' && typeof value.name === 'string') for (const component of value.name.split('.')) if (component) values.add(component)
      for (const [name, entry] of Object.entries(value)) {
        const endpoint = name === 'source' && typeof entry === 'string' && typeof value.target === 'string' || name === 'target' && typeof entry === 'string' && typeof value.source === 'string'
        if (endpoint || !sourceField.test(name)) visit(entry, name, endpoint || textField.test(name))
      }
    }
  }
  visit(root, '')
  return [...values]
}
