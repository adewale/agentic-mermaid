# Native and ELK: frozen PR versus Main

Main `4260292397d4bca7624a30c34649eb943a5f8e0c`; PR `599bee58db7cb54293866cc8aa86c887ef93e9a4`; Trident `f080278e31e4202ca89d524e4ee9e4cf3cbff038`.

Native has lower observed layout-cache-disabled SVG and full-product runtime medians than ELK on all eight graph-family representatives, and smaller fetched browser closures. Main already has that Native advantage. These small examples do not establish workload-wide replacement correctness.

The PR is not a general performance improvement over current Main. For the 100-node chain, full SVG+receipt repeat medians with layout cache disabled are 107.5ms on Main Native and 173.2ms on PR Native. With the existing cache enabled, the PR's repeated-source median is 15.6ms, but its first authored edit costs 184.6ms. The 100 ms fresh-work target remains unmet. PR diagnostic products are proof-unverified while Main's pass; raw execution costs are not rates of equivalently proved diagrams.

The demonstrated visible gain versus Main is controlled embedded-image delivery, shared by both backends. It comes alongside larger browser payloads and six additional unverified larger outputs in the 62-case seed cohort. Native/ELK quality tradeoffs and unavailable geometry remain separate below.

All 33 family representatives return SVG in all four arms. Only eight representatives record a graph-solver choice; the other 25 have identical Native/ELK SVGs and provide shared-renderer coverage, not an algorithm contest. Native is `agentic` in raw results. Fallback is disabled in every arm.

Measurements are exploratory: three fresh process replicas and seven adaptive warm batch means, one round; below Trident's full calibration. Numbers are medians of process medians in milliseconds. Raw process min/max and all samples remain available; no broad calibrated replacement or speed-ratio claim. The SVG-only public API and the entire consumed SVG+receipt API are separate boundaries. Cold excludes import; import is separately recorded. Cache0 disables the layout cache, not every application/module cache. Cache1 enables it. Alternating edits revisit two authored source variants; comment variants may normalize to the same cache key. Receipt first-edit is the first edited source, while later edited calls are repeats.

## Correctness and availability

Independent 99-case authored-meaning/finalSVG cohort, including 91 cases with deeper declared expectations and 8 labels-only supplements:

| Arm | Returned /99 | Trident projected-meaning complete passes /91 | Declared paint checks complete /99 | Known paint failures | Proof P/U/no receipt |
|---|---:|---:|---:|---:|---|
|main Native|97|87|72|1|92/5/2|
|main ELK|97|87|71|1|92/5/2|
|pr Native|97|88|73|0|91/6/2|
|pr ELK|97|88|72|0|91/6/2|

The projected-meaning totals retain an observer-schema mismatch in Event Modeling in all four arms: Trident reads `boxes/relations`, while the actual public native model contains ordered `frames` with the authored IDs and labels. Actual SVG paint finds the expected nodes and connections. Its raw failed meaning checks remain retained, but deeper qualification is unavailable through this adapter; this is not demonstrated missing meaning in either renderer. Sequence-note semantics and ZenUML structured meaning also remain unavailable. Counts are not an overall correctness score, and parsing may pass even where rendering fails. The parser is shared between requested layout backends, so matching parse facts alone do not establish post-layout correctness. See QUALIFICATION-ANNOTATIONS.json.

The existing quantitative paint observers record 21 passed and 6 unavailable chart/family checks per arm, with no known failed quantitative check. These are check counts across the 99-case cohort, not 21 completely verified diagrams. Exact expected/actual quantities and observer tolerances remain in fidelity/RESULTS.json and the same-input family rows.

Declared paint completion covers each case's enrolled checks. The eight labels-only supplements do not test deeper visible structure even when those checks pass. PR's controlled embedded-image case improves authored meaning and actual image paint in both backends. Two fontSize configuration-reset errors per arm remain enrolled. Unknown/incomplete paint and meaning are not passes. Native's one additional complete paint case versus ELK is Requirement relationship-label ownership unavailable to the ELK observer, not a demonstrated missing visible label; that difference already exists on Main. Separate 62-case seed cohort: 58 returned/arm, four shared errors/arm (including three authored invalid sources); Main 56 passed proofs/2 unverified, PR 50/8. Six larger outputs lose proof availability in the PR in both backends: flowchart128, sequence128, state128, chain100, fanin100, chain300. This does not by itself establish visible failure, and it remains an adverse result.

