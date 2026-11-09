# Current three-way comparison

Source: parent15a7ab421 plus retained Native body-gap repair; final commit recorded in SOURCE-COMMITS.txt.

Existing original874 sources; explicit backend and fallback:none. Full SVG delivery and proof availability are distinct. No actual-ink claim follows from proof counts.

| Metric | ELK | Native | Trinity |
| --- | ---: | ---: | ---: |
| SVGs returned /874 |874|874|122|
| Unsupported /874 |0|0|752|
| Proof passed / unverified |696 /178|735 /139|122 /0|

Same labelled-star source; all return/P. Fresh Node24 fullSVG+entireReceipt, two process replicas/cell, separate import/cold/cache/edit. Medians are descriptive; raw ranges remain in CURRENT-COMPARISON.json.

| Labelled-star metric | ELK | Native | Trinity |
| --- | ---: | ---: | ---: |
|Area px²|284277.02|266271.9|261437.38|
|Written polyline wire px|3040.47|2872.45|2721.72|
|Written bends|20|22|20|
|First target ms, import separate|513.04|239.58|206.27|
|Cache0 repeat2 wall / CPU ms|91.38 / 155.64|59.57 / 89.92|42.69 / 65.47|
|Cache0 edit / edit2 wall ms|98.52 / 99.94|54.40 / 62.80|37.33 / 41.68|
|Cache1 repeat2 / edit2 wall ms|10.45 / 37.92|9.21 / 40.92|7.64 / 36.78|
|Edit2 heap snapshot MiB range|67.01–68.57|51.83–51.89|43.93–43.93|
|Process peak RSS MiB range|202.57–214.80|180.32–191.41|187.19–190.04|
|Full response gzip9 / Brotli11 bytes|3356 / 2733|3327 / 2704|3253 / 2657|

13-input actual browser product union: ELK861487gzip/691396Brotli bytes, Native489833/419873, Trinity483089/413822; requests43/49/50 including the separately listed Trident binding. Each product closure grows933gzip/727Brotli bytes versus15a7ab421, no new requests. Raw responses/offline compression do not measure compressed wire/startup.

Native201+3invisible constraints: TB and BT each66hidden→0/72attenuated→0 at3×; ELK selected pair clear; Trinity unsupported. Caption moves16.8px along route/0.5px across it; node/route/definition geometry and viewport retained. 280timed attempts in56processes retain200P/40U/40Trinity errors,240actualserializedproducts/18unique, everygzip/Br stream decodesexactly. No U→P speed ratio.

RSS includes driver/import/artifact lifetime; heap snapshots are not peaks/retention/leak proof. Original2dad baseline and equivalent pinnedPele runtime remain unavailable. Replacement24 sealed; retainELK. The existing performance review records five self/inclusive hotspots and cache inventory; no new cache or invented speedup.
