// Photo filters, rendered with WebGL so they work the same on the live camera preview and on the
// saved pixels (photos, photobooth strips, filtered video). One fragment shader does all the looks;
// each filter is a set of uniforms, and `amount` blends between the original and the filtered image.

export const FILTERS = [
  { id: 'none', name: 'Gốc', p: {} },
  { id: 'vintage', name: 'Vintage Film', p: { contrast: 1.06, saturation: 0.82, temp: 0.35, fade: 0.12, shadows: [0.10, 0.06, -0.04], highlights: [0.10, 0.06, -0.06], split: 0.6, vignette: 0.35, grain: 0.18 } },
  { id: 'retro', name: 'Retro', p: { contrast: 1.12, saturation: 1.1, temp: 0.25, tint: -0.05, fade: 0.08, shadows: [-0.04, 0.06, 0.10], highlights: [0.12, 0.05, -0.08], split: 0.7, vignette: 0.25, grain: 0.10 } },
  { id: 'y2k', name: 'Y2K', p: { exposure: 0.12, contrast: 1.15, saturation: 1.35, temp: -0.12, tint: 0.10, highlights: [0.06, -0.02, 0.12], split: 0.6, glow: 0.35, vignette: 0.15 } },
  { id: 'korean', name: 'Korean Aesthetic', p: { exposure: 0.16, contrast: 0.9, saturation: 0.88, temp: 0.06, tint: 0.04, fade: 0.08, highlights: [0.06, 0.02, 0.04], split: 0.5, glow: 0.22, blur: 0.12 } },
  { id: 'softpink', name: 'Soft Pink', p: { exposure: 0.12, contrast: 0.92, saturation: 0.95, temp: 0.08, tint: 0.16, fade: 0.06, highlights: [0.10, 0.0, 0.05], shadows: [0.06, 0.0, 0.04], split: 0.7, glow: 0.18 } },
  { id: 'pastel', name: 'Pastel', p: { exposure: 0.14, contrast: 0.82, saturation: 0.7, fade: 0.16, highlights: [0.04, 0.05, 0.08], shadows: [0.06, 0.04, 0.08], split: 0.6 } },
  { id: 'grain', name: 'Film Grain', p: { contrast: 1.08, saturation: 0.9, temp: 0.1, fade: 0.06, grain: 0.42, vignette: 0.22 } },
  { id: 'vhs', name: 'VHS', p: { contrast: 1.1, saturation: 1.25, temp: -0.05, fade: 0.06, vhs: 1.0, grain: 0.2, blur: 0.2, vignette: 0.3 } },
  { id: 'disposable', name: 'Disposable', p: { exposure: 0.08, contrast: 1.18, saturation: 1.05, temp: 0.3, tint: 0.04, flash: 0.45, vignette: 0.45, grain: 0.28, leak: 0.28 } },
  { id: 'bw', name: 'Black & White', p: { mono: 1, contrast: 1.18, grain: 0.12, vignette: 0.2 } },
  { id: 'noir', name: 'Noir', p: { mono: 1, exposure: -0.08, contrast: 1.45, vignette: 0.55, grain: 0.18 } },
  { id: 'warm', name: 'Warm Tone', p: { temp: 0.42, tint: 0.03, saturation: 1.08, highlights: [0.08, 0.04, -0.04], split: 0.5 } },
  { id: 'cool', name: 'Cool Tone', p: { temp: -0.42, tint: -0.02, saturation: 0.98, shadows: [-0.04, 0.02, 0.08], split: 0.5 } },
  { id: 'flash', name: 'Flash', p: { exposure: 0.2, contrast: 1.25, saturation: 1.05, flash: 0.75, vignette: 0.5 } },
  { id: 'blur', name: 'Soft Blur', p: { blur: 0.75, exposure: 0.05, contrast: 0.95, glow: 0.15 } },
  { id: 'glow', name: 'Glow', p: { exposure: 0.08, glow: 0.8, saturation: 1.05, contrast: 1.02 } },
  { id: 'analog', name: 'Analog Film', p: { contrast: 1.04, saturation: 0.86, temp: 0.18, tint: -0.04, fade: 0.14, shadows: [-0.02, 0.06, 0.06], highlights: [0.10, 0.06, -0.02], split: 0.8, grain: 0.3, vignette: 0.3, leak: 0.12 } },
  { id: 'cine', name: 'Cinematic', p: { contrast: 1.16, saturation: 0.92, shadows: [-0.08, 0.04, 0.14], highlights: [0.14, 0.06, -0.08], split: 1.0, vignette: 0.4, fade: 0.04 } },
  { id: 'moody', name: 'Moody', p: { exposure: -0.12, contrast: 1.1, saturation: 0.7, temp: -0.08, fade: 0.1, shadows: [0.0, 0.04, 0.08], split: 0.7, vignette: 0.5, grain: 0.12 } },
];
export const filterById = (id) => FILTERS.find((f) => f.id === id) || FILTERS[0];

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_crop;          // x, y, w, h of the source region (0..1)
uniform float u_mirror;
uniform vec2 u_res;           // output size in px
uniform vec2 u_texel;         // 1 / source size
uniform float u_time;
uniform float u_amount;
uniform float u_exposure, u_contrast, u_saturation, u_temp, u_tint, u_fade, u_vignette, u_grain;
uniform float u_mono, u_split, u_vhs, u_blur, u_glow, u_flash, u_leak;
uniform vec3 u_shadows, u_highlights;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 srcUV(vec2 uv) {
  vec2 u = vec2(u_mirror > 0.5 ? 1.0 - uv.x : uv.x, 1.0 - uv.y);
  return u_crop.xy + u * u_crop.zw;
}
vec3 tex(vec2 uv) { return texture2D(u_tex, srcUV(clamp(uv, 0.0, 1.0))).rgb; }
vec3 soft(vec2 uv, float r) {
  // 13-tap blur, radius in output pixels
  vec2 d = r / u_res;
  vec3 s = tex(uv) * 0.2;
  s += (tex(uv + vec2(d.x, 0.0)) + tex(uv - vec2(d.x, 0.0)) + tex(uv + vec2(0.0, d.y)) + tex(uv - vec2(0.0, d.y))) * 0.1;
  s += (tex(uv + d) + tex(uv - d) + tex(uv + vec2(d.x, -d.y)) + tex(uv + vec2(-d.x, d.y))) * 0.075;
  s += (tex(uv + vec2(2.0 * d.x, 0.0)) + tex(uv - vec2(2.0 * d.x, 0.0)) + tex(uv + vec2(0.0, 2.0 * d.y)) + tex(uv - vec2(0.0, 2.0 * d.y))) * 0.025;
  return s;
}
void main() {
  vec2 uv = v_uv;
  vec3 orig = tex(uv);
  vec3 c = orig;
  float px = max(u_res.x, u_res.y) / 1000.0;

  if (u_blur > 0.0 || u_glow > 0.0) {
    vec3 b = soft(uv, (3.0 + 9.0 * max(u_blur, u_glow)) * px);
    c = mix(c, b, clamp(u_blur, 0.0, 1.0));
    vec3 bloom = max(b - 0.55, 0.0) * 2.2;
    c = 1.0 - (1.0 - c) * (1.0 - bloom * u_glow);
  }
  if (u_vhs > 0.0) {
    float shift = 0.004 * u_vhs;
    float wobble = sin(uv.y * 40.0 + u_time * 3.0) * 0.0015 * u_vhs;
    c.r = mix(c.r, tex(uv + vec2(shift + wobble, 0.0)).r, 0.85);
    c.b = mix(c.b, tex(uv - vec2(shift - wobble, 0.0)).b, 0.85);
    float scan = 0.5 + 0.5 * sin(uv.y * u_res.y * 1.6);
    c *= 1.0 - 0.10 * u_vhs * scan;
    float band = step(0.995, hash(vec2(floor(uv.y * 90.0), floor(u_time * 6.0))));
    c += band * 0.12 * u_vhs;
  }

  c *= pow(2.0, u_exposure);
  c = (c - 0.5) * u_contrast + 0.5;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(lum), c, u_saturation);
  c += vec3(u_temp * 0.09, u_tint * 0.07, -u_temp * 0.09);
  lum = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  c += (u_shadows * (1.0 - lum) + u_highlights * lum) * u_split;
  c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), u_mono);
  c = u_fade * 0.55 + c * (1.0 - u_fade * 0.55);

  vec2 q = uv - 0.5;
  float dist = length(q * vec2(u_res.x / max(u_res.y, 1.0), 1.0)) / 0.72;
  if (u_flash > 0.0) {
    c *= 1.0 + u_flash * 0.55 * (1.0 - smoothstep(0.0, 0.85, dist));
  }
  if (u_leak > 0.0) {
    float l = smoothstep(0.95, 0.0, distance(uv, vec2(1.05, 0.95)));
    c += u_leak * l * vec3(1.0, 0.42, 0.12);
  }
  c *= 1.0 - u_vignette * smoothstep(0.35, 1.05, dist);
  if (u_grain > 0.0) {
    float n = hash(floor(uv * u_res / max(px, 1.0)) + fract(u_time) * 97.0) - 0.5;
    c += n * u_grain * 0.22;
  }
  gl_FragColor = vec4(mix(orig, clamp(c, 0.0, 1.0), u_amount), 1.0);
}`;

const DEFAULTS = {
  exposure: 0, contrast: 1, saturation: 1, temp: 0, tint: 0, fade: 0, vignette: 0, grain: 0,
  mono: 0, split: 0, vhs: 0, blur: 0, glow: 0, flash: 0, leak: 0, shadows: [0, 0, 0], highlights: [0, 0, 0],
};

export function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

// One WebGL context bound to a canvas. render() draws `source` (video, image, bitmap or canvas) cropped to
// `crop` into the whole canvas with the chosen filter, and recovers gracefully if the GPU drops the context.
export class FilterRenderer {
  constructor(canvas, { preserve = false, onLost = null, onRestored = null } = {}) {
    this.canvas = canvas;
    this.onLost = onLost;
    this.onRestored = onRestored;
    this.lost = false;
    const opts = { premultipliedAlpha: false, preserveDrawingBuffer: preserve, antialias: false, alpha: false };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('webgl');
    this.gl = gl;
    this._onLost = (e) => {
      e.preventDefault();
      this.lost = true;
      this.onLost?.();
    };
    this._onRestored = () => {
      try {
        this._init();
        this.lost = false;
        this.onRestored?.();
      } catch {
        this.lost = true;
      }
    };
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);
    this._init();
  }

  _init() {
    const { gl } = this;
    if (gl.isContextLost()) throw new Error('webgl-lost');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.u = {};
    ['u_tex', 'u_crop', 'u_mirror', 'u_res', 'u_texel', 'u_time', 'u_amount', 'u_exposure', 'u_contrast', 'u_saturation', 'u_temp',
      'u_tint', 'u_fade', 'u_vignette', 'u_grain', 'u_mono', 'u_split', 'u_vhs', 'u_blur', 'u_glow', 'u_flash', 'u_leak', 'u_shadows', 'u_highlights']
      .forEach((n) => { this.u[n] = gl.getUniformLocation(prog, n); });
  }

  isAvailable() {
    return !this.lost && !this.gl.isContextLost();
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    this.lost = true;
  }

  render(source, { filter = 'none', amount = 1, crop = [0, 0, 1, 1], mirror = false, width, height, time = 0 }) {
    if (!this.isAvailable()) return false;
    const { gl, canvas, u } = this;
    if (width && height && (canvas.width !== width || canvas.height !== height)) {
      canvas.width = width;
      canvas.height = height;
    }
    const sw = source.videoWidth || source.naturalWidth || source.width || 1;
    const sh = source.videoHeight || source.naturalHeight || source.height || 1;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    const p = { ...DEFAULTS, ...filterById(filter).p };
    gl.uniform1i(u.u_tex, 0);
    gl.uniform4f(u.u_crop, crop[0], crop[1], crop[2], crop[3]);
    gl.uniform1f(u.u_mirror, mirror ? 1 : 0);
    gl.uniform2f(u.u_res, canvas.width, canvas.height);
    gl.uniform2f(u.u_texel, 1 / sw, 1 / sh);
    gl.uniform1f(u.u_time, time);
    gl.uniform1f(u.u_amount, filter === 'none' ? 0 : amount);
    ['exposure', 'contrast', 'saturation', 'temp', 'tint', 'fade', 'vignette', 'grain', 'mono', 'split', 'vhs', 'blur', 'glow', 'flash', 'leak']
      .forEach((k) => gl.uniform1f(u[`u_${k}`], p[k]));
    gl.uniform3fv(u.u_shadows, p.shadows);
    gl.uniform3fv(u.u_highlights, p.highlights);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return !gl.isContextLost();
  }
}

// Source region (0..1) for a centred crop with aspect `aspect` (w/h), zoomed in by `zoom`.
export function centerCrop(sw, sh, aspect = 1, zoom = 1) {
  let w = sw;
  let h = sw / aspect;
  if (h > sh) { h = sh; w = sh * aspect; }
  w /= zoom;
  h /= zoom;
  return [(sw - w) / 2 / sw, (sh - h) / 2 / sh, w / sw, h / sh];
}

// Offscreen renderer shared by every "apply the filter to these pixels" job.
let shared = null;
function sharedRenderer() {
  if (shared && !shared.isAvailable()) {
    shared.dispose();
    shared = null;
  }
  if (!shared) shared = new FilterRenderer(document.createElement('canvas'), { preserve: true });
  return shared;
}

function draw2D(out, source, sw, sh, region, width, height, mirror) {
  const ctx = out.getContext('2d');
  ctx.save();
  if (mirror) { ctx.translate(width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, region[0] * sw, region[1] * sh, region[2] * sw, region[3] * sh, 0, 0, width, height);
  ctx.restore();
}

// Filtered copy of `source` as a 2D canvas of width x height (the crop keeps the aspect).
export function filteredCanvas(source, { filter = 'none', amount = 1, width, height, crop, mirror = false }) {
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const region = crop || centerCrop(sw, sh, width / height);
  if (filter === 'none' || !webglSupported()) {
    draw2D(out, source, sw, sh, region, width, height, mirror);
    return out;
  }
  try {
    const r = sharedRenderer();
    if (r.render(source, { filter, amount, crop: region, mirror, width, height, time: Math.random() * 10 })) {
      out.getContext('2d').drawImage(r.canvas, 0, 0);
      return out;
    }
  } catch {
    if (shared) { shared.dispose(); shared = null; }
  }
  // WebGL context lost / unavailable: fall back to the unfiltered 2D copy rather than returning black pixels
  draw2D(out, source, sw, sh, region, width, height, mirror);
  return out;
}
