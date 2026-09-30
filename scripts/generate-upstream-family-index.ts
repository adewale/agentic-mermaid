// Rewrites src/upstream-mermaid-family-index.json, the runtime header routing
// table, from the installed (pinned) Mermaid package and the reviewed policy in
// docs/project/upstream-mermaid-policy.json. Run it by hand after a Mermaid
// upgrade and review the diff; nothing checks the committed copy against it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import mermaid from 'mermaid'

const ROOT = resolve(import.meta.dir, '..')
const FAMILY_INDEX_PATH = join(ROOT, 'src/upstream-mermaid-family-index.json')
const POLICY_PATH = join(ROOT, 'docs/project/upstream-mermaid-policy.json')
const PACKAGE_JSON_PATH = join(ROOT, 'node_modules/mermaid/package.json')

interface PolicyFamily {
  id: string
  source: 'core' | 'external-first-party'
  upstreamDetectorIds: string[]
  headers: Array<{ value: string; agenticStatus: 'native' | 'unsupported' | 'inventory-only' }>
}

if (!existsSync(PACKAGE_JSON_PATH)) throw new Error('Install dependencies before generating the upstream family index')
const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8')) as { schemaVersion: number; pin?: { version?: string }; families: PolicyFamily[] }
const version = String(JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')).version)
if (policy.schemaVersion !== 2) throw new Error('Unsupported upstream policy version')
if (String(policy.pin?.version) !== version) {
  throw new Error(`Installed mermaid@${version} does not match audited policy pin ${String(policy.pin?.version)}`)
}

// The policy supplies grouping and our support classification; every detector
// and header claim is verified against the installed detector registry.
mermaid.initialize({ startOnLoad: false })
const watchRuntimeIds = new Set(['error', 'info', '---'])
const actualPublicDetectorIds = mermaid.getRegisteredDiagramsMetadata().map(item => item.id).filter(id => !watchRuntimeIds.has(id))
const coreFamilies = policy.families.filter(family => family.source === 'core')
const externalFamilies = policy.families.filter(family => family.source === 'external-first-party')
const claimedDetectorIds = coreFamilies.flatMap(family => family.upstreamDetectorIds)
const sorted = (values: readonly string[]) => [...values].sort().join('\0')
if (sorted(claimedDetectorIds) !== sorted(actualPublicDetectorIds)) {
  const claimed = new Set(claimedDetectorIds)
  const actual = new Set(actualPublicDetectorIds)
  const added = actualPublicDetectorIds.filter(id => !claimed.has(id))
  const removed = claimedDetectorIds.filter(id => !actual.has(id))
  throw new Error(`Upstream detector policy is stale (unassigned: ${added.join(', ') || 'none'}; missing: ${removed.join(', ') || 'none'})`)
}
if (new Set(claimedDetectorIds).size !== claimedDetectorIds.length) throw new Error('Upstream detector policy assigns a detector more than once')
for (const family of coreFamilies) {
  const allowed = new Set(family.upstreamDetectorIds)
  for (const header of family.headers) {
    let detected: string
    try { detected = mermaid.detectType(header.value, {}) }
    catch { throw new Error(`Upstream header probe "${header.value}" no longer detects family "${family.id}"`) }
    if (!allowed.has(detected)) throw new Error(`Upstream header probe "${header.value}" detects "${detected}", not "${family.id}"`)
  }
}
const externalDetectorIds = externalFamilies.flatMap(family => family.upstreamDetectorIds)
if (externalFamilies.some(family => family.headers.length === 0)
  || new Set(externalDetectorIds).size !== externalDetectorIds.length
  || externalDetectorIds.some(id => actualPublicDetectorIds.includes(id))) {
  throw new Error('External first-party family policy has a family without headers, a duplicate detector, or overlaps the installed core registry')
}

const familyIndex = {
  schemaVersion: 2,
  provenance: { version },
  families: policy.families.map(family => ({
    id: family.id,
    headers: family.headers.map(header => ({ value: header.value, agenticStatus: header.agenticStatus })),
  })),
}
writeFileSync(FAMILY_INDEX_PATH, `${JSON.stringify(familyIndex, null, 2)}\n`)
console.log(`Wrote ${FAMILY_INDEX_PATH} for mermaid@${version} (${familyIndex.families.length} families)`)
