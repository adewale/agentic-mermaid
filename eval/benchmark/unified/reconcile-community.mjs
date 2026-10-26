/** Compose explicit qualification partitions without rewriting either raw measurement ledger. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readBenchmarkDocument } from '../portable/project-records.ts'

const read = file => JSON.parse(readFileSync(file, 'utf8'))
const canonical = value =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map(key => [key, item[key]]),
        )
      : item,
  )
const equal = (a, b, reason) => {
  if (canonical(a) !== canonical(b)) throw Error(reason)
}
const requireThat = (condition, reason) => {
  if (!condition) throw Error(reason)
}
const without = (value, keys) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !keys.includes(key)))
const bytes = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const passedTime = value => typeof value === 'number' && Number.isFinite(value) && value > 0
const impl = row => row.metrics?.implementation
const output = row => row.metrics?.renderedOutput ?? row.format
const selected = row => ['svg', 'react-flow'].includes(output(row))
const rowKey = row => canonical([row.suite, impl(row), row.surface, row.runtime, row.family, row.caseId, row.operation, row.format, row.mode, row.metrics?.round ?? null, output(row)])
const workloadKey = (row, workloadIds) => rowKey(workloadIds.has(row.caseId) && !row.caseId.startsWith('core:') ? { ...row, mode: 'frozen-feature-once-protocol' } : row)
const rankKey = row => canonical([row.implementation, row.surface, row.output, row.family ?? null])
const status = rows => (rows.some(row => row.status === 'failed') ? 'failed' : rows.some(row => row.status === 'blocked') ? 'blocked' : 'passed')
function unique(rows, key, reason) {
  const map = new Map()
  for (const row of rows) {
    const id = key(row)
    if (map.has(id)) throw Error(reason + ': ' + id)
    map.set(id, row)
  }
  return map
}
function verifyFiles(files, reason) {
  for (const file of files ?? []) requireThat(existsSync(file.path) && bytes(file.path) === file.sha256, reason + ': ' + file.path)
}
function sourceEnvelope(root) {
  const directory = join(root, 'community'),
    result = readBenchmarkDocument(join(directory, 'community-result.json')),
    ranks = read(join(directory, 'community-ranks.json')),
    evidence = read(join(directory, 'community-evidence.json'))
  const ledger = readBenchmarkDocument(join(root, 'report.json')),
    invocation = read(join(root, 'invocation.json')),
    inputs = read(join(directory, 'community-inputs.json'))
  requireThat(result.id === 'community' && result.finishedAt && ledger.finishedAt && result.finishedAt === ranks.finishedAt && result.finishedAt === evidence.finishedAt, 'Unfinished or inconsistent source ledger')
  equal(evidence, ranks.evidence, 'Ranks/evidence differ')
  const parent = ledger.suites.filter(row => row.id === 'community')
  requireThat(parent.length === 1, 'Expected one community parent suite')
  equal(parent[0].result, result, 'Community result differs from completed parent ledger')
  requireThat(ledger.profile === 'full' && ledger.rounds === 3 && evidence.profile === 'full' && evidence.rounds === 3 && evidence.coverageOnce === true, 'Repair must retain full/three-round/feature-once protocol')
  requireThat(inputs.workloads.length === 963 && new Set(inputs.workloads.map(row => row.id)).size === 963, 'Expected963 distinct literal inputs')
  requireThat(ranks.artifacts.length === 84 && new Set(ranks.artifacts.map(row => row.node.id)).size === 84, 'Expected84 distinct catalog nodes')
  return { root, directory, result, ranks, evidence, ledger, invocation, inputs, prepared: read(join(directory, 'community-prepared.json')), browser: read(join(directory, 'community-browser-prepared.json')) }
}
function windows(value) {
  return { startedAt: value.startedAt, finishedAt: value.finishedAt }
}
function verifyBrowserPair(base, repair) {
  equal(
    base.map(peer => peer.node),
    repair.map(peer => peer.node),
    'Browser catalog/config/order differs',
  )
  const helperChanges = []
  for (let index = 0; index < base.length; index++) {
    const before = base[index],
      after = repair[index]
    equal(without(before, ['artifact', 'browser']), without(after, ['artifact', 'browser']), 'Browser status or public host contract changed: ' + before.node.id)
    equal(without(before.artifact, ['detail']), without(after.artifact, ['detail']), 'Browser backing engine artifact changed')
    if (!before.browser) {
      requireThat(!after.browser, 'Repair adds an unprepared engine')
      continue
    }
    const old = before.browser,
      next = after.browser
    equal(without(old, ['files', 'qualificationHelper']), without(next, ['files', 'qualificationHelper']), 'Public browser entry/runtime/assets changed: ' + before.node.id)
    requireThat(old.qualificationHelper && next.qualificationHelper && resolve(old.qualificationHelper) !== resolve(next.qualificationHelper), 'Repair must use a distinct helper path')
    const original = old.files.filter(file => resolve(file.path) !== resolve(old.qualificationHelper)),
      fresh = next.files.filter(file => resolve(file.path) !== resolve(next.qualificationHelper))
    equal(original, fresh, 'Non-qualification browser file proof changed: ' + before.node.id)
    verifyFiles(old.files, 'Original browser proof no longer holds')
    verifyFiles(next.files, 'Repaired browser proof does not hold')
    helperChanges.push({ implementation: before.node.id, original: old.files.find(file => resolve(file.path) === resolve(old.qualificationHelper)), repaired: next.files.find(file => resolve(file.path) === resolve(next.qualificationHelper)) })
  }
  return helperChanges
}
export function comparisonRowsFromCommittedBrowserRounds(observations, browserRecords, workloadIds) {
  const groups = new Map()
  for (const [observationIndex, row] of observations.entries()) {
    if (!selected(row) || !workloadIds.has(row.caseId) || row.suite !== 'community-browser' || row.metrics?.round !== undefined) continue
    const key = canonical(row),
      group = groups.get(key) ?? { row, observationIndices: [], candidates: [] }
    group.observationIndices.push(observationIndex)
    groups.set(key, group)
  }
  for (const [recordIndex, record] of browserRecords.entries()) {
    requireThat(Number.isInteger(record.round) && record.round >= 1 && record.round <= 3, 'Invalid committed browser record round')
    for (const [sampleIndex, row] of (record.samples ?? []).entries()) {
      const group = groups.get(canonical(row))
      if (!group) continue
      requireThat(record.id === impl(row) && !row.samplesMs?.length && ['failed', 'blocked', 'unsupported', 'not-applicable'].includes(row.status), 'Missing-round normalization cannot invent successful/timed work')
      group.candidates.push({ round: record.round, recordIndex, sampleIndex })
    }
  }
  const replacements = new Map(),
    skipped = new Set(),
    associations = []
  for (const group of groups.values()) {
    requireThat(group.candidates.length === group.observationIndices.length, 'Missing-round base outcome has no exact committed raw browser association multiset')
    const rounds = [...new Set(group.candidates.map(candidate => candidate.round))],
      ambiguous = rounds.length > 1
    associations.push({
      observationIndices: group.observationIndices,
      implementation: impl(group.row),
      caseId: group.row.caseId,
      association: ambiguous ? 'ambiguous-failure-set; no individual old observation round assigned' : 'unique-committed-round',
      candidates: group.candidates,
      ...(ambiguous ? {} : { recoveredRound: rounds[0] }),
    })
    // Only comparison cohort slots come from the raw records. This makes no assertion
    // assigning an ambiguous original row to one of those slots, and is never published as old data.
    replacements.set(
      group.observationIndices[0],
      group.candidates.map(candidate => ({ ...browserRecords[candidate.recordIndex].samples[candidate.sampleIndex], metrics: { ...group.row.metrics, round: candidate.round } })),
    )
    for (const index of group.observationIndices.slice(1)) skipped.add(index)
  }
  const rows = observations.flatMap((row, index) => (skipped.has(index) ? [] : (replacements.get(index) ?? [row])))
  return { rows, associations, policy: 'Comparison cohort keys derive from identical committed raw-record failure outcomes. Ambiguous old observation members retain complete candidate association sets and remain individually unassigned. Base JSON stays untouched; no successful sample or timing is inferred.' }
}
export function mergeRows(baseRows, repairedRows, workloadIds) {
  const oldSelected = baseRows.filter(selected),
    newSelected = repairedRows.filter(selected)
  // Output lanes must not accidentally execute an unaffected public API.
  requireThat(
    repairedRows.filter(row => !selected(row)).every(row => !row.samplesMs?.length),
    'Repair contains timed unaffected output',
  )
  const before = unique(
      oldSelected.filter(row => workloadIds.has(row.caseId)),
      row => workloadKey(row, workloadIds),
      'Duplicate base selected workload',
    ),
    after = unique(
      newSelected.filter(row => workloadIds.has(row.caseId)),
      row => workloadKey(row, workloadIds),
      'Duplicate repaired selected workload',
    )
  equal([...before.keys()].sort(), [...after.keys()].sort(), 'Missing or extra selected workload/runtime/round key; no old timing fallback permitted')
  const diagnosticChanges = { removed: oldSelected.filter(row => !workloadIds.has(row.caseId)).map(rowKey), added: newSelected.filter(row => !workloadIds.has(row.caseId)).map(rowKey) }
  // Diagnostics are replaced by selected output ownership, not compared by error-only shape.
  unique(
    newSelected.filter(row => !workloadIds.has(row.caseId)),
    rowKey,
    'Duplicate repaired output diagnostic',
  )
  for (const row of newSelected) {
    const round = row.metrics?.round
    if (workloadIds.has(row.caseId) && !row.caseId.startsWith('core:') && row.status !== 'not-applicable') requireThat(round === 1 && !row.samplesMs?.length, 'Feature-once row is repeated or calibrated')
    if (row.samplesMs) requireThat(row.samplesMs.every(passedTime), 'Invalid repaired sample; zeros are not speed wins')
  }
  return { observations: [...baseRows.filter(row => !selected(row)), ...newSelected], preserved: baseRows.filter(row => !selected(row)).length, replaced: oldSelected.length, inserted: newSelected.length, diagnosticChanges }
}
function cliIdentity(variant) {
  return { variantOf: variant.variantOf, variant: variant.variant, prepared: { node: variant.prepared.node, artifact: without(variant.prepared.artifact, ['detail']) }, identity: variant.identity, error: variant.error ?? null }
}
function reconcileCli(baseRoot, repairRoot, destination, communityManifest, cliApi, communityPrepared) {
  const base = readBenchmarkDocument(join(baseRoot, 'community-cli-result.json')),
    correction = readBenchmarkDocument(join(repairRoot, 'community-cli-result.json'))
  requireThat(base.id === 'community-cli' && correction.id === 'community-cli' && base.finishedAt && correction.finishedAt && base.rounds === 3 && correction.rounds === 3, 'CLI repair is incomplete or not three rounds')
  equal(correction.evidence.outputSelection, ['svg'], 'CLI correction must be SVG-only')
  equal(base.evidence.cohort, correction.evidence.cohort, 'CLI literal fixed core changed')
  requireThat(resolve(base.evidence.sourceRun) === resolve(communityManifest.sourceCommunity.original) && resolve(correction.evidence.sourceRun) === resolve(communityManifest.sourceCommunity.repair), 'CLI phase does not bind its actual base/repair parent community')
  for (const current of [base, correction])
    requireThat(resolve(current.evidence.target.root) === resolve(communityManifest.target.root) && resolve(current.evidence.target.packageRoot) === resolve(communityManifest.target.packageRoot) && current.evidence.target.head === communityManifest.target.revision, 'CLI phase uses a different target head/root/package')
  equal(base.evidence.target, correction.evidence.target, 'CLI target/runtime source changed')
  equal(base.evidence.resourceObserver, correction.evidence.resourceObserver, 'CLI resource observer changed')
  equal(base.evidence.variants.map(cliIdentity), correction.evidence.variants.map(cliIdentity), 'CLI executable/args/package/files/variant identity changed')
  const ids = new Set(base.evidence.cohort.map(row => row.id)),
    latency = mergeRows(base.observations, correction.observations, ids)
  // Resource rows have no round; SVG-only still must retain every required per-case key once.
  const resources = mergeRows(base.diagnostics, correction.diagnostics, ids)
  equal(base.evidence.cohort, communityManifest.coreCohort, 'CLI fixed inputs differ from composed community')
  for (const variant of correction.evidence.variants) {
    const artifact = variant.prepared.artifact
    const admitted = communityPrepared.find(peer => peer.node.id === variant.variantOf)
    requireThat(admitted?.artifact, 'CLI variant is not bound to an admitted catalog engine')
    if (variant.variant === 'public-cli') equal(without(artifact, ['detail']), without(admitted.artifact, ['detail']), 'CLI executable/protocol differs from selected parent community')
    else {
      requireThat(admitted.node.benchmark?.adapter === 'agentic', 'Synthetic variant is not an Agentic invocation')
      if (variant.variant === 'native-cli') requireThat(resolve(artifact.executable) === resolve(communityManifest.target.root, 'dist/am'), 'Native CLI is not the frozen target executable')
      else if (variant.variant === 'node-cli') {
        const fileIdentity = files => [...files].map(file => ({ path: resolve(file.path), sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path))
        equal(fileIdentity(artifact.files), fileIdentity(communityManifest.target.compiledArtifacts.files), 'Installed Node CLI package does not match admitted target archive closure')
        const pkg = read(join(communityManifest.target.packageRoot, 'package.json')),
          bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.am ?? pkg.bin?.['agentic-mermaid'])
        requireThat(bin && resolve(artifact.args[0]) === resolve(communityManifest.target.packageRoot, bin), 'Node CLI does not invoke actual candidate published bin')
      } else throw Error('Unknown candidate CLI variant')
    }
    verifyFiles(artifact?.files, 'CLI shipped file changed')
    if (variant.identity?.executable) requireThat(bytes(variant.identity.executable.path) === variant.identity.executable.sha256, 'CLI executable changed')
  }
  const ranks = cliApi.rankCommunityCliObservations(base.evidence.variants, latency.observations, base.evidence.cohort, 3),
    resourceRanks = cliApi.rankCommunityCliResources(base.evidence.variants, resources.observations, base.evidence.cohort)
  for (const [field, recomputed] of [
    ['ranks', ranks],
    ['resourceRanks', resourceRanks],
  ]) {
    equal(
      base[field].filter(row => row.output !== 'svg'),
      recomputed.filter(row => row.output !== 'svg'),
      'Unaffected CLI rank changed',
    )
    equal(
      correction[field].filter(row => row.output === 'svg'),
      recomputed.filter(row => row.output === 'svg'),
      'Fresh CLI SVG rank does not derive from repaired raw observations',
    )
  }
  const result = {
    ...base,
    status: status([...latency.observations, ...resources.observations]),
    finishedAt: communityManifest.composedAt,
    observations: latency.observations,
    diagnostics: resources.observations,
    ranks,
    resourceRanks,
    composition: {
      protocol: 'community-cli-qualification-composition-v1',
      original: { directory: baseRoot, ...windows(base) },
      repair: { directory: repairRoot, ...windows(correction) },
      outputSelection: ['svg'],
      communityComposition: communityManifest.id,
      communityTarget: communityManifest.target,
      preservedLatencyRows: latency.preserved,
      preservedResourceRows: resources.preserved,
      latencyFinishedAt: { original: base.latencyFinishedAt, repair: correction.latencyFinishedAt },
      policy: 'Mixed-window qualification repair: onlySVG latency/resources are fresh; all terminal observations and ranks are original. No product speed-improvement attribution.',
    },
  }
  // Source-run changes only in the new composite, with original paths retained above.
  result.evidence = { ...base.evidence, sourceRun: join(destination, '..', 'community'), composition: result.composition }
  mkdirSync(destination, { recursive: true })
  write(join(destination, 'community-cli-result.json'), result)
  write(join(destination, 'ranks.json'), { ...result, observations: undefined, diagnostics: undefined })
  write(join(destination, 'community-cli-inputs.json'), result.evidence)
  return result
}

export function validateFrozenCommunityInputs(base, repair) {
  equal(without(base, ['source']), without(repair, ['source']), 'Frozen963 source/family/label/features/reference input changed')
  return { originalSourcePath: base.source ?? null, repairSourcePath: repair.source ?? null, scope: 'Only top-level input-file provenance path differs; every literal workload object, expectation, feature, reference and policy remains identical' }
}
export async function reconcileCommunity(options) {
  const base = sourceEnvelope(resolve(options.base)),
    repair = sourceEnvelope(resolve(options.repair)),
    out = resolve(options.out)
  requireThat(!existsSync(out) || readdirSync(out).length === 0, 'Composite output already contains evidence; choose a fresh directory')
  equal(repair.evidence.outputSelection, ['svg', 'react-flow'], 'Repair output lane must be exactly svg,react-flow')
  requireThat(repair.evidence.qualificationProtocol && repair.evidence.qualificationProtocol !== base.evidence.qualificationProtocol, 'No explicit changed qualification protocol')
  const inputSourceProvenance = validateFrozenCommunityInputs(base.inputs, repair.inputs)
  equal(base.evidence.currentReference, repair.evidence.currentReference, 'Pinned reference changed')
  equal(base.evidence.target, repair.evidence.target, 'Target/archive/package/engine files changed')
  equal(base.evidence.targetAdvance, repair.evidence.targetAdvance, 'Target advance proof changed')
  equal(base.evidence.catalogIds, repair.evidence.catalogIds, 'Catalog ID/config ordering changed')
  equal(base.ranks.aliases, repair.ranks.aliases, 'Alias proof or representative changed')
  equal(without(base.ranks.eligibility, ['generatedAt']), without(repair.ranks.eligibility, ['generatedAt']), 'Engine eligibility changed')
  equal(
    base.prepared.map(peer => ({ ...peer, artifact: without(peer.artifact, ['detail']) })),
    repair.prepared.map(peer => ({ ...peer, artifact: without(peer.artifact, ['detail']) })),
    'Prepared engine/package/runtime/config/source proof changed',
  )
  const api = await import(pathToFileURL(join(resolve(options.driver), 'eval/benchmark/unified/community.ts')).href)
  for (const peer of base.prepared) if (peer.artifact) api.verifyProvidedCommunityArtifact(peer.artifact)
  const helperChanges = verifyBrowserPair(base.browser, repair.browser)
  const target = base.evidence.target
  requireThat(bytes(target.candidateTarball) === target.candidateSha256, 'Candidate tarball changed')
  const targetHead = execFileSync('git', ['-C', target.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  requireThat(targetHead === target.revision, 'Candidate Git target changed')
  for (const ledger of [base, repair])
    requireThat(
      ledger.ranks.identityRechecks.every(row => row.status === 'passed'),
      'Source artifact identity recheck failed',
    )
  const workloadIds = new Set(base.inputs.workloads.map(row => row.id))
  const comparison = comparisonRowsFromCommittedBrowserRounds(base.result.observations, read(join(base.directory, 'community-browser-rounds.json')), workloadIds)
  const merged = mergeRows(comparison.rows, repair.result.observations, workloadIds)
  const ranks = api.rankCommunityObservations(merged.observations, 3),
    familyRanks = api.rankCommunityFamilyObservations(merged.observations, 3)
  for (const field of ['ranks', 'familyRanks']) {
    const before = unique(
        base.ranks[field].filter(row => !['svg', 'react-flow'].includes(row.output)),
        rankKey,
        'Duplicate unaffected rank',
      ),
      after = unique(
        { ranks, familyRanks }[field].filter(row => !['svg', 'react-flow'].includes(row.output)),
        rankKey,
        'Duplicate recomputed unaffected rank',
      )
    equal([...before.keys()].sort(), [...after.keys()].sort(), 'Unaffected rank keys changed')
    for (const [key, value] of before) equal(value, after.get(key), 'Unaffected rank value changed')
  }
  const composedAt = new Date().toISOString(),
    coreCohort = base.inputs.workloads.filter(row => row.features.includes('core-graph-batch'))
  const manifest = {
    id: 'community-qualification-composition-v3',
    sourceCommunity: { original: base.directory, repair: repair.directory }, inputSourceProvenance,
    composedAt,
    scope: ['svg', 'react-flow'],
    policy: 'Mixed-window correctness-qualification evidence. Engine bytes, sources, labels, protocols, pins and target remain frozen. SVG/IR timings are fresh under repaired admission; unaffected observations are exact original JSON. No product speed-improvement attribution.',
    target,
    targetAdvance: base.evidence.targetAdvance,
    original: { directory: base.root, driver: base.ledger.driverRevision, driverDirty: base.ledger.driverDirty, ...windows(base.result), qualification: base.evidence.svgQualification },
    repair: { directory: repair.root, driver: repair.ledger.driverRevision, driverDirty: repair.ledger.driverDirty, ...windows(repair.result), qualification: repair.evidence.svgQualification, qualificationProtocol: repair.evidence.qualificationProtocol },
    currentReference: base.evidence.currentReference,
    catalogIds: base.evidence.catalogIds,
    coreCohort,
    sourceCaseIds: base.inputs.workloads.map(row => row.id),
    comparisonSchemaRepair: { workloadModeKeyPolicy: 'For noncore frozen feature-once workloads only, legacy outcome-dependent attempt/qualification mode strings share the independently fixed one-call protocol. Raw modes remain untouched; round1 and no calibrated feature samples are required. Core and diagnostic modes remain exact.', source: join(base.directory, 'community-browser-rounds.json'), associations: comparison.associations, policy: comparison.policy },
    helperChanges,
    preservedObservations: merged.preserved,
    replacedObservations: merged.replaced,
    freshObservations: merged.inserted,
    diagnosticChanges: merged.diagnosticChanges,
    aliasEvidence: base.ranks.aliases,
  }
  const result = { ...base.result, status: status(merged.observations), finishedAt: composedAt, observations: merged.observations, composition: manifest, gaps: [...new Set([...base.result.gaps, ...repair.result.gaps, manifest.policy])] }
  const evidence = { ...base.evidence, protocol: manifest.id, finishedAt: composedAt, qualificationComposition: manifest, svgQualification: repair.evidence.svgQualification }
  const scores = { ...base.ranks, protocol: manifest.id, finishedAt: composedAt, evidence, ranks, familyRanks, composition: manifest, gaps: result.gaps, identityRechecks: repair.ranks.identityRechecks }
  mkdirSync(join(out, 'community'), { recursive: true })
  write(join(out, 'community/community-result.json'), result)
  write(join(out, 'community/community-ranks.json'), scores)
  write(join(out, 'community/community-evidence.json'), evidence)
  write(join(out, 'community/community-qualification-composition.json'), manifest)
  for (const name of ['community-inputs.json', 'community-prepared.json']) copyFileSync(join(base.directory, name), join(out, 'community', name))
  copyFileSync(join(repair.directory, 'community-browser-prepared.json'), join(out, 'community/community-browser-prepared.json'))
  write(join(out, 'invocation.json'), { ...base.invocation, composition: manifest })
  requireThat(Boolean(options.cliBase) === Boolean(options.cliRepair), 'Supply both CLI partitions or neither')
  const cliApi = options.cliBase ? await import(pathToFileURL(join(resolve(options.driver), 'eval/benchmark/unified/community-cli.ts')).href) : undefined
  const cli = options.cliBase && options.cliRepair ? reconcileCli(resolve(options.cliBase), resolve(options.cliRepair), join(out, 'community-cli'), manifest, cliApi, base.prepared) : undefined
  const ledger = {
    ...base.ledger,
    finishedAt: composedAt,
    composition: manifest,
    suites: base.ledger.suites.map(suite =>
      suite.id === 'community'
        ? { ...suite, status: result.status, result, mixedMeasurementWindows: true }
        : suite.id === 'community-cli' && cli
          ? { ...suite, status: cli.status, result: { ...suite.result, status: cli.status, finishedAt: composedAt, observations: [...cli.observations, ...cli.diagnostics], composition: cli.composition }, mixedMeasurementWindows: true }
          : suite,
    ),
  }
  ledger.status = ledger.suites.some(suite => suite.selected && suite.status === 'failed') ? 'failed' : ledger.suites.some(suite => suite.selected && suite.status === 'blocked') ? 'incomplete' : 'passed'
  write(join(out, 'report.json'), ledger)
  writeFileSync(
    join(out, 'QUALIFICATION-COMPOSITION.md'),
    `# Explicit qualification composition\n\n${manifest.policy}\n\nOriginal: ${base.root}, ${base.result.startedAt} → ${base.result.finishedAt}.\n\nSVG/IR repair: ${repair.root}, ${repair.result.startedAt} → ${repair.result.finishedAt}.\n\nComposed: ${composedAt}. Preserved ${merged.preserved} original observations; replaced ${merged.replaced} with ${merged.inserted} fresh selected-output observations. Original ledgers and qualification helpers remain unchanged. Full proof: community/community-qualification-composition.json.\n`,
  )
  return { out, status: ledger.status, manifest }
}
export { selected as isQualificationRepairObservation, rowKey as communityReconciliationKey, workloadKey as communityReconciliationWorkloadKey }
if (import.meta.main) {
  const options = {}
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index],
      value = process.argv[index + 1]
    requireThat(['--base', '--repair', '--out', '--driver', '--cli-base', '--cli-repair'].includes(key) && value && !value.startsWith('--') && !(key.slice(2) in options), 'Invalid or duplicate reconciliation option')
    options[key.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value
  }
  for (const key of ['base', 'repair', 'out', 'driver']) requireThat(options[key], 'Missing ' + key)
  console.log(JSON.stringify(await reconcileCommunity(options), null, 2))
}
