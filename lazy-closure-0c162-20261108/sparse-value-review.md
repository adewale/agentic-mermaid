# Sparse32 causal scope/value review

Read-only review at `0c162c446b58ad98d0a5550719592a0d868619f8`, 2026-11-08. Inspected `svg-writer.ts`, `native-paint-emission.ts`, the existing Sparse32 fixture, deferred-token candidate and recorded count-only receipts/SVG/profile data. No source edits, tests, builds, profiling runs or new agents.

**Recommendation: stop this bounded XML-replay/paint-sharing line. I cannot identify one sufficiently small safe subtraction with evidence of the required saving. Do not adopt the token-only candidate for a Sparse32 recovery it does not deliver, and do not revive eager streaming.** This is a scope/value decision, not a claim that Sparse32 can never be optimized.

## Quantified target

Recorded `count-only-before/repeat1.receipt.json.gz` reports 450,245 emission operations; token diagnostic reports 421,715. With the coordinator's approximately 13,318 additional final-proof work, the deficits are respectively **63,563** and **35,033** operations. The token trial removes 28,530 counted operations and still falls short. Count-only diagnostics relax emission accounting to expose required work; neither is an admissible public proof/pass.

## Why sharing paint projection does not address this witness

`paint-certification.test.ts:65–78` creates 1,500 labels with own `paint: { fill: '#111' }`, the same prepared block and varying y positions. The recorded SVG confirms 1,500 single-line prepared `x` labels with four ordinary attributes (`text-anchor`, `font-size`, `font-weight`, `fill`) plus the prepared bundle.

`native-paint-emission.ts:624–639` calls `readSvgTextPaintWrite` only when inherited paint is detected. These ordinary own-paint labels do not select that branch. Consequently `XmlLeafWrite.paint` is not a second full event replay paid for these labels. Combining its lexical checks with `check()` may improve an inherited-paint witness, but it has no demonstrated saving on the current Sparse32 failure. Issuing a possible paint fact at write time must not be confused with actually projecting its paint.

Each such label records only six XML events: one element, four attributes and one prepared bundle. The deferred event loop pays two operations per event. Even the impossible best case of deleting that entire dispatch cost without replacement saves only **6 × 2 × 1,500 = 18,000**, about half the post-token deficit. Removing the separate one-operation `check()` entry adds 1,500, still insufficient. This bound covers dispatch overhead, not legitimate lexical, duplicate-name, prepared-bundle or closure obligations; those cannot simply be zeroed.

## Existing reuse already removes the obvious lexical repetition

`createSvgXmlCapture` already retains per-capture name and literal results (`svg-writer.ts:143–182`), separating attribute/text grammars. Repeated successful scalar scans are not performed afresh for every label. Prepared fixed names/values are also checked once through `preparedChecked`. The distinct emitted y strings still require validation, including the actual bytes produced by formatting. A source block or nominal numeric input cannot authorize skipping that validation when ambient formatting/escaping behavior is part of the contract.

Reusing a successful check on the same actual write is already supported by `projectFact` replacing its deferred projection with the completed projection. Sharing lexical facts with paint would additionally need to preserve paint's stricter restrictions (unescaped paint values, no embedded markup), multi-prepared rejection and completion status. Those obligations are not interchangeable with XML-literal validity, and they are not the source of the current witness's work deficit.

## What the profiles do and do not justify

Both recorded profiles contain substantial `copyInner`/`materializeText` sampling. This suggests that XML event dispatch is not the sole runtime cost. It does **not** give a work-ledger saving estimate or authorize eliminating fresh occurrence copies. `materializeText` deliberately creates fresh receiver objects and performs the original observable definitions; source reflection is already reused through its private plan. Sharing the materialized object or skipping definitions would change the getter/prototype/definition contract the task explicitly preserves.

There is no measured attribution here identifying at least 35,033 additional removable operations within one safe change. Therefore another replay-fusion implementation would be speculative. Keep the original caps, Sparse32 refusal and existing delivery improvements explicit; spend no more implementation effort on this particular hypothesis without new causal work attribution. The stopped eager-stream change remains inadmissible because it moved authority-sensitive checks across ambient mutations.
