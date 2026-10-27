// Shared public-site route manifest. The build emits the same routes to
// _redirects that the Worker uses for clean-route canonicalization.

export const LEGACY_REDIRECTS: ReadonlyArray<readonly [from: string, to: string]> = [
  ['/why', '/about/'], ['/why/', '/about/'],
  ['/gallery', '/examples/'], ['/gallery/', '/examples/'],
  ['/getting-started', '/docs/getting-started/'], ['/getting-started/', '/docs/getting-started/'],
  ['/warnings/index.md', '/warning-codes.md'], ['/warnings/index.md/', '/warning-codes.md'],
]

export const CLEAN_PAGE_ROUTES: readonly string[] = [
  'about',
  'about/design',
  'comparisons',
  'demo',
  'docs',
  'docs/api',
  'docs/api/advanced',
  'docs/ascii',
  'docs/cli',
  'docs/custom-styles',
  'docs/fork-differences',
  'docs/getting-started',
  'docs/mcp',
  'docs/quality',
  'docs/theming',
  'editor',
  'errors',
  'examples',
  'examples/corpus',
  'examples/style-palette',
  'skills/agentic-mermaid-diagram-workflow',
  'warnings',
]

export const CLEAN_ROUTE_PATHS = CLEAN_PAGE_ROUTES.map((route) => `/${route}`) as readonly string[]

/** Only pages with a canonical Markdown counterpart participate in negotiation. */
export function markdownAlternative(pathname: string): string | undefined {
  if (pathname === '/') return '/index.md'
  if (pathname === '/docs/api/' || pathname === '/docs/api/advanced/'
    || /^\/(?:warnings|errors)\/[^/.]+\/$/.test(pathname)) {
    return `${pathname}index.md`
  }
  return undefined
}

export const DYNAMIC_CLEAN_REDIRECT_LINES: readonly string[] = [
  '/warnings/:code /warnings/:code/ 308',
  '/errors/:kind /errors/:kind/ 308',
]

export function staticRedirectLines(): string[] {
  return [
    ...LEGACY_REDIRECTS.map(([from, to]) => `${from} ${to} 308`),
    ...CLEAN_PAGE_ROUTES.map((route) => `/${route} /${route}/ 308`),
  ]
}