## All 33 families: public SVG runtime

Main N/E and PR N/E are Native / ELK ms. Cache0 cold and warm are SVG + UTF8 consumption. Cache1 warm is separately shown; this is not a receipt-cost table.

| Family | Graph choice | Main cold N/E | PR cold N/E | Main warm0 N/E | PR warm0 N/E | PR warm1 N/E |
|---|---|---:|---:|---:|---:|---:|
|flowchart|yes|112.1/338.0|135.1/451.3|8.2/16.4|12.2/22.4|2.4/2.4|
|sequence|shared/no choice|92.8/80.3|141.1/117.3|7.8/7.4|11.6/10.7|5.2/3.1|
|state|yes|172.0/449.6|216.7/551.6|7.4/17.0|12.4/23.3|6.2/4.6|
|class|yes|133.9/2,057.3|125.7/1,140.8|10.2/16.4|12.8/23.5|10.6/11.6|
|er|yes|251.9/902.0|180.7/625.9|7.8/15.0|10.4/19.6|9.1/10.6|
|timeline|shared/no choice|86.2/155.8|123.4/119.0|5.5/4.6|7.8/8.5|2.4/3.0|
|journey|shared/no choice|151.2/154.5|213.9/161.0|7.8/8.4|14.8/14.4|2.5/2.8|
|architecture|yes|106.3/338.1|127.6/331.5|8.7/19.6|14.5/27.5|3.9/3.4|
|xychart|shared/no choice|111.8/87.8|132.1/117.8|9.0/10.1|14.4/15.4|3.4/3.4|
|pie|shared/no choice|74.7/80.6|102.1/98.6|5.0/4.8|7.8/7.9|2.4/2.6|
|quadrant|shared/no choice|74.1/84.6|99.0/113.3|5.4/5.1|9.2/8.8|2.1/2.2|
|gantt|shared/no choice|94.6/82.3|97.3/124.7|5.3/5.1|8.8/8.1|8.3/9.1|
|mindmap|shared/no choice|70.8/90.6|150.9/112.2|5.9/6.6|8.9/8.8|2.3/2.1|
|gitgraph|shared/no choice|97.2/81.0|113.0/108.3|8.1/7.9|11.2/11.8|2.1/2.7|
|radar|shared/no choice|75.2/73.3|88.6/95.6|5.1/5.1|7.7/7.1|2.2/2.4|
|sankey|shared/no choice|83.7/88.7|94.6/100.9|5.7/7.2|8.7/7.3|2.5/2.4|
|c4|shared/no choice|104.3/102.9|111.9/130.4|10.6/9.6|13.5/14.2|16.0/15.7|
|packet|shared/no choice|73.0/67.6|89.0/85.0|3.2/3.3|6.8/6.7|2.2/2.4|
|kanban|shared/no choice|70.9/84.6|79.5/91.1|4.2/4.4|7.4/6.8|2.2/2.3|
|requirement|yes|202.7/385.7|145.9/435.7|8.3/15.0|12.4/22.8|2.7/2.5|
|treemap|shared/no choice|113.6/72.5|108.8/98.9|4.7/4.4|7.2/7.2|2.5/2.2|
|ishikawa|shared/no choice|80.8/99.7|105.7/248.8|5.7/5.9|10.9/10.9|2.9/2.5|
|block|shared/no choice|90.7/84.5|92.5/93.1|6.1/6.3|10.2/11.7|2.1/2.4|
|eventmodeling|shared/no choice|89.9/87.2|117.9/110.8|7.2/5.3|10.2/12.4|2.6/3.5|
|zenuml|shared/no choice|98.8/101.8|121.7/127.8|9.2/8.5|13.9/16.3|3.2/3.0|
|railroad|shared/no choice|75.3/74.9|88.5/92.3|5.2/5.4|6.3/8.0|1.9/2.4|
|cynefin|shared/no choice|91.7/82.5|120.0/110.5|5.7/6.6|11.3/10.8|6.7/7.4|
|agentflow|yes|117.0/351.5|144.3/400.3|10.5/20.6|14.5/24.2|2.3/6.7|
|usecase|yes|107.4/365.7|143.4/392.2|10.4/22.6|14.1/30.3|2.9/2.5|
|wardley|shared/no choice|80.1/95.8|118.3/112.5|7.1/6.7|11.3/15.5|2.5/2.2|
|venn|shared/no choice|69.4/76.8|79.9/96.2|4.7/6.6|6.7/7.0|2.0/2.3|
|swimlane|shared/no choice|89.1/89.3|134.8/134.7|10.1/9.5|13.9/15.3|3.3/2.6|
|treeview|shared/no choice|66.4/78.4|94.5/111.8|4.8/4.3|6.0/6.5|2.2/2.1|

