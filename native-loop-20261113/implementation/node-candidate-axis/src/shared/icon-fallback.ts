/** Visible fallback token, shared by native measurement and final icon paint. */
export function iconFallbackToken(icon: string): string {
  return icon.split(/[:/\s-]+/).filter(Boolean).at(-1)?.slice(0, 2).toUpperCase() || '?'
}
