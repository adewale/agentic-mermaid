const rendererRoot=process.env.RENDERER_ROOT??process.cwd()
const {renderMermaidSVG}=await import(rendererRoot+'/src/index.ts')
const {withPerformanceObserver}=await import(rendererRoot+'/src/performance-observations.ts')
const rows=await Bun.file(new URL('./inputs.json',import.meta.url)).json()
rows.push({family:'straight-control',source:'flowchart LR\nA-->B',options:{}})
const report=[]
for(const row of rows){const times=[];for(let i=0;i<20;i++){const now=performance.now();renderMermaidSVG(row.source,row.options);if(i>=5)times.push(performance.now()-now)}times.sort((a,b)=>a-b)
const events:any[]=[];withPerformanceObserver(e=>events.push(e),()=>renderMermaidSVG(row.source,row.options));report.push({family:row.family,median_ms:times[7],p95_ms:times[14],layout_misses:events.filter(e=>e.kind==='cache'&&e.owner==='elk-layout'&&e.outcome==='miss').length,layout_fallbacks:events.filter(e=>e.kind==='fallback'&&e.owner!=='native-drawing').length})}
await Bun.write((process.env.OUTPUT_DIR??'/tmp')+'/bench-'+process.argv[2]+'.json',JSON.stringify(report,null,2))