## All 33 families: fully consumed receipt product

Entire public SVG+receipt result JSON-serialized once and UTF8-counted inside each clock. Receipt artifacts encoded after the clock; profiling and source observers disabled. Median of each process's four repeat calls; first-edit is a separate call. No subtraction from the SVG-only table is attributed to a specific internal stage.

| Family | Main repeat0 N/E | PR repeat0 N/E | PR repeat1 N/E | PR first edit0 N/E | PR first edit1 N/E |
|---|---:|---:|---:|---:|---:|
|flowchart|12.1/28.9|19.1/37.8|3.7/5.4|18.5/30.3|21.8/39.4|
|sequence|10.2/10.3|19.4/18.6|4.3/5.2|15.8/14.9|25.8/21.9|
|state|13.7/30.6|18.1/36.6|4.6/5.4|15.2/28.5|23.6/34.4|
|class|12.8/26.7|14.9/27.0|13.6/14.8|14.7/23.9|18.5/32.9|
|er|11.5/22.4|12.8/22.7|12.5/13.3|11.4/23.0|14.7/28.6|
|timeline|7.7/6.7|10.5/11.2|4.2/4.2|9.9/11.6|14.4/15.2|
|journey|12.4/12.5|21.8/20.9|4.8/4.8|19.1/21.4|23.3/25.0|
|architecture|14.2/31.3|21.0/50.2|5.2/6.4|19.8/38.3|28.2/53.9|
|xychart|11.9/13.0|23.0/19.9|11.2/18.1|17.2/20.2|32.0/35.4|
|pie|7.4/7.1|9.1/9.9|3.8/3.8|8.5/9.6|12.1/18.3|
|quadrant|8.8/7.0|10.5/9.2|4.0/4.0|8.8/10.8|12.9/14.6|
|gantt|7.9/8.6|13.7/11.6|12.3/13.4|10.9/8.8|10.0/10.3|
|mindmap|10.5/10.1|14.0/14.0|4.0/3.9|10.5/12.3|16.0/19.8|
|gitgraph|11.1/10.5|17.9/16.3|3.9/4.1|14.6/14.5|19.8/20.3|
|radar|8.5/8.3|11.5/11.1|3.6/3.9|8.6/10.6|11.0/12.1|
|sankey|10.8/8.9|13.5/12.4|3.9/3.4|11.6/11.0|16.8/12.1|
|c4|14.4/14.4|21.9/20.9|18.8/19.3|20.5/18.7|18.6/17.7|
|packet|5.2/7.6|10.2/8.2|3.3/3.8|9.5/8.5|10.9/12.7|
|kanban|6.7/6.7|10.2/11.7|3.8/3.8|10.5/9.0|12.4/13.8|
|requirement|10.2/22.0|19.6/35.2|4.9/5.6|18.7/32.9|24.9/24.6|
|treemap|7.1/6.8|10.9/8.6|3.8/3.4|8.7/9.1|15.6/14.5|
|ishikawa|9.7/8.4|14.3/16.1|5.0/5.2|15.1/15.8|21.1/20.8|
|block|9.5/9.1|11.5/13.1|4.9/4.5|14.1/10.8|18.8/19.3|
|eventmodeling|9.8/9.6|18.5/17.6|4.1/4.5|13.7/17.7|23.3/22.8|
|zenuml|15.7/27.5|22.5/22.9|5.6/4.8|17.2/43.8|23.4/22.7|
|railroad|9.9/8.8|12.3/10.4|3.7/3.0|11.7/9.0|18.4/14.2|
|cynefin|11.9/10.1|20.1/19.7|4.9/3.5|12.3/13.3|20.8/14.7|
|agentflow|14.1/30.1|22.1/37.2|4.2/4.4|16.1/32.5|29.4/41.9|
|usecase|13.6/29.8|20.7/34.8|4.8/5.2|23.5/30.5|25.7/46.3|
|wardley|9.2/9.3|16.0/15.7|3.5/4.6|12.1/13.8|15.3/17.7|
|venn|7.4/6.6|10.4/9.7|3.1/3.3|9.9/8.8|13.3/12.2|
|swimlane|12.6/12.9|26.7/22.1|4.2/4.0|17.7/18.0|22.6/20.3|
|treeview|6.9/5.5|11.9/8.9|2.9/3.1|8.7/9.9|11.4/11.8|

