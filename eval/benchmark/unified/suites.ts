import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../../../src/agent/families.ts'
import type { UnifiedRunOptions } from './types.ts'

export interface SuiteOptions extends UnifiedRunOptions {
  harnessRoot: string
  packageRoot?: string
  site?: string
  ownershipSite?: string
  candidateTarball?: string
  candidateSha256?: string
  baseline?: string
  baselineRef?: string
  baselineNpm?: string
  baselineTarball?: string
  baselineSha256?: string
  baselineLock?: string
  bezelDir?: string
  mermaidDir?: string
  referenceDir?: string
  liveProvider?: string
  liveModel?: string
}
export interface SuiteDefinition {
  id: string
  title: string
  kind: 'internal' | 'script' | 'test'
  smoke: boolean
  automatic?: boolean
  source: string
  command?: string[]
  cwd?: string
  environment?: Record<string, string>
  prerequisites: string[]
  policy: string
  target?: 'candidate' | 'driver'
  pin?: unknown
}
const json = (file: string): any => JSON.parse(readFileSync(file, 'utf8'))
const add = (args: string[], flag: string, value: string | undefined): void => {
  if (value) args.push(flag, value)
}

/** Command discovery follows declared package benchmark entries. Standalone
 * adapters describe real executable boundaries; worker/helper modules are never
 * inferred to be executables from their filenames. */
