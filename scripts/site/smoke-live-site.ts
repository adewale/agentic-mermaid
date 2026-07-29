const CANONICAL_ORIGIN = 'https://agentic-mermaid.dev'

export interface SiteSmokeOptions {
  origin?: string
  expectedSha?: string
  workerName?: string
  workerVersionId?: string
  log?: (message: string) => void
}

interface JsonRecord {
  [key: string]: unknown
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function argument(name: string) {
  const prefix = `--${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

function normalizedOrigin(value: string) {
  const origin = new URL(value)
  requireCondition(origin.protocol === 'http:' || origin.protocol === 'https:', `origin must use http or https: ${value}`)
  requireCondition(origin.pathname === '/' && !origin.search && !origin.hash, `origin must not include a path, query, or fragment: ${value}`)
  return origin.origin
}

function essence(response: Response) {
  return response.headers.get('content-type')?.split(';', 1).at(0)?.trim().toLowerCase() || ''
}

function asRecord(value: unknown, label: string): JsonRecord {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected a JSON object`)
  return value as JsonRecord
}

function nonEmptyArray(value: unknown, label: string): unknown[] {
  requireCondition(Array.isArray(value) && value.length > 0, `${label}: expected a non-empty array`)
  return value
}

function generatedFrom(value: JsonRecord, label: string) {
  const generated = asRecord(value.generatedFrom, `${label}.generatedFrom`)
  requireCondition(typeof generated.packageVersion === 'string' && generated.packageVersion.length > 0, `${label}: missing generated package version`)
  requireCondition(typeof generated.gitSha === 'string' && generated.gitSha.length > 0, `${label}: missing generated git SHA`)
  return generated as { packageVersion: string; gitSha: string }
}

