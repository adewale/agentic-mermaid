# GitGraph origins, uses, and visual-design implications

Research receipt for PR #149. Historical claims are separated from design recommendations.

## Historical foundation

Git was created in 2005 for Linux kernel development ([Pro Git: short history](https://git-scm.com/book/en/v2/Getting-Started-A-Short-History-of-Git)). A commit stores a snapshot plus zero or more parent commit IDs; following those parents forms a directed acyclic history ([Git objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)). Branches and tags are movable references to commits rather than ownership containers ([branches](https://git-scm.com/book/en/v2/Git-Branching-Branches-in-a-Nutshell), [tags](https://git-scm.com/docs/git-tag)). A merge commit has multiple parents.

**Renderer consequence:** parent edges are the source of truth. Lane position and color aid tracking but may never invent ancestry. Merge convergence must expose its parent endpoints; branch labels should read as references, not permanent boxes around commits.

## Terminal graph convention

[`git log --graph`](https://git-scm.com/docs/git-log#Documentation/git-log.txt---graph) draws topology to the left of log text and may insert connector-only rows. It uses topological ordering by default because flattening branches makes unrelated commits appear consecutive. Git's lane limit uses an explicit `~` truncation marker rather than silently dropping lanes ([rev-list options](https://github.com/git/git/blob/master/Documentation/rev-list-options.adoc#L1247-L1270)).

**Renderer consequence:** preserve stable parallel lanes, commit marks, forks, and explicit convergence. Connector-only space is legitimate. Under terminal pressure, reduce secondary labels before topology; any omitted lane must be named.

## Mermaid GitGraph

Mermaid describes GitGraph as a pictorial representation of commits and Git actions, especially for explaining branching strategies and Git flow ([syntax](https://mermaid.js.org/syntax/gitgraph.html)). Statements replay state in authored order: `commit`, `branch`, `checkout`, `merge`, and `cherry-pick`. Its implementation retains current branch, branch order, commits, and parents ([AST](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/git/gitGraphAst.ts)) and supports LR/TB/BT directions, branch ordering, optional parallel commits, labels, tags, and typed marks ([renderer](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/git/gitGraphRenderer.ts)). Mermaid recommends rotated labels when they avoid collisions and horizontal labels for short content.

Mermaid also includes an imaginary railroad example with `MetroLine1` and interchange merges. This is an official domain-transfer analogy, not evidence that Git graphs historically originated in metro maps.

**Renderer consequence:** use metro-map discipline—stable colored rails, restrained bends, offset labels, and unmistakable junctions—but only a parent relation may create a merge. A geometric crossing is not ancestry; a cherry-pick is a copied change, not an ordinary parent edge.

## Common uses

- **Branching strategy and Gitflow:** feature, release, and hotfix divergence/rejoin ([original Gitflow article](https://nvie.com/posts/a-successful-git-branching-model/)). Gitflow is one recognizable workflow, not a universal default.
- **Releases:** tags name important commits and need compact, high-salience badges.
- **Backports:** [`git cherry-pick`](https://git-scm.com/docs/git-cherry-pick) applies changes from an existing commit; merge cherry-picks require a selected mainline parent. The destination commit and source annotation must remain distinguishable from parent ancestry.
- **CI/CD promotion:** build, staging, canary, and production lanes communicate branch-based delivery ([GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow)).
- **Teaching:** Pro Git uses commit graphs to explain pointers, divergence, merging, and rebasing; simple histories need a low-noise presentation.

## Adopted visual hierarchy

1. Topology and replay order remain strongest.
2. Authored branch order produces stable, distinct colored rails.
3. Normal commits inherit a light branch tint; typed commits retain distinctive marks.
4. Branch names, commit messages, and tags remain separate channels.
5. Labels and tags receive contrast-preserving backplates; tags use compact badges.
6. Chronological spacing expands deterministically from measured rotated-label and tag bounds.
7. Dense evidence is shown at a readable scale rather than squeezed into a two-column thumbnail.
8. Color is redundant with branch names, commit IDs, parent lists, tags, and typed marks.
9. Identical input/config preserves lane assignment, packing, and bytes.

## Quality gates used

The existing quality system already provided useful foundations: `family-rubric.ts` catches overlap/off-canvas failures, `visual-quality.ts` reports area fill/aspect/label risk, the heuristic tracker ratchets family scores, and `eval/overlap-audit` checks final SVG text and primitive collisions. The audit had one material blind spot: it skipped arbitrary text rotations, including GitGraph's 45° labels. PR #149 closes that gap with generic rotated-corner bounds and gates every real-content GitGraph at zero overlap findings.
