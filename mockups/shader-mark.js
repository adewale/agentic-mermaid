/* The brand mark — a small layered directed graph, after Kozo Sugiyama's method
   for drawing DAGs. Flipped so the flow converges downward: three source nodes
   (the prong tips) route through dummy nodes in the middle rank to one sink (the
   handle), so the layered drawing vaguely resembles a trident — a wink back at an
   earlier idea, but emergent from the layout rather than drawn as one. Every edge
   spans two ranks, so each is routed through a dummy; the three dummies line up as
   the crossbar.

   On load the ranks settle into place (layer assignment), then the long edges
   route through the dummies (edge routing). A WebGL shader sweeps a soft light
   down through the ranks now and then. Static under prefers-reduced-motion;
   quicker on hover; flat-accent fallback without WebGL. Coordinates (viewBox 48)
   are shared with the shader and favicon.svg / the docs end-mark. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

  // CRAP-tuned: tines on a 3-column grid (14/24/34), center tine taller, dead-centre shaft;
  // y-rows shifted +2.5 from the rank grid so the glyph's bounding box sits centred in the 48 box
  const N = { L: [14, 9.5], M: [24, 6.5], R: [34, 9.5], Vl: [14, 24.5], Vm: [24, 24.5], Vr: [34, 24.5], H: [24, 40.5] };

  function graphSVG() {
    const svg = el('svg', { viewBox: '0 0 48 48', fill: 'none', 'aria-hidden': 'true' });
    const longEdge = (tip, dummy, sw) => el('polyline', { points: `${N[tip]} ${N[dummy]} ${N.H}`, stroke: 'currentColor', 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'edge edge-long' });
    svg.appendChild(longEdge('L', 'Vl', 1.9)); svg.appendChild(longEdge('M', 'Vm', 2.4)); svg.appendChild(longEdge('R', 'Vr', 1.9)); // heavier central shaft = contrast
    const node = (k, rank, r) => el('circle', { cx: N[k][0], cy: N[k][1], r: r, fill: 'currentColor', class: 'node nrank' + rank });
    svg.appendChild(node('L', 1, 2.5)); svg.appendChild(node('M', 1, 2.5)); svg.appendChild(node('R', 1, 2.5));
    svg.appendChild(node('H', 3, 3.3));   // sink is the focal point = contrast
    for (const k of ['Vl', 'Vm', 'Vr']) svg.appendChild(el('circle', { cx: N[k][0], cy: N[k][1], r: 1.7, stroke: 'currentColor', 'stroke-width': 1.3, class: 'dummy' }));
    return svg;
  }

  const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const FRAG = `precision highp float;
    uniform vec2 u_res; uniform float u_time; uniform float u_hover;
    uniform vec3 u_cDeep; uniform vec3 u_cMid; uniform vec3 u_cSweep;
    float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h); }
    void main(){
      vec2 uv = gl_FragCoord.xy / u_res;
      vec3 aDeep = u_cDeep, aMid = u_cMid;
      vec3 col = mix(aDeep, aMid, smoothstep(0.0, 1.0, uv.y));
      vec2 P = vec2(uv.x, 1.0 - uv.y) * 48.0;
      vec2 L=vec2(14.,9.5), M=vec2(24.,6.5), R=vec2(34.,9.5);
      vec2 Vl=vec2(14.,24.5), Vm=vec2(24.,24.5), Vr=vec2(34.,24.5), H=vec2(24.,40.5);
      float g = 1e9;
      g=min(g,length(P-L)-2.5); g=min(g,length(P-M)-2.5); g=min(g,length(P-R)-2.5); g=min(g,length(P-H)-3.3);
      g=min(g,sdSeg(P,L,Vl)-0.95); g=min(g,sdSeg(P,Vl,H)-0.95);
      g=min(g,sdSeg(P,M,Vm)-1.15); g=min(g,sdSeg(P,Vm,H)-1.15);
      g=min(g,sdSeg(P,R,Vr)-0.95); g=min(g,sdSeg(P,Vr,H)-0.95);
      float halo = smoothstep(3.4, 0.6, g);
      float band = fract(u_time * (0.12 + 0.07 * u_hover)) * 88.0 - 20.0;
      float sweep = smoothstep(7.0, 0.0, abs(P.y - band));
      col = mix(col, u_cSweep, halo * sweep * (0.6 + 0.35 * u_hover));
      float d = distance(uv, vec2(0.5));
      col *= 1.0 - 0.18 * smoothstep(0.25, 0.82, d);
      gl_FragColor = vec4(col, 1.0);
    }`;

  function setup(mark) {
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.appendChild(graphSVG());
    const canvas = document.createElement('canvas');
    mark.textContent = '';
    mark.appendChild(canvas);
    mark.appendChild(glyph);

    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) { canvas.remove(); return; }

    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uHover = gl.getUniformLocation(prog, 'u_hover');

    // mark palette from CSS custom properties (the brand layer), so the green is
    // declared in CSS alongside the other brand tokens rather than hard-coded
    // here. --m-sweep lighter than the chip lifts; darker than it dips — which
    // is how a light chip keeps a visible sweep. Falls back to the pine palette.
    const hexToVec3 = (h) => { h = (h || '').trim().replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16) || 0; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    const cs = getComputedStyle(mark);
    const pick = (name, def) => { const v = cs.getPropertyValue(name); return hexToVec3(v && v.trim() ? v : def); };
    gl.uniform3fv(gl.getUniformLocation(prog, 'u_cDeep'), pick('--m-deep', '#0B634F'));
    gl.uniform3fv(gl.getUniformLocation(prog, 'u_cMid'), pick('--m-mid', '#0E6F56'));
    gl.uniform3fv(gl.getUniformLocation(prog, 'u_cSweep'), pick('--m-sweep', '#A3DEC4'));

    let hover = 0, target = 0;
    mark.addEventListener('pointerenter', () => { target = 1; });
    mark.addEventListener('pointerleave', () => { target = 0; });

    function resize() {
      const r = Math.max(1, window.devicePixelRatio || 1);
      const w = mark.clientWidth || 26, h = mark.clientHeight || 26;
      canvas.width = Math.round(w * r); canvas.height = Math.round(h * r);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function draw(timeSec, hov) {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, timeSec);
      gl.uniform1f(uHover, hov);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (reduce) { draw(0.0, 0); return; }
    function frame(ms) {
      hover += (target - hover) * 0.08;
      const tt = (typeof window.__SHADER_TIME__ === 'number') ? window.__SHADER_TIME__ : ms * 0.001;
      draw(tt, hover);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function init() { document.querySelectorAll('.mark').forEach(setup); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