## All 33 families: finalSVG layout quality

Same-source independent finalSVG observations where available; the unmatched Event Modeling representative has only its actual pilot SVG viewport measured. PR Native/ELK vectors are area (SVG units squared), strict owned linear wire/bends/crossings/parallel/opposing overlaps. Curved/relative/transformed or unowned paths are unavailable, never zero. Browser centerline approximation and separate width/height are in FAMILY-METRICS. Exact node-body contacts, exact pairwise glyph-collision counts and finalSVG flow-axis violation counts are unavailable across this run. Source direction/labels and browser visibility/clipping checks do not replace those geometric observations. Area and wire are tradeoffs, not correctness scores.

| Family | PR area N/E | Area Native vs ELK | Native wire/bend/cross/parallel/opposing | ELK wire/bend/cross/parallel/opposing | Meaning N/E | Paint N/E | Proof N/E |
|---|---:|---:|---|---|---|---|---|
|flowchart|47,240.2/47,240.2|0.0%|96.0/0/0/0/0|96.0/0/0/0/0|passed/passed|passed/passed|passed/passed|
|sequence|57,680.0/57,680.0|0.0%|unavailable|unavailable|passed/passed|passed/passed|passed/passed|
|state|41,318.0/47,978.7|-13.9%|78.3/0/0/0/0|116.3/0/0/0/0|passed/passed|passed/passed|passed/passed|
|class|51,020.0/63,020.0|-19.0%|77.3/0/0/0/0|137.3/0/0/0/0|passed/passed|passed/passed|passed/passed|
|er|69,101.3/78,145.3|-11.6%|unavailable|unavailable|passed/passed|passed/passed|passed/passed|
|timeline|55,334.4/55,334.4|0.0%|unavailable|unavailable|passed/passed|passed/passed|unverified/unverified|
|journey|196,778.4/196,778.4|0.0%|unavailable|unavailable|passed/passed|passed/passed|passed/passed|
|architecture|76,704.0/76,704.0|0.0%|56.0/0/0/0/0|56.0/0/0/0/0|passed/passed|passed/passed|passed/passed|
|xychart|350,000.0/350,000.0|0.0%|unavailable|unavailable|passed/passed|passed/passed|unverified/unverified|
|pie|104,613.3/104,613.3|0.0%|unavailable|unavailable|passed/passed|passed/passed|passed/passed|
|quadrant|224,352.0/224,352.0|0.0%|unavailable|unavailable|passed/passed|passed/passed|passed/passed|
|gantt|128,154.0/128,154.0|0.0%|unavailable|unavailable|passed/passed|passed/passed|passed/passed|
|mindmap|43,617.8/43,617.8|0.0%|unavailable|unavailable|passed/passed|unknown/unknown|passed/passed|
|gitgraph|145,570.5/145,570.5|0.0%|567.0/4/0/0/0|567.0/4/0/0/0|passed/passed|unknown/unknown|passed/passed|
|radar|161,181.7/161,181.7|0.0%|unavailable|unavailable|passed/passed|passed/passed|passed/passed|
|sankey|290,304.0/290,304.0|0.0%|unavailable|unavailable|passed/passed|unknown/unknown|passed/passed|
|c4|180,614.6/180,614.6|0.0%|101.2/0/0/0/0|101.2/0/0/0/0|passed/passed|passed/passed|passed/passed|
|packet|114,060.8/114,060.8|0.0%|unavailable|unavailable|passed/passed|passed/passed|passed/passed|
|kanban|83,558.4/83,558.4|0.0%|unavailable|unavailable|passed/passed|passed/passed|passed/passed|
|requirement|115,615.3/136,232.6|-15.1%|unavailable|unavailable|passed/passed|passed/passed|passed/passed|
|treemap|510,720.0/510,720.0|0.0%|unavailable|unavailable|passed/passed|unknown/unknown|passed/passed|
|ishikawa|66,066.0/66,066.0|0.0%|unavailable|unavailable|passed/passed|unknown/unknown|passed/passed|
|block|26,784.0/26,784.0|0.0%|24.0/0/0/0/0|24.0/0/0/0/0|passed/passed|passed/passed|passed/passed|
|eventmodeling|413,044.8/413,044.8|0.0%|unavailable|unavailable|unavailable/unavailable|unavailable/unavailable|passed/passed|
|zenuml|67,592.0/67,592.0|0.0%|unavailable|unavailable|unknown/unknown|unknown/unknown|passed/passed|
|railroad|69,465.0/69,465.0|0.0%|unavailable|unavailable|labels-only; deeper unknown/labels-only; deeper unknown|passed/passed|passed/passed|
|cynefin|548,928.5/548,928.5|0.0%|1,572.8/4/0/0/0|1,572.8/4/0/0/0|labels-only; deeper unknown/labels-only; deeper unknown|passed/passed|passed/passed|
|agentflow|51,167.8/51,167.8|0.0%|48.0/0/0/0/0|48.0/0/0/0/0|labels-only; deeper unknown/labels-only; deeper unknown|passed/passed|passed/passed|
|usecase|64,146.5/68,208.4|-6.0%|108.3/2/0/0/0|105.2/0/0/0/0|labels-only; deeper unknown/labels-only; deeper unknown|passed/passed|passed/passed|
|wardley|454,717.5/454,717.5|0.0%|unavailable|unavailable|labels-only; deeper unknown/labels-only; deeper unknown|passed/passed|passed/passed|
|venn|179,568.0/179,568.0|0.0%|unavailable|unavailable|labels-only; deeper unknown/labels-only; deeper unknown|passed/passed|passed/passed|
|swimlane|75,405.1/75,405.1|0.0%|150.1/4/0/0/0|150.1/4/0/0/0|labels-only; deeper unknown/labels-only; deeper unknown|passed/passed|passed/passed|
|treeview|11,881.0/11,881.0|0.0%|24.5/1/0/0/0|24.5/1/0/0/0|labels-only; deeper unknown/labels-only; deeper unknown|passed/passed|passed/passed|

