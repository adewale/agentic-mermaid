const {chromium}=await import(`${process.argv[2]}/node_modules/playwright/index.mjs`)
import {readFileSync,writeFileSync} from 'node:fs'
const out=process.argv[3]!, base=process.argv[4]!, head=process.argv[5]!
const panels=['before','after'].map(name=>{
 const json=JSON.parse(readFileSync(`${out}/${name}.json`,'utf8'))
 return `<section><h2>${name==='before'?`Before · ${base.slice(0,12)}`:`After · ${head.slice(0,12)}`}</h2>${readFileSync(`${out}/${name}.svg`,'utf8')}<h3>Soft hyphen · 27px wrap</h3><pre>${json.softHyphen.join('\n')}</pre><h3>Zero-width space · 27px wrap</h3><pre>${json.zeroWidthSpace.join('\n')}</pre></section>`
}).join('')
const html=`<!doctype html><meta charset="utf-8"><title>Numeric and discretionary-break regressions</title><style>body{margin:24px;font:16px system-ui;color:#162030;background:#f5f7fa}h1{font-size:23px}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}section{padding:18px;background:white;border:1px solid #d3dae4;border-radius:8px}h2{font-size:18px}h3{font-size:14px;margin-bottom:6px}svg{width:100%;height:auto}pre{margin:0;padding:8px;background:#f5f7fa;font:16px monospace;line-height:1.5}</style><h1>Actual renderer output · same input and options</h1><main>${panels}</main>`
writeFileSync(`${out}/before-after.html`,html)
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
try{const page=await browser.newPage({viewport:{width:1400,height:950}});await page.setContent(html);await page.screenshot({path:`${out}/before-after.png`,fullPage:true})}finally{await browser.close()}
