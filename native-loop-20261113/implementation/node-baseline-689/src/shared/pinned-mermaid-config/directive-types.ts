// Generated from Mermaid 12.2.0 (1fb7869866dd619168d840291c9c54b4f129758b).
// Selectors owned by detectInit and processDirectives. Rebuild with the config generator.
export function isMermaidConfigDirective(raw: string): boolean {
  const kind = /%%\{\s*(\w+)/.exec(raw)?.[1]
  return kind !== undefined && (kind.match(/(?:init\b)|(?:initialize\b)/) !== null || kind.match('wrap') !== null)
}