## All 33 families: browser delivery and memory

Actual fresh-realm fetched browser-lazy product closure; product byte columns exclude binding/instrumentation transport, whose bytes are separately retained. Request counts include the observed binding requests. gzip9 and Brotli11 are real offline compressed module bytes, not observed compressed HTTP transfer or complete npm tarballs. Browser JS heap is post-GC document heap for the support-probe plus enrolled-source portfolio, not process/GPU memory. Whole-process Node RSS includes import, driver, GC and qualification and is not an API allocation peak. Do not sum cold closures across families as a warm-portfolio cost.

| Family | PR requests N/E | PR raw KiB N/E | Main gzip KiB N/E | PR gzip KiB N/E | PR Brotli KiB N/E | PR browser JS heap MiB N/E | PR Node peak RSS MiB N/E |
|---|---:|---:|---:|---:|---:|---:|---:|
|flowchart|41.0/31.0|1,173.1/2,390.1|326.5/688.0|389.6/739.7|332.1/585.9|5.7/10.7|77.1/100.3|
|sequence|15.0/15.0|697.4/697.4|181.8/181.8|224.1/224.1|187.0/187.0|4.8/4.8|76.8/76.7|
|state|37.0/27.0|1,172.1/2,389.0|325.6/687.1|388.7/738.8|331.4/585.1|5.5/10.5|77.1/100.3|
|class|36.0/23.0|964.6/2,178.9|255.5/622.9|318.6/666.7|269.5/521.3|5.1/9.6|79.3/100.9|
|er|37.0/25.0|1,062.9/2,271.7|284.0/645.4|352.3/698.6|299.2/549.5|5.0/9.5|78.6/100.3|
|timeline|11.0/11.0|639.5/639.5|163.3/163.3|205.7/205.7|170.3/170.3|4.2/4.2|75.8/75.6|
|journey|12.0/12.0|660.0/660.0|170.6/170.6|212.9/212.9|176.9/176.9|4.9/4.9|79.1/79.4|
|architecture|38.0/28.0|1,152.4/2,369.4|317.3/678.8|380.5/730.6|323.6/577.4|5.1/10.6|78.1/101.2|
|xychart|15.0/15.0|681.8/681.8|178.0/178.0|220.3/220.3|183.3/183.3|4.8/4.8|79.7/80.1|
|pie|17.0/17.0|651.8/651.8|170.1/170.1|212.4/212.4|176.3/176.3|4.2/4.2|75.2/75.6|
|quadrant|14.0/14.0|648.8/648.8|167.7/167.7|210.0/210.0|174.2/174.2|4.4/4.4|76.1/76.2|
|gantt|11.0/11.0|665.9/665.9|172.5/172.5|214.8/214.8|178.5/178.5|4.4/4.4|76.8/76.4|
|mindmap|16.0/16.0|655.3/655.3|172.1/172.1|214.4/214.4|178.1/178.1|4.5/4.5|75.9/76.1|
|gitgraph|14.0/14.0|654.2/654.2|170.1/170.1|212.4/212.4|176.3/176.3|4.5/4.5|77.3/77.1|
|radar|16.0/16.0|658.1/658.1|171.8/171.8|214.2/214.2|178.0/178.0|4.3/4.3|75.6/76.0|
|sankey|14.0/14.0|659.1/659.1|169.3/169.3|213.3/213.3|177.3/177.3|4.4/4.4|75.8/75.7|
|c4|22.0/22.0|861.1/861.1|228.8/228.8|280.1/280.1|235.7/235.7|5.3/5.3|78.3/78.5|
|packet|12.0/12.0|627.2/627.2|160.3/160.3|202.7/202.7|167.7/167.7|4.2/4.2|74.3/74.2|
|kanban|13.0/13.0|635.6/635.6|163.7/163.7|206.1/206.1|170.7/170.7|4.3/4.3|75.1/74.9|
|requirement|31.0/16.0|879.7/2,070.7|226.6/585.7|291.4/631.4|246.3/490.9|5.1/9.7|79.2/100.4|
|treemap|14.0/14.0|645.7/645.7|168.1/168.1|210.4/210.4|174.7/174.7|4.2/4.2|75.7/74.9|
|ishikawa|13.0/13.0|628.8/628.8|160.8/160.8|203.1/203.1|168.1/168.1|4.7/4.6|76.5/76.3|
|block|18.0/18.0|802.5/802.5|211.0/211.0|261.3/261.3|219.1/219.1|4.6/4.6|75.3/75.0|
|eventmodeling|11.0/11.0|635.9/635.9|162.8/162.8|205.1/205.1|169.9/169.9|4.8/4.8|78.8/78.8|
|zenuml|14.0/14.0|711.1/711.1|186.9/186.9|229.2/229.2|191.6/191.6|4.8/4.8|77.4/77.2|
|railroad|13.0/13.0|644.0/644.0|165.8/165.8|208.1/208.1|172.6/172.6|4.3/4.3|74.5/74.8|
|cynefin|13.0/13.0|632.1/632.1|162.1/162.1|204.4/204.4|169.3/169.3|4.5/4.5|77.8/77.8|
|agentflow|40.0/30.0|1,280.3/2,497.3|361.0/722.5|424.2/774.3|363.0/616.8|6.0/11.1|78.1/100.7|
|usecase|35.0/26.0|1,139.2/2,356.5|314.6/676.3|377.4/727.8|321.1/575.0|5.4/10.4|77.8/100.0|
|wardley|15.0/15.0|659.9/659.9|171.0/171.0|213.6/213.6|177.6/177.6|4.7/4.7|77.6/77.4|
|venn|12.0/12.0|640.9/640.9|165.5/165.5|207.9/207.9|172.4/172.4|4.1/4.1|75.0/74.7|
|swimlane|38.0/38.0|1,180.8/1,180.8|329.1/329.1|392.6/392.6|334.9/334.9|5.5/5.5|77.3/77.4|
|treeview|14.0/14.0|636.6/636.6|164.3/164.3|206.6/206.6|171.2/171.2|4.1/4.1|74.4/74.4|

