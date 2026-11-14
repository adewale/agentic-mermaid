# Unqualified typed-group rework checkpoint

This is recovery evidence for work in progress on existing PR602. The source
branch still points to `4cddae30548df1adf0ea1908c88454fae3bcb36d`; this checkpoint
does not publish a verified runtime milestone or claim that Chain300 is fixed.

The owner requested restoration of Chain300 proof under the unchanged cap,
removal of shared Native/ELK overhead, and retention of the demonstrated
correctness and horizontal-layout gains. The first structural step replaces
generated group-string assembly and reparsing with ordered escaped attributes
at the original producer read points. Raw group and generic Scene paths remain.

The owning test extends the existing public proof-capacity table to Chain300
for both engines. It fails on the original runtime because the proof is
unverified. A passing result must retain the 400,000-operation/100,000-pair caps,
902 primitives, 899 measured regions, 300 prepared texts, no conditional regions,
299 checked markers and completed occlusion-pair work.

The executed refinement made four untimed public source calls: Chain100 and
Chain300, each with Native and ELK. All four SVGs are byte-exact to the qualified
4cdd build. Chain100 still passes with its context clear, 99 markers and 814 pairs;
operations fall from 238,786 to 230,586. Chain300 reaches 899 measured regions and
zero conditional entries, but both engines still exhaust 400,000 operations with
zero completed markers/pairs. Its proof also retains OUTPUT_SCOPE uncertainty;
this partial stage is not acceptance evidence for the complete rework.

Observed Native Chain300 producer work is 351,415 operations;
after composition it is 354,432. The diagnostic before-inspection
injection did not run because of its ASI placement, so no before-inspection value
is inferred. These are work counters, not runtime or speedup measurements.

`SOURCE.patch` reconstructs all five source files listed in `SNAPSHOT.json` from
the immutable base; that reconstruction was checked against every listed hash.
The four compressed products, reduced outcomes, diagnostic driver and original
owning-test failure log are included. Full source files are omitted because the
base and patch recover them. Initial setup/type iterations and the superseded
logical-attribute pilot remain local. Existing core types passed for this stage;
canonical builds, broad contracts, final ink checks and cost qualification are
still pending. A separate primitive connector representation and actual-resource
handoff are being developed; they are not part of this snapshot.

This selected checkpoint excludes the previously blocked profile, related audit
and historical archive. It is not a full environment backup. No new source
commit, backend, cache, cap, default, version or proof waiver is included.
