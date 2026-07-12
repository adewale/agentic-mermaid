// Deterministic per-family fuzz generators for the overlap audit (hash-seeded, no RNG).
const H = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0)
const pick = <T,>(arr: T[], i: number): T => arr[H(i) % arr.length]!
const R = (i: number, n: number) => H(i) % n
const W = ['ok', 'retry', 'x', 'done', 'validate input', 'a longer label goes here', 'errors', 'warnings', 'process the request', 'q', 'same word ok', 'fan out', 'reads profiles']
const w = (i: number) => pick(W, i)
export const gen: Record<string, (i: number) => string> = {
  flowchart(i) {
    const d = pick(['LR', 'TD', 'RL', 'BT'], i), n = 4 + R(i, 6), L = [`flowchart ${d}`]
    const shp = (id: string, t: string, k: number) => [`${id}["${t}"]`, `${id}{${t}}`, `${id}((${t}))`, `${id}(["${t}"])`, `${id}[(${t})]`][k % 5]
    for (let a = 0; a < n; a++) L.push(`  ${shp('N' + a, w(i + a), H(i + a) % 5)}`)
    for (let e = 0; e < 3 + R(i >> 2, 7); e++) {
      const s = H(i * 7 + e) % n, t = H(i * 13 + e + 1) % n
      if (s === t) continue
      L.push(`  N${s} ${pick(['-->', '--->', '===>'], i + e)}${R(i + e, 2) ? `|${w(i + e)}|` : ''} N${t}`)
    }
    return L.join('\n')
  },
  state(i) {
    const n = 3 + R(i, 5), L = ['stateDiagram-v2', `  direction ${pick(['LR', 'TB'], i)}`, '  [*] --> S0']
    for (let e = 0; e < 3 + R(i >> 1, 6); e++) {
      const s = H(i * 3 + e) % n, t = H(i * 5 + e + 1) % n
      L.push(`  S${s} --> S${t}: ${w(i + e)}`)
    }
    L.push(`  S${R(i, n)} --> [*]`)
    return L.join('\n')
  },
  sequence(i) {
    const n = 2 + R(i, 3), L = ['sequenceDiagram']
    for (let a = 0; a < n; a++) L.push(`  participant P${a}`)
    for (let m = 0; m < 3 + R(i >> 1, 6); m++) {
      const s = H(i * 3 + m) % n, t = H(i * 5 + m + 1) % n
      L.push(`  P${s}${pick(['->>', '-->>'], i + m)}P${t}: ${w(i + m)}`)
      if (R(i + m, 4) === 0) L.push(`  Note over P${s}: ${w(i * 2 + m)}`)
    }
    return L.join('\n')
  },
  class(i) {
    const n = 2 + R(i, 4), L = ['classDiagram']
    for (let a = 0; a < n; a++) L.push(`  class C${a} {\n    +${w(i + a).replace(/ /g, '_')} f${a}\n    +m${a}() void\n  }`)
    for (let e = 0; e < 1 + R(i >> 1, 4); e++) {
      const s = H(i * 3 + e) % n, t = H(i * 5 + e + 1) % n
      if (s === t) continue
      L.push(`  C${s} ${pick(['<|--', 'o--', '-->', '..>'], i + e)} C${t} : ${w(i + e)}`)
    }
    return L.join('\n')
  },
  er(i) {
    const n = 2 + R(i, 4), L = ['erDiagram']
    for (let e = 0; e < 1 + R(i >> 1, 5); e++) {
      const s = H(i * 3 + e) % n, t = H(i * 5 + e + 1) % n
      if (s === t) continue
      L.push(`  E${s} ${pick(['||--o{', '||--||', '}o--o{', '|o--|{'], i + e)} E${t} : "${w(i + e)}"`)
    }
    if (L.length === 1) L.push('  E0 ||--o{ E1 : "has"')
    return L.join('\n')
  },
  timeline(i) {
    const L = ['timeline', `  title ${w(i)}`]
    for (let p = 0; p < 2 + R(i, 5); p++) {
      const evs = Array.from({ length: 1 + R(i + p, 3) }, (_, k) => w(i * 3 + p + k))
      L.push(`  ${2000 + p} : ${evs.join(' : ')}`)
    }
    return L.join('\n')
  },
  gantt(i) {
    const compact = R(i, 3) === 0
    const L = [...(compact ? ['---', 'displayMode: compact', '---'] : []), 'gantt', `  title ${w(i)}`, '  dateFormat YYYY-MM-DD']
    let id = 0
    for (let s = 0; s < 1 + R(i, 3); s++) {
      L.push(`  section Sec${s}`)
      for (let t = 0; t < 2 + R(i + s, 4); t++) {
        const start = R(i * 3 + s + t, 12) + 1, dur = 2 + R(i * 5 + t, 8)
        L.push(`  ${w(i + id)} :t${id}, 2024-01-${String(start).padStart(2, '0')}, ${dur}d`)
        id++
      }
    }
    return L.join('\n')
  },
  journey(i) {
    const L = ['journey', `  title ${w(i)}`]
    for (let s = 0; s < 1 + R(i, 3); s++) {
      L.push(`  section Sec${s}`)
      for (let t = 0; t < 2 + R(i + s, 4); t++) L.push(`    ${w(i * 3 + s + t)}: ${1 + R(i + t, 5)}: Me${R(i + t, 2) ? ', Team' : ''}`)
    }
    return L.join('\n')
  },
  architecture(i) {
    const g = 1 + R(i, 2), n = 2 + R(i, 4), L = ['architecture-beta']
    for (let a = 0; a < g; a++) L.push(`  group g${a}(cloud)[${w(i + a)}]`)
    for (let a = 0; a < n; a++) L.push(`  service s${a}(${pick(['server', 'database', 'disk', 'internet'], i + a)})[${w(i * 2 + a)}] in g${a % g}`)
    for (let e = 0; e < 1 + R(i >> 1, 4); e++) {
      const s = H(i * 3 + e) % n, t = H(i * 5 + e + 1) % n
      if (s === t) continue
      const sides = ['L', 'R', 'T', 'B']
      L.push(`  s${s}:${pick(sides, i + e)} ${R(i + e, 2) ? `-[${w(i + e)}]->` : '-->'} ${pick(sides, i * 2 + e)}:s${t}`)
    }
    return L.join('\n')
  },
  xychart(i) {
    const cats = Array.from({ length: 3 + R(i, 6) }, (_, k) => w(i * 3 + k).replace(/ /g, '-'))
    const vals = () => `[${cats.map((_, k) => R(i * 7 + k, 500) + 5).join(', ')}]`
    const L = ['xychart-beta', `  title "${w(i)}"`, `  x-axis [${cats.join(', ')}]`, `  y-axis "${w(i + 1)}" 0 --> ${500 + R(i, 9000)}`, `  bar ${vals()}`]
    if (R(i, 2)) L.push(`  line ${vals()}`)
    return L.join('\n')
  },
  pie(i) {
    const L = [`pie${R(i, 2) ? ' showData' : ''} title ${w(i)}`]
    for (let s = 0; s < 2 + R(i, 6); s++) L.push(`  "${w(i * 3 + s)} ${s}" : ${R(i * 5 + s, 3) === 0 ? 1 + R(i + s, 4) : 10 + R(i + s, 300)}`)
    return L.join('\n')
  },
  quadrant(i) {
    const L = ['quadrantChart', `  title ${w(i)}`, `  x-axis Low --> High`, `  y-axis Bad --> Good`,
      `  quadrant-1 ${w(i + 1)}`, `  quadrant-2 ${w(i + 2)}`, `  quadrant-3 ${w(i + 3)}`, `  quadrant-4 ${w(i + 4)}`]
    for (let p = 0; p < 2 + R(i, 7); p++) L.push(`  ${w(i * 3 + p)} ${p}: [0.${R(i * 5 + p, 10)}${R(i * 7 + p, 10)}, 0.${R(i * 11 + p, 10)}${R(i * 13 + p, 10)}]`)
    return L.join('\n')
  },
  mindmap(i) {
    const L = ['mindmap', `  root((Root ${i}))`]
    for (let branch = 0; branch < 2 + R(i, 5); branch++) {
      L.push(`    Branch ${branch} ${w(i + branch)}`)
      for (let child = 0; child < 1 + R(i + branch, 3); child++) {
        L.push(`      Item ${branch}.${child} ${w(i * 3 + branch + child)}`)
      }
    }
    return L.join('\n')
  },
  gitgraph(i) {
    const branches = 1 + R(i, 4)
    const L = ['gitGraph LR:', `  commit id:"root-${i}" msg:"${w(i)}"`]
    for (let branch = 0; branch < branches; branch++) {
      L.push(`  branch b${branch} order:${branch + 1}`)
      L.push(`  commit id:"b${branch}-${i}" msg:"${w(i * 3 + branch)}" tag:"v${i}.${branch}"`)
      L.push('  checkout main')
    }
    L.push(`  merge b${branches - 1} id:"merge-${i}"`)
    return L.join('\n')
  },
}