## Scaling and 100/300-node diagnostics

Same fixed source per row. Public SVG warm0 and full receipt repeat0 are different boundaries; no solver-only claim. These diagnostics have no independently authored deeper meaning expectations. A returned output or a helper proof is not a complete visible-correctness claim.

| Case | Main SVG N/E ms | PR SVG N/E ms | PR receipt N/E ms | PR proof N/E |
|---|---:|---:|---:|---|
|scaling:flowchart:8|10.6/25.8|19.8/37.7|—/—|passed/passed|
|scaling:flowchart:32|28.4/58.2|56.2/103.8|—/—|passed/passed|
|scaling:flowchart:128|76.9/174.7|144.8/229.3|—/—|unverified/unverified|
|scaling:sequence:8|9.6/8.8|19.5/17.6|—/—|passed/passed|
|scaling:sequence:32|17.0/18.1|44.4/44.9|—/—|passed/passed|
|scaling:sequence:128|38.9/43.4|121.0/124.7|—/—|unverified/unverified|
|scaling:class:8|13.1/24.0|21.3/28.7|—/—|passed/passed|
|scaling:class:32|39.5/53.2|67.4/95.2|—/—|passed/passed|
|scaling:class:128|105.6/140.8|248.1/269.4|—/—|passed/passed|
|scaling:state:8|13.2/27.5|18.9/34.6|—/—|passed/passed|
|scaling:state:32|22.2/55.1|54.4/87.4|—/—|passed/passed|
|scaling:state:128|74.1/164.5|125.6/232.1|—/—|unverified/unverified|
|scaling:er:8|13.3/34.7|26.8/42.0|—/—|passed/passed|
|scaling:er:32|41.6/68.8|74.3/118.8|—/—|passed/passed|
|scaling:er:128|141.8/164.1|269.7/307.3|—/—|passed/passed|
|diagnostic:chain100|77.2/189.0|119.1/273.3|173.2/387.8|unverified/unverified|
|diagnostic:fanin100|114.6/370.7|174.6/433.2|239.1/509.6|unverified/unverified|
|diagnostic:chain300|218.1/688.0|292.9/592.4|385.9/714.5|unverified/unverified|

