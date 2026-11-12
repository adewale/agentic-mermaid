# GitGraph routing and gantt ink review

Candidate: `src/__tests__/testdata/section-b-brand-evidence.png`, sha256 `685f0752f06676d020903eed66883040f11a5f4bd20e23b12273b4e7a50547ef`.

Ten changed row bands, all in two cells per variant; every other cell is
pixel-identical to the previous approved sheet (`fb51685f…`).

- **GitGraph** (four variants): the `work` → `merge` connector previously
  rose at `release`'s column and ran through that commit, which read as
  `work` merging before `release`. It now branches beside `base`, runs along
  the empty `work` lane and bends beside `merge` (the F15 routing rule in
  `src/gitgraph/layout.ts`). Commit positions, labels and lane colours are
  unchanged.
- **Gantt** (four variants): task bars keep their geometry; only bar fill and
  outline ink changed to the resolved gantt ink (G2).

Old and current crops of each band were compared at native size. This finite
agent review is not human approval, deployed-site parity or exhaustive
geometry proof.
