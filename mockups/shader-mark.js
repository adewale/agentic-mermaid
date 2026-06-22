/* The brand mark — the product's own primitive, not a sea metaphor: two nodes
   joined by a deterministically routed orthogonal edge (what the layout engine
   makes). A WebGL shader renders the accent ground and sends a faint signal
   travelling the edge now and then — an agent moving through the diagram. Static
   under prefers-reduced-motion; the signal quickens on hover; falls back to the
   flat accent fill (white diagram still shown) if WebGL is unavailable.

   The edge route is shared, in viewBox(48) coords, with the shader (as uv with a
   flipped y) and with favicon.svg / the docs end-mark. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function diagramSVG() {
    const svg = el('svg', { viewBox: '0 0 48 48', fill: 'none', 'aria-hidden': 'true' });
    svg.appendChild(el('rect', { x: 6, y: 8, width: 15, height: 10, rx: 3, fill: 'currentColor' }));      // node A
    svg.appendChild(el('rect', { x: 27, y: 30, width: 15, height: 10, rx: 3, fill: 'currentColor' }));    // node B
    svg.appendChild(el('path', { d: 'M21,13 H34.5 V28.5', stroke: 'currentColor', 'stroke-width': 2.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    svg.appendChild(el('path', { d: 'M34.5,30.5 L32.3,26.4 L36.7,26.4 Z', fill: 'currentColor' }));       // arrowhead into B
    return svg;
  }

  const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const FRAG = `precision highp float;
    uniform vec2 u_res; uniform float u_time; uniform float u_hover;
    float seg(vec2 p, vec2 a, vec2 b, float base, out float arc){
      vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      arc = base + h * length(ba); return length(pa - ba * h);
    }
    void main(){
      vec2 uv = gl_FragCoord.xy / u_res;
      // accent ground: a gentle vertical gradient, no caustic
      vec3 aDeep = vec3(0.043, 0.388, 0.310);
      vec3 aMid  = vec3(0.055, 0.435, 0.336);
      vec3 col = mix(aDeep, aMid, smoothstep(0.0, 1.0, uv.y));
      // edge route A->B->C (viewBox 21,13 -> 34.5,13 -> 34.5,28.5, as uv with flipped y)
      vec2 A = vec2(0.43750, 0.72917), B = vec2(0.71875, 0.72917), C = vec2(0.71875, 0.40625);
      float L1 = length(B - A), L2 = length(C - B), L = L1 + L2;
      float a1, a2;
      float d1 = seg(uv, A, B, 0.0, a1);
      float d2 = seg(uv, B, C, L1, a2);
      float dist = min(d1, d2);
      float arc = d1 < d2 ? a1 : a2;
      col = mix(col, aMid, smoothstep(0.05, 0.0, dist) * 0.14);          // faint wire so the route reads
      float head = fract(u_time * (0.16 + 0.10 * u_hover)) * (L + 0.55) - 0.30;  // signal sweeps, with a gap
      float along = smoothstep(0.13, 0.0, abs(arc - head));
      float near = smoothstep(0.075, 0.0, dist);
      col = mix(col, vec3(0.64, 0.87, 0.77), near * along * (0.55 + 0.35 * u_hover));
      float d = distance(uv, vec2(0.5));
      col *= 1.0 - 0.18 * smoothstep(0.25, 0.82, d);
      gl_FragColor = vec4(col, 1.0);
    }`;

  function setup(mark) {
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.appendChild(diagramSVG());
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
    if (reduce) { draw(0.0, 0); return; }   // t=0 sits in the signal's gap: clean static diagram
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