export async function runSiteSmoke(options: SiteSmokeOptions = {}) {
  const origin = normalizedOrigin(options.origin || process.env.SITE_SMOKE_ORIGIN || CANONICAL_ORIGIN)
  const expectedSha = options.expectedSha || process.env.SITE_SMOKE_EXPECTED_SHA || ''
  const workerName = options.workerName || process.env.SITE_WORKER_NAME || 'agentic-mermaid-website'
  const workerVersionId = options.workerVersionId || process.env.SITE_WORKER_VERSION_ID || ''
  const log = options.log || console.log

  requireCondition(!/[\r\n"]/.test(workerName), 'worker name contains invalid header characters')
  requireCondition(!/[\r\n"]/.test(workerVersionId), 'worker version id contains invalid header characters')

  let checks = 0
  const ok: (condition: unknown, message: string) => asserts condition = (condition, message) => {
    requireCondition(condition, message)
    checks += 1
  }

  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('cache-control', 'no-cache')
    if (workerVersionId) headers.set('Cloudflare-Workers-Version-Overrides', `${workerName}="${workerVersionId}"`)
    const response = await fetch(new URL(path, origin), { ...init, headers, redirect: 'manual' })
    ok(!response.headers.has('set-cookie'), `${path}: Set-Cookie is forbidden`)
    return response
  }

  async function text(path: string, expectedTypes: string[], init: RequestInit = {}) {
    const response = await request(path, init)
    ok(response.status === 200, `${path}: expected 200, got ${response.status}`)
    ok(expectedTypes.includes(essence(response)), `${path}: expected ${expectedTypes.join(' or ')}, got ${essence(response) || 'no content type'}`)
    return { response, body: await response.text() }
  }

  async function json(path: string) {
    const result = await text(path, ['application/json'])
    let parsed: unknown
    try {
      parsed = JSON.parse(result.body)
    } catch (error) {
      throw new Error(`${path}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    return asRecord(parsed, path)
  }

  async function html(path: string, canonicalPath: string, marker: string) {
    const { body } = await text(path, ['text/html'], { headers: { accept: 'text/html' } })
    ok(body.includes(`<link rel="canonical" href="${CANONICAL_ORIGIN}${canonicalPath}">`), `${path}: canonical metadata mismatch`)
    ok(body.includes(marker), `${path}: missing semantic marker ${marker}`)
    return body
  }

  await html('/', '/', '<main id="main"')
  const editor = await html('/editor/?empty=1', '/editor/', 'id="code-editor"')
  await html('/docs/', '/docs/', '<main id="main"')
  await html('/examples/', '/examples/', 'class="example-sample"')
  await html('/comparisons/', '/comparisons/', 'data-comparison-engine="agentic"')

  const markdown = await text('/', ['text/markdown'], { headers: { accept: 'text/markdown' } })
  ok(markdown.body.startsWith('# Agentic Mermaid\n'), '/ markdown representation: missing title')
  ok(markdown.body.includes('Hosted MCP endpoint'), '/ markdown representation: missing agent interface links')

  const assetPath = editor.match(/<script type="module" src="(\/editor\/editor-[a-f0-9]{12}\.js)"><\/script>/)?.[1]
  ok(assetPath, '/editor/: missing content-addressed editor module')
  const editorAsset = await text(assetPath, ['text/javascript', 'application/javascript'])
  ok(editorAsset.body.length > 0, `${assetPath}: empty editor module`)
  ok(editorAsset.response.headers.get('cache-control') === 'public, max-age=31536000, immutable', `${assetPath}: expected immutable caching`)

  const capabilities = await json('/capabilities.json')
  nonEmptyArray(capabilities.families, '/capabilities.json families')
  nonEmptyArray(capabilities.outputFormats, '/capabilities.json output formats')
  const capabilitiesGenerated = generatedFrom(capabilities, '/capabilities.json')

  const examples = await json('/examples/index.json')
  nonEmptyArray(examples.examples, '/examples/index.json examples')
  nonEmptyArray(examples.richExamples, '/examples/index.json rich examples')
  const examplesGenerated = generatedFrom(examples, '/examples/index.json')

  const manifest = await json('/.well-known/mcp.json')
  ok(manifest.transport === 'streamable-http', '/.well-known/mcp.json: unexpected transport')
  ok(manifest.serverUrl === `${CANONICAL_ORIGIN}/mcp`, '/.well-known/mcp.json: unexpected server URL')
  nonEmptyArray(manifest.tools, '/.well-known/mcp.json tools')
  const manifestGenerated = generatedFrom(manifest, '/.well-known/mcp.json')

  const serverCard = await json('/.well-known/mcp/server-card.json')
  ok(serverCard.transport === 'streamable-http', '/.well-known/mcp/server-card.json: unexpected transport')
  ok(serverCard.serverUrl === `${CANONICAL_ORIGIN}/mcp`, '/.well-known/mcp/server-card.json: unexpected server URL')
  nonEmptyArray(serverCard.protocolVersions, '/.well-known/mcp/server-card.json protocol versions')
  nonEmptyArray(serverCard.tools, '/.well-known/mcp/server-card.json tools')
  const serverCardGenerated = generatedFrom(serverCard, '/.well-known/mcp/server-card.json')

  const generated = [capabilitiesGenerated, examplesGenerated, manifestGenerated, serverCardGenerated]
  const packageVersions = new Set(generated.map(value => value.packageVersion))
  const gitShas = new Set(generated.map(value => value.gitSha))
  ok(packageVersions.size === 1, `machine resources disagree on package version: ${[...packageVersions].join(', ')}`)
  ok(gitShas.size === 1, `machine resources disagree on git SHA: ${[...gitShas].join(', ')}`)
  if (expectedSha) ok(gitShas.has(expectedSha), `deployed git SHA is ${[...gitShas].join(', ')}, expected ${expectedSha}`)

  const llms = await text('/llms.txt', ['text/plain'])
  ok(llms.body.includes(`${CANONICAL_ORIGIN}/mcp`), '/llms.txt: missing hosted MCP endpoint')

  // robots.txt is Cloudflare-managed production edge state rather than a
  // Worker asset, so local Wrangler correctly returns 404 for it.
  if (origin === CANONICAL_ORIGIN) {
    const robots = await text('/robots.txt', ['text/plain'])
    ok(robots.body.trim().length > 0, '/robots.txt: Cloudflare-managed policy is empty')
  }

  const sitemap = await text('/sitemap.xml', ['application/xml', 'text/xml'])
  ok(sitemap.body.includes(`<loc>${CANONICAL_ORIGIN}/</loc>`), '/sitemap.xml: missing canonical home URL')

  const styles = await request('/styles.css', { method: 'HEAD' })
  ok(styles.status === 200, `/styles.css HEAD: expected 200, got ${styles.status}`)
  ok(essence(styles) === 'text/css', `/styles.css HEAD: expected text/css, got ${essence(styles) || 'no content type'}`)
  ok((await styles.arrayBuffer()).byteLength === 0, '/styles.css HEAD returned a body')

  const missing = await request('/__agentic_mermaid_site_smoke_missing__')
  ok(missing.status === 404, `missing route: expected 404, got ${missing.status}`)
  ok(!missing.headers.get('cache-control')?.includes('immutable'), 'missing route must not be cached as immutable')

  log(`site-smoke: ${checks} checks passed at ${origin}${workerVersionId ? ` through candidate ${workerVersionId}` : ''}`)
  return checks
}

if (import.meta.main) {
  await runSiteSmoke({
    origin: argument('origin'),
    expectedSha: argument('expected-sha'),
    workerName: argument('worker-name'),
    workerVersionId: argument('worker-version-id'),
  })
}
