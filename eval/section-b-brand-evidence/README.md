# Section B visual evidence

The reviewed golden is `src/__tests__/testdata/section-b-brand-evidence.png`.
It renders every registered family through the public native PNG API, using
one sentinel and three inline StyleSpec variants.

Run `bun run gallery:section-b` to create a candidate. Inspect the family cells
at native size before accepting a changed golden. The owning test regenerates
the PNG in memory and byte-compares it with the reviewed image; it also renders
the sentinel through the default, rough and hybrid SVG/PNG backends.

The pre-Section-B commit `e60be1e68b5aa51fac205c7cf9e481ea3b27ffc8`
rejects `roles` in the preserved `baseline.mmd`/`role-style.json` inputs.
The review records in this directory describe their recorded revisions and
bytes. They are historical context, not an approval gate for current changes.
