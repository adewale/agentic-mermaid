# Mutation infrastructure local-minimum postmortem (2026-07)

**Status:** historical decision record, not a roadmap or backlog. The live
mutation policy is [`docs/mutation-testing.md`](../../mutation-testing.md), and
only the root [`TODO.md`](../../../TODO.md) schedules future work.

## Decision

The broad scheduled mutation matrix is retired. Its workflow, sharder,
mutant-set oracle, aggregate verifier, temporary-config machinery, and
orchestration tests were deleted. Broad Stryker configs remain available as
opt-in diagnostic survivor harvests without break floors. The universal
diagram-family citizenship matrix no longer requires a `mutationLane` cell.

Two bounded mechanisms remain automatic because their cost and signal are
known:

- the roughly one-minute incremental mutation gate over
  `src/agent/structural-count.ts`; and
- five behavior-specific route/link sabotage probes that must make focused
  regression tests fail.

This is not a finding that mutation testing has no value. It is a finding that
the universal recurring implementation had negative marginal value.

## What happened

| Date | Evidence | Consequence |
|---|---|---|
| 12 June | Focused ASCII and route survivor harvests found real test gaps, equivalent mutants, and dead code. | Mutation testing acquired justified local credibility. |
| 18 June | Commit `dde335b8` created a four-lane nightly workflow. Missing reports were ignored and there was no successful-run prerequisite for expansion. | A diagnostic could be red without blocking normal work. |
| 19 June | The first scheduled run was cancelled. [PR #63](https://github.com/adewale/agentic-mermaid/pull/63) proposed a measured four-shard route repair but remained open and unreviewed. | Known ownership debt accumulated outside `main`. |
| 19 June–14 July | [All 26 scheduled runs](https://github.com/adewale/agentic-mermaid/actions/workflows/nightly-route-mutation.yml) failed or were cancelled. | Persistent operational failure became background noise. |
| 10–11 July | Commits `7f264d31`, `d146adc9`, and `8f3297b5` expanded the red workflow from route checks to every diagram family. Fourteen configs shared assumed 60% floors without retained calibration. | Exact family enrollment replaced demonstrated signal as the success criterion. |
| 14 July | [Run 29309167850](https://github.com/adewale/agentic-mermaid/actions/runs/29309167850) reproduced the failure. A fail-closed repair added semantic sharding, a mutant-set oracle, aggregation, calibration, and provenance. | Correctness of the mechanism improved while its cost and necessity were still unproven. |
| 14 July | [Run 29327418603](https://github.com/adewale/agentic-mermaid/actions/runs/29327418603) completed some lanes but timed out or lost runners on others. | More orchestration was needed to sustain the universal claim. |
| 14 July | The final repair expanded to 39 coverage workers (41 jobs total); [run 29340333016](https://github.com/adewale/agentic-mermaid/actions/runs/29340333016) was cancelled and the broad infrastructure was removed. | The portfolio was reduced to bounded checks with demonstrated value. |

The red scheduled build predated [PR #163](https://github.com/adewale/agentic-mermaid/pull/163).
The 14 July scheduled failure started and finished before PR #163 merged and ran
pre-PR commit `da5ca633`; PR #163's required checks passed. PR #163 inherited
and exposed the debt; it did not create the original failure.

## Why this became a local minimum

The individual decisions were locally defensible, but their feedback loop was
not:

1. **A focused tool found real defects.** That success was generalized from
   “use mutation testing where it is discriminating” to “every family needs a
   mutation lane.”
2. **Enrollment was easier to measure than usefulness.** Exact-set citizenship
   tests could prove that every family named a config; they could not prove that
   another recurring lane would find a novel product fault.
3. **The workflow failed open.** Missing artifacts were ignored and the nightly
   result was not a required merge signal. Failure therefore did not stop scope
   growth.
4. **Documentation promoted a proxy.** Calling mutation score the “real” or
   “truer” adequacy signal turned maintenance of that number into a correctness
   obligation, even though no single metric measures suite adequacy.
5. **There was no cost budget or stop rule.** No owner had to state a maximum
   wall time, runner-minute budget, expiry, or response to repeated timeouts.
6. **Audits optimized inside the selected architecture.** They correctly found
   missing provenance, unsafe line shards, incomplete aggregation, and false
   floors. Fixing each defect made the system more internally correct but also
   more elaborate. Necessity, subtraction, and return on runner-hours were not
   part of the original audit charter.
7. **Repair became the default response.** Once effort had been invested,
   another split or verifier looked cheaper than reopening whether the broad
   schedule should exist. This was sunk-cost escalation, not evidence that the
   next shard would create user value.
8. **Unowned work stayed parallel.** PR #63 demonstrated that the timeout was
   known, but it received no review and never landed. Meanwhile `main` expanded
   the same workflow, increasing the cost of adopting or replacing that repair.

The surrounding accidental-merge correction amplified the completeness frame:
parity, exact enrollment, and multi-agent audit closure were being pursued
across the system at once. That context made a comprehensive mutation repair
feel consistent. It was not the technical cause of the failures, and it should
not be used to erase the independently useful correctness work in PR #163.

## Counterfactual

After the third consecutive failed schedule, the workflow should have been
disabled pending one complete retained run. New family configs could still have
existed for deliberate local harvests. A recurring lane should only have been
re-enabled after demonstrating a fault class, runtime, floor, owner, and budget.

That path would have preserved every useful mutation discovery without building
an orchestration platform around an unproven universal requirement.

## Durable lessons

- Quality portfolios are outcome-based: diagram-family parity does not require
  every family to use the same testing technique.
- A diagnostic that is red for three scheduled runs must be fixed, narrowed,
  disabled, or deleted before it gains scope.
- Recurring checks need a complete retained baseline, a demonstrated fault
  class, a runner-minute budget, an owner, and a removal criterion.
- Repeating expensive analysis on unchanged relevant inputs adds cost, not
  evidence.
- Broad audits must ask what can be deleted, whether the work can stop now, and
  what ongoing operational surface each fix creates.
- Generated matrices, test counts, assertion counts, coverage, and mutation
  scores are instruments. None is a substitute for behavioral correctness or
  external use.

These are policy constraints, not work items. Any future implementation belongs
in `TODO.md` and must make its own value case.