## Evidence and limitations

[All family metrics](FAMILY-METRICS.csv), [all SVG timing/resource cells](SVG-METRICS.csv), [all full-product cells](RECEIPT-METRICS.csv), [same-input observed deltas](COMPARISONS.csv). These include cold/import, warm, edits, both cache regimes, CPU, Node heap/external/ArrayBuffer snapshots, baseline-adjusted retained memory, process RSS and serialized sizes. Raw samples and process spread are in JSON and performance/results.jsonl; render/refusal costs remain enrolled, and invalid-input timing is not a successful-layout win.

[Authored meaning and actual ink](fidelity/SUMMARY.md), [all396 fidelity rows](fidelity/RESULTS.json), [per-family fidelity coverage](fidelity/FAMILY-RESULTS.csv), [browser closures](browser/FAMILY-PAYLOAD.csv), [frozen identity](IDENTITY.json), [protocol](PLAN.json), [pilot receipts](PILOT.json), [original Trident calibration/p95](CALIBRATION.json), [output stability](OUTPUT-STABILITY.json). Frozen input literals, all returned SVGs/receipts, failures and unknowns are retained. The failed oracle-path setup and both worker smoke checks are retained outside measurement results. No production source changes, optimizer, new cache, or acceptance gate was introduced. Scoped Node/browser artifacts are not a complete package build. The lost original 12 grouped inputs and original campaign baseline/pinned peer renderer comparisons were not recovered or claimed. Replacement24 remains sealed. The old automation remains disabled.

Small family representatives do not requalify historical larger counterexamples: forest wire +16.89% with area −6.43%, Requirement TB/BT area +9.53%, implemented Sparse256 area +5.04% (the +0.97% candidate is unshipped). Sparse32's proof-budget limitation and the shared ER256 relationship-chain refusal remain separate known limitations. Those are retained historical results, not new measurements on these frozen heads.

## Product outcomes and stability

The 864 full-product workers performed 7776 measured calls: {'returned': 7776}. Proof status totals across those calls are {'passed': 7020, 'unverified': 756}; repeated/cached calls are not additional independent diagrams.

Exact same-input SVG comparisons across layout-cache modes and public SVG/receipt APIs: {'True': 232, 'unavailable': 16} and {'True': 232, 'unavailable': 16}, respectively. The 16 unavailable rows are actual errors/refusals and do not compare equal. Same-process warm repeats preserve complete SVG and receipt bytes in all 3456 observations. All 3456 edit outputs change bytes; byte change alone does not prove authored edit semantics. See OUTPUT-STABILITY-SUMMARY.json and the retained declared checks.
