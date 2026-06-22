/* The brand mark — a small layered directed graph, after Kozo Sugiyama's method
   for drawing DAGs (rank assignment, crossing minimisation, downward flow): the
   algorithm family the layout engine uses. Three ranks; one edge (A→E) spans two
   ranks and is routed through a dummy node V in rank 2, the framework's signature
   move — a gentle bend that rewards a second look.

   On load the ranks settle into place top-to-bottom (the layer-assignment step),
   then the edges route in (CSS, in styles.css). A WebGL shader paints the accent
   ground and sweeps a soft light DOWN through the ranks now and then. Static under
   prefers-reduced-motion; quicker on hover; flat-accent fallback without WebGL.

   Coordinates (viewBox 48, top-down) are shared with the shader and with
   favicon.svg / the docs end-mark. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

  const N = { A: [24, 9], B: [12, 24], C: [36, 24], D: [15, 39], E: [33, 39], V: [28, 24] }; // V = dummy node

  function graphSVG() {
    const svg = el('svg', { viewBox: '0 0 48 48', fill: 'none', 'aria-hidden': 'true' });
    const line = (a, b, cls) => el('line', { x1: N[a][0], y1: N[a][1], x2: N[b][0], y2: N[b][1], stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', class: cls });
    svg.appendChild(line('A', 'B', 'edge')); svg.appendChild(line('A', 'C', 'edge'));
    svg.appendChild(line('B', 'D', 'edge')); svg.appendChild(line('C', 'E', 'edge'));
    // long edge A→E routed through the dummy V (the bend)
    svg.appendChild(el('polyline', { points: `${N.A} ${N.V} ${N.E}`, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'edge edge-long' }));
    const node = (k, rank) => el('circle', { cx: N[k][0], cy: N[k][1], r: 2.7, fill: 'currentColor', class: 'node nrank' + rank });
    svg.appendChild(node('A', 1));
    svg.appendChild(node('B', 2)); svg.appendChild(node('C', 2));
    svg.appendChild(node('D', 3)); svg.appendChild(node('E', 3));
    svg.appendChild(el('circle', { cx: N.V[0], cy: N.V[1], r: 1.8, stroke: 'currentColor', 'stroke-width': 1.3, class: 'dummy' })); // virtual node: hollow
    return svg;
  }

  const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const FRAG = `precision highp float;
    uniform vec2 u_res; uniform float u_time; uniform float u_hover;
    float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h); }
    void main(){
      vec2 uv = gl_FragCoord.xy / u_res;
      vec3 aDeep = vec3(0.043, 0.388, 0.310), aMid = vec3(0.055, 0.435, 0.336);
      vec3 col = mix(aDeep, aMid, smoothstep(0.0, 1.0, uv.y));
      vec2 P = vec2(uv.x, 1.0 - uv.y) * 48.0;
      vec2 A=vec2(24.,9.), B=vec2(12.,24.), C=vec2(36.,24.), D=vec2(15.,39.), E=vec2(33.,39.), V=vec2(28.,24.);
      float g = 1e9;
      g=min(g, length(P-A)-2.7); g=min(g, length(P-B)-2.7); g=min(g, length(P-C)-2.7);
      g=min(g, length(P-D)-2.7); g=min(g, length(P-E)-2.7);
      g=min(g, sdSeg(P,A,B)-1.0); g=min(g, sdSeg(P,A,C)-1.0); g=min(g, sdSeg(P,B,D)-1.0);
      g=min(g, sdSeg(P,C,E)-1.0); g=min(g, sdSeg(P,A,V)-1.0); g=min(g, sdSeg(P,V,E)-1.0);
      float halo = smoothstep(3.4, 0.6, g);
      float band = fract(u_time * (0.12 + 0.07 * u_hover)) * 88.0 - 20.0;   // sweep descends the ranks
      float sweep = smoothstep(7.0, 0.0, abs(P.y - band));
      col = mix(col, vec3(0.64, 0.87, 0.77), halo * sweep * (0.6 + 0.35 * u_hover));
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
