/* ISC 2.0 dashboard hero scene (D-090). Hand-written WebGL1, no library, no images, no network: a procedural low-poly
   courier rocket (after the GL100 "Frontier Beacon" sheet: teal hull, cream bands, gold trim, porthole, warm engine glow)
   floating over a small banded planet with craters, clouds and an atmosphere rim, in front of point-sprite stars.
   Decorative only: the container carries the text alternative, the canvas is aria-hidden and ignores pointer events.
   Pure helpers (mode decision, quality, geometry, matrices) are exported for the Node tests. */
(function (root, factory) {
  'use strict';
  var S = factory();
  if (typeof module === 'object' && module.exports) module.exports = S;
  else root.PMScene = S;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ palette (game UI tokens, Slice.uss + GL100 rocket sheet)
  function hex(h, a) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, a == null ? 1 : a];
  }
  var C = {
    teal: hex('#22a596'), tealDeep: hex('#17766f'), cream: hex('#fff2c9'), gold: hex('#ffc542'), goldDeep: hex('#d98a1a'),
    glass: hex('#8ce2ff'), navy: hex('#2a2660'), ink: hex('#1b1840'),
    violet: hex('#9b7bff'), lavender: hex('#b6a8ff'), blue: hex('#5b7cff'), deep: hex('#3a2f8c'), amber: hex('#ffc542'), coral: hex('#ff9a7a'),
    cloud: hex('#f5f3ff', 0.9), rim: hex('#5fe0c8'), glow: hex('#ffe08a'), white: hex('#ffffff')
  };

  // ------------------------------------------------------------ pure decisions
  /* Which mode to run: 'fallback' (static SVG), 'static' (one rendered WebGL frame, no loop) or 'animate'.
     o = { param: ?scene= value, webgl: context available, reducedMotion: prefers-reduced-motion }. */
  function decideMode(o) {
    o = o || {};
    var p = String(o.param || '').toLowerCase();
    if (p === 'off' || p === 'svg' || p === 'fallback') return 'fallback';
    if (!o.webgl) return 'fallback';
    if (o.reducedMotion || p === 'static') return 'static';
    return 'animate';
  }
  /* Render budget from the hero width and devicePixelRatio: DPR capped (1.5, or 1.25 on narrow screens), fewer stars on mobile. */
  function quality(width, dpr) {
    var mobile = !(width >= 600);
    var cap = mobile ? 1.25 : 1.5;
    return { mobile: mobile, dpr: Math.max(1, Math.min(cap, dpr || 1)), stars: mobile ? 240 : 560, planetDetail: mobile ? 2 : 3 };
  }

  // ------------------------------------------------------------ vectors and matrices (column-major)
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function ident() { var m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function persp(fovy, asp, n, f) {
    var t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f);
    return m;
  }
  function lookAt(e, c, u) {
    var z = norm(sub(e, c)), x = norm(cross(u, z)), y = cross(z, x), m = ident();
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
    m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
    m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
    m[12] = -dot(x, e); m[13] = -dot(y, e); m[14] = -dot(z, e);
    return m;
  }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a), m = ident(); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a), m = ident(); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a), m = ident(); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
  function trans(x, y, z) { var m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function scale(s) { var m = ident(); m[0] = m[5] = m[10] = s; return m; }
  function chain() { var m = arguments[0]; for (var i = 1; i < arguments.length; i++) m = mul(m, arguments[i]); return m; }
  function apply(m, p) {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  }

  // ------------------------------------------------------------ procedural geometry (flat-shaded triangles)
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function Mesh() { this.p = []; this.n = []; this.c = []; }
  Mesh.prototype.tri = function (a, b, c, col, na, nb, nc) {
    var f = norm(cross(sub(b, a), sub(c, a)));
    var vs = [a, b, c], ns = [na || f, nb || f, nc || f];
    for (var i = 0; i < 3; i++) {
      this.p.push(vs[i][0], vs[i][1], vs[i][2]);
      this.n.push(ns[i][0], ns[i][1], ns[i][2]);
      this.c.push(col[0], col[1], col[2], col[3]);
    }
  };
  Mesh.prototype.quad = function (a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); };
  Mesh.prototype.count = function () { return this.p.length / 3; };

  /* Surface of revolution around +Y. prof = [[radius, y, colour of the band up to the next ring], ...]; m = optional transform. */
  function lathe(mesh, prof, seg, m, phase) {
    phase = phase || 0;
    var ring = function (r, y, i) { var a = phase + i / seg * Math.PI * 2, p = [r * Math.cos(a), y, r * Math.sin(a)]; return m ? apply(m, p) : p; };
    for (var j = 0; j < prof.length - 1; j++) {
      var A = prof[j], B = prof[j + 1], col = A[2] || B[2];
      for (var i = 0; i < seg; i++) {
        var a0 = ring(A[0], A[1], i), a1 = ring(A[0], A[1], i + 1), b0 = ring(B[0], B[1], i), b1 = ring(B[0], B[1], i + 1);
        if (A[0] === 0) mesh.tri(a0, b1, b0, col);
        else if (B[0] === 0) mesh.tri(a0, a1, b0, col);
        else mesh.quad(a0, a1, b1, b0, col);
      }
    }
    return mesh;
  }

  /* Flat fin in the plane of the axis, extruded along the tangent. pts = [[r, y], ...] (convex outline). */
  function fin(mesh, pts, angle, thick, col) {
    var ca = Math.cos(angle), sa = Math.sin(angle), tx = -sa * thick / 2, tz = ca * thick / 2;
    var P = function (q, s) { return [q[0] * ca + s * tx, q[1], q[0] * sa + s * tz]; };
    for (var i = 1; i < pts.length - 1; i++) {
      mesh.tri(P(pts[0], 1), P(pts[i], 1), P(pts[i + 1], 1), col);
      mesh.tri(P(pts[0], -1), P(pts[i + 1], -1), P(pts[i], -1), col);
    }
    for (var k = 0; k < pts.length; k++) {
      var q0 = pts[k], q1 = pts[(k + 1) % pts.length];
      mesh.quad(P(q0, 1), P(q0, -1), P(q1, -1), P(q1, 1), col);
    }
  }

  function buildRocket() {
    var m = new Mesh(), seg = 12, T = C.teal, W = C.cream, G = C.gold, N = C.navy;
    lathe(m, [[0, -1.05, N], [0.30, -1.05, G], [0.40, -0.96, T], [0.46, -0.62, W], [0.48, -0.40, T], [0.48, -0.08, W],
      [0.47, 0.14, T], [0.43, 0.58, G], [0.44, 0.68, T], [0.37, 0.98, T], [0.25, 1.24, T], [0.11, 1.44, G], [0, 1.56, G]], seg);
    lathe(m, [[0.17, -1.04, N], [0.22, -1.22, N], [0.30, -1.36, N], [0.26, -1.36, N], [0.15, -1.16, N]], seg);   // nozzle bell
    lathe(m, [[0.05, 1.50, G], [0, 1.92, G]], 6);                                                                  // antenna spike
    lathe(m, [[0.42, 0.60, G], [0.62, 0.60, G], [0.62, 0.66, G], [0.43, 0.66, G]], 16);                             // gold collar ring
    for (var f = 0; f < 3; f++) fin(m, [[0.42, -0.30], [0.86, -1.12], [0.80, -1.30], [0.38, -0.96]], Math.PI / 2 + f * Math.PI * 2 / 3 + Math.PI / 3, 0.07, C.tealDeep);
    var face = rotX(Math.PI / 2);                                                                                    // porthole faces +Z
    var place = function (y) { return chain(trans(0, y, 0), face); };
    lathe(m, [[0.20, -0.44, G], [0.20, -0.50, G], [0.14, -0.53, G], [0.14, -0.50, C.glass], [0, -0.51, C.glass]], 14, place(0.32));
    for (var b = 0; b < 3; b++) {                                                                                    // rivets on the cream band
      var a = -0.7 + b * 0.7;
      lathe(m, [[0.035, 0, G], [0.035, 0.03, G], [0, 0.04, G]], 6, chain(trans(Math.sin(a) * 0.48, -0.24, Math.cos(a) * 0.48), rotY(a), face));
    }
    return m;
  }

  function buildGlow() {
    var m = new Mesh();
    lathe(m, [[0.26, -1.34, hex('#ffc542', 0.35)], [0.20, -1.85, hex('#ffc542', 0.12)], [0, -2.5, hex('#ffc542', 0)]], 12);
    lathe(m, [[0.17, -1.30, hex('#fff2c2', 0.9)], [0.12, -1.6, hex('#ffe08a', 0.55)], [0, -1.95, hex('#ffe08a', 0)]], 10);
    return m;
  }

  // icosphere vertices + faces, subdivided d times (unit radius)
  function icosphere(d) {
    var t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
    var f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (var s = 0; s < d; s++) {
      var cache = {}, nf = [];
      var mid = function (a, b) {
        var k = a < b ? a + '_' + b : b + '_' + a;
        if (!(k in cache)) { v.push(norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])); cache[k] = v.length - 1; }
        return cache[k];
      };
      f.forEach(function (q) { var a = mid(q[0], q[1]), b = mid(q[1], q[2]), c = mid(q[2], q[0]); nf.push([q[0], a, c], [q[1], b, a], [q[2], c, b], [a, b, c]); });
      f = nf;
    }
    return { v: v, f: f };
  }

  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]; }

  function buildPlanet(detail) {
    var ico = icosphere(detail), m = new Mesh(), r = rng(7);
    var craters = [];
    for (var i = 0; i < 9; i++) craters.push({ d: norm([r() * 2 - 1, r() * 1.4 - 0.7, r() * 2 - 1]), s: 0.93 + r() * 0.05 });
    ico.f.forEach(function (q) {
      var a = ico.v[q[0]], b = ico.v[q[1]], c = ico.v[q[2]], cen = norm([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
      var wob = Math.sin(cen[0] * 5.1 + cen[2] * 3.7) * 0.18 + Math.sin(cen[2] * 9.3 - cen[0] * 2.1) * 0.07;
      var band = Math.sin((cen[1] + wob) * 5.5);
      var col = band > 0.72 ? C.lavender : band > -0.1 ? C.violet : band > -0.75 ? mix(C.violet, C.blue, 0.55) : mix(C.deep, C.violet, 0.3);
      if (Math.abs(cen[1] + wob * 0.5 + 0.18) < 0.05) col = mix(C.amber, C.coral, 0.4);
      if (cen[1] > 0.93) col = mix(C.lavender, C.white, 0.35);
      for (var k = 0; k < craters.length; k++) {
        var dd = dot(cen, craters[k].d);
        if (dd > craters[k].s + 0.03) { col = mix(col, C.deep, 0.55); break; }
        if (dd > craters[k].s) { col = mix(col, C.lavender, 0.35); break; }
      }
      m.tri(a, b, c, col);
    });
    return m;
  }

  function buildClouds() {
    var ico = icosphere(2), m = new Mesh(), R = 1.045;
    ico.f.forEach(function (q) {
      var a = ico.v[q[0]], b = ico.v[q[1]], c = ico.v[q[2]], cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      var n = Math.sin(cen[0] * 6.3 + 1.7) * Math.cos(cen[2] * 5.1 - 0.4) + Math.sin(cen[1] * 11.0 + cen[0] * 3.0) * 0.45;
      if (n > 0.62 && Math.abs(cen[1]) < 0.8) m.tri([a[0] * R, a[1] * R, a[2] * R], [b[0] * R, b[1] * R, b[2] * R], [c[0] * R, c[1] * R, c[2] * R], C.cloud);
    });
    return m;
  }

  function buildAtmosphere() {
    var ico = icosphere(3), m = new Mesh(), R = 1.16;
    ico.f.forEach(function (q) {
      var a = ico.v[q[0]], b = ico.v[q[1]], c = ico.v[q[2]];
      m.tri([a[0] * R, a[1] * R, a[2] * R], [b[0] * R, b[1] * R, b[2] * R], [c[0] * R, c[1] * R, c[2] * R], C.rim, a, b, c);   // smooth normals
    });
    return m;
  }

  function buildStars(n) {
    var r = rng(42), p = [], s = [], c = [];
    for (var i = 0; i < n; i++) {
      var th = r() * Math.PI * 2, z = -r() * 0.9 - 0.1, rr = Math.sqrt(1 - z * z), d = 22 + r() * 14;
      p.push(Math.cos(th) * rr * d, Math.sin(th) * rr * d * 0.75, z * d);
      s.push(0.8 + r() * r() * 2.4);
      var warm = r() < 0.16, col = warm ? C.glow : r() < 0.3 ? C.lavender : C.white;
      c.push(col[0], col[1], col[2]);
    }
    return { p: p, s: s, c: c, n: n };
  }

  // ------------------------------------------------------------ WebGL
  var VS = [
    'attribute vec3 aP; attribute vec3 aN; attribute vec4 aC;',
    'uniform mat4 uM; uniform mat4 uVP; varying vec3 vN; varying vec3 vW; varying vec4 vC;',
    'void main() { vec4 w = uM * vec4(aP, 1.0); vW = w.xyz; vN = (uM * vec4(aN, 0.0)).xyz; vC = aC; gl_Position = uVP * w; }'].join('\n');
  var FS = [
    'precision mediump float;',
    'varying vec3 vN; varying vec3 vW; varying vec4 vC;',
    'uniform vec3 uEye; uniform vec3 uL; uniform vec3 uKey; uniform vec3 uFill; uniform vec3 uAmb; uniform vec3 uRim; uniform float uMode; uniform float uAlpha;',
    'void main() {',
    '  vec3 n = normalize(vN); vec3 v = normalize(uEye - vW);',
    '  if (dot(n, v) < 0.0) n = -n;',
    '  float fr = 1.0 - max(dot(n, v), 0.0);',
    '  if (uMode > 1.5) { float a = pow(fr, 3.0) * uAlpha * (1.0 - smoothstep(0.82, 1.0, fr)); gl_FragColor = vec4(vC.rgb * a, a); return; }',
    '  if (uMode > 0.5) { float g = vC.a * uAlpha; gl_FragColor = vec4(vC.rgb * g, g); return; }',
    '  float d = dot(n, uL); float lit = max(d, 0.0); float back = max(-d, 0.0);',
    '  vec3 h = normalize(uL + v); float sp = pow(max(dot(n, h), 0.0), 40.0) * 0.14;',
    '  vec3 col = vC.rgb * (uAmb + uKey * lit + uFill * back) + uKey * sp + uRim * pow(fr, 2.5) * 0.5;',
    '  gl_FragColor = vec4(col * vC.a * uAlpha, vC.a * uAlpha);',
    '}'].join('\n');
  var SVS = [
    'attribute vec3 aP; attribute float aS; attribute vec3 aC; uniform mat4 uVP; uniform float uT; uniform float uPx;',
    'varying float vA; varying vec3 vC;',
    'void main() { gl_Position = uVP * vec4(aP, 1.0); gl_PointSize = aS * uPx; vC = aC;',
    '  vA = 0.6 + 0.4 * sin(uT * (0.6 + fract(aP.x * 0.37) * 1.2) + aP.y * 1.7); }'].join('\n');
  var SFS = [
    'precision mediump float; varying float vA; varying vec3 vC;',
    'void main() { vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.05, length(d)) * vA; gl_FragColor = vec4(vC * a, a); }'].join('\n');

  function compile(gl, vs, fs) {
    var p = gl.createProgram();
    [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(function (x) {
      var s = gl.createShader(x[0]);
      gl.shaderSource(s, x[1]); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader');
      gl.attachShader(p, s);
    });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link');
    var info = { p: p, a: {}, u: {} }, i, n;
    for (i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i < n; i++) { var a = gl.getActiveAttrib(p, i).name; info.a[a] = gl.getAttribLocation(p, a); }
    for (i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { var u = gl.getActiveUniform(p, i).name; info.u[u] = gl.getUniformLocation(p, u); }
    return info;
  }
  function buffer(gl, arr) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); return b; }
  function upload(gl, mesh) { return { p: buffer(gl, mesh.p), n: buffer(gl, mesh.n), c: buffer(gl, mesh.c), count: mesh.count() }; }
  function attr(gl, loc, buf, size) { if (loc == null || loc < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); }

  function getGL(canvas) {
    var opts = { alpha: true, antialias: true, premultipliedAlpha: true, depth: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false };
    try { return canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch (e) { return null; }
  }

  // ------------------------------------------------------------ the scene
  function start(host, opts) {
    if (!host || typeof window === 'undefined') return 'fallback';
    opts = opts || {};
    var win = window, canvas = host.querySelector('canvas');
    var reduced = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var gl = canvas && decideMode({ param: opts.param, webgl: true }) !== 'fallback' ? getGL(canvas) : null;
    var mode = decideMode({ param: opts.param, webgl: !!gl, reducedMotion: reduced });
    host.setAttribute('data-scene', mode);
    if (mode === 'fallback') return mode;

    var Q, prog, sprog, rocket, glow, planet, clouds, atmo, stars, starBuf = {};
    try {
      Q = quality(win.innerWidth || 800, win.devicePixelRatio || 1);
      prog = compile(gl, VS, FS); sprog = compile(gl, SVS, SFS);
      rocket = upload(gl, buildRocket()); glow = upload(gl, buildGlow()); planet = upload(gl, buildPlanet(Q.planetDetail));
      clouds = upload(gl, buildClouds()); atmo = upload(gl, buildAtmosphere());
      stars = buildStars(Q.stars);
      starBuf = { p: buffer(gl, stars.p), s: buffer(gl, stars.s), c: buffer(gl, stars.c) };
    } catch (e) {
      host.setAttribute('data-scene', 'fallback');
      return 'fallback';
    }

    var W = 0, H = 0, aspect = 1, raf = 0, visible = true, onscreen = true, lost = false, t0 = null, tilt = [0, 0], tiltGoal = [0, 0];
    function resize() {
      Q = quality(win.innerWidth || 800, win.devicePixelRatio || 1);
      var w = Math.max(1, Math.round(host.clientWidth * Q.dpr)), h = Math.max(1, Math.round(host.clientHeight * Q.dpr));
      if (w !== W || h !== H) { W = canvas.width = w; H = canvas.height = h; aspect = w / h; }
    }

    function drawMesh(mesh, model, mode, alpha) {
      gl.uniformMatrix4fv(prog.u.uM, false, model);
      gl.uniform1f(prog.u.uMode, mode); gl.uniform1f(prog.u.uAlpha, alpha);
      attr(gl, prog.a.aP, mesh.p, 3); attr(gl, prog.a.aN, mesh.n, 3); attr(gl, prog.a.aC, mesh.c, 4);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    function frame(t) {
      if (lost) return;
      resize();
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      tilt[0] += (tiltGoal[0] - tilt[0]) * 0.06; tilt[1] += (tiltGoal[1] - tilt[1]) * 0.06;
      // narrow / portrait viewports pull the camera back so both bodies stay in frame
      var dist = aspect < 1.1 ? 8.6 / Math.max(0.75, aspect) * 0.95 : 7.6;
      var eye = [tilt[0] * 0.6, 0.25 - tilt[1] * 0.4, dist];
      var proj = persp(0.62, aspect, 0.1, 80), view = lookAt(eye, [0, -0.1, 0], [0, 1, 0]), vp = mul(proj, view);
      var wide = aspect >= 1.1;
      var pPos = wide ? [1.25, -1.05, -1.4] : [0.75, -1.25, -1.4], rPos = wide ? [-0.75, 0.42, 0.8] : [-0.55, 0.5, 0.8];

      // stars (far shell, slow drift; the camera offset gives the parallax)
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(sprog.p);
      gl.uniformMatrix4fv(sprog.u.uVP, false, mul(vp, rotZ(t * 0.006)));
      gl.uniform1f(sprog.u.uT, t); gl.uniform1f(sprog.u.uPx, Q.dpr);
      attr(gl, sprog.a.aP, starBuf.p, 3); attr(gl, sprog.a.aS, starBuf.s, 1); attr(gl, sprog.a.aC, starBuf.c, 3);
      gl.drawArrays(gl.POINTS, 0, stars.n);
      [sprog.a.aP, sprog.a.aS, sprog.a.aC].forEach(function (l) { if (l >= 0) gl.disableVertexAttribArray(l); });

      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(prog.u.uVP, false, vp);
      gl.uniform3fv(prog.u.uEye, eye);
      gl.uniform3fv(prog.u.uL, norm([-0.55, 0.65, 0.55]));
      gl.uniform3fv(prog.u.uKey, [0.92, 0.78, 0.6]);
      gl.uniform3fv(prog.u.uFill, [0.22, 0.2, 0.48]);
      gl.uniform3fv(prog.u.uAmb, [0.26, 0.24, 0.42]);

      // opaque: planet, rocket
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
      var pBase = chain(trans(pPos[0], pPos[1], pPos[2]), scale(1.45), rotZ(0.38));
      gl.uniform3fv(prog.u.uRim, [0.37, 0.88, 0.78]);
      drawMesh(planet, mul(pBase, rotY(t * 0.07)), 0, 1);
      var bob = Math.sin(t * 0.9) * 0.09, sway = Math.sin(t * 0.31) * 0.32;
      var rModel = chain(trans(rPos[0] + Math.sin(t * 0.45) * 0.04, rPos[1] + bob, rPos[2]), rotZ(-0.42 + Math.sin(t * 0.7) * 0.04 - tilt[0] * 0.12),
        rotX(0.12 + tilt[1] * 0.12), rotY(sway + tilt[0] * 0.25), scale(0.6));
      gl.uniform3fv(prog.u.uRim, [0.71, 0.66, 1.0]);
      drawMesh(rocket, rModel, 0, 1);

      // translucent: clouds, atmosphere, engine glow
      gl.enable(gl.BLEND); gl.depthMask(false);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform3fv(prog.u.uRim, [0.37, 0.88, 0.78]);
      drawMesh(clouds, mul(pBase, rotY(t * 0.1 + 0.6)), 0, 0.9);
      gl.blendFunc(gl.ONE, gl.ONE);
      drawMesh(atmo, pBase, 2, 0.75);
      var flick = 1 + Math.sin(t * 9.0) * 0.07 + Math.sin(t * 23.0) * 0.04;
      drawMesh(glow, chain(rModel, trans(0, -1.3, 0), scale(flick), trans(0, 1.3, 0)), 1, 0.95);
      gl.depthMask(true);
      if (!host.classList.contains('gl-on')) host.classList.add('gl-on');
    }

    function loop(now) {
      raf = 0;
      if (t0 === null) t0 = now;
      frame(4 + (now - t0) / 1000);
      schedule();
    }
    function schedule() { if (mode === 'animate' && visible && onscreen && !lost && !raf) raf = win.requestAnimationFrame(loop); }
    function pause() { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } }

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); lost = true; pause(); host.classList.remove('gl-on'); host.setAttribute('data-scene', 'fallback');
    });

    if (mode === 'static') {
      frame(6);
      if (win.ResizeObserver) new win.ResizeObserver(function () { if (!lost) frame(6); }).observe(host);
      return mode;
    }
    win.document.addEventListener('visibilitychange', function () { visible = win.document.visibilityState !== 'hidden'; if (visible) schedule(); else pause(); });
    if (win.IntersectionObserver) new win.IntersectionObserver(function (es) { onscreen = es[0].isIntersecting; if (onscreen) schedule(); else pause(); }).observe(host);
    var heroEl = host.parentNode || host;
    heroEl.addEventListener('pointermove', function (e) {
      var b = heroEl.getBoundingClientRect();
      tiltGoal = [Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width - 0.5) * 2)), Math.max(-1, Math.min(1, ((e.clientY - b.top) / b.height - 0.5) * 2))];
    }, { passive: true });
    heroEl.addEventListener('pointerleave', function () { tiltGoal = [0, 0]; }, { passive: true });
    frame(4);                       // first frame right away (no blank hero while waiting for the first animation frame)
    schedule();
    return mode;
  }

  return {
    decideMode: decideMode, quality: quality, start: start,
    buildRocket: buildRocket, buildGlow: buildGlow, buildPlanet: buildPlanet, buildClouds: buildClouds, buildAtmosphere: buildAtmosphere,
    buildStars: buildStars, icosphere: icosphere, mul: mul, ident: ident, rotY: rotY, apply: apply, persp: persp, lookAt: lookAt
  };
});
/* ISC 2.0 portable project dashboard (D-083, visual overhaul D-090). Plain JS, no dependencies, no external requests.
   Pure calculation functions are exported for Node tests (module.exports); the browser part boots on DOMContentLoaded. */
