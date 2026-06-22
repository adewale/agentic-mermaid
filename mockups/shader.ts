import { chromium } from 'playwright'
import { writeFileSync, unlinkSync } from 'fs'

const cwd = process.cwd()
const url = (p: string) => `file://${cwd}/mockups/${p}`
const browser = await chromium.launch()
const temp: string[] = []

async function filmstrip(srcs: { src: string; cap: string }[], out: string) {
  const frames = srcs.map((f) => `<figure style="margin:0">
    <img src="${f.src}" style="width:200px;height:200px;display:block;border-radius:26px;border:1px solid var(--line);">
    <figcaption style="font-family:var(--mono);font-size:12px;color:var(--ink-faint);margin-top:8px;text-align:center;">${f.cap}</figcaption>
  </figure>`).join('')
  writeFileSync(`${cwd}/mockups/_strip.html`, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css">
<body style="margin:0"><div style="display:flex;gap:18px;padding:24px;background:var(--paper);width:max-content;">${frames}</div></body>`)
  temp.push('_strip.html')
  const c = await browser.newContext({ viewport: { width: 980, height: 290 }, deviceScaleFactor: 2 })
  const p = await c.newPage()
  await p.goto(url('_strip.html'), { waitUntil: 'load' })
  await p.waitForTimeout(150)
  await p.screenshot({ path: `mockups/${out}`, fullPage: true })
  await c.close()
  console.log('built', out)
}

// 1) the rank sweep (after the settle has finished), via pinned phases
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  await page.goto(url('shader-demo.html'), { waitUntil: 'load' })
  await page.waitForTimeout(1200)   // let the layer-assignment settle finish
  const box = await page.locator('.demo-big').boundingBox()
  const clip = { x: Math.round(box!.x), y: Math.round(box!.y), width: Math.round(box!.width), height: Math.round(box!.height) }
  const phases = [{ t: 0.0, cap: 'resting' }, { t: 2.84, cap: 'top rank' }, { t: 4.17, cap: 'middle rank' }, { t: 5.49, cap: 'bottom rank' }]
  const out: { src: string; cap: string }[] = []
  for (let i = 0; i < phases.length; i++) {
    await page.evaluate((t) => { (window as any).__SHADER_TIME__ = t }, phases[i].t)
    await page.waitForTimeout(140)
    await page.screenshot({ path: `mockups/_s${i}.png`, clip }); temp.push(`_s${i}.png`)
    out.push({ src: `_s${i}.png`, cap: phases[i].cap })
  }
  await ctx.close()
  await filmstrip(out, 'shot-shader.png')
}

// 2) the ranks settling on load (layer assignment, then the long edge routes through the dummy)
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  await page.goto(url('shader-demo.html'), { waitUntil: 'load' })
  const box = await page.locator('.demo-big').boundingBox()
  const clip = { x: Math.round(box!.x), y: Math.round(box!.y), width: Math.round(box!.width), height: Math.round(box!.height) }
  await page.reload({ waitUntil: 'load' })          // restart the CSS settle from the top
  const times = [80, 300, 560, 980], caps = ['rank 1 lands', 'ranks 2–3', 'edges route', 'long edge + dummy']
  const out: { src: string; cap: string }[] = []
  let prev = 0
  for (let i = 0; i < times.length; i++) {
    await page.waitForTimeout(times[i] - prev); prev = times[i]
    await page.screenshot({ path: `mockups/_se${i}.png`, clip }); temp.push(`_se${i}.png`)
    out.push({ src: `_se${i}.png`, cap: caps[i] })
  }
  await ctx.close()
  await filmstrip(out, 'shot-shader-settle.png')
}

// 3) nav context — settled, mid-sweep
{
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 200 }, deviceScaleFactor: 3, colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  await page.goto(url('home.html'), { waitUntil: 'load' })
  await page.waitForTimeout(1200)
  await page.evaluate(() => { (window as any).__SHADER_TIME__ = 4.17 })
  await page.waitForTimeout(120)
  await page.screenshot({ path: 'mockups/shot-shader-context.png', clip: { x: 16, y: 8, width: 320, height: 46 } })
  await ctx.close()
  console.log('built shot-shader-context.png')
}

await browser.close()
for (const f of temp) { try { unlinkSync(`${cwd}/mockups/${f}`) } catch {} }
console.log('done')
