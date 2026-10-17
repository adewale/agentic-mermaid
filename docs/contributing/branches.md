# Classifying branches without losing work

Branch names, age and ahead/behind counts do not establish delivery status.
Squash merges commonly leave a merged head apparently ahead of main. Match
the exact branch-tip SHA against PR heads and inspect history before deciding.

| Category | Evidence | Disposition |
|---|---|---|
| Main | Default delivery branch | Keep; require canonical CI through repository protection. |
| Active PR | Open PR names this head | Keep while reviewed; record overlap/dependencies rather than opening duplicate work. |
| Merged PR residue | Exact head belongs to a merged PR | Deletion candidate after checking later work and retaining needed evidence. |
| Closed, unmerged residue | Exact head belongs to a closed, unmerged PR | Read the closure rationale; distinguish abandoned work from work folded into another PR. |
| Audit/evidence reference | Explicit evidence purpose, often protected | Preserve until its evidence-retention purpose is resolved. Protection is not proof of product activity. |
| Unpublished or historical head | No exact current PR match | Inspect unique commits and behavioral/patch equivalence; classify as salvage, optional idea, superseded work or evidence to preserve. |

Do not delete a branch merely because an issue is closed, its name looks old,
or `git branch --merged` omits it. `git cherry` compares individual patches,
not equivalent aggregate behavior. A reused branch name can refer to a new
open PR after an older PR merged.

Keep dated, full branch inventories in review artifacts rather than a committed
generated ledger. Record SHA, PR identity/state, evidence and recommended
disposition. Re-check tips immediately before any deletion, and request explicit
authorization for deletion separately from analysis or categorization.
