/* The brand mark — a white forged trident (Poseidon, the sea, the mermaid) over
   a restrained caustic shimmer rendered by a WebGL fragment shader. Pine→mint,
   slow, low-contrast, so the water reads as a shimmer rather than a spectacle.
   The trident is one vector path, shared with the docs end-mark. Static single
   frame under prefers-reduced-motion; the water stirs a little on hover; falls
   back to the flat accent fill (trident still shown) if WebGL is unavailable. */
(function () {
  // refined trident silhouette (filled vector parts, viewBox 0 0 48 48)
  const TRIDENT = [
    'M24,22 C22.2,16 22.2,9.5 24,4 C25.8,9.5 25.8,16 24,22 Z',                 // centre leaf blade
    'M15.5,22 C12.3,18.4 11.6,12.4 13.2,7.4 C13.0,11.8 14.2,16.6 17.4,21 Z',   // left tine
    'M32.5,22 C35.7,18.4 36.4,12.4 34.8,7.4 C35.0,11.8 33.8,16.6 30.6,21 Z',   // right tine
    'M13,21 L24,19.4 L35,21 L24,23.2 Z',                                       // collar
    'M23.1,22 L24.9,22 L24.9,42 L23.1,42 Z',                                   // shaft
    'M24,42 L26.2,45 L24,48 L21.8,45 Z',                                       // finial
  ];
  const NS = 'http://www.w3.org/2000/svg';
  function tridentSVG() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of TRIDENT) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); }
    return svg;
  }

  const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const FRAG = `precision highp float;
    uniform vec2 u_res; uniform float u_time; uniform float u_hover;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1.,0.)), u.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), u.x), u.y); }
    float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.0; a*=0.5; } return v; }
    void main(){
      vec2 uv = gl_FragCoord.xy / u_res;
      float t = u_time * (0.15 + u_hover * 0.20);
      vec2 q = vec2(fbm(uv*3.0 + t), fbm(uv*3.0 + vec2(5.2, 1.3) - t));
      float f = fbm(uv*3.4 + 1.6*q + vec2(0.0, t*0.5));
      float caustic = pow(abs(sin(f*6.2831853 + t*1.2)), 2.2);
      vec3 deep = vec3(0.035, 0.310, 0.250);
      vec3 mid  = vec3(0.055, 0.431, 0.333);
      vec3 mint = vec3(0.435, 0.760, 0.640);
      vec3 col = mix(deep, mid, f);
      col = mix(col, mint, caustic * (0.42 + 0.28 * u_hover));
      float d = distance(uv, vec2(0.5));
      col *= 1.0 - 0.22 * smoothstep(0.2, 0.78, d);   // soft vignette
      gl_FragColor = vec4(col, 1.0);
    }`;

  function setup(mark) {
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.appendChild(tridentSVG());          // the white trident is the logo
    const canvas = document.createElement('canvas');
    mark.textContent = '';
    mark.appendChild(canvas);
    mark.appendChild(glyph);

    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) { canvas.remove(); return; }      // trident on the flat accent fill remains

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
    if (reduce) { draw(2.0, 0); return; }
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
