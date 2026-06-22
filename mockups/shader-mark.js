/* A living brand mark — a restrained caustic shimmer confined to the 26px logo.
   On-brand: the product is "mermaid" and the glyph is a wave. Pine→mint palette,
   slow time, low contrast, so it reads as a shimmer rather than a spectacle.
   Static single frame under prefers-reduced-motion; a gentle stir on hover.
   Falls back to the flat accent fill if WebGL is unavailable. */
(function () {
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
      col *= 1.0 - 0.22 * smoothstep(0.2, 0.78, d);   // soft vignette keeps the glyph legible
      gl_FragColor = vec4(col, 1.0);
    }`;

  function setup(mark) {
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = (mark.textContent || '').trim();
    const canvas = document.createElement('canvas');
    mark.textContent = '';
    mark.appendChild(canvas);
    mark.appendChild(glyph);

    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) { canvas.remove(); return; }   // CSS flat accent remains as fallback

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
    if (reduce) { draw(2.0, 0); return; }    // one settled frame, no loop
    function frame(ms) { hover += (target - hover) * 0.08; draw(ms * 0.001, hover); requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  }

  function init() { document.querySelectorAll('.mark').forEach(setup); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
