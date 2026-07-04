/**
 * Shared SVG accessibility root attributes.
 *
 * One implementation of the contract every family renderer that threads
 * accessibility itself must follow: `role="img"` on the root,
 * `aria-labelledby` referencing the `<title id>` and `aria-describedby`
 * referencing the `<desc id>`. Renderers that do not thread accessibility get
 * the same contract from the injectAccessibility post-pass in index.ts —
 * which detects these root attributes to know when to leave output alone.
 * (Conformance-gated across all families by svg-a11y-conformance.test.ts.)
 */
export function buildAccessibilityAttrs(
  title: string | undefined,
  description: string | undefined,
  titleId: string,
  descId: string,
  roledescription?: string,
): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (roledescription) {
    attrs['role'] = 'img'
    attrs['aria-roledescription'] = roledescription
  } else if (title || description) {
    attrs['role'] = 'img'
  }
  if (title) attrs['aria-labelledby'] = titleId
  if (description) attrs['aria-describedby'] = descId
  return attrs
}
