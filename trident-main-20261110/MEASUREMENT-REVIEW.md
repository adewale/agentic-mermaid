# Independent reporting review

The existing independent reviewer inspected collectors and report reduction
without running any renderer or timing job. The original review found no
unequal artifact/options/cache/cold-barrier boundary between arms. It noted
that authored edits can rename identities; all reporting uses that scope.

Before the full-receipt measurement phase, the coordinator removed the extra
receipt serialization from the clock and disabled the inspector session for
profile:false. Only one entire-response JSON serialization and UTF8 count is
measured. Receipt evidence encoding stays outside the clock; no empty profile
files are emitted. Both earlier smoke observations are retained and excluded.

The final report review identified three corrections, all applied before the
receipt collector was launched:

- Expected acceptance alone did not make a successful-layout timing cell.
  Reduction now records actual acceptance/status and suppresses observed
  layout percentages for the failing fontSize configuration input or other
  actual failure/mixed cells. Their execution costs remain in the raw results.
- Two failed products could compare undefined===undefined and appear equal.
  Repeat/receipt exactness and edited-output change now require both products;
  otherwise the observation is unavailable.
- Declared paint-check completion was too broad a label for the eight
  family/labels-only supplements. The report states their deeper visible
  structure remains untested even when enrolled paint checks pass.

The reviewer otherwise found the pooled adaptive-mean p95, proof availability,
shared-renderer family attribution and cold-closure/portfolio limitations
properly separated. No production change or acceptance gate was requested.
