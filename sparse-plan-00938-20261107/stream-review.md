# Bounded independent review: streaming XML facts

Read-only source review of external `svg-writer-stream.ts` versus `svg-writer-before.ts`, 2026-11-07. Production was not edited. No tests, profiles or reproductions were run. The candidate changed during review: its last inspected SHA256 was `1877dfa0e3a9d0fdd9f8df93ebc4204ce3a121b78033c9284136eb2e41fdb048`.

**Do not adopt this inspected version without resolving the ordinary-attribute ambient lookup issue below.** Streaming and the private token/mask approach are reasonable, but moving mutable ambient lookups into the write changes the authority of the retained result.

## Remaining finding: ordinary duplicate checks can retain a transient ambient lie

`XmlLeafWrite.attribute` (candidate lines 336–345) now invokes `Set.prototype.has/add` while emitting each attribute. `check()` (line 386) subsequently trusts `valid` and does not repeat duplicate validation. Before this change, those lookups occurred during the deferred event check.

Concrete source-level counterexample design: arrange two ordinary attributes with the same name in one actual write (the writer has independent hook `aria-label` and accessibility `aria-label` emission sites), override `Set.prototype.has` to return false for that name only while the write runs, then restore the original method before projection/verification. The candidate retains `valid=true` and can substitute the leaf's occupied placeholder despite duplicate raw attributes. The old deferred check executes after restoration and detects the duplicate. The final envelope parser cannot recover this check once the malformed leaf has been substituted. For a prepared text leaf, the same retained validity can also permit completion marking.

This is a causal source finding at the writer/capture boundary, **not a claim that a complete public renderer exploit was reproduced**. The seven-bit prepared-attribute mask avoids this specific ambient Set dependency for those seven names; other names still use the Set. Streaming `state.name/literal` also moves mutable Map cache lookups earlier; their timing should receive the same scrutiny rather than assuming that scalar scanning alone establishes authority.

Prefer proof bookkeeping whose membership/cache operations cannot be changed by ambient hooks during emission, consistent with the existing private primitive-indexing contract. Merely restoring hooks before final verification or retaining the final envelope check does not repair a falsely accepted substituted leaf.

## Finding fixed while this review was in progress

The first candidate read used `const [field, escaped] = xml.#paintEvents[i]!` in `XmlLeafWrite.paint`. Those records are ordinary arrays, so this introduced an ambient `Array.prototype[Symbol.iterator]` call into proof projection and allowed a post-write hook to substitute paint facts. The old implementation used indexed event reads. After notification, the last inspected candidate used `event[0]` and `event[1]` instead (line 376). **That finding is resolved in the checksum identified above.** Preserve the indexed version.

## Other bounded checks

- The four private numeric tokens map through one switch to the actual emitted name and proof name. Their bypass of general name scanning is sound for these fixed literals; no caller-provided spelling is accepted through that route.
- The seven prepared-name bits are distinct and cover the same seven fixed attributes. Ordinary occurrences of those names and the prepared bundle collide in either order. Per-element reset allows legitimate same-name attributes on distinct compound children.
- Invalidity is sticky through `element`, `attribute`, `prepared` and `check`: a later element does not reset `valid` to true. Multiple prepared bundles in one element invalidate through the mask. The paint projection additionally requires exactly one prepared bundle. Recorded fields/content after a failed prepared validation cannot pass the existing validity gate.
- Under ordinary untampered built-ins, source getter order, formatting/escaping calls, CSS/paint field emission order and observer order are retained. However, additional Set/Map/work callbacks now occur between these existing reads. Do not claim full ambient/getter behavior equivalence until that interleaving is qualified; callback-visible changes to later getters are possible even apart from proof bypass.
- The fresh enclosing-document/occupied-DATA verification, write/source identity binding and original cap remain present. They do not compensate for incorrectly validated leaf facts. No new cross-call cache is introduced by this diff.

The diagnostic removed-check result is not an admissible candidate or qualification result. Sparse32 delivery/performance outcomes remain the coordinator's running experiment, not evidence produced by this review. Review stops here.
