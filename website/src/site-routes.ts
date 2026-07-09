// Shared public-site route manifest. The build emits the same routes to
// _redirects that the Worker uses for clean-route canonicalization.

export const LEGACY_REDIRECTS: ReadonlyArray<readonly [from: string, to: string]> = [
  ['/why', '/about/'], ['/why/', '/about/'],
  ['/gallery', '/examples/'], ['/gallery/', '/examples/'],
]

export const CLEAN_PAGE_ROUTES: readonly string[] = [
  'about',
  'about/design',
  'comparisons',
  'docs',
  'docs/api',
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
  'skills/agentic-mermaid-diagram-workflow',
  'warnings',
]

export const CLEAN_ROUTE_PATHS = CLEAN_PAGE_ROUTES.map((route) => `/${route}`) as readonly string[]

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
