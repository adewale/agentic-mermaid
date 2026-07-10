/* Shared, dependency-free motion primitives for the editor. The API is kept
 * DOM-free so timers and geometry can be tested with fake rAF/performance. */
var EditorMotion = (function() {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function adaptiveRenderDelay(lastSuccessfulMs) {
    if (!Number.isFinite(lastSuccessfulMs)) return 300;
    return clamp(lastSuccessfulMs * 1.5, 60, 300);
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function springTo(options) {
    var from = options.from;
    var to = options.to;
    var velocity = options.velocity || 0;
    var response = Math.max(0.05, options.response || 0.3);
    var onFrame = options.onFrame || function() {};
    var onDone = options.onDone;
    var omega = (2 * Math.PI) / response;
    var A = from - to;
    var B = velocity + omega * A;
    var start = performance.now();
    var frameId = 0;
    var active = true;
    var state = { value: from, velocity: velocity };

    function frame(now) {
      if (!active) return;
      var t = Math.max(0, (now - start) / 1000);
      var decay = Math.exp(-omega * t);
      state.value = to + (A + B * t) * decay;
      state.velocity = (B - omega * (A + B * t)) * decay;
      if (Math.abs(state.value - to) < 0.001 * Math.max(1, Math.abs(A)) && Math.abs(state.velocity) < 0.01) {
        state.value = to;
        state.velocity = 0;
        onFrame(state.value, state.velocity);
        active = false;
        if (onDone) onDone(state.value, state.velocity);
        return;
      }
      onFrame(state.value, state.velocity);
      frameId = requestAnimationFrame(frame);
    }

    frameId = requestAnimationFrame(frame);
    return {
      cancel: function() {
        if (!active) return;
        active = false;
        cancelAnimationFrame(frameId);
      },
      getState: function() { return { value: state.value, velocity: state.velocity }; },
    };
  }

  function decay2d(options) {
    var vx = options.vx || 0;
    var vy = options.vy || 0;
    var rate = options.rate || 0.998;
    var onFrame = options.onFrame || function() {};
    var onDone = options.onDone;
    var last = performance.now();
    var frameId = 0;
    var active = true;

    function frame(now) {
      if (!active) return;
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      var factor = Math.pow(rate, dt * 1000);
      vx *= factor;
      vy *= factor;
      if (Math.hypot(vx, vy) < 4) {
        active = false;
        if (onDone) onDone();
        return;
      }
      if (onFrame(vx * dt, vy * dt, vx, vy) === false) {
        active = false;
        if (onDone) onDone();
        return;
      }
      frameId = requestAnimationFrame(frame);
    }

    frameId = requestAnimationFrame(frame);
    return {
      cancel: function() {
        if (!active) return;
        active = false;
        cancelAnimationFrame(frameId);
      },
      getVelocity: function() { return { vx: vx, vy: vy }; },
    };
  }

  function makeVelocityTracker() {
    var samples = [];
    return {
      reset: function() { samples.length = 0; },
      push: function(time, x, y) {
        samples.push({ time: time, x: x, y: y });
        while (samples.length > 2 && time - samples[0].time > 100) samples.shift();
      },
      get: function() {
        if (samples.length < 2) return { vx: 0, vy: 0 };
        var first = samples[0];
        var last = samples[samples.length - 1];
        var elapsed = (last.time - first.time) / 1000;
        if (elapsed <= 0) return { vx: 0, vy: 0 };
        return { vx: (last.x - first.x) / elapsed, vy: (last.y - first.y) / elapsed };
      },
    };
  }

  return {
    adaptiveRenderDelay: adaptiveRenderDelay,
    clamp: clamp,
    decay2d: decay2d,
    makeVelocityTracker: makeVelocityTracker,
    reduced: reduced,
    springTo: springTo,
  };
})();