(function (root, factory) {
  'use strict';
  var PM = factory();
  if (typeof module === 'object' && module.exports) module.exports = PM;
  else root.PM = PM;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { PM.boot(root); });
    else PM.boot(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ constants
  var DONE = ['DONE', 'RELEASED'];
  var TECH = ['IMPLEMENTED', 'QA_PASS', 'DIRECTOR_ACCEPTED'];
  var RUNGS = ['IMPLEMENTED', 'QA_PASS', 'TECHNICAL_ACCEPTED', 'DEVICE_VALIDATED', 'DIRECTOR_ACCEPTED'];
  var SCN = ['opt', 'base', 'cons'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ------------------------------------------------------------ CSV
  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false, i = 0, c;
    text = String(text || '').replace(/^﻿/, '');
    for (; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    if (!rows.length) return { columns: [], rows: [] };
    var cols = rows[0];
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      if (rows[r].length === 1 && rows[r][0] === '') continue;
      var o = {};
      for (var k = 0; k < cols.length; k++) o[cols[k]] = rows[r][k] === undefined ? '' : rows[r][k];
      out.push(o);
    }
    return { columns: cols, rows: out };
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(columns, rows) {
    var lines = [columns.map(csvCell).join(',')];
    rows.forEach(function (r) { lines.push(columns.map(function (c) { return csvCell(r[c]); }).join(',')); });
    return lines.join('\n') + '\n';
  }

  // ------------------------------------------------------------ helpers
  function num(v) { var x = parseFloat(v); return isFinite(x) && String(v).trim() !== '' ? x : null; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function isExec(r) { return r.node_type !== 'EPIC' && r.node_type !== 'PARENT'; }
  function has(arr, v) { return arr.indexOf(v) >= 0; }
  function fmtDate(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s || '—';
    var p = s.slice(0, 10).split('-');
    return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function dayNum(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; }
  function groupBy(rows, keyFn, init) {
    var order = [], m = {};
    rows.forEach(function (r) { var k = keyFn(r); if (!(k in m)) { m[k] = init(k); order.push(k); } m[k].__rows.push(r); });
    return order.map(function (k) { return m[k]; });
  }

  // ------------------------------------------------------------ calculations (pure)
  function kpi(tasks) {
    var t = tasks.filter(isExec);
    var c = function (f) { return t.filter(f).length; };
    var done = c(function (r) { return has(DONE, r.status); });
    return {
      total: t.length, done: done,
      technical: c(function (r) { return has(TECH, r.status); }),
      in_progress: c(function (r) { return r.status === 'IN_PROGRESS'; }),
      hold: c(function (r) { return r.status === 'HOLD'; }),
      blocked: c(function (r) { return r.status === 'BLOCKED'; }),
      hold_blocked: c(function (r) { return r.status === 'HOLD' || r.status === 'BLOCKED'; }),
      pct_done: t.length ? r1(done / t.length * 100) : 0
    };
  }

  function ladder(tasks) {
    var t = tasks.filter(isExec);
    var at = {}, reached = {};
    RUNGS.forEach(function (g) { at[g] = 0; });
    var none = 0;
    t.forEach(function (r) { if (has(RUNGS, r.ladder)) at[r.ladder]++; else none++; });
    var acc = 0;
    for (var i = RUNGS.length - 1; i >= 0; i--) { acc += at[RUNGS[i]]; reached[RUNGS[i]] = acc; }
    return { rungs: RUNGS.map(function (g) { return { rung: g, at: at[g], reached: reached[g] }; }), none: none, total: t.length };
  }

  function forecast(schedule) {
    return SCN.map(function (s) {
      var f = schedule.filter(function (r) { return r.scenario === s && r.finish; }).map(function (r) { return r.finish; }).sort();
      return { scenario: s, launch: f.length ? f[f.length - 1] : null };
    });
  }

  function statusGroup(st) {
    if (has(DONE, st)) return 'done';
    if (has(TECH, st)) return 'technical';
    if (st === 'IN_PROGRESS') return 'active';
    if (st === 'HOLD' || st === 'BLOCKED') return 'hold_blocked';
    return 'open';
  }

  function msProgress(tasks) {
    return groupBy(tasks.filter(isExec), function (r) { return r.milestone || '(none)'; }, function (k) {
      return { milestone: k, total: 0, done: 0, technical: 0, active: 0, hold_blocked: 0, open: 0, __rows: [] };
    }).map(function (o) {
      o.__rows.forEach(function (r) { o.total++; o[statusGroup(r.status)]++; });
      delete o.__rows; o.pct = o.total ? r1(o.done / o.total * 100) : 0; return o;
    }).sort(function (a, b) { return b.total - a.total || (a.milestone < b.milestone ? -1 : 1); });
  }

  function wsStatus(tasks) {
    return groupBy(tasks.filter(isExec), function (r) { return r.workstream || '(none)'; }, function (k) {
      return { workstream: k, total: 0, done: 0, technical: 0, active: 0, hold_blocked: 0, open: 0, __rows: [] };
    }).map(function (o) {
      o.__rows.forEach(function (r) { o.total++; o[statusGroup(r.status)]++; });
      delete o.__rows; return o;
    }).sort(function (a, b) { return b.total - a.total || (a.workstream < b.workstream ? -1 : 1); });
  }

  function ganttBase(schedule, tasks) {
    var ms = {};
    tasks.forEach(function (r) { ms[r.task_id] = r.milestone || '(none)'; });
    var g = {}, order = [];
    schedule.forEach(function (r) {
      if (r.scenario !== 'base' || !r.start || !r.finish) return;
      var m = ms[r.task_id] || '(none)';
      if (!g[m]) { g[m] = { milestone: m, start: r.start, finish: r.finish, tasks: 0 }; order.push(m); }
      var o = g[m];
      if (r.start < o.start) o.start = r.start;
      if (r.finish > o.finish) o.finish = r.finish;
      o.tasks++;
    });
    return order.map(function (m) { return g[m]; }).sort(function (a, b) {
      return a.start < b.start ? -1 : a.start > b.start ? 1 : (a.milestone < b.milestone ? -1 : 1);
    });
  }

  function resByDate(runs) {
    var g = groupBy(runs, function (r) { return r.date || 'UNKNOWN'; }, function (k) {
      return { date: k, runs: 0, worker_min: 0, lock_min: 0, __rows: [] };
    });
    return g.map(function (o) {
      o.__rows.forEach(function (r) {
        o.runs++;
        if (r.kind === 'worker') o.worker_min += num(r.duration_min) || 0;
        o.lock_min += num(r.unity_lock_min) || 0;
      });
      delete o.__rows;
      o.worker_min = r1(o.worker_min); o.lock_min = r1(o.lock_min);
      return o;
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  function resTotal(runs) {
    var w = runs.filter(function (r) { return r.kind === 'worker'; });
    var sum = function (rows, k) { return rows.reduce(function (a, r) { return a + (num(r[k]) || 0); }, 0); };
    return {
      worker_runs: w.length,
      worker_min: r1(sum(w, 'duration_min')),
      worker_h: r1(sum(w, 'duration_min') / 60),
      lock_min: r1(sum(runs, 'unity_lock_min')),
      lock_h: r1(sum(runs, 'unity_lock_min') / 60),
      unknown_runs: w.filter(function (r) { return num(r.duration_min) === null; }).length
    };
  }

  function activeRows(tasks) { return tasks.filter(function (t) { return t.status === 'IN_PROGRESS' && t.node_type !== 'EPIC'; }); }
  function holdRows(tasks) {
    return tasks.filter(function (t) {
      return (t.status === 'HOLD' || t.status === 'BLOCKED') && t.node_type !== 'EPIC' && !/POST-LAUNCH|DEFERRED/.test(t.milestone || '');
    });
  }
  function filterRegister(tasks, f) {
    var q = String(f.q || '').trim().toLowerCase();
    return tasks.filter(function (r) {
      return (!f.status || r.status === f.status) && (!f.ws || r.workstream === f.ws) &&
        (!q || (r.task_id + ' ' + r.title).toLowerCase().indexOf(q) >= 0);
    });
  }
  function distinct(rows, field) {
    var s = {};
    rows.forEach(function (r) { if (r[field]) s[r[field]] = 1; });
    return Object.keys(s).sort();
  }
  function parseQuery(search) {
    var o = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      try { o[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* malformed */ }
    });
    return o;
  }
  function takeaway(k, fc) {
    var base = fc.filter(function (x) { return x.scenario === 'base'; })[0];
    return k.done + ' of ' + k.total + ' executable launch tasks are DONE (' + k.pct_done + '%), ' + k.in_progress + ' are in progress and ' +
      k.hold_blocked + ' are on hold or blocked (deferred work excluded). The provisional base forecast puts public launch on ' + fmtDate(base && base.launch) + '.';
  }

  // ---- D-090 additions (pure): hero status, overview cards, galaxy route, decisions, register sort
  function projectStatus(k) {
    if (k.blocked > 0) return { label: 'In flight · ' + k.blocked + ' blocked', tone: 'bad' };
    if (k.hold > 0) return { label: 'In flight · ' + k.hold + ' on hold', tone: 'warn' };
    if (k.total && k.done === k.total) return { label: 'All launch tasks done', tone: 'good' };
    return { label: 'In flight', tone: 'good' };
  }

  function activeWorkstreams(ws) {
    var named = ws.filter(function (w) { return w.workstream !== '(none)'; });
    return { active: named.filter(function (w) { return w.active > 0; }).length, total: named.length };
  }

  function overview(c) {
    var k = c.reality.kpi, aw = activeWorkstreams(c.ws);   // D-100: launch-scope denominators
    var by = {};
    c.forecast.forEach(function (f) { by[f.scenario] = f.launch; });
    return [
      { key: 'progress', label: 'Overall progress', value: k.pct_done + '%', detail: k.done + ' of ' + k.total + ' launch tasks DONE',
        bar: k.total ? k.done / k.total : 0, bar2: k.total ? (k.done + k.technical) / k.total : 0, tone: 'good' },
      { key: 'done', label: 'Completed tasks', value: String(k.done), unit: '/ ' + k.total, detail: k.technical + ' more technically complete, not yet DONE', tone: 'teal' },
      { key: 'workstreams', label: 'Active workstreams', value: String(aw.active), unit: '/ ' + aw.total, detail: k.in_progress + ' launch tasks in progress', tone: 'violet' },
      { key: 'blockers', label: 'Blockers', value: String(k.blocked), detail: k.blocked + ' blocked · ' + k.hold + ' on hold (launch scope)', tone: k.blocked ? 'bad' : (k.hold ? 'warn' : 'good') },
      { key: 'forecast', label: 'Forecast · PROVISIONAL', value: fmtDate(by.base), detail: 'Base (P50); optimistic ' + fmtDate(by.opt) + ', conservative ' + fmtDate(by.cons), tone: 'warn', provisional: true }
    ];
  }

  // Milestones as planets on a route. Only existing figures (msProgress + ganttBase); order = base-schedule start, unscheduled first.
  function galaxy(ms, gantt) {
    var start = {}, finish = {};
    gantt.forEach(function (g) { start[g.milestone] = g.start; finish[g.milestone] = g.finish; });
    var rows = ms.filter(function (m) { return m.milestone !== '(none)'; });
    var max = Math.max.apply(null, rows.map(function (m) { return m.total; }).concat([1]));
    return rows.map(function (m) {
      var state = m.total && m.done === m.total ? 'done' : m.active > 0 ? 'active' : (m.hold_blocked > 0 && m.hold_blocked + m.done >= m.total) ? 'hold' : 'planned';
      return {
        milestone: m.milestone, total: m.total, done: m.done, technical: m.technical, active: m.active, hold_blocked: m.hold_blocked, pct: m.pct,
        frac: m.total ? m.done / m.total : 0, techFrac: m.total ? (m.done + m.technical) / m.total : 0,
        start: start[m.milestone] || null, finish: finish[m.milestone] || null,
        r: Math.round((9 + 13 * Math.sqrt(m.total / max)) * 10) / 10, state: state
      };
    }).sort(function (a, b) {
      var sa = a.start || '', sb = b.start || '';
      return sa < sb ? -1 : sa > sb ? 1 : (a.milestone < b.milestone ? -1 : a.milestone > b.milestone ? 1 : 0);
    });
  }

  // Positions on a gentle serpentine route that fits the given width: rows of `cols` nodes, alternate direction.
  function galaxyLayout(nodes, W) {
    var cell = 112, pad = 40, cols = Math.max(2, Math.min(nodes.length || 1, Math.floor((W - 2 * pad) / cell) + 1));
    var rowH = 116, step = cols > 1 ? (W - 2 * pad) / (cols - 1) : 0;
    var pts = nodes.map(function (n, i) {
      var row = Math.floor(i / cols), col = i % cols;
      if (row % 2) col = cols - 1 - col;
      return { x: Math.round((pad + col * step) * 10) / 10, y: 36 + row * rowH + (col % 2 ? 10 : 0), node: n };
    });
    var rows = Math.ceil(nodes.length / cols);
    return { points: pts, cols: cols, height: 36 + Math.max(0, rows - 1) * rowH + 80 };
  }

  function decisionRefs(rows, limit) {
    var c = {}, order = [];
    rows.forEach(function (r) {
      String(r.decision_ref || '').split(/[;,\s]+/).forEach(function (d) {
        if (!/^D-\d+$/.test(d)) return;
        if (!(d in c)) { c[d] = 0; order.push(d); }
        c[d]++;
      });
    });
    return order.map(function (d) { return { id: d, count: c[d] }; }).sort(function (a, b) {
      return b.count - a.count || (parseInt(a.id.slice(2), 10) - parseInt(b.id.slice(2), 10));
    }).slice(0, limit || 1e9);
  }

  var SORT_KEYS = ['task_id', 'title', 'status', 'workstream', 'milestone', 'effort_base_h', 'ladder', 'decision_ref'];
  function sortRegister(rows, key, dir) {
    if (SORT_KEYS.indexOf(key) < 0) return rows.slice();
    var sgn = dir === 'desc' ? -1 : 1, numeric = key === 'effort_base_h';
    return rows.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      var x = a.r[key] || '', y = b.r[key] || '';
      if (numeric) { x = num(x); y = num(y); if (x === null) x = ''; if (y === null) y = ''; }
      if (x === '' && y !== '') return 1;             // empty values always last
      if (y === '' && x !== '') return -1;
      var c = 0;
      if (x !== '' && y !== '') c = numeric ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true });
      return c ? c * sgn : a.i - b.i;
    }).map(function (o) { return o.r; });
  }

  // ---- D-100 "progress reality" (pure): launch-scope denominators, separate buckets, effort weighting
  // Executable = node_type not EPIC/PARENT. Launch scope = executable, milestone not POST-LAUNCH/DEFERRED, status not CANCELLED (D-117).
  var DEFERRED_RE = /POST-LAUNCH|DEFERRED/;
  function isDeferred(r) { return DEFERRED_RE.test(r.milestone || ''); }
  function isLaunch(r) { return isExec(r) && !isDeferred(r) && r.status !== 'CANCELLED'; }   // D-117: CANCELLED rows stay in the registry, never in a launch denominator
  // Mutually exclusive buckets: every launch row lands in exactly one.
  function bucket(st) {
    if (has(DONE, st)) return 'done';
    if (st === 'DIRECTOR_ACCEPTED') return 'director_accepted';
    if (st === 'IMPLEMENTED' || st === 'QA_PASS') return 'tech_pending';
    if (st === 'IN_PROGRESS') return 'in_progress';
    if (st === 'PLANNED' || st === 'READY') return 'not_started';
    if (st === 'HOLD') return 'hold';
    if (st === 'BLOCKED') return 'blocked';
    return 'other';
  }
  // Why a technically complete row is not DONE (null when the row is not technically complete).
  function techReason(r) {
    if (!has(TECH, r.status)) return null;
    if (String(r.device_status || '').trim().toUpperCase() === 'NOT TESTED') return 'device_not_tested';
    if (r.status !== 'DIRECTOR_ACCEPTED') return 'awaiting_director';
    return 'other';
  }
  // Effort in integer hundredths of an hour, so sums are exact and reproducible in Python.
  function effC(v) { var x = num(v); return x === null ? 0 : Math.round(x * 100); }
  function emptyCounts() {
    return { total: 0, done: 0, director_accepted: 0, tech_pending: 0, in_progress: 0, not_started: 0, hold: 0, blocked: 0, other: 0 };
  }
  function finishCounts(o) {
    o.technical = o.director_accepted + o.tech_pending;          // technical completion includes Director accepted (not DONE)
    o.hold_blocked = o.hold + o.blocked;
    o.remaining = o.total - o.done - o.technical;
    o.pct_done = o.total ? r1(o.done / o.total * 100) : 0;
    o.pct_done_or_tech = o.total ? r1((o.done + o.technical) / o.total * 100) : 0;
    return o;
  }
  function launchKpi(tasks) {
    var o = emptyCounts(), reasons = { device_not_tested: 0, awaiting_director: 0, other: 0 };
    tasks.filter(isLaunch).forEach(function (r) {
      o.total++; o[bucket(r.status)]++;
      var why = techReason(r); if (why) reasons[why]++;
    });
    o.reasons = reasons;
    o.containers = tasks.filter(function (r) { return !isExec(r); }).length;
    var d = emptyCounts();
    tasks.filter(function (r) { return isExec(r) && isDeferred(r); }).forEach(function (r) { d.total++; d[bucket(r.status)]++; });
    o.deferred = finishCounts(d);
    return finishCounts(o);
  }
  function effortSplit(tasks) {
    var c = { total: 0, done: 0, technical: 0, remaining: 0 }, zero = 0, rows = 0;
    tasks.filter(isLaunch).forEach(function (r) {
      var e = effC(r.effort_base_h), b = bucket(r.status);
      rows++;
      if (!e) zero++;
      c.total += e;
      if (b === 'done') c.done += e; else if (b === 'director_accepted' || b === 'tech_pending') c.technical += e; else c.remaining += e;
    });
    return { total_h: c.total / 100, done_h: c.done / 100, technical_h: c.technical / 100, remaining_h: c.remaining / 100,
      zero_effort: zero, rows: rows, weighted_rows: rows - zero };
  }
  function launchMilestones(tasks) {
    var g = {}, order = [];
    tasks.filter(isLaunch).forEach(function (r) {
      var m = r.milestone || '(none)';
      if (!g[m]) { g[m] = emptyCounts(); g[m].milestone = m; g[m].rem_c = 0; order.push(m); }
      var b = bucket(r.status);
      g[m].total++; g[m][b]++;
      if (b !== 'done' && b !== 'director_accepted' && b !== 'tech_pending') g[m].rem_c += effC(r.effort_base_h);
    });
    return order.map(function (m) {
      var o = finishCounts(g[m]); o.remaining_h = o.rem_c / 100; delete o.rem_c; return o;
    }).sort(function (a, b) { return b.total - a.total || (a.milestone < b.milestone ? -1 : 1); });
  }
  function fmtH(h) { return (Math.round(h * 10) / 10).toFixed(1).replace(/\.0$/, ''); }
  // One sentence for readers. The public data has no critical path, so the forecast dates stand in (never an invented path).
  function realitySummary(lk, eff, fc) {
    var by = {}; fc.forEach(function (f) { by[f.scenario] = f.launch; });
    return lk.total + ' executable launch tasks: ' + lk.done + ' DONE, ' + lk.technical + ' technically complete but not DONE (' +
      lk.director_accepted + ' of them Director accepted), ' + lk.in_progress + ' in progress, ' + lk.not_started + ' not started, ' +
      lk.hold_blocked + ' on hold or blocked. Base effort remaining: ' + fmtH(eff.remaining_h) + ' h of ' + fmtH(eff.total_h) + ' h. ' +
      'Critical path: not in the public data; launch forecast (PROVISIONAL) base ' + fmtDate(by.base) + ', optimistic ' + fmtDate(by.opt) +
      ', conservative ' + fmtDate(by.cons) + '.';
  }
  function progressReality(tasks, fc) {
    var lk = launchKpi(tasks), eff = effortSplit(tasks);
    return { kpi: lk, effort: eff, milestones: launchMilestones(tasks), summary: realitySummary(lk, eff, fc), critical_path: null };
  }

  function computeAll(data) {
    var tasks = data.tasks, runs = data.runs, schedule = data.schedule;
    var k = kpi(tasks), fc = forecast(schedule);
    var reality = progressReality(tasks, fc);
    var out = {
      kpi: k, ladder: ladder(tasks), forecast: fc, ms: msProgress(tasks), ws: wsStatus(tasks),
      gantt: ganttBase(schedule, tasks), resByDate: resByDate(runs), resTotal: resTotal(runs),
      active: activeRows(tasks), hold: holdRows(tasks), takeaway: takeaway(reality.kpi, fc), reality: reality
    };
    out.status = projectStatus(reality.kpi);
    out.overview = overview(out);
    out.galaxy = galaxy(out.ms, out.gantt);
    out.decisionsHold = decisionRefs(out.hold);
    out.decisionsAll = decisionRefs(tasks.filter(isExec), 12);
    return out;
  }

  // ------------------------------------------------------------ browser rendering
  var doc, win, state = { data: null, manifest: null, texts: null, calc: null, filter: { q: '', status: '', ws: '' }, sort: { key: '', dir: 'asc' }, open: {} };

  function el(tag, attrs, kids) {
    var e = doc.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (a) {
      if (a === 'text') e.textContent = attrs[a];
      else if (a === 'cls') e.className = attrs[a];
      else e.setAttribute(a, attrs[a]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return e;
  }
  function sv(tag, attrs, text) {
    var e = doc.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (a) { if (a === 'style') Object.assign(e.style, attrs[a]); else e.setAttribute(a, attrs[a]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function $(id) { return doc.getElementById(id); }
  function show(v) { return v == null || v === '' ? '—' : String(v); }
  function td(tr, v, cls) { var c = tr.insertCell(); c.textContent = show(v); if (cls) c.className = cls; return c; }
  function titleTd(tr, r) {
    var c = tr.insertCell();
    if (has(DONE, r.status)) { var s = el('s', { text: r.title }); c.appendChild(s); c.appendChild(el('span', { cls: 'skip', text: ' (done)' })); }
    else c.textContent = r.title;
    return c;
  }
  function chipTd(tr, s) { var c = tr.insertCell(); c.appendChild(el('span', { cls: 'chip st-' + String(s || '').replace(/[^A-Z_]/g, ''), text: s || '—' })); return c; }
  function tile(v, label, cls) {
    return el('div', { cls: 'tile' + (cls ? ' ' + cls : '') }, [el('span', { cls: 'v', text: show(v) }), el('span', { cls: 'l', text: label })]);
  }
  function fill(id, nodes) { var e = $(id); e.replaceChildren.apply(e, nodes); }
  function emptyRow(tbody, cols, msg) { var tr = tbody.insertRow(); var c = tr.insertCell(); c.colSpan = cols; c.textContent = msg; }
  function textW(s) { return String(s).length * 6.4; }

  function tipFor(container) {
    var t = container.querySelector('.tip');
    if (!t) { t = el('div', { cls: 'tip', role: 'status' }); t.hidden = true; container.appendChild(t); }
    return {
      show: function (text, x, y) {
        t.textContent = text; t.hidden = false;
        var w = container.clientWidth;
        t.style.left = Math.max(0, Math.min(x + 12, w - 230)) + 'px'; t.style.top = (y + 12) + 'px';
      },
      hide: function () { t.hidden = true; }
    };
  }
  function bindTip(node, tip, container, text) {
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', text);
    node.appendChild(sv('title', {}, text));
    node.addEventListener('pointermove', function (ev) {
      var b = container.getBoundingClientRect(); tip.show(text, ev.clientX - b.left, ev.clientY - b.top);
    });
    node.addEventListener('pointerleave', tip.hide);
    node.addEventListener('focus', function () {
      var b = container.getBoundingClientRect(), n = node.getBoundingClientRect(); tip.show(text, n.left - b.left, n.bottom - b.top - 8);
    });
    node.addEventListener('blur', tip.hide);
  }

  function renderHeader() {
    var c = state.calc, m = state.manifest;
    $('takeaway').textContent = c.takeaway;
    var ps = $('proj-status'); ps.textContent = c.status.label; ps.setAttribute('data-tone', c.status.tone);
    $('snap-text').textContent = 'Snapshot ' + m.snapshot.replace('T', ' ');
    renderOverview();
    $('meta').textContent = 'Snapshot ' + m.snapshot.replace('T', ' ') + ' (tracker changelog) · source commit ' + m.source_commit + ' · forecast ' + m.forecast.label;
    var k = c.reality.kpi;
    fill('kpi-tiles', [
      tile(k.total, 'Executable launch tasks (denominator)'), tile(k.done, 'DONE or released', 'ok'),
      tile(k.director_accepted, 'Director accepted, not yet DONE', 'ok'),
      tile(k.tech_pending, 'Implemented or QA pass, not yet DONE', 'ok'),
      tile(k.in_progress, 'In progress'), tile(k.not_started, 'Not started (planned or ready)'),
      tile(k.hold, 'On hold (waits for a Director GO)', 'warn'),
      tile(k.blocked, 'Blocked', 'bad'), tile(k.pct_done + '%', 'Completion by task count (DONE ÷ launch tasks)')
    ]);
    $('kpi-deferred').textContent = deferredLine(k);
    renderReality();
    $('fc-label').textContent = m.forecast.label;
    var names = { opt: 'Optimistic', base: 'Base (P50)', cons: 'Conservative' };
    fill('fc-tiles', c.forecast.map(function (f) {
      return tile(fmtDate(f.launch), names[f.scenario] + ' · ' + m.forecast.label.toLowerCase(), f.scenario === 'cons' ? 'warn' : '');
    }));
    $('fc-note').textContent = m.forecast.note;
  }

  function deferredLine(k) {
    var d = k.deferred;
    return 'Not in the denominator: ' + d.total + ' deferred executable rows (POST-LAUNCH / DEFERRED, not launch backlog: ' + d.done + ' DONE, ' +
      d.technical + ' technically complete, ' + d.in_progress + ' in progress, ' + d.not_started + ' not started, ' + d.hold_blocked + ' on hold or blocked) and ' +
      k.containers + ' container rows (EPIC / PARENT, never counted).';
  }
  function baseLaunch(fc) { var b = fc.filter(function (f) { return f.scenario === 'base'; })[0]; return b ? b.launch : null; }
  var R_SEG = [['done_h', 'DONE', 'var(--good)'], ['technical_h', 'Technically complete', 'var(--series-1)'], ['remaining_h', 'Remaining', 'var(--neutral)']];
  function renderReality() {
    var R = state.calc.reality, k = R.kpi, e = R.effort;
    $('reality-summary').textContent = R.summary;
    fill('reality-tiles', [
      tile(k.total, 'Executable launch tasks'), tile(k.done, 'DONE (fully accepted)', 'ok'),
      tile(k.technical, 'Technically complete, not DONE', 'ok'), tile(k.not_started, 'Not started'),
      tile(fmtH(e.remaining_h) + ' h', 'Base effort remaining'), tile(fmtDate(baseLaunch(state.calc.forecast)), 'Launch forecast, base · PROVISIONAL (no critical path in the public data)', 'warn')
    ]);
    var bar = $('reality-bar'), tot = e.total_h || 1;
    bar.replaceChildren();
    bar.setAttribute('aria-label', 'Base effort over launch scope: ' + R_SEG.map(function (s) { return s[1].toLowerCase() + ' ' + fmtH(e[s[0]]) + ' h'; }).join(', ') +
      ' of ' + fmtH(e.total_h) + ' h');
    R_SEG.forEach(function (s) {
      var seg = el('span', { title: s[1] + ': ' + fmtH(e[s[0]]) + ' h' }); seg.style.width = (e[s[0]] / tot * 100) + '%'; seg.style.background = s[2]; bar.appendChild(seg);
    });
    fill('reality-legend', R_SEG.map(function (s) {
      var i = el('i'); i.style.background = s[2]; return el('span', {}, [i, s[1] + ' ' + fmtH(e[s[0]]) + ' h (' + (e.total_h ? r1(e[s[0]] / e.total_h * 100) : 0) + '%)']);
    }));
    $('reality-effort-note').textContent = 'Effort weighting covers ' + e.weighted_rows + ' of ' + e.rows + ' launch tasks; ' + e.zero_effort +
      ' launch rows have zero or empty base effort (mostly decisions, gates and sessions) and do not move this bar.';
    $('reality-reasons').textContent = 'Why ' + k.technical + ' technically complete tasks are not DONE: device NOT TESTED ' + k.reasons.device_not_tested +
      ' · awaiting Director acceptance ' + k.reasons.awaiting_director + ' · other (Director accepted, remaining definition of done) ' + k.reasons.other + '.';
    $('reality-deferred').textContent = deferredLine(k);
  }

  var ICONS = {
    progress: 'M4 18a8 8 0 1 1 16 0M12 18l4-6',
    done: 'M5 12.5l4.5 4.5L19 7.5',
    workstreams: 'M4 7h16M4 12h11M4 17h7',
    blockers: 'M12 4l8.5 15h-17zM12 10v4M12 16.5v.5',
    forecast: 'M12 3c2.6 2.2 3.8 5 3.8 8.4L14.5 15h-5L8.2 11.4C8.2 8 9.4 5.2 12 3zM10 18l2 3 2-3'
  };
  function icon(name) {
    var s = sv('svg', { 'class': 'ico', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    s.appendChild(sv('path', { d: ICONS[name], fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return s;
  }
  function renderOverview() {
    fill('ov-tiles', state.calc.overview.map(function (o) {
      var v = el('div', { cls: 'v' }, [o.value, o.unit ? el('small', { text: ' ' + o.unit }) : null]);
      var kids = [el('div', { cls: 'k' }, [icon(o.key), o.label]), v, el('div', { cls: 'd', text: o.detail })];
      if (o.bar != null) {
        var hud = el('div', { cls: 'hud', role: 'img', 'aria-label': r1(o.bar * 100) + '% done; ' + r1(o.bar2 * 100) + '% done or technically complete' });
        var b2 = el('span', { cls: 'tech' }); b2.style.width = (o.bar2 * 100) + '%';
        var b1 = el('span'); b1.style.width = (o.bar * 100) + '%';
        hud.appendChild(b2); hud.appendChild(b1); kids.push(hud);
      }
      return el('div', { cls: 'ov', 'data-tone': o.tone, 'data-key': o.key }, kids);
    }));
  }

  var G_STATE = { done: ['Complete', 'var(--good)'], active: ['In progress', 'var(--violet)'], hold: ['Waiting (hold / blocked)', 'var(--warning)'], planned: ['Planned', 'var(--neutral)'] };
  function renderGalaxy() {
    var box = $('galaxy-chart'), nodes = state.calc.galaxy;
    box.replaceChildren();
    if (!nodes.length) { box.textContent = 'No milestones in the dataset.'; return; }
    var W = Math.max(300, box.clientWidth || 900), L = galaxyLayout(nodes, W);
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + L.height, role: 'img', 'aria-label': 'Milestone route, ordered by base-schedule start: ' +
      nodes.map(function (n) { return n.milestone + ' ' + n.done + ' of ' + n.total + ' done (' + n.pct + '%)'; }).join('; ') });
    var d = L.points.map(function (p, i) {
      if (!i) return 'M' + p.x + ' ' + p.y;
      var q = L.points[i - 1];
      return Math.abs(q.y - p.y) < 40 ? 'L' + p.x + ' ' + p.y : 'C' + q.x + ' ' + (q.y + 60) + ' ' + p.x + ' ' + (p.y - 60) + ' ' + p.x + ' ' + p.y;
    }).join(' ');
    svg.appendChild(sv('path', { d: d, 'class': 'orbit' }));
    var tip = tipFor(box);
    L.points.forEach(function (p) {
      var n = p.node, g = sv('g', { 'class': 'gnode' }), col = G_STATE[n.state][1], r = n.r, rr = r + 5;
      var circ = 2 * Math.PI * rr, rot = 'rotate(-90 ' + p.x + ' ' + p.y + ')';
      g.appendChild(sv('circle', { cx: p.x, cy: p.y, r: rr, 'class': 'gring-bg', style: { fill: 'var(--surface)', stroke: 'var(--bar-track)', strokeWidth: '4' } }));
      if (n.techFrac > n.frac) g.appendChild(sv('circle', { cx: p.x, cy: p.y, r: rr, transform: rot,
        style: { fill: 'none', stroke: 'var(--series-1)', strokeOpacity: '0.45', strokeWidth: '4', strokeDasharray: (circ * n.techFrac) + ' ' + circ } }));
      if (n.frac > 0) g.appendChild(sv('circle', { cx: p.x, cy: p.y, r: rr, transform: rot,
        style: { fill: 'none', stroke: 'var(--good)', strokeWidth: '4', strokeDasharray: (circ * n.frac) + ' ' + circ } }));
      g.appendChild(sv('circle', { cx: p.x, cy: p.y, r: r, style: { fill: col } }));
      g.appendChild(sv('circle', { cx: p.x + r * 0.28, cy: p.y + r * 0.28, r: r * 0.72, style: { fill: '#000000', fillOpacity: '0.10' } }));
      g.appendChild(sv('ellipse', { cx: p.x - r * 0.32, cy: p.y - r * 0.36, rx: r * 0.42, ry: r * 0.26, style: { fill: '#ffffff', fillOpacity: '0.32' } }));
      g.appendChild(sv('text', { x: p.x, y: p.y + rr + 16, 'text-anchor': 'middle', 'class': 'gname' }, n.milestone.length > 14 ? n.milestone.slice(0, 13) + '…' : n.milestone));
      g.appendChild(sv('text', { x: p.x, y: p.y + rr + 30, 'text-anchor': 'middle', 'class': 'gsub' }, n.done + '/' + n.total + ' · ' + n.pct + '%'));
      svg.appendChild(g);
      bindTip(g, tip, box, n.milestone + ': ' + n.done + ' of ' + n.total + ' done (' + n.pct + '%), ' + n.technical + ' technical, ' + n.active +
        ' in progress, ' + n.hold_blocked + ' hold / blocked' + (n.start ? '; base schedule ' + fmtDate(n.start) + ' to ' + fmtDate(n.finish) : '; no open base-schedule tasks'));
    });
    box.appendChild(svg);
    fill('galaxy-legend', Object.keys(G_STATE).map(function (k) {
      var i = el('i'); i.style.background = G_STATE[k][1]; i.style.borderRadius = '50%'; return el('span', {}, [i, G_STATE[k][0]]);
    }).concat([(function () { var i = el('i'); i.style.background = 'var(--good)'; return el('span', {}, [i, 'Ring: done share (light blue: technically complete)']); })()]));
    $('galaxy-note').textContent = 'One planet per milestone (executable tasks only); planet size grows with the task count and the ring shows the done share from the milestone table. ' +
      'Route order follows the earliest start in the base schedule (provisional); milestones without open scheduled tasks come first.';
  }

  function renderLadder() {
    var box = $('ladder-chart'), L = state.calc.ladder;
    box.replaceChildren();
    var rows = L.rungs.map(function (g) { return { label: g.rung.replace(/_/g, ' '), v: g.at, reached: g.reached }; });
    rows.push({ label: 'NOT IMPLEMENTED YET', v: L.none, reached: null });
    var W = Math.max(300, box.clientWidth || 600), rowH = 20, gap = 6, lw = 0;
    rows.forEach(function (r) { lw = Math.max(lw, textW(r.label)); });
    var padL = Math.ceil(lw) + 10, padR = 120, H = rows.length * (rowH + gap);
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
    var x = function (v) { return (W - padL - padR) * v / max; };
    var aria = 'Acceptance ladder, highest rung per executable task: ' + rows.map(function (r) { return r.label.toLowerCase() + ' ' + r.v; }).join(', ');
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': aria });
    var tip = tipFor(box);
    rows.forEach(function (r, i) {
      var y = i * (rowH + gap);
      svg.appendChild(sv('text', { x: padL - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end' }, r.label));
      var bar = sv('rect', { x: padL, y: y, width: Math.max(r.v ? 2 : 0, x(r.v)), height: rowH, rx: 4, 'class': 'bar',
        style: { fill: r.reached === null ? 'var(--neutral)' : 'var(--series-1)' } });
      svg.appendChild(bar);
      bindTip(bar, tip, box, r.label + ': ' + r.v + ' tasks' + (r.reached !== null ? ' (' + r.reached + ' at this rung or higher)' : ''));
      svg.appendChild(sv('text', { x: padL + x(r.v) + 6, y: y + rowH / 2 + 4, 'class': 'val' },
        r.v + (r.reached !== null ? '  (≥ rung: ' + r.reached + ')' : '')));
    });
    box.appendChild(svg);
  }

  var WS_KEYS = [
    ['done', 'Done', 'var(--good)'], ['technical', 'Technical (not done)', 'var(--series-1)'], ['active', 'In progress', 'var(--series-7)'],
    ['hold_blocked', 'Hold / blocked', 'var(--warning)'], ['open', 'Planned / ready', 'var(--neutral)']
  ];
  function renderWs() {
    var box = $('ws-chart'), rows = state.calc.ws;
    box.replaceChildren();
    var W = Math.max(280, box.clientWidth || 500), rowH = 18, gap = 6, lw = 0;
    rows.forEach(function (r) { lw = Math.max(lw, textW(r.workstream)); });
    var padL = Math.ceil(lw) + 10, padR = 34, H = rows.length * (rowH + gap);
    var max = Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([1]));
    var sx = function (v) { return (W - padL - padR) * v / max; };
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Executable tasks per workstream split by status group: ' + rows.map(function (r) {
        return r.workstream + ' ' + r.total + ' (' + r.done + ' done)'; }).join(', ') });
    var tip = tipFor(box);
    rows.forEach(function (r, i) {
      var y = i * (rowH + gap), acc = 0;
      svg.appendChild(sv('text', { x: padL - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end' }, r.workstream));
      WS_KEYS.forEach(function (k) {
        var v = r[k[0]]; if (!v) return;
        var x0 = padL + sx(acc), w = Math.max(1, sx(v) - 2);
        var seg = sv('rect', { x: x0, y: y, width: w, height: rowH, rx: 2, style: { fill: k[2] } });
        svg.appendChild(seg);
        bindTip(seg, tip, box, r.workstream + ': ' + k[1].toLowerCase() + ' ' + v + ' of ' + r.total);
        acc += v;
      });
      svg.appendChild(sv('text', { x: padL + sx(r.total) + 4, y: y + rowH / 2 + 4, 'class': 'val' }, String(r.total)));
    });
    box.appendChild(svg);
    fill('ws-legend', WS_KEYS.map(function (k) {
      var i = el('i'); i.style.background = k[2]; return el('span', {}, [i, k[1]]);
    }));
  }

  function renderGantt() {
    var box = $('gantt-chart'), rows = state.calc.gantt.filter(function (r) { return r.milestone !== '(none)'; });
    box.replaceChildren();
    var today = state.manifest.snapshot.slice(0, 10);
    $('gantt-note').textContent = 'Each bar runs from the earliest start to the latest finish of the milestone\'s scheduled tasks in the base scenario (provisional). ' +
      'The dashed line is the snapshot date (' + fmtDate(today) + '); the gold diamond marks the latest finish of each milestone.';
    if (!rows.length) { box.textContent = 'No scheduled tasks in the base scenario.'; return; }
    var W = Math.max(300, box.clientWidth || 800), rowH = 18, gap = 6, padT = 22, lw = 0;
    rows.forEach(function (r) { lw = Math.max(lw, textW(r.milestone)); });
    var showDates = W >= 640, padL = Math.ceil(lw) + 10, padR = showDates ? 84 : 12, H = padT + rows.length * (rowH + gap);
    var lo = Math.min(dayNum(today), Math.min.apply(null, rows.map(function (r) { return dayNum(r.start); })));
    var hi = Math.max.apply(null, rows.map(function (r) { return dayNum(r.finish); })) + 1;
    var x = function (d) { return padL + (W - padL - padR) * (d - lo) / Math.max(1, hi - lo); };
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Milestone timeline, base scenario: ' +
      rows.map(function (r) { return r.milestone + ' ' + fmtDate(r.start) + ' to ' + fmtDate(r.finish); }).join('; ') });
    // month ticks
    var d0 = new Date(lo * 864e5), months = [];
    for (var y = d0.getUTCFullYear(), mo = d0.getUTCMonth() + 1; ; mo++) {
      if (mo > 11) { mo = 0; y++; }
      var dn = Date.UTC(y, mo, 1) / 864e5;
      if (dn > hi) break;
      months.push({ d: dn, label: MONTHS[mo] + (mo === 0 ? ' ' + y : '') });
    }
    var step = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor((W - padL) / 64))));
    months.forEach(function (m, i) {
      svg.appendChild(sv('line', { x1: x(m.d), x2: x(m.d), y1: padT - 4, y2: H, style: { stroke: 'var(--line)' } }));
      if (i % step === 0) svg.appendChild(sv('text', { x: x(m.d), y: 12, 'text-anchor': 'middle' }, m.label));
    });
    var tip = tipFor(box);
    rows.forEach(function (r, i) {
      var yy = padT + i * (rowH + gap);
      svg.appendChild(sv('text', { x: padL - 8, y: yy + rowH / 2 + 4, 'text-anchor': 'end' }, r.milestone));
      var bar = sv('rect', { x: x(dayNum(r.start)), y: yy, width: Math.max(4, x(dayNum(r.finish) + 1) - x(dayNum(r.start))), height: rowH, rx: 4,
        style: { fill: 'var(--series-1)' } });
      svg.appendChild(bar);
      bindTip(bar, tip, box, r.milestone + ': ' + fmtDate(r.start) + ' to ' + fmtDate(r.finish) + ' (' + r.tasks + ' tasks)');
      var xe = x(dayNum(r.finish) + 1), yc = yy + rowH / 2;
      svg.appendChild(sv('path', { d: 'M' + xe + ' ' + (yc - 6) + 'l6 6-6 6-6-6z', style: { fill: 'var(--gold)', stroke: 'var(--surface)', strokeWidth: '1.5' }, 'aria-hidden': 'true' }));
      if (showDates) svg.appendChild(sv('text', { x: xe + 9, y: yc + 4, 'class': 'val' }, fmtDate(r.finish)));
    });
    svg.appendChild(sv('line', { x1: x(dayNum(today)), x2: x(dayNum(today)), y1: padT - 4, y2: H,
      style: { stroke: 'var(--ink-2)', strokeDasharray: '4 3', strokeWidth: '1.5' } }));
    svg.appendChild(sv('text', { x: x(dayNum(today)) + 4, y: padT - 6, 'class': 'val' }, 'snapshot'));
    box.appendChild(svg);
  }

  function renderTables() {
    var c = state.calc, b;
    b = $('ms-body'); b.replaceChildren();
    var lm = c.reality.milestones, sum = emptyCounts(), remC = 0;
    lm.forEach(function (r) {
      var tr = b.insertRow();
      td(tr, r.milestone); td(tr, r.total, 'num'); td(tr, r.done, 'num'); td(tr, r.director_accepted, 'num'); td(tr, r.technical, 'num');
      td(tr, r.in_progress, 'num'); td(tr, r.not_started, 'num'); td(tr, r.hold_blocked, 'num'); td(tr, fmtH(r.remaining_h), 'num'); td(tr, r.pct_done + '%', 'num');
      Object.keys(sum).forEach(function (key) { sum[key] += r[key]; }); remC += Math.round(r.remaining_h * 100);
    });
    finishCounts(sum);
    var ft = $('ms-foot'); ft.replaceChildren();
    var tr = ft.insertRow();
    td(tr, 'Launch scope'); td(tr, sum.total, 'num'); td(tr, sum.done, 'num'); td(tr, sum.director_accepted, 'num'); td(tr, sum.technical, 'num');
    td(tr, sum.in_progress, 'num'); td(tr, sum.not_started, 'num'); td(tr, sum.hold_blocked, 'num'); td(tr, fmtH(remC / 100), 'num'); td(tr, sum.pct_done + '%', 'num');
    $('ms-deferred').textContent = deferredLine(c.reality.kpi);
    b = $('active-body'); b.replaceChildren();
    c.active.forEach(function (r) {
      var tr = b.insertRow(); td(tr, r.task_id, 'id'); titleTd(tr, r); td(tr, r.workstream); td(tr, r.milestone); td(tr, fmtDate(r.actual_start)); td(tr, r.acceptance_status);
    });
    if (!c.active.length) emptyRow(b, 6, 'Nothing in progress.');
    b = $('hold-body'); b.replaceChildren();
    c.hold.forEach(function (r) {
      var tr = b.insertRow(); td(tr, r.task_id, 'id'); titleTd(tr, r); chipTd(tr, r.status); td(tr, r.milestone); td(tr, (r.decision_ref || '').replace(/;/g, '; ')); td(tr, r.blocker);
    });
    if (!c.hold.length) emptyRow(b, 6, 'Nothing on hold or blocked before launch.');
    var decList = function (id, list, empty) {
      fill(id, list.length ? list.map(function (d) {
        return el('li', {}, [el('b', { text: d.id }), el('span', { text: d.count + (d.count === 1 ? ' task' : ' tasks') })]);
      }) : [el('li', {}, [el('span', { text: empty })])]);
    };
    decList('dec-hold', c.decisionsHold, 'No decision referenced');
    decList('dec-all', c.decisionsAll, 'No decision referenced');
    $('dec-note').textContent = 'Decision IDs from the public decision_ref column (the decision log itself is internal). Counts are executable tasks that reference each decision.';
    var t = c.resTotal;
    fill('res-tiles', [
      tile(t.worker_h, 'Worker hours (summed agent time, not elapsed)'), tile(t.worker_runs, 'Worker runs'),
      tile(t.lock_h, 'Unity-lock hours (known runs)'), tile(t.unknown_runs, 'Worker runs with unknown duration')
    ]);
    $('res-note').textContent = 'Only measured runs are summed. Lead minutes and Director review minutes are not recorded (UNKNOWN). ' +
      'Token usage and worker identities are not published (D-087).';
    b = $('res-body'); b.replaceChildren();
    c.resByDate.forEach(function (r) {
      var tr = b.insertRow(); td(tr, r.date); td(tr, r.runs, 'num'); td(tr, r.worker_min, 'num'); td(tr, r.lock_min, 'num');
    });
  }

  var DETAIL = [['node_type', 'Node type'], ['priority', 'Priority'], ['status', 'Status'], ['ladder', 'Ladder'], ['acceptance_status', 'Acceptance'],
    ['device_status', 'Device'], ['decision_ref', 'Decision'], ['effort_opt_h', 'Effort opt h'], ['effort_base_h', 'Effort base h'], ['effort_cons_h', 'Effort cons h'],
    ['planned_start', 'Planned start'], ['planned_end', 'Planned end'], ['actual_start', 'Actual start'], ['actual_end', 'Actual end'], ['blocker', 'Blocker / waiting for']];
  function detailRow(b, r) {
    var tr = b.insertRow(); tr.className = 'detail';
    var c = tr.insertCell(); c.colSpan = 10;
    var dl = el('dl');
    DETAIL.forEach(function (f) {
      var v = r[f[0]];
      if (/_start$|_end$/.test(f[0])) v = v ? fmtDate(v) : v;
      dl.appendChild(el('div', { cls: f[0] === 'blocker' || f[0] === 'acceptance_status' ? 'wide' : '' }, [el('dt', { text: f[1] }), el('dd', { text: show(v) })]));
    });
    c.appendChild(dl);
  }
  function renderRegister() {
    var rows = sortRegister(filterRegister(state.data.tasks, state.filter), state.sort.key, state.sort.dir), b = $('reg-body');
    b.replaceChildren();
    rows.forEach(function (r) {
      var tr = b.insertRow();
      var idc = tr.insertCell(); idc.className = 'id';
      var open = !!state.open[r.task_id];
      var btn = el('button', { type: 'button', cls: 'idbtn', text: r.task_id, 'aria-expanded': open ? 'true' : 'false', 'data-id': r.task_id,
        'aria-label': r.task_id + ': ' + (open ? 'hide' : 'show') + ' task detail' });
      btn.addEventListener('click', function () {
        state.open[r.task_id] = !state.open[r.task_id];
        renderRegister();
        Array.prototype.forEach.call($('reg-body').querySelectorAll('button.idbtn'), function (x) { if (x.getAttribute('data-id') === r.task_id) x.focus(); });
      });
      idc.appendChild(btn);
      titleTd(tr, r); chipTd(tr, r.status); td(tr, r.workstream); td(tr, r.milestone); td(tr, r.effort_base_h, 'num');
      td(tr, r.ladder ? r.ladder.replace(/_/g, ' ') : ''); td(tr, r.acceptance_status); td(tr, r.device_status); td(tr, r.decision_ref);
      if (open) detailRow(b, r);
    });
    Array.prototype.forEach.call($('reg-head').cells, function (th) {
      var k = th.getAttribute('data-sort');
      if (!k) return;
      if (state.sort.key === k) th.setAttribute('aria-sort', state.sort.dir === 'desc' ? 'descending' : 'ascending'); else th.removeAttribute('aria-sort');
    });
    if (!rows.length) emptyRow(b, 10, 'No task matches the filters.');
    $('reg-count').textContent = rows.length + ' of ' + state.data.tasks.length + ' rows shown';
  }

  function setupFilters() {
    var mk = function (id, label, vals, key) {
      var s = $(id);
      s.replaceChildren.apply(s, [new win.Option(label, '')].concat(vals.map(function (v) { return new win.Option(v, v); })));
      s.addEventListener('change', function () { state.filter[key] = s.value; renderRegister(); });
    };
    mk('f-status', 'All statuses', distinct(state.data.tasks, 'status'), 'status');
    mk('f-ws', 'All workstreams', distinct(state.data.tasks, 'workstream'), 'ws');
    // deep links: ?q=...&status=...&ws=... pre-fill the register filters
    var qs = parseQuery(win.location.search || '');
    if (qs.q) { state.filter.q = qs.q; $('f-q').value = qs.q; }
    if (qs.status && distinct(state.data.tasks, 'status').indexOf(qs.status) >= 0) { state.filter.status = qs.status; $('f-status').value = qs.status; }
    if (qs.ws && distinct(state.data.tasks, 'workstream').indexOf(qs.ws) >= 0) { state.filter.ws = qs.ws; $('f-ws').value = qs.ws; }
    if (qs.sort && SORT_KEYS.indexOf(qs.sort) >= 0) { state.sort.key = qs.sort; state.sort.dir = qs.dir === 'desc' ? 'desc' : 'asc'; }
    if (qs.task) {
      var hit = state.data.tasks.filter(function (r) { return r.task_id === qs.task; })[0];
      if (hit) { state.open[hit.task_id] = true; if (!qs.q && !qs.status && !qs.ws) { state.filter.q = hit.task_id; $('f-q').value = hit.task_id; } }
    }
    Array.prototype.forEach.call($('reg-head').cells, function (th) {
      var k = th.getAttribute('data-sort');
      if (!k) return;
      var label = th.textContent;
      var b = el('button', { type: 'button', cls: 'sort', text: label, 'aria-label': 'Sort by ' + label });
      b.addEventListener('click', function () {
        if (state.sort.key === k) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc'; else { state.sort.key = k; state.sort.dir = 'asc'; }
        renderRegister();
      });
      th.replaceChildren(b);
    });
    $('f-q').addEventListener('input', function (e) { state.filter.q = e.target.value; renderRegister(); });
    $('reg-export').addEventListener('click', function () {
      var cols = state.manifest.schema['tasks.csv'];
      download('tasks-filtered.csv', toCSV(cols, sortRegister(filterRegister(state.data.tasks, state.filter), state.sort.key, state.sort.dir)));
    });
  }

  function download(name, text) {
    var blob = new win.Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = win.URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    doc.body.appendChild(a); a.click(); a.remove();
    win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 1000);
  }

  function renderSources() {
    var m = state.manifest, b = $('src-body');
    b.replaceChildren();
    m.files.forEach(function (f) {
      var tr = b.insertRow();
      td(tr, f.name); td(tr, f.rows, 'num');
      var h = tr.insertCell(); h.appendChild(el('code', { cls: 'hash', text: f.sha256 }));
      td(tr, m.snapshot.replace('T', ' ')); td(tr, m.source_commit);
      var c = tr.insertCell();
      var btn = el('button', { type: 'button', cls: 'dl', text: 'CSV', 'aria-label': 'Download ' + f.name });
      btn.addEventListener('click', function () { download(f.name, state.texts[f.name]); });
      c.appendChild(btn);
    });
    $('src-note').textContent = 'Public, sanitised snapshot (D-083, D-087): only allow-listed columns are published; free text is scrubbed of paths, branch names, ' +
      'commit ids and worker labels (shown as [worker]); token usage is never published. Snapshot = latest tracker changelog entry; source commit = last commit of the tracker source files' +
      (m.source_commit_time ? ' (' + m.source_commit_time + ')' : '') + '. Forecast: ' + m.forecast.label + '.';
    fill('src-schema', Object.keys(m.schema).sort().map(function (k) {
      return el('li', {}, [el('code', { text: k }), ': ' + m.schema[k].join(', ')]);
    }));
  }

  function renderCharts() { renderGalaxy(); renderLadder(); renderWs(); renderGantt(); }

  function setupTheme() {
    var btn = $('theme-btn'), html = doc.documentElement, modes = ['auto', 'light', 'dark'], mode = 'auto';
    try { mode = win.localStorage.getItem('pm-theme') || 'auto'; } catch (e) { /* storage blocked */ }
    var qt = parseQuery(win.location.search || '').theme;
    if (qt === 'light' || qt === 'dark' || qt === 'auto') mode = qt;
    var apply = function () {
      if (mode === 'auto') html.removeAttribute('data-theme'); else html.setAttribute('data-theme', mode);
      btn.textContent = 'Theme: ' + mode;
      btn.setAttribute('aria-label', 'Colour theme: ' + (mode === 'auto' ? 'follow system' : mode) + '. Activate to change.');
    };
    apply();
    btn.addEventListener('click', function () {
      mode = modes[(modes.indexOf(mode) + 1) % modes.length];
      try { win.localStorage.setItem('pm-theme', mode); } catch (e) { /* ignore */ }
      apply();
    });
  }

  function loadData() {
    var emb = doc.getElementById('pm-embed');
    if (emb) {
      var d = JSON.parse(emb.textContent);
      return Promise.resolve({ manifest: d.manifest, texts: d.files });
    }
    return win.fetch('data/manifest.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('manifest ' + r.status);
      return r.json();
    }).then(function (manifest) {
      return Promise.all(manifest.files.map(function (f) {
        return win.fetch('data/' + f.name, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(f.name + ' ' + r.status); return r.text(); });
      })).then(function (txts) {
        var texts = {};
        manifest.files.forEach(function (f, i) { texts[f.name] = txts[i]; });
        return { manifest: manifest, texts: texts };
      });
    });
  }

  function datasetFromTexts(texts) {
    var d = {};
    Object.keys(texts).forEach(function (n) { d[n.replace(/\.csv$/, '')] = parseCSV(texts[n]).rows; });
    return d;
  }

  function boot(root) {
    win = root; doc = root.document;
    setupTheme();
    // decorative hero scene (scene.js, appended to app.js at build time); it never blocks the data path
    try { if (root.PMScene) root.PMScene.start(doc.getElementById('hero-art'), { param: parseQuery(win.location.search || '').scene }); } catch (e) { /* stays on the SVG fallback */ }
    loadData().then(function (res) {
      state.manifest = res.manifest; state.texts = res.texts;
      state.data = datasetFromTexts(res.texts);
      state.calc = computeAll(state.data);
      renderHeader(); renderTables(); setupFilters(); renderRegister(); renderSources(); renderCharts();
      var t; win.addEventListener('resize', function () { win.clearTimeout(t); t = win.setTimeout(renderCharts, 150); });
      doc.documentElement.setAttribute('data-ready', '1');
    }).catch(function (e) {
      var p = $('takeaway');
      p.className = 'take err';
      p.textContent = 'The dataset could not be loaded (' + e.message + '). Serve this folder over HTTP, or open portable.html for local use.';
    });
  }

  return {
    parseCSV: parseCSV, toCSV: toCSV, kpi: kpi, ladder: ladder, forecast: forecast, msProgress: msProgress, wsStatus: wsStatus,
    ganttBase: ganttBase, resByDate: resByDate, resTotal: resTotal, activeRows: activeRows, holdRows: holdRows,
    filterRegister: filterRegister, distinct: distinct, parseQuery: parseQuery, takeaway: takeaway, computeAll: computeAll, datasetFromTexts: datasetFromTexts,
    fmtDate: fmtDate, isExec: isExec, RUNGS: RUNGS, boot: boot,
    projectStatus: projectStatus, activeWorkstreams: activeWorkstreams, overview: overview, galaxy: galaxy, galaxyLayout: galaxyLayout,
    decisionRefs: decisionRefs, sortRegister: sortRegister, SORT_KEYS: SORT_KEYS,
    isDeferred: isDeferred, isLaunch: isLaunch, bucket: bucket, techReason: techReason, launchKpi: launchKpi, effortSplit: effortSplit,
    launchMilestones: launchMilestones, realitySummary: realitySummary, progressReality: progressReality, fmtH: fmtH
  };
});
