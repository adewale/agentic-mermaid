export function escapeHtml(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export function escapeAttr(s: string) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}
export function makePreFocusable(html: string) {
  return html.replace(/<pre(?![^>]*\btabindex)((?:\s[^>]*)?)>/g, '<pre tabindex="0"$1>')
}
