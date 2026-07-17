# Twenty-eight red runs: a forensic post-mortem of the nightly mutation matrix

**Status:** historical decision record, companion to
[`mutation-infrastructure-postmortem-2026-07.md`](./mutation-infrastructure-postmortem-2026-07.md).
That document records the retirement decision and its policy consequences.
This one reconstructs the failure from primary evidence — all 28 workflow
runs at job level, the commits that built and expanded the matrix, the
guidance that inspired it, and the published research that predicted the
outcome — and answers two questions the first post-mortem left open: where
exactly did the program go wrong, and was the upstream testing guidance at
fault?

**Evidence base:** the GitHub Actions run and job records for
`nightly-route-mutation.yml` (28 runs, 2026-06-19 to 2026-07-14), job logs
for runs 1, 14, and 26, the full git history including the deleted workflow
and the abandoned repair branch `agent/fix-nightly-mutation-build`, PRs #63,
#79, and #169, issue #35, the
[`adewale/testing-best-practices`](https://github.com/adewale/testing-best-practices)
skill at the commit this repo's docs pin (`e5047992`), and the primary
literature cited in §6. Three claims below rest on inference rather than
direct observation; all three are marked and listed again in §7.

## 1. What the record shows

The scheduled workflow never had a green run: 28 runs, zero successes.
But "zero successes" flattens three different failures that hid under the
same red X, and each one called for a different response.

**Failure A — capacity.** The broad `routes` lane carried about 165 minutes
of single-machine work (measured in PR #63) under a 90-minute job timeout.
It was cancelled at that cap on the first night and on every night
inspected job-by-job afterward. This lane could never have finished; it was
dead on arrival, and one manually dispatched run before scheduling would
have shown that.

**Failure B — policy.** During the 10–11 July expansion,
`thresholds.break: 60` floors appeared on fourteen Stryker configs whose
scores had never been measured in CI. On the final scheduled night the
`er` lane completed a full 24-minute, 1,889-mutant measurement, uploaded
its 1.0 MB report, and exited 1 because 30.17 is less than 60. Four more
family lanes (class, sequence, pie, quadrant) failed that night after
running 29–75 minutes each; the `er` log shows the floor mechanism
directly, and the durations of the other four are consistent with it
(inference — their logs were not pulled). The
floor on the `routes` config itself was 60% although the lane's recorded
scores were 50.69% (`docs/mutation-testing.md`, commit `526d9cf`) and
~54.5% (PR #63's complete sharded run): even a night where that lane
finished would have been declared a failure.

**Failure C — staleness, the one true signal.** On 2 July the
`sabotage-routes` probe "downgraded detours cannot keep stale straightened
metadata" stopped biting: the injected one-line fault applied cleanly and
`route-contracts.test.ts` passed anyway, because the 1 July layout-pipeline
rework (PRs #79, #84, #86) had made the probe's mutation a no-op on its
fixture. This is precisely the event the sabotage suite exists to detect —
a seeded fault that the tests no longer catch — and it fired truthfully. It
also flipped the workflow's nightly conclusion from `cancelled` to
`failure`, a visible state change in the Actions UI. The probe stayed red
for thirteen consecutive scheduled nights, through retirement day, when
PR #169 recalibrated it in a single hunk to inject the impossible state
unconditionally.

The measurement machinery, in other words, mostly worked. The lanes that
fit their timeouts produced reports every night (`route-certificates` in
3–6 minutes, `subgraph-routing` in under a minute, `mindmap` and `gitgraph`
in about 3 minutes each on 14 July). What failed was everything around the
measurement: capacity planning, threshold calibration, and — fatally —
anyone reading the results.

## 2. Timeline

Times are from the Actions API (UTC) and commit metadata (+0100 where
shown).

- **12–16 June.** Focused survivor harvests on the ASCII and route cores
  find real test gaps, dead code, and one falsified audit assumption;
  `route-contracts.ts` goes 58.1% → 73.1% over three batches. Family
  Stryker configs are created 16 June (`da4ede0d`) with **no** thresholds.
- **18 June, 02:16.** Commit `dde335b8` ("Harden layout closure
  follow-ups", 33 files) adds `nightly-route-mutation.yml` as a
  side-change: four lanes, cron `17 3 * * *`, no backlog entry, no owner,
  no completed reference run. The `routes` lane gets `timeout: 90`.
- **19 June, 08:41.** Run 1: `subgraph-routing` passes in 51 s, `sabotage`
  in 17 s, `route-certificates` in 6 m 28 s; `routes` is cancelled at
  90 m 15 s. Every scheduled night for the next two weeks repeats this
  shape.
- **19 June, 23:45.** PR #63 opens: it measures the routes lane at 165
  minutes of work, shards it four ways by mutant density, and harvests
  survivors. It correctly diagnoses and fixes Failure A within 24 hours of
  the first red run. It will wait 25 days without review.
- **20 June, 12:31.** Commit `52838af7` writes into
  `docs/testing-strategy.md`: "The mutation score is the truer number; it
  just runs less often." The scheduled lane that would compute that number
  has at this point failed once and succeeded never.
- **19 June – 1 July.** Runs 1–13, all `cancelled` at the routes cap.
  (Job-level data was pulled for run 1; the uniform ~90-minute run
  durations of runs 2–13 are consistent with the same single cause —
  inference, not observed per-job.)
- **1 July.** The pass-manifest rework lands (#79, with #84 and #86 shortly
  after midnight). Issue #35's thread notes the same day that the two real
  route bugs #79 fixed were *topological* — reachable only through specific
  graph shapes, invisible to line-level mutants, and now pinned by two
  property generators (22/500 and 60/60 discriminating cases).
- **2 July, 06:51.** Run 14: the sabotage probe goes no-op (Failure C) and
  the nightly conclusion changes from `cancelled` to `failure`. Nobody
  responds. From here to 13 July only four lanes exist and
  `route-certificates` and `subgraph-routing` demonstrably pass on the
  nights inspected, so the failing job each night is the sabotage probe
  (inference for runs 15–25; observed directly on runs 14 and 26).
- **10–11 July.** With 21 consecutive red runs behind it, the matrix
  expands: `7f264d31` adds journey and families lanes; `d146adc9` adds
  per-family lanes and break floors (the routes floor verifiably arrives
  in this commit; all fourteen `break: 60` entries are in place by the
  final scheduled run); `8f3297b5` completes "family elevation". The
  citizenship test now fails CI for any family without a named
  `mutationLane` config. Enrollment is enforced by test; value is not.
- **14 July, 05:40.** Run 26, the last scheduled night, 16 jobs: six pass,
  four are cancelled at their caps (`routes` 90 m, `state` 90 m, `gantt`
  120 m, `families` 125 m), five fail their uncalibrated floors after
  completing real measurements, and sabotage fails in 23 seconds. The night
  consumes roughly 659 job-minutes — eleven runner-hours — and retains
  nothing.
- **14 July, 11:01 and 14:19.** Two manual runs of the fail-closed repair
  branch: a plan job derives 39 source-relative shards (41 jobs,
  max-parallel 12, per-shard `break: 0`, aggregate verification after
  joining). Architecturally sounder than everything before it — and
  cancelled at 3 h 13 m and 1 h 48 m. The repair had become an
  orchestration platform for a measurement nobody had used in four weeks.
- **14 July, 17:27–17:49.** PR #169 retires the whole scheduled surface,
  deletes the floors from every config except the calibrated incremental
  gate, removes `mutationLane` from citizenship, fixes the stale sabotage
  probe, and lands the first post-mortem. PR #63 is closed unmerged one
  minute after #169 opens.

Total spend on the routes lane alone, at its cap across 26 scheduled
nights: roughly 39 runner-hours, producing zero retained scores.

## 3. Where it actually went wrong

The retirement post-mortem describes a local-minimum feedback loop. The
run-level record sharpens that into five specific moments, each of which
had a cheap, available alternative.

**Moment 1 — 18 June: institutionalizing before measuring.** The workflow
was born inside an unrelated 33-file commit, with no owner, no budget, and
a headline lane that could not finish inside its own timeout. A single
`workflow_dispatch` run before merging would have exposed Failure A the
same day. The program never recovered from skipping this step, because
every later decision inherited a workflow that had never once been seen
working.

**Moment 2 — 20 June: promoting the proxy while it was already red.**
"The mutation score is the truer number" entered the docs one day after
the first cancelled run. The citations behind that sentence are real
(§6 returns to the load-bearing one), but neither says what the sentence
says: a correlation between
mutant detection and fault detection does not make the score a number
whose maintenance is a correctness obligation. Once the doctrine existed,
a falling score read as a quality debt (issue #35 is exactly this), and an
unrunnable score lane read as infrastructure worth any repair cost.

**Moment 3 — 19 June to 14 July: the orphaned fix.** PR #63 solved
Failure A on day one. It sat unreviewed for 25 days while `main` tripled
the mutation surface, then was closed unmerged. This is the clearest
governance failure in the record: the constraint was not knowledge (the
diagnosis was written down within 24 hours) but review bandwidth — the
repo's agent sessions generated repair work faster than its one human
reviewed it, and work not on `main` was invisible to the sessions
expanding `main`.

**Moment 4 — 2 July: the true positive nobody read.** The sabotage no-op
was the only genuinely new information the scheduled system ever produced:
a previously-fixed bug class was no longer covered by a biting test. The
signal even changed the workflow's conclusion state. Because the workflow
had been red every night of its life, was fail-open (blocked nothing),
and notified no one, a change in *why* it was red was indistinguishable
from noise. Alarm fatigue is usually described as a human factor; here it
was structural — there was no channel through which any red, old or new,
reached a person.

**Moment 5 — 10–11 July: enforcing enrollment instead of testing value.**
The expansion added fourteen floors with no measured basis (the `er`
config had shipped floorless on 16 June; by the final scheduled run all
fourteen carried the same 60, including one under a lane whose recorded
score was ten points lower). The citizenship test
could prove every family named a config; no test could prove any lane had
ever found a fault worth its runner-minutes — and none had been asked to.
Measured against the guidance this repo already cited, the floors were the
moment the score stopped being an instrument (§5).

One sentence for the whole arc: because the diagnostic became an
institution before it had produced a single institutional-grade result,
every later hour of effort went into maintaining the institution.

## 4. What the program cost and what it returned

Costs that the record supports: ~39 runner-hours on the routes lane alone;
~11 runner-hours on the final scheduled night; two multi-hour cancelled
repair runs; the design, audit, and orchestration work across `dde335b8`,
the expansion commits, PR #63, and the repair branch; and 25 days of a
standing red signal that made this workflow's failure state unremarkable
— the condition that buried Failure C.

Returns: the June focused harvests (which predate and did not need the
scheduler) found real gaps, dead code, and a falsified audit assumption;
the 14 July night produced completed family measurements whose only use
was to fail their floors; and the sabotage lane produced one true positive
that was read twelve days late. Nothing the scheduled system produced in
28 runs changed a line of product code while the system lived.

## 5. Was `testing-best-practices` at fault?

Mostly no — the program contradicted the guidance it descended from on
every operative axis. Partly yes — three specific properties of the
guidance lowered the activation energy for the failure, and one of them is
worth fixing upstream.

What the skill actually prescribes (quotes from
`references/mutation-testing.md` and `references/test-types.md` at
`e5047992`):

- "Focus on critical modules, not the whole codebase." The repo enrolled
  every diagram family by CI-enforced citizenship.
- Mutation testing is Tier 3, "Use With Caution", "Costs: 10-100x test
  runtime. Requires interpretation." The repo made it a nightly
  fourteen-lane matrix.
- "Make coverage informational, not blocking" (antipattern #10 — stated
  for coverage, and the skill nowhere licenses score floors for mutation
  either; no threshold number appears anywhere in it). The repo added
  fourteen blocking floors.
- "Do not give every artifact the same test plan" (SKILL.md). The
  citizenship matrix required exactly that.

So the program failed by contradicting its guidance rather than by
following it. The repo's own docs
even applied the guidance correctly where they engaged with it directly —
`docs/design/families/gantt.md` asks for "targeted mutation runs for the
date resolver", which is the focused pattern.

The three genuine weaknesses:

1. **"Run nightly or weekly" names a cadence, not a contract.** The line
   exists to keep mutation off the per-commit path, but it is the only
   operational sentence in the reference, so "nightly" was implemented as
   *cron and forget*. The guidance says nothing about a completed baseline
   before scheduling, notification, fail-open versus fail-closed, budgets,
   or a stop rule after repeated failures. Every one of those absences
   became a load-bearing defect between 18 June and 14 July.
2. **"80% mutation score with 70% coverage > 95% coverage with 50%
   mutation score" ranks suites by score.** As a one-line corrective to
   coverage worship it is fine; read by an agent building policy, it is
   one small step from "the mutation score is the truer number" — the
   sentence this repo wrote on 20 June. A comparative claim about signals
   became a maintenance obligation on a number, which is the precise
   mechanism Strathern compressed to "when a measure becomes a target, it
   ceases to be a good measure" (§6).
3. **The shipped skill never mentions equivalent mutants.** The caveat
   exists only in the repo's non-shipping research notes. An agent working
   from the skill has no principled reason to believe a mutation score has
   a structural ceiling below 100% — and without that, any floor looks
   safe to assume. This is the cheapest upstream fix of the three.

A general observation sits under all three: guidance written for human
practitioners travels with tacit context — a human who reads "run
nightly" also knows to look at the results. Guidance consumed by agents
is executed to the letter at high speed and volume, so its letters need
the operational context spelled out. The skill's own design philosophy
("choose the smallest useful test tier", "load only relevant references")
already points this way; the mutation reference just never got the
operational paragraph.

## 6. What the literature already knew

Everything above was predicted in print. Sources verified against the
papers themselves.

**Mutation score has a measured ceiling on real faults.** Just et al.,
"Are Mutants a Valid Substitute for Real Faults in Software Testing?"
(FSE 2014, DOI 10.1145/2635868.2635929), studied 357 real faults across
five Java systems: mutant detection correlates with real-fault detection
independently of coverage — the finding this repo's docs cited correctly —
but 27% of real faults were not coupled to mutants from common operators,
and 17% were "not coupled to any mutants", "mostly involving algorithmic
changes or code deletion", which the authors call "a fundamental
limitation of mutation analysis". This repo re-derived that limitation
empirically: the two `edgeThroughNode` bugs of PR #79 were
algorithm-shaped, invisible to line mutants at any score, and were caught
by property-based topology generators instead. That division of labor has
published support from the other side too — in the largest empirical
evaluation of property-based testing to date, each property test killed
about 50 times as many mutants as the average unit test (Ravi & Coblenz,
OOPSLA 2025, DOI 10.1145/3764068) — so the properties that catch what
mutants cannot represent also tend to kill the mutants themselves.

There is also a footnote in the doctrine's own sourcing. The coverage
citation in the "truer number" sentence — Inozemtseva & Holmes, "Coverage
Is Not Strongly Correlated with Test Suite Effectiveness" (ICSE 2014) —
says in its abstract that coverage "should not be used as a quality
target because it is not a good indicator of test suite effectiveness".
The paper's lesson is about *targets*, and it transfers to any adequacy
number. The sentence borrowed the paper's authority to rank one score
above another, then did to the mutation score exactly what the paper
warned against doing to coverage.

**The score itself is weaker than the doctrine assumed, and its ceiling
is unknowable.** Papadakis, Shin, Yoo & Bae (ICSE 2018,
DOI 10.1145/3180155.3180183) found that "all correlations between mutation
scores and real fault detection are weak when controlling for test suite
size", concluding that "mutants provide good guidance for improving the
fault detection of test suites, but their correlation with fault detection
are weak". On the floor question:
program equivalence is undecidable (Budd & Angluin, Acta Informatica 18,
1982), so no tool can tell which survivors are killable; Schuler & Zeller
(STVR 23(5), 2013) manually classified survivors in seven Java programs
and found "about 45% of all undetected mutants turned out to be
equivalent", at "about 15 min per mutation" of classification effort; and
the Papadakis et al. survey (Advances in Computers 112, 2019) estimates
that "only few of the mutants produced (approximately 5%) is practically
useful. The rest is noise to the process with severe consequences." A
fixed floor treats every survivor as a test gap. The literature says an
unknowable, often large fraction of survivors is noise — which is why
`er`'s 30.17% was not evidence of 70% missing tests, and why a floor
copied onto fourteen lanes without per-lane classification work was
arbitrary rather than conservative.

**The one at-scale success story refuses to do what this repo did.**
Google's system (Petrović & Ivanković, ICSE-SEIP 2018,
DOI 10.1145/3183519.3183521; Petrović, Ivanković, Fraser & Just, IEEE TSE,
DOI 10.1109/TSE.2021.3107634) mutates only changed, covered, non-arid
lines during code review, at most one mutant per line, capped per file,
and surfaces results as review findings. It computes no codebase mutation
score — "we were also unable to find a good way to surface it to the
developers in an actionable way, as it is neither concrete nor actionable,
and it does not guide testing" — and it invests continuously in
suppression because "presenting hundreds of mutants, most of which are not
actionable, to a developer would almost certainly result in that developer
abandoning mutation testing altogether". Their initial deployment saw 85%
of reported mutants judged unproductive; years of feedback-driven
suppression raised the productive fraction to 89%. The through-line of
both papers is that mutation testing at scale is an attention-budget
problem before it is a compute problem. The nightly matrix inverted every
one of these choices: whole-module sweeps over unchanged code, scores as
the product, results in artifacts nobody opened.

**Meta reached the same conclusion from the other direction.** Beller et
al. (ICSE-SEIP 2021, arXiv:2010.13464): "At industrial systems the scale
and size of Facebook's, doing this is infeasible. We should not create
mutants that the test suite would likely fail on or that give no
actionable signal to developers." Meta's later ACH system
(arXiv:2501.12862) generates "relatively few mutants... specific to an
issue of concern" — mutation as a targeted question, not a standing
census.

**The tool authors described this failure before it happened.** Henry
Coles, author of PIT, wrote in 2021 ("Don't let your code dry",
blog.pitest.org): "Typically, if the analysis is run overnight, this
doesn't happen in a meaningful fashion. The results are largely forgotten
and ignored." On score gates: "Pitest supports this because so many people
asked for it, but it is not something I ever use myself... It doesn't
really solve the problem, and can actually make things worse." PIT's own
threshold documentation warns that "your build may contain equivalent
mutations. Careful thought must therefore be given when selecting a
threshold." And StrykerJS — the tool this repo ran — ships with
`thresholds.break: null`: "Set break to null (default) to never let your
build fail." The fourteen floors of the July expansion were an opt-in against the
tool's own default, added without the measured history its documentation
asks for. The Stryker team's stated CI practice for developing StrykerJS
itself is incremental mode on changed code plus an occasional full run —
the changed-code pattern again, from the maintainers of the exact tool.

**The proxy failure has a name and a fifty-year paper trail.** Goodhart
(1975): "Any observed statistical regularity will tend to collapse once
pressure is placed upon it for control purposes." Campbell (1979) said the
same of any quantitative social indicator used for decision-making.
Strathern (1997, European Review 5(3), p. 308) gave it the modern form
quoted in §3. The accounting literature calls the mechanism *surrogation*
— substituting the measure for the construct it proxies (Choi, Hecht &
Tayler, The Accounting Review 87(4), 2012). "The mutation score is the
truer number" is surrogation in seven words: the score replaced
test-suite adequacy as the thing being managed, at which point restoring
the number (issue #35's stated goal) became indistinguishable from
improving the tests.

## 7. What this record cannot show

Job-level evidence was pulled for three of the 28 runs; the three
inferences that fill the gaps — the cause of runs 2–13, the failing job in
runs 15–25, and the floor mechanism behind four of the five family
failures on 14 July — are marked where they appear. Runner-hour figures
are sums of job durations, not billed minutes. Nothing in the record shows
whether anyone opened the Actions tab between 19 June and 14 July — only
that no commit, issue, or PR reacted to the red state before 14 July, and
that the one artifact which did react (PR #63) predates all but the first
failure. Intent is out of scope throughout: the commits record actions and
their timing, and this document does not claim to know what anyone
believed while taking them.

## 8. What transfers

The retirement post-mortem's stop rules stand. This deeper record supports
four additions, each tied to a specific failure above:

- **No schedule without a witnessed completion.** A recurring diagnostic
  must have one complete, retained run — dispatched manually, on the
  target infrastructure — before it gets a cron line (Moment 1; would have
  caught the 165-min/90-min mismatch on 18 June).
- **Separate "measurement failed" from "measurement below target".** A
  lane that completes and reports must not exit like a lane that crashed
  or timed out. The repair branch had this right (per-shard `break: 0`,
  judgment applied after aggregation); the retirement kept floors only
  where a measured history justifies them. Floors come from baselines, not
  from round numbers (Failure B).
- **A scheduled diagnostic that cannot page someone is a write-only log.**
  Fail-open plus no notification meant thirteen nights of a true positive
  (Failure C). Either the signal blocks something, or it notifies someone,
  or it should not run on a schedule at all.
- **Review the fix before expanding the surface.** New scope on a red
  diagnostic while its known repair sits unreviewed is the exact shape of
  Moments 3 and 5. The existing three-failures stop rule covers the red
  part; this adds the converse: an open PR that fixes a failing diagnostic
  outranks any PR that grows it.

The sabotage probe is the right closing image for future readers, because
it is the whole program in one job: a 23-second check that did exactly
what it was designed to do, on schedule, for thirteen nights, in a system
that had lost the ability to hear it. The lesson of June–July 2026 is not
that mutation testing failed here — the focused harvests that started this
program remain some of the best test-quality work in the repo's history.
It is that a measurement only becomes information when a decision is
waiting for it, and every runner-hour spent producing scores nobody was
waiting for was spent turning a good instrument into background noise.