export function benchmarkSuites(options: SuiteOptions): SuiteDefinition[] {
  const root = options.harnessRoot,
    out = (id: string) => join(options.out, id.replaceAll(':', '-'))
  const pkg = json(join(root, 'package.json')) as { scripts: Record<string, string> }
  const built = existsSync(join(options.packageRoot ?? options.root, 'dist/index.js'))
  const upstream = options.mermaidDir ?? process.env.MERMAID_UPSTREAM_DIR ?? resolve(root, '../mermaid')
  const reference = options.referenceDir ?? process.env.MERMAID_REFERENCE_DIR ?? resolve(root, '../mermaid-reference')
  const referenceMissing = [!existsSync(join(upstream, 'packages/mermaid/package.json')) && `Pinned Mermaid source missing: ${upstream}`, !existsSync(join(reference, 'node_modules/mermaid/package.json')) && `Independent Mermaid installation missing: ${reference}`].filter((x): x is string => Boolean(x))
  const site = options.site ?? join(root, 'website/public')
  const siteMissing = existsSync(join(site, 'editor/index.html')) ? [] : [`Built editor missing: ${site}; run bun run website`]
  const browserMissing = options.executable && !existsSync(options.executable) ? [`Browser executable missing: ${options.executable}`] : []
  const suites: SuiteDefinition[] = [
    { id: 'mermaid-fidelity', title: 'Independent family meaning, feature workflows and actual painted output', kind: 'internal', smoke: true, source: 'eval/benchmark/fidelity/run.ts', prerequisites: [...referenceMissing, ...browserMissing, ...(!built ? ['Built selected Agentic package missing'] : [])], policy: 'One independently authored criterion universe for every required stable family and interacting features. Native identities/relations/values, real source/configuration/edit workflows, computed visibility/owned ink/quantitative geometry and actual PNG evidence stay distinct. Reference failures and missing peer evidence never shrink the denominator. Optional ZenUML uses its actual pinned first-party addon. Per-project records; no new performance clocks.' },
    { id: 'community-fidelity', title: 'Independent painted functionality on frozen community SVG artifacts', kind: 'internal', smoke: false, source: 'eval/benchmark/fidelity/community.ts', prerequisites: [...browserMissing, ...(!options.communityBrowserPreparedFile ? ['Explicit existing frozen browser-prepared manifest required; no acquisition or old clocks are repeated'] : [])], policy: 'Use the same authored cases and planned criteria as core fidelity. Verify actual artifact/version bytes; retain per-project records and all catalog boundaries. Native APIs without reviewed adapters remain unavailable. Lossless SVGs, basic family PNG witnesses and alias attribution; separate from historical speed/memory costs.' },
    { id: 'upstream-fidelity', title: 'Expanded original upstream assertions across required families', kind: 'internal', smoke: false, source: 'eval/benchmark/unified/upstream-fidelity.ts', prerequisites: referenceMissing, policy: 'Original callbacks and expectations through reviewed actual public-model capabilities; every tracked declaration receives a disposition. Private API, unsupported imports/matchers and pure helper tests never manufacture engine passes. Exact diagnostic and internal representation compatibility remain separate from drawing meaning.' },
    { id: 'upstream-original', title: 'Actual pinned Mermaid original core Vitest runner', kind: 'internal', smoke: false, source: 'eval/benchmark/unified/upstream-fidelity-original.ts', prerequisites: referenceMissing, policy: 'Genuine pinned source and original Vite test configuration, one worker, real declared runtimes and read-only snapshots. Complete callback/declaration accounting; source/ref/dependency identity checked before and after. Browser/e2e and docs-site workspace exclusions stay explicit. Local-only; an unselected Mermaid project does not launch a reference worker.' },
    { id: 'mermaid-baseline-browser', title: 'Pinned Mermaid browser SVG baseline, startup and resources', kind: 'internal', smoke: false, source: 'eval/benchmark/unified/baseline-browser.ts', prerequisites: [...referenceMissing, ...browserMissing], pin: json(join(root, 'docs/project/upstream-mermaid-policy.json')).pin, policy: 'Common authored SVG work against actual pinned Mermaid with same-artifact A/A controls; full protocol uses five counterbalanced renderer rounds, 25 fresh startups and five separate document-heap passes per role. Requested round overrides, rolling records, missing capability, independent SVG/label admission and unmeasured paint/native/GPU memory remain explicit. No overall weighted score.' },
    { id: 'mermaid-baseline-compatibility', title: 'Pinned Mermaid public parser baseline and original assertion coverage', kind: 'internal', smoke: false, source: 'eval/benchmark/unified/mermaid-baseline-compatibility.ts', prerequisites: referenceMissing, pin: json(join(root, 'docs/project/upstream-mermaid-policy.json')).pin, policy: 'Native Node public parser results, with required DOM host setup explicitly included for Mermaid. Full mode measures 25 first-result processes and five separate resources per project; syntax acceptance, rich versus validation-only output, original callback subset and unavailable core-Mermaid operations remain distinct. Existing original-assertion records are verified and retained, not re-executed.' },
    { id: 'family', title: 'All-family functionality and feature evidence', kind: 'internal', smoke: true, source: 'eval/benchmark/unified/family-suite.ts', prerequisites: [], policy: 'Fresh executable evidence; stored descriptor witness declarations are not new passes.' },
    { id: 'stable-support', title: 'Required Mermaid family admission', kind: 'internal', smoke: true, source: 'eval/benchmark/unified/stable-support-run.ts', prerequisites: built ? (existsSync(join(upstream, 'packages/mermaid/package.json')) ? [] : ['Pinned Mermaid source missing']) : ['Built target package missing'], pin: json(join(root, 'docs/project/upstream-mermaid-policy.json')).pin, policy: 'All policy-stable families plus conservatively required unresolved exclusions. Actual public SVG/label admission is a hard complete-comparison gate; beta/experimental supplements and incomplete fidelity stay distinct. Per-project retained records.' },
    { id: 'entry-startup', title: 'Fresh public entry startup and paired memory diagnostics', kind: 'internal', smoke: false, source: 'eval/benchmark/unified/entry-startup.ts', prerequisites: built ? (!options.startupSurfaces || options.startupSurfaces.includes('browser') ? browserMissing : []) : ['Built target package missing'], policy: 'Derive shipped entries and actual public operations; measure fresh process through complete first consumption, readiness/import separately, then fresh paired resource passes. Use --rounds 5 --startup-samples 5 for 25 samples per interface; incomplete tails and unavailable native/hosted/worker memory stay explicit. Per-project reuse precedes operation discovery.' },
    { id: 'upstream-test-assertions', title: 'Original pinned Mermaid assertions and full test census', kind: 'internal', smoke: false, source: 'eval/benchmark/unified/upstream-test-score.ts', prerequisites: referenceMissing, pin: json(join(root, 'docs/project/upstream-mermaid-policy.json')).pin, policy: 'Execute current original Mindmap/GitGraph assertions through reviewed public-model adapters. Retain all other test declarations, skips/private assertions and diagnostic source replay without pass credit; workflow time is not an equivalent original-runner speed score. Per-project retained records.' },
    {
      id: 'invocation',
      title: 'Public invocation matrix',
      kind: 'internal',
      smoke: true,
      source: 'eval/benchmark/unified/invocation.ts',
      prerequisites: built ? [] : ['Built target package missing; run bun run build or provide --package-root'],
      policy: 'Target source and installed artifact identities are separate from the driver. Every unsupported or unavailable path remains visible.',
    },
    {
      id: 'pinned-reference-score',
      title: 'Selected historical inputs: pinned Mermaid score and parse timings',
      kind: 'internal',
      smoke: false,
      source: 'eval/benchmark/unified/reference-score.ts',
      prerequisites: referenceMissing,
      pin: json(join(root, 'docs/project/upstream-mermaid-policy.json')).pin,
      policy: 'Same independently expected source fixtures and assertion scopes; parser timing is separate from oracle/serialization and transport.',
    },
    { id: 'community', title: 'Community JSON population comparison', kind: 'internal', smoke: true, source: 'eval/benchmark/unified/community.ts', prerequisites: [], policy: 'Population is docs/mermaid-community.json; no missing peer is a zero-cost success.' },
  ]
  suites.push({
    id: 'community-cli',
    title: 'Matched public CLI cohorts and separately instrumented resources',
    kind: 'internal',
    smoke: false,
    source: 'eval/benchmark/unified/community-cli.ts',
    prerequisites: [],
    policy: 'Requires the completed sibling community artifacts; fresh-process CLI variants use matched fixed inputs. Child RSS/CPU are a separate post-latency diagnostic pass; source aliases are not additional independent engines.',
  })
  for (const [script, command] of Object.entries(pkg.scripts)) {
    if (!script.startsWith('bench:') || script === 'bench:charts' || script === 'bench:peers:qualify' || /eval\/benchmark\/(?:commands|portable\/(?:run|build)|unified\/(?:run|pr-campaign|project-update|update-scorecard)|suite)\.ts/.test(command)) continue
    const id = script.slice('bench:'.length),
      args = ['bun', 'run', script],
      prerequisites: string[] = []
    const policy = 'Owning maintained suite, executed in the driver checkout. Its own protocol and qualification remain authoritative.'
    if (id === 'samples') {
      /* The source sample runner has no argv protocol. */
    } else if (id === 'micro') args.push('--runtime', 'node', '--rounds', String(options.rounds), '--json', join(out(id), 'report.json'))
    else if (id === 'experiments') args.push('--out', out(id), '--rounds', String(options.rounds), '--paired', '1', '--broad', '1', '--png', '1')
    else if (id === 'pipeline') args.push('--out', out(id), '--rounds', String(options.rounds))
    else if (id === 'peers') args.push('--rounds', String(options.rounds), '--corpus', '--json', join(out(id), 'report.json'), '--markdown', join(out(id), 'report.md'))
    else if (id === 'dave') {
      if (options.candidateTarball) {
        args.splice(0, args.length, 'bun', 'run', 'eval/benchmark/release-browser-bench.ts', '--candidate-tarball', options.candidateTarball, '--warmup', '30')
        add(args, '--candidate-sha256', options.candidateSha256)
        if (!options.candidateSha256) prerequisites.push('Dave exact-artifact mode requires --candidate-sha256')
      }
      args.push('--out', out(id), '--rounds', String(options.rounds))
      add(args, '--executable', options.executable)
      add(args, '--bezel-dir', options.bezelDir)
      prerequisites.push(...browserMissing)
    } else if (id === 'release') {
      args.push('--out', out(id), '--rounds', String(options.rounds))
      if (options.candidateTarball) {
        add(args, '--candidate-tarball', options.candidateTarball)
        add(args, '--candidate-sha256', options.candidateSha256)
      } else {
        add(args, '--candidate', options.packageRoot ?? options.root)
        if (!built) prerequisites.push('Built candidate missing; provide --candidate-tarball or build the package')
      }
      if (options.baseline) {
        add(args, '--baseline', options.baseline)
        if (!existsSync(join(options.baseline, 'package.json'))) prerequisites.push('--baseline must name a built package directory; use --baseline-ref for output identity or --baseline-npm for a published release')
      } else {
        const selector = options.baselineNpm ?? (options.baselineLock && existsSync(options.baselineLock) ? json(options.baselineLock).requested : 'latest')
        args.push('--baseline-npm', selector)
        add(args, '--baseline-lock', options.baselineLock ?? join(out(id), 'baseline.json'))
      }
    } else if (id === 'release:browser') {
      args.push('--out', out(id), '--rounds', String(options.rounds))
      add(args, '--candidate-tarball', options.candidateTarball)
      add(args, '--candidate-sha256', options.candidateSha256)
      add(args, '--baseline-tarball', options.baselineTarball)
      add(args, '--baseline-sha256', options.baselineSha256)
      add(args, '--baseline-lock', options.baselineLock)
      add(args, '--executable', options.executable)
      add(args, '--bezel-dir', options.bezelDir)
      if (!options.candidateTarball || !options.candidateSha256) prerequisites.push('Provide --candidate-tarball and --candidate-sha256 for exact-artifact browser release measurements')
      if (!options.baselineLock && !(options.baselineTarball && options.baselineSha256)) prerequisites.push('Provide --baseline-lock or the baseline tarball and digest')
      prerequisites.push(...browserMissing)
    }
    suites.push({ id, title: script, kind: 'script', smoke: id === 'samples', source: command, command: args, prerequisites, policy, ...(['release', 'release:browser'].includes(id) || (id === 'dave' && options.candidateTarball) ? { target: 'candidate' as const } : {}) })
  }
  const qualificationRoot = options.root
  const qualificationSource = join(qualificationRoot, 'eval/benchmark/qualify-peer-performance.ts')
  if ((existsSync(qualificationSource) || existsSync(join(root, 'eval/benchmark/qualify-peer-performance.ts'))) && !suites.some(suite => suite.id === 'peers:qualify')) {
    const prerequisites = [
      ...(!existsSync(qualificationSource) ? ['Selected target checkout lacks eval/benchmark/qualify-peer-performance.ts; the driver protocol is not substituted'] : []),
      ...(!options.candidateTarball || !options.candidateSha256 ? ['Peer qualification needs the exact candidate tarball and digest'] : []),
      ...(!options.baselineTarball || !options.baselineSha256 ? ['Peer qualification needs the exact baseline tarball and digest'] : []),
    ]
    const args = ['bun', 'run', qualificationSource, '--out', out('peers:qualify'), '--rounds', String(options.rounds), '--runtime-source', qualificationRoot, '--elk-cache', 'off']
    add(args, '--candidate-tarball', options.candidateTarball)
    add(args, '--candidate-sha256', options.candidateSha256)
    add(args, '--baseline-tarball', options.baselineTarball)
    add(args, '--baseline-sha256', options.baselineSha256)
    suites.push({
      id: 'peers:qualify',
      title: 'Consumed semantic peer performance qualification',
      kind: 'script',
      smoke: false,
      source: qualificationSource,
      command: args,
      cwd: qualificationRoot,
      target: 'candidate',
      prerequisites,
      policy:
        'Uses the selected checkout’s maintained semantic peer protocol: two independent A/A controls, then candidate comparison. Exact archives, actual runtime dependency policy and all semantic tracks are retained. Insufficient cold-tail rounds and unsupported endpoint contracts remain explicit qualification gaps.',
    })
  }
  const standalone = (id: string, title: string, file: string, args: string[], prerequisites: string[] = [], policy = 'Diagnostic owning entry; instrumented timings are not cross-engine API latency.'): void => {
    if (existsSync(join(root, file))) suites.push({ id, title, kind: 'script', smoke: false, source: file, command: ['bun', 'run', file, ...args], prerequisites, policy })
  }
  standalone('render-stages', 'Official-corpus SVG receipt stage costs', 'eval/benchmark/render-stage-bench.ts', [String(options.rounds), join(out('render-stages'), 'report.json')])
  standalone('performance-profile', 'Experimental profile correctness qualification', 'eval/benchmark/qualify-performance-profile.ts', ['--out', join(out('performance-profile'), 'report.json')])
  standalone(
    'output-identity',
    'Cross-revision output identity across styles and formats',
    'eval/benchmark/output-identity.ts',
    ['--baseline', options.baselineRef ?? 'origin/main', '--jobs', '1'],
    [],
    'Output identity is correctness evidence, not time or semantic identity proof. Output hashes are shipped/rendered bytes; source inputs are not custom-hashed.',
  )
  for (const [id, file, extra] of [
    ['editor-preview', 'editor-preview-bench.ts', []],
    ['editor-session', 'editor-session-bench.ts', ['--cold-runs', String(options.rounds)]],
    ['editor-ownership', 'editor-ownership-bench.ts', ['--runs', String(options.rounds)]],
  ] as const) {
    const selectedSite = id === 'editor-ownership' ? (options.ownershipSite ?? site) : site
    const selectedMissing = id === 'editor-ownership' ? ['original.html', 'candidate.html'].filter(file => !existsSync(join(selectedSite, file))).map(file => `Controlled ownership comparison needs frozen ${file}: ${selectedSite}; provide --ownership-site with both reviewed variants and their assets`) : siteMissing
    const args = ['--site', selectedSite, '--out', out(id), ...extra]
    add(args, '--executable', options.executable)
    standalone(
      id,
      id,
      `eval/benchmark/${file}`,
      args,
      [...selectedMissing, ...browserMissing],
      'Real hosted editor/production adapter; verified DOM, request closure and ownership have separate clocks and contracts. Controlled ownership requires actual frozen original/candidate pages; no identical copies are fabricated to satisfy prerequisites.',
    )
  }
  const renderer = ['--agentic-root', options.packageRoot ?? root, '--bezel-dir', options.bezelDir ?? '', '--out', out('renderer-profile'), '--rounds', String(options.rounds)]
  add(renderer, '--executable', options.executable)
  standalone('renderer-profile', 'Packaged/browser attribution and CPU profile', 'eval/benchmark/renderer-profile.ts', renderer, [...browserMissing, ...(!options.bezelDir ? ['Verified Bezel wrapper directory required: --bezel-dir'] : [])])
  const currentPin = json(join(root, 'docs/project/upstream-mermaid-policy.json')).pin
  const test = (id: string, title: string, files: string[], prerequisites: string[] = [], pin?: unknown, smoke = false): void => {
    suites.push({
      id,
      title,
      kind: 'test',
      smoke,
      source: files.join(', '),
      command: ['bun', 'test', '--timeout', '30000', ...files],
      prerequisites,
      policy: 'Fresh owning tests. Pass/fail/skip counts and complete wall time come from this run, not stored witness metadata. Joint reference assertions are not separate parser latency ratios.',
      ...(pin ? { pin } : {}),
    })
  }
  let managedBrowserMissing: string[] = []
  try {
    const require = createRequire(join(root, 'package.json')),
      playwright = require('playwright'),
      chromiumPath = playwright.chromium.executablePath() as string,
      registry = require(join(dirname(require.resolve('playwright-core/package.json')), 'lib/server/registry/index.js')).registry,
      headlessPath = registry.findExecutable('chromium-headless-shell')?.executablePath('javascript') as string | undefined
    managedBrowserMissing = [
      ...(!existsSync(chromiumPath) ? [`Canonical browser contracts need managed Playwright Chromium: ${chromiumPath}`] : []),
      ...(!headlessPath || !existsSync(headlessPath) ? ['Canonical browser contracts need the installed Playwright chromium-headless-shell; run playwright install chromium'] : []),
      ...(['firefox', 'webkit'] as const).flatMap(name => {
        const file = playwright[name].executablePath() as string
        return existsSync(file) ? [] : [`Canonical cross-engine browser contracts need managed ${name}: ${file}; run playwright install chromium firefox webkit`]
      }),
    ]
  } catch (error) {
    managedBrowserMissing = [`Cannot resolve canonical managed Playwright prerequisites: ${String(error)}`]
  }
  if (existsSync(join(root, 'e2e/run-browser-contracts.ts')))
    suites.push({
      id: 'browser-contracts',
      title: 'Canonical public browser/editor/security contracts',
      kind: 'test',
      smoke: false,
      source: 'e2e/run-browser-contracts.ts',
      command: ['bun', 'run', 'e2e/run-browser-contracts.ts'],
      environment: { UPDATE_BASELINES: '' },
      prerequisites: managedBrowserMissing,
      policy:
        'Driver-owned canonical runner rebuilds the driver website and executes its enrolled browser contracts one file per process. It accepts no --site/--executable override; managed Playwright Chromium/headless shell, Firefox and WebKit are required. Fresh counts sum independent process summaries; first failing file stops later contracts, so a failed process is partial evidence. Wall time includes build/setup. No baseline screenshots are rewritten.',
    })
  const distributionPolicy =
    'Existing CI public-distribution correctness boundary in the driver checkout. Owning tests build/pack their own driver artifacts into isolated temporary consumer projects; --target and --package-root do not rebind this source/consumer parity gate. Process wall time is not public API latency.'
  for (const [id, title, files, timeout] of [
    ['distribution-cli', 'CLI and offline fresh-checkout contracts', ['cli-smoke.e2e.test.ts', 'cli.e2e.test.ts', 'fresh-checkout.e2e.test.ts'], 120000],
    ['distribution-native', 'Compiled single-binary distribution contracts', ['single-binary.e2e.test.ts'], 180000],
    ['distribution-dist-fuzz', 'Built artifact differential fuzz under plain Node', ['dist-artifact-fuzz.e2e.test.ts'], 400000],
    ['distribution-tarball', 'Installed tarball library, CLI, MCP and getting-started contracts', ['tarball-consumer-fuzz.e2e.test.ts'], 600000],
  ] as const)
    if (files.every(file => existsSync(join(root, 'e2e', file)))) suites.push({ id, title, kind: 'test', smoke: false, source: files.map(file => 'e2e/' + file).join(', '), cwd: join(root, 'e2e'), command: ['bun', 'test', ...files, '--timeout', String(timeout)], prerequisites: [], policy: distributionPolicy })
  if (existsSync(join(root, 'e2e/tarball-consumer-fuzz.e2e.test.ts'))) {
    const node22 = process.env.NODE22_EXECUTABLE
    suites.push({
      id: 'distribution-tarball-node22',
      title: 'Installed tarball contracts under independent Node22',
      kind: 'test',
      smoke: false,
      source: 'e2e/tarball-consumer-fuzz.e2e.test.ts',
      cwd: join(root, 'e2e'),
      command: ['bun', 'test', 'tarball-consumer-fuzz.e2e.test.ts', '--timeout', '600000'],
      ...(node22 ? { environment: { NODE_BINARY: node22, PATH: dirname(node22) + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? '') } } : {}),
      prerequisites: node22 && existsSync(node22) ? [] : ['Independent Node22 executable required: set NODE22_EXECUTABLE; another Node runtime is not substituted'],
      policy: distributionPolicy + ' NODE_BINARY selects the real Node22 consumer process; its directory leads PATH for npm and documented shell entrypoints.',
    })
  }
  standalone(
    'browser-lazy-delivery',
    'Shipped lazy-browser closure and transfer budgets',
    'scripts/build/browser-lazy-report.ts',
    ['--root', root, '--json'],
    existsSync(join(root, 'dist/metafile-esm.json')) ? [] : ['Driver lazy-browser metafile missing; run bun run build before this shipped-output closure gate'],
    'Actual driver-built request closures, gzip/Brotli sizes, family decoding and placement-demanded ELK checks. Static initial/family closures and budgeted possible ELK are named separately; this is delivery/owning correctness, not plain API latency.',
  )
  test(
    'family-contracts',
    'Fresh all-family capability, Scene and mutation contracts',
    ['src/__tests__/section-a-family-descriptor-conformance.test.ts', 'src/__tests__/family-registration-conformance.test.ts', 'src/__tests__/stable-family-edit-artifact.test.ts', 'src/__tests__/stable-family-source-maps.test.ts'],
    [],
    undefined,
    true,
  )
  const nativeFamilies = BUILTIN_FAMILY_METADATA.map(family => family.id)
  const canonicalContracts = new Set(suites.find(suite => suite.id === 'family-contracts')!.command!.filter(arg => arg.endsWith('.test.ts')))
  const familyFunctionality = readdirSync(join(root, 'src/__tests__'))
    .filter(file => {
      if (!file.endsWith('.test.ts') || /upstream|mermaidseqbench/.test(file) || canonicalContracts.has('src/__tests__/' + file)) return false
      return /^agent-|^stable-family-|^(?:extension-family|external-scene|family-)|^(?:style-|styled-output)|^property-(?:route|paint|scene|family|layout|svg|ascii|terminal|mcp)/.test(file) || nativeFamilies.some(family => new RegExp(`(?:^|[-_.])${family}(?:[-_.]|$)`).test(file))
    })
    .sort()
    .map(file => 'src/__tests__/' + file)
  test('family-functionality', 'Scoped public family/agent mutation, query, serializer and route behavior', familyFunctionality)
  const familySuite = suites.find(suite => suite.id === 'family-functionality')!
  // Proxy-configured environments must still exercise the owning IPv6 loopback
  // transport directly. Preserve all external proxy configuration and bypasses.
  const loopbackBypasses = [...new Set([process.env.NO_PROXY, process.env.no_proxy, '::1', '[::1]'].flatMap(value => (value ?? '').split(',')).filter(Boolean))].join(',')
  familySuite.environment = { NO_PROXY: loopbackBypasses, no_proxy: loopbackBypasses }
  familySuite.policy += ' Enrollment follows existing owning filename conventions and registry family IDs; it excludes the unrelated unit suite. Passing this group is not a per-schema-operation witness map; operations without explicit benchmark witnesses remain unmeasured.'
  const importedTests = readdirSync(join(root, 'src/__tests__'))
    .filter(file => /(?:upstream.*bench|mermaidseqbench|mindmap-gitgraph-upstream-oracle)\.test\.ts$/.test(file))
    .sort()
    .map(file => `src/__tests__/${file}`)
  const historicalPin = json(join(root, 'eval/mermaid-upstream-suite-bench/manifest.json')).upstream
  test('upstream-imported', 'Pinned imported Mermaid parser/DB tests and family companions', importedTests, [], { mainHarvest: historicalPin, note: 'Each companion fixture retains its own historical pin. This is not the current Mermaid 12.2.0 source checkout.' })
  for (const [id, file, title] of [
    ['pinned-semantic-tests', 'semantic.test.ts', 'Pinned current Mermaid semantic and label assertions'],
    ['pinned-operation-tests', 'native-operations.test.ts', 'Pinned current Mermaid actual ordered native writes'],
    ['pinned-grammar-tests', 'grammar-regressions.test.ts', 'Pinned current Mermaid grammar regressions'],
  ])
    test(id!, title!, [`eval/mermaid-modern-compat/${file}`], referenceMissing, currentPin)
  standalone(
    'pinned-semantic-corpus',
    'Independent current-reference corpus and authored label census',
    'eval/mermaid-modern-compat/run.ts',
    ['--mermaid-dir', upstream, '--reference-dir', reference, '--specs', '--labels', '--fuzz', '100', '--seed', '7', '--output', out('pinned-semantic-corpus')],
    referenceMissing,
    'Same sources retained, including reference rejection and native/preserved/unsupported cases. Semantic label presence is not complete visual or identity fidelity.',
  )
  standalone(
    'pinned-grammar-corpus',
    'Independent current-reference grammar and native observations',
    'eval/mermaid-modern-compat/grammar-run.ts',
    ['--mermaid-dir', upstream, '--reference-dir', reference, '--native-only', '--fuzz', '100', '--seed', '7', '--workers', '1', '--output', out('pinned-grammar-corpus')],
    referenceMissing,
  )
  for (const definition of suites) if (definition.id.startsWith('pinned-')) definition.pin = currentPin
  standalone(
    'family-portfolio',
    'Balanced registry-derived family corpus',
    'eval/benchmark/unified/portfolio.ts',
    ['--out', out('family-portfolio')],
    [],
    'Execute the maintained portfolio builder and record inventory/provenance outside the checkout; no tracked generated corpus is rewritten. This is preparation evidence, not a renderer speed score.',
  )
  test('agent-replay', 'Stored real-agent/scripted usage and safe mutation paths', ['src/__tests__/agent-usage.test.ts'])
  const live = ['--provider', options.liveProvider ?? 'anthropic', '--model', options.liveModel ?? '']
  const provider = options.liveProvider ?? 'anthropic',
    hasKey = provider === 'anthropic' ? Boolean(process.env.ANTHROPIC_API_KEY) : Boolean(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY)
  standalone(
    'agent-live',
    'Observed API-backed agent usage and token costs',
    'eval/agent-usage/live.ts',
    live,
    [...(!options.liveModel ? ['An explicit --live-model is required; stored replay is not a live-provider measurement'] : []), ...(!hasKey ? [`No configured ${provider} provider credential`] : [])],
    'Provider/model, discovery availability, usage tokens and task correctness are separate. A blocked live run does not score zero cost.',
  )
  standalone('mcp-conformance', 'Official pinned MCP transport conformance', 'scripts/ci/mcp-conformance.ts', [], [], 'Official MCP conformance may acquire its declared npm runner; tests wire behavior, not family fidelity or renderer speed.')
  if (pkg.scripts['style:audit'])
    suites.push({
      id: 'style-audit',
      title: 'Public style option and styled-output behavior',
      kind: 'test',
      smoke: false,
      source: pkg.scripts['style:audit'],
      command: ['bun', 'run', 'style:audit'],
      prerequisites: [],
      policy: 'Existing owning style behavior checks; scoped correctness evidence, not a renderer speed rank.',
    })
  if (pkg.scripts['sketch:check'])
    suites.push({ id: 'sketch-check', title: 'Sketch style behavior and contrast audit', kind: 'test', smoke: false, source: pkg.scripts['sketch:check'], command: ['bun', 'run', 'sketch:check'], prerequisites: [], policy: 'Existing sketch behavior and contrast evaluator. Contrast is our own quality contract.' })
  standalone(
    'agent-subagent',
    'Observed external-agent transcript capture/evaluation',
    'eval/agent-usage/capture-subagent-prompt-eval.ts',
    [],
    ['An external agent transcript dispatch/capture directory is required; generating request templates is not a completed model evaluation'],
    'No model/provider transcript is fabricated or replaced by stored script replay.',
  )
  if (existsSync(join(root, 'eval/layout-compare/run.ts')))
    standalone(
      'layout-compare',
      'Maintained layout comparison evaluator',
      'eval/layout-compare/run.ts',
      ['snapshot', '--out', join(out('layout-compare'), 'snapshot.json'), '--label', 'unified-driver'],
      [],
      'Current own-quality snapshot. A before/after comparison requires a separately admitted baseline snapshot; independent Mermaid geometry is not our pixel specification.',
    )
  standalone('route-enumeration', 'Degenerate-route structural/certificate enumeration', 'eval/degenerate-etn/enumerate.ts', [])
  standalone('visual-rubric', 'Own rendering-quality invariants', 'eval/visual-rubric/run.ts', ['--out', out('visual-rubric')], [], 'Our own layout and visual rules; Mermaid rendering is not a pixel specification.')
  standalone('heuristic-tracker', 'Per-fixture layout-quality tracker', 'eval/heuristic-tracker/run.ts', [], [], 'Read-only tracker run. No baseline reset or generated baseline rewrite is requested.')
  standalone('ugly-audit', 'Own layout aesthetic diagnostics', 'eval/ugly-detector/audit.ts', [])
  if (existsSync(join(root, 'eval/benchmark/unified/pr-campaign.ts')))
    suites.push({
      id: 'prs',
      title: 'Active-PR campaign orchestration',
      kind: 'script',
      smoke: false,
      automatic: false,
      source: 'eval/benchmark/unified/pr-campaign.ts',
      command: ['bun', 'run', 'eval/benchmark/unified/pr-campaign.ts', '--run', '--out', out('prs'), '--rounds', String(options.rounds), '--profile', options.profile, '--root', options.harnessRoot],
      prerequisites: [],
      policy: 'Explicit campaign selection only; nesting this orchestrator inside the full suite would repeat the entire workload campaign. Use bench:prs for frozen-head target comparisons.',
    })
  const portableArgs = [
    'bun',
    'run',
    'eval/benchmark/portable/run.ts',
    '--project',
    options.portableProject ?? 'unconfigured',
    '--artifact-root',
    options.portableArtifactRoot ?? root,
    '--adapter',
    options.portableAdapter ?? 'pele',
    '--out',
    out('portable-community'),
    '--records',
    join(root, 'bench-report/project-records'),
    '--rounds',
    String(options.rounds),
    '--samples',
    '31',
    '--cold-samples',
    '20',
    '--allow-partial',
  ]
  if (options.portableObserver) portableArgs.push('--observer', options.portableObserver)
  if (options.communityForce) portableArgs.push('--force')
  suites.push({
    id: 'portable-community',
    title: 'Portable balanced-family, scaling, fidelity and resource qualification',
    kind: 'script',
    smoke: false,
    automatic: false,
    source: 'eval/benchmark/portable/run.ts',
    command: portableArgs,
    prerequisites: [!options.portableProject && 'Provide --portable-project', (!options.portableArtifactRoot || !existsSync(join(options.portableArtifactRoot, 'package.json'))) && 'Provide an installed --portable-artifact-root'].filter((value): value is string => !!value),
    policy: 'Explicit project artifact only; unchanged records are reused. Full calibration needs --rounds 5,31 warm sample means and20 fresh processes per replica/round/case. Paint scope and unavailable resources remain explicit.',
  })
  suites.push({
    id: 'editor-delivery',
    title: 'Observed editor request graph and export delivery',
    kind: 'script',
    smoke: false,
    source: 'eval/benchmark/editor-delivery-bench.ts',
    command: ['bun', 'run', 'eval/benchmark/editor-delivery-bench.ts', '--site', site, '--out', out('editor-delivery'), '--rounds', String(options.rounds), '--corpus', 'official'],
    prerequisites: [...siteMissing, ...browserMissing],
    policy: 'Observed local browser request/export closure and warm official-corpus output parity; not first-use family admission.',
  })
  suites.push({
    id: 'palette-performance',
    title: 'Palette generation cost and deterministic operation counts',
    kind: 'script',
    smoke: false,
    source: 'eval/palette-performance/run.ts',
    command: ['bun', 'run', 'eval/palette-performance/run.ts', '--record'],
    prerequisites: [],
    policy: 'Owning deterministic fixture matrix and shuffled warm samples; output goes to the campaign directory. No renderer speed claim.',
  })
  const modernOutside = !resolve(options.out).startsWith(resolve(root) + '/')
  suites.push({
    id: 'modern-editor',
    title: 'External Modern Mermaid application and dependency engines',
    kind: 'script',
    smoke: false,
    automatic: false,
    source: 'eval/modern-mermaid/run.mjs',
    command: ['bun', 'eval/modern-mermaid/run.mjs', options.modernEditorRoot ?? 'unconfigured', out('modern-editor')],
    prerequisites: [(!options.modernEditorRoot || !existsSync(join(options.modernEditorRoot, 'package.json'))) && 'Provide --modern-editor-root checkout', !modernOutside && 'Modern Mermaid outputs require --out outside the source repository'].filter((value): value is string => !!value),
    policy: 'Explicit external application comparison with its own frozen resume protocol; engine, app, themes and exports stay separate.',
  })
  return suites
}
