import { writeFileSync } from 'node:fs'
const root=process.argv[2]!,name=process.argv[3]!
const {renderMermaidSVG}=await import(`${root}/src/index.ts`)
const {linearTicks,formatTickValue}=await import(`${root}/src/xychart/axis-utils.ts`)
const {preparePixelText}=await import(`${root}/src/shared/prepared-text.ts`)
const out=process.argv[4]!
const source='xychart-beta\n title "Tiny numeric x-axis"\n x-axis 0.00000000000001 --> 0.0000000000001\n y-axis 0 --> 10\n line [1,5,9]'
try{writeFileSync(`${out}/${name}.svg`,renderMermaidSVG(source))}catch(e){writeFileSync(`${out}/${name}.error.txt`,String(e))}
writeFileSync(`${out}/${name}.json`,JSON.stringify({ticks:linearTicks(1e-14,1e-13).map(formatTickValue),softHyphen:preparePixelText('ab\u00adcdef',{fontSize:14,fontWeight:400,maxWidth:27}).lines,zeroWidthSpace:preparePixelText('ab\u200bcdef',{fontSize:14,fontWeight:400,maxWidth:27}).lines},null,2))
