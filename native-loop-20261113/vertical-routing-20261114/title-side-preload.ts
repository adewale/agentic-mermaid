import {readFileSync} from 'node:fs'
Bun.plugin({name:'vertical-title-side-diagnostic',setup(build){
 build.onLoad({filter:/\/compound-boundary-routes\.ts$/},args=>{
  let source=readFileSync(args.path,'utf8')
  const original='if (!points && !directOnly) try {'
  if(source.split(original).length!==2)throw Error('Primary owner changed')
  source=source.replace(original,`if (!points && !directOnly) try {
    const sourceDirection = directions[owners[edge.source]! + 1]!, targetDirection = directions[owners[edge.target]! + 1]!
    const downward = sourceDirection === 'TB' || sourceDirection === 'TD', upward = sourceDirection === 'BT'
    const titleOwner = owners[downward ? edge.target : edge.source]!
    const title = titleOwner >= 0 ? headerGroups[titleOwner]?.headerHeight : undefined
    const titleSide = process.env.AM_VERTICAL_TITLE_SIDE === '1' && !leafPaths && !edge.label && quotient.length === 2
      && quotient[0]!.x === quotient[1]!.x && (downward && quotient[0]!.y < quotient[1]!.y || upward && quotient[0]!.y > quotient[1]!.y)
      && sourceDirection === targetDirection && sourceDirection === input.direction && title !== undefined && title > 0
      && widthProof !== undefined && edge.source < leafCount && edge.target < leafCount && crossingSource && crossingTarget
      && edge.sourceTerminalLead !== undefined && edge.targetTerminalLead !== undefined
    const sharedPrimaryAnchor = titleSide ? downward ? end : start : undefined
  `)
  for(const [a,b] of [
    ['directCorridor(bounds, obstacles, sources, start, endpointFrames(edge.source)', 'directCorridor(bounds, obstacles, sources, sharedPrimaryAnchor ?? start, endpointFrames(edge.source)'],
    ['directCorridor(bounds, obstacles, targets, end, endpointFrames(edge.target)', 'directCorridor(bounds, obstacles, targets, sharedPrimaryAnchor ?? end, endpointFrames(edge.target)'],
    ['first ??= grid.route(sources, start)', 'first ??= grid.route(sources, sharedPrimaryAnchor ?? start)'],
    ['last ??= grid.route(targets, end).reverse()', 'last ??= grid.route(targets, sharedPrimaryAnchor ?? end).reverse()'],
  ]){if(source.split(a).length!==2)throw Error('Primary query owner changed: '+a);source=source.replace(a,b)}
  source=source.replace('const quotient = simplifyOrthogonal(raw.points)',`const quotient = simplifyOrthogonal(raw.points); if(index===0){(globalThis as any).__verticalTrace={input:structuredClone(input),placed:structuredClone(placed),quotient:structuredClone(quotient),events:[]}}`)
  source=source.replace('points = simplifyOrthogonal([...first, ...core.slice(1, -1), ...last])',`points = simplifyOrthogonal([...first, ...core.slice(1, -1), ...last]); (globalThis as any).__verticalTrace.events.push({stage:'primary',index,first:structuredClone(first),last:structuredClone(last),core:structuredClone(core),anchor:structuredClone(sharedPrimaryAnchor),sourceDirection,targetDirection,titleOwner,title,points:structuredClone(points)})`)
  const commit='const finalPoints = points'
  if(source.split(commit).length!==2)throw Error('Final owner changed')
  source=source.replace(commit,`(globalThis as any).__verticalTrace.events.push({stage:'commit',index,points:structuredClone(points)}); const finalPoints = points`)
  return {contents:source,loader:'ts'}
 })
}})
