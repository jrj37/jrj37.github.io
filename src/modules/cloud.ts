/// <reference types="vite/client" />

// Canvas context types are sticky — once a canvas has been queried for '2d',
// `getContext('webgl2')` returns null. Force a full reload on HMR so this
// module always starts from a fresh canvas element.
if (import.meta.hot) {
  import.meta.hot.invalidate();
}

/**
 * Interactive spiral galaxy point cloud — WebGL2 particles + 2D overlay markers.
 *
 *   • Particles (~10 k) live in a single static VBO. The vertex shader does
 *     rotation, perspective tilt, screen projection, depth-based size/alpha,
 *     and the convergence lerp when a marker is clicked.
 *   • Fragment shader draws each point as a soft additive disc.
 *   • Markers (planet-like spheres + glow) render to a transparent 2D canvas
 *     stacked on top of the WebGL canvas — easier to draw radial gradients
 *     there than in a shader, and the marker count is tiny.
 *
 * Galaxy structure:
 *   • Central bulge: dense Gaussian cluster, warm yellow-white.
 *   • Spiral arms: 2 logarithmic arms, scattered with Gaussian noise around
 *     the analytical curve, colored by radius (warm core → cool periphery).
 *   • Halo stars: sparse scatter beyond the disk for cosmic backdrop.
 *   • Disk sits in the XZ plane with a fixed tilt (~31°).
 */

type Point3D = { x: number; y: number; z: number };

type CloudPoint = {
  pos: Point3D;
  rgb: [number, number, number]; // 0..255
  size: number;
  alpha: number;
};

export type CloudMarker = {
  pos: Point3D;
  color: string;
  rgb: [number, number, number];
  label: string;
  href: string;
};

const N_BULGE = 1400;
const N_ARM_STARS = 5500;
const N_KNOTS = 28;                 // bright clusters embedded in arms
const N_KNOT_STARS = 70;            // stars per knot
const N_FILLER = 700;
const N_HALO = 320;
const SEED = 23;
const N_ARMS = 2;
const ARM_TIGHTNESS = 0.55;
const SCALE = 0.42;
const BASE_TILT_X = -0.55;          // ~31° tilt from face-on
const BASE_ROTATION = 0.0009;
const PARALLAX_X = 0.10;
const PARALLAX_Y = 0.18;

// Convergence-to-marker animation (triggered on marker click).
const CONVERGE_DURATION = 1400;      // ms — total time from click to full crash
const CONVERGE_NAVIGATE_AT = 1050;   // ms — scroll begins mid-implosion
const CONVERGE_HOLD = 1100;          // ms — keep converged state after navigate
const CONVERGE_RESET = CONVERGE_DURATION + CONVERGE_HOLD;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGauss(rand: () => number): () => number {
  // Box–Muller
  return () => {
    const u = Math.max(1e-9, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
  };
}

/** Warm core → cool arms, indexed by radius. */
const GALAXY_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0.00, [255, 246, 220]],   // hot white
  [0.10, [255, 228, 175]],   // warm white
  [0.25, [240, 200, 140]],   // gold
  [0.45, [225, 190, 150]],   // warm beige
  [0.60, [165, 195, 215]],   // transition
  [0.80, [120, 180, 235]],   // cool blue
  [1.20, [95, 155, 230]],    // outer blue
];

function galaxyColor(r: number, variant: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(GALAXY_STOPS[GALAXY_STOPS.length - 1][0], r));
  for (let i = 0; i < GALAXY_STOPS.length - 1; i++) {
    const [r1, c1] = GALAXY_STOPS[i];
    const [r2, c2] = GALAXY_STOPS[i + 1];
    if (clamped >= r1 && clamped <= r2) {
      const t = (clamped - r1) / (r2 - r1);
      const tint = (variant - 0.5) * 26;
      return [
        Math.max(0, Math.min(255, Math.round(c1[0] + (c2[0] - c1[0]) * t + tint * 0.45))),
        Math.max(0, Math.min(255, Math.round(c1[1] + (c2[1] - c1[1]) * t + tint * 0.20))),
        Math.max(0, Math.min(255, Math.round(c1[2] + (c2[2] - c1[2]) * t - tint * 0.30))),
      ];
    }
  }
  return [...GALAXY_STOPS[GALAXY_STOPS.length - 1][1]] as [number, number, number];
}

function makePoint(pos: Point3D, size: number, alpha: number, rgb: [number, number, number]): CloudPoint {
  return { pos, rgb, size, alpha };
}

function generateGalaxy(): CloudPoint[] {
  const rand = mulberry32(SEED);
  const gauss = makeGauss(rand);
  const points: CloudPoint[] = [];

  // ─── Central bulge ──────────────────────────────────────────────
  for (let i = 0; i < N_BULGE; i++) {
    const r = Math.abs(gauss()) * 0.14 + rand() * 0.025;
    const theta = rand() * Math.PI * 2;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    const y = gauss() * 0.055;
    const t = Math.min(1, r / 0.22);
    const c: [number, number, number] = [
      255,
      Math.round(248 - t * 35),
      Math.round(225 - t * 95),
    ];
    points.push(makePoint({ x, y, z }, 1.0 + rand() * 0.7, 0.55 + (1 - t) * 0.4, c));
  }

  // ─── Spiral arms ────────────────────────────────────────────────
  for (let i = 0; i < N_ARM_STARS; i++) {
    const armIdx = i % N_ARMS;
    const r = 0.18 + Math.pow(rand(), 0.55) * 0.92;

    const baseTheta = Math.log(r) / ARM_TIGHTNESS + armIdx * (Math.PI * 2 / N_ARMS);

    const armWidth = 0.06 + r * 0.09;
    const scatter = gauss() * armWidth;
    const tangent = baseTheta + Math.PI / 2;
    const x = Math.cos(baseTheta) * r + Math.cos(tangent) * scatter;
    const z = Math.sin(baseTheta) * r + Math.sin(tangent) * scatter;

    const y = gauss() * 0.03;

    const distFromArm = Math.abs(scatter) / armWidth;
    const variant = rand();
    const color = galaxyColor(r, variant);
    const brightness = (1 - distFromArm * 0.55) * (0.55 + rand() * 0.4);

    points.push(makePoint({ x, y, z }, 0.6 + rand() * 0.6, Math.max(0.15, brightness), color));
  }

  // ─── Bright knots (H-II-region style clumps embedded in arms) ───
  for (let k = 0; k < N_KNOTS; k++) {
    const armIdx = k % N_ARMS;
    const r = 0.30 + rand() * 0.72;
    const baseTheta = Math.log(r) / ARM_TIGHTNESS + armIdx * (Math.PI * 2 / N_ARMS);
    const offset = (rand() - 0.5) * 0.05;
    const tangent = baseTheta + Math.PI / 2;
    const cx = Math.cos(baseTheta) * r + Math.cos(tangent) * offset;
    const cz = Math.sin(baseTheta) * r + Math.sin(tangent) * offset;
    const knotColor = galaxyColor(r, rand());
    const radiusSpread = 0.035 + rand() * 0.04;
    for (let s = 0; s < N_KNOT_STARS; s++) {
      const dx = gauss() * radiusSpread;
      const dz = gauss() * radiusSpread;
      const y = gauss() * 0.02;
      const useHotCenter = rand() < 0.18;
      const color: [number, number, number] = useHotCenter
        ? [255, 245, 230]
        : knotColor;
      points.push(makePoint(
        { x: cx + dx, y, z: cz + dz },
        0.7 + rand() * 0.7,
        0.45 + rand() * 0.35,
        color,
      ));
    }
  }

  // ─── Inter-arm filler (very dim diffuse) ────────────────────────
  for (let i = 0; i < N_FILLER; i++) {
    const r = 0.18 + rand() * 0.95;
    const theta = rand() * Math.PI * 2;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    const y = gauss() * 0.03;
    const color = galaxyColor(r, rand());
    points.push(makePoint({ x, y, z }, 0.45 + rand() * 0.4, 0.10 + rand() * 0.14, color));
  }

  return points;
}

function generateHaloStars(): CloudPoint[] {
  const rand = mulberry32(SEED + 9);
  const gauss = makeGauss(rand);
  const points: CloudPoint[] = [];
  for (let i = 0; i < N_HALO; i++) {
    const r = 1.20 + rand() * 0.95;
    const theta = rand() * Math.PI * 2;
    const x = Math.cos(theta) * r * 1.10;
    const z = Math.sin(theta) * r;
    const y = gauss() * 0.55;
    const variant = rand();
    let color: [number, number, number];
    if (variant < 0.78) {
      color = [200 + Math.floor(rand() * 55), 215 + Math.floor(rand() * 40), 240];
    } else if (variant < 0.92) {
      color = [255, 225 + Math.floor(rand() * 25), 185];
    } else {
      color = [255, 130 + Math.floor(rand() * 50), 130];
    }
    points.push(makePoint({ x, y, z }, 0.45 + rand() * 0.55, 0.18 + rand() * 0.32, color));
  }
  return points;
}

// ── WebGL shaders ───────────────────────────────────────────────────
//
// Vertex shader takes the original 3D position and applies:
//   1. Optional lerp toward the convergence target (mix by uConvEase)
//   2. Y rotation (auto-spin + drag), then X tilt
//   3. Project to screen pixels then to NDC
//   4. Depth-scaled gl_PointSize and per-vertex alpha
//
// Fragment shader draws a soft circular falloff and discards the corners.
// Additive blending (SRC_ALPHA, ONE) produces the bulge bloom naturally.

const VERT_SHADER = `#version 300 es
precision highp float;

in vec3 aPos;
in float aSize;
in vec4 aColor;

uniform float uRotX;
uniform float uRotY;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uDpr;
uniform float uSizeMul;
uniform vec2 uResolution;
uniform float uConvEase;       // smoothstep-eased 0..1
uniform float uConvProgress;   // raw 0..1 (drives heat & spiral angle)
uniform vec3 uConvTarget;
uniform int uConverging;
uniform float uConvAlphaMul;
uniform float uConvSizeMul;

out vec4 vColor;

void main() {
  vec3 p = aPos;

  if (uConverging == 1) {
    // Spiral collapse: rotate the offset-to-target around the disk Y axis
    // while shrinking the radial distance. Far particles get more total
    // angular sweep, so the inner ones snap in while the outer ones whirl.
    vec3 d = aPos - uConvTarget;
    float dist2D = length(d.xz);
    float swirl = uConvProgress * (2.6 + dist2D * 1.8);
    float ca = cos(swirl);
    float sa = sin(swirl);
    vec2 rotXZ = vec2(d.x * ca + d.z * sa, -d.x * sa + d.z * ca);
    float radial = 1.0 - uConvEase;
    p = uConvTarget + vec3(rotXZ.x * radial, d.y * radial, rotXZ.y * radial);
  }

  // Rotate around Y axis (spin around vertical), then X (tilt).
  float cY = cos(uRotY);
  float sY = sin(uRotY);
  vec3 r1 = vec3(p.x * cY + p.z * sY, p.y, -p.x * sY + p.z * cY);

  float cX = cos(uRotX);
  float sX = sin(uRotX);
  float y1 = r1.y * cX - r1.z * sX;
  float z2 = r1.y * sX + r1.z * cX;

  vec2 screen = uCenter + vec2(r1.x, y1) * uRadius;
  vec2 ndc = (screen / uResolution) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);

  float depth = (z2 + 1.0) * 0.5;
  float depthSizeMul = 0.55 + depth * 0.95;
  float depthAlphaMul = 0.55 + depth * 0.65;

  gl_PointSize = max(0.6, aSize * depthSizeMul * uSizeMul * uConvSizeMul) * uDpr;

  // Color heat-up: as particles plunge in, they shift toward the star's
  // hot yellow-cream core (#fde68a, palette accent) — accretion glow.
  vec3 hot = vec3(0.992, 0.902, 0.541);
  float heat = uConvProgress * uConvProgress;
  vec3 rgb = mix(aColor.rgb, hot, heat * 0.75);

  vColor = vec4(rgb, clamp(aColor.a * depthAlphaMul * uConvAlphaMul, 0.0, 1.0));
}
`;

const FRAG_SHADER = `#version 300 es
precision highp float;

in vec4 vColor;
out vec4 outColor;

void main() {
  // gl_PointCoord is 0..1 across the rasterized point quad.
  vec2 c = gl_PointCoord - vec2(0.5);
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  float fade = 1.0 - smoothstep(0.0, 0.25, r2);
  // Premultiplied output so additive blend (ONE, ONE) composites cleanly
  // against a transparent canvas: bright regions reveal less of the page
  // grid behind, dark regions stay see-through.
  float a = vColor.a * fade;
  outColor = vec4(vColor.rgb * a, a);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

export function initCloud(canvas: HTMLCanvasElement, markers: CloudMarker[]): void {
  const maybeGl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
  });
  if (!maybeGl) {
    console.warn('WebGL2 not available — galaxy disabled');
    return;
  }
  const gl: WebGL2RenderingContext = maybeGl;

  const wrap = canvas.parentElement;

  // 2D overlay canvas — same physical pixels, stacked on top, never captures pointer.
  const overlay = document.createElement('canvas');
  overlay.className = 'cloud__overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  wrap?.appendChild(overlay);
  const maybeOctx = overlay.getContext('2d');
  if (!maybeOctx) {
    console.warn('2D overlay context unavailable');
    return;
  }
  const octx: CanvasRenderingContext2D = maybeOctx;

  const tooltip = document.createElement('div');
  tooltip.className = 'cloud__tooltip';
  tooltip.setAttribute('aria-hidden', 'true');
  wrap?.appendChild(tooltip);

  // Generate galaxy + halo, then upload as a single interleaved VBO.
  const galaxy = generateGalaxy();
  const halo = generateHaloStars();
  const all: CloudPoint[] = [...halo, ...galaxy];
  const total = all.length;

  const STRIDE_FLOATS = 8; // pos(3) + size(1) + color(4)
  const interleaved = new Float32Array(total * STRIDE_FLOATS);
  for (let i = 0; i < total; i++) {
    const o = i * STRIDE_FLOATS;
    const p = all[i];
    interleaved[o + 0] = p.pos.x;
    interleaved[o + 1] = p.pos.y;
    interleaved[o + 2] = p.pos.z;
    interleaved[o + 3] = p.size;
    interleaved[o + 4] = p.rgb[0] / 255;
    interleaved[o + 5] = p.rgb[1] / 255;
    interleaved[o + 6] = p.rgb[2] / 255;
    interleaved[o + 7] = p.alpha;
  }

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER);
  const program = linkProgram(gl, vs, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, 'aPos');
  const aSize = gl.getAttribLocation(program, 'aSize');
  const aColor = gl.getAttribLocation(program, 'aColor');
  const STRIDE = STRIDE_FLOATS * 4;
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, STRIDE, 0);
  gl.enableVertexAttribArray(aSize);
  gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, STRIDE, 3 * 4);
  gl.enableVertexAttribArray(aColor);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, STRIDE, 4 * 4);

  const u = {
    rotX: gl.getUniformLocation(program, 'uRotX'),
    rotY: gl.getUniformLocation(program, 'uRotY'),
    center: gl.getUniformLocation(program, 'uCenter'),
    radius: gl.getUniformLocation(program, 'uRadius'),
    dpr: gl.getUniformLocation(program, 'uDpr'),
    sizeMul: gl.getUniformLocation(program, 'uSizeMul'),
    resolution: gl.getUniformLocation(program, 'uResolution'),
    convEase: gl.getUniformLocation(program, 'uConvEase'),
    convProgress: gl.getUniformLocation(program, 'uConvProgress'),
    convTarget: gl.getUniformLocation(program, 'uConvTarget'),
    converging: gl.getUniformLocation(program, 'uConverging'),
    convAlphaMul: gl.getUniformLocation(program, 'uConvAlphaMul'),
    convSizeMul: gl.getUniformLocation(program, 'uConvSizeMul'),
  };

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // pure additive — fragment shader pre-multiplies
  gl.clearColor(0, 0, 0, 0);

  // ── State ─────────────────────────────────────────────────────────
  let rotX = BASE_TILT_X;
  let rotY = 0;
  let targetRotX = BASE_TILT_X;
  let targetRotY = 0;
  let autoY = 0;
  let dpr = window.devicePixelRatio || 1;
  let hasValidSize = false;

  let zoom = 1;
  let targetZoom = 1;
  let panX = 0, panY = 0;
  let targetPanX = 0, targetPanY = 0;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 4;

  let isDragging = false;
  let pointerInside = false;
  const dragStart = { x: 0, y: 0 };
  const dragStartPan = { x: 0, y: 0 };
  let lastMove = 0;

  let convergeStartTime: number | null = null;
  let convergeMarkerIdx = -1;

  const zoomIndicator = document.querySelector<HTMLElement>('[data-zoom-readout]');

  function zoomBy(factor: number, atX: number, atY: number): void {
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom * factor));
    if (newZoom === targetZoom) return;
    const realFactor = newZoom / targetZoom;
    const cx = canvas.width / 2 + targetPanX;
    const cy = canvas.height / 2 + targetPanY;
    targetPanX = (atX - (atX - cx) * realFactor) - canvas.width / 2;
    targetPanY = (atY - (atY - cy) * realFactor) - canvas.height / 2;
    targetZoom = newZoom;
  }

  function resetView(): void {
    targetZoom = 1;
    targetPanX = 0;
    targetPanY = 0;
  }

  function baseRadius(): number {
    return Math.min(canvas.width, canvas.height) * SCALE;
  }

  type RenderedMarker = { marker: CloudMarker; x: number; y: number; depth: number };
  let renderedMarkers: RenderedMarker[] = [];
  let hoveredIndex = -1;

  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (w === 0 || h === 0) {
      hasValidSize = false;
      return;
    }
    canvas.width = w;
    canvas.height = h;
    overlay.width = w;
    overlay.height = h;
    gl.viewport(0, 0, w, h);
    hasValidSize = true;
  }

  function frame(): void {
    if (!hasValidSize) resize();
    if (!hasValidSize) {
      requestAnimationFrame(frame);
      return;
    }

    const w = canvas.width;
    const h = canvas.height;

    zoom += (targetZoom - zoom) * 0.15;
    panX += (targetPanX - panX) * 0.15;
    panY += (targetPanY - panY) * 0.15;

    const cx = w / 2 + panX;
    const cy = h / 2 + panY;
    const radius = baseRadius() * zoom;

    // ── Convergence ────────────────────────────────────────────────
    // Two coupled curves drive the implosion:
    //   • convT (linear) feeds the spiral angle in the vertex shader, so the
    //     swirl sweeps the disk steadily from t=0.
    //   • convEase (cubic ease-in) shrinks the radial distance and the size,
    //     so points drift outwardly while spinning, then crash inward at the
    //     end — gravitational well behavior.
    let convT = 0;
    let convEase = 0;
    let convergeTargetPos: Point3D | null = null;
    if (convergeStartTime !== null) {
      const elapsed = performance.now() - convergeStartTime;
      if (elapsed >= CONVERGE_RESET) {
        convergeStartTime = null;
        convergeMarkerIdx = -1;
      } else {
        convT = Math.min(1, elapsed / CONVERGE_DURATION);
        convEase = convT * convT * convT; // ease-in cubic
        if (convergeMarkerIdx >= 0) convergeTargetPos = markers[convergeMarkerIdx].pos;
      }
    }
    const isConverging = convergeTargetPos !== null;

    const idle = !isDragging && hoveredIndex === -1 && zoom < 1.2 && !isConverging;
    if (idle) autoY += BASE_ROTATION;
    rotX += (targetRotX - rotX) * 0.05;
    rotY += (targetRotY - rotY) * 0.05;
    const totalY = rotY + autoY;

    if (zoomIndicator) zoomIndicator.textContent = `${zoom.toFixed(1).replace('.', ',')}×`;

    // ── WebGL particle pass ────────────────────────────────────────
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.uniform1f(u.rotX, rotX);
    gl.uniform1f(u.rotY, totalY);
    gl.uniform2f(u.center, cx, cy);
    gl.uniform1f(u.radius, radius);
    gl.uniform1f(u.dpr, dpr);
    gl.uniform1f(u.sizeMul, Math.pow(zoom, 0.65));
    gl.uniform2f(u.resolution, w, h);
    gl.uniform1f(u.convEase, convEase);
    gl.uniform1f(u.convProgress, convT);
    gl.uniform3f(
      u.convTarget,
      convergeTargetPos?.x ?? 0,
      convergeTargetPos?.y ?? 0,
      convergeTargetPos?.z ?? 0,
    );
    gl.uniform1i(u.converging, isConverging ? 1 : 0);
    gl.uniform1f(u.convAlphaMul, isConverging ? 1 - convEase * 0.9 : 1);
    gl.uniform1f(u.convSizeMul, isConverging ? 1 - convEase * 0.55 : 1);

    gl.drawArrays(gl.POINTS, 0, total);

    // ── 2D overlay: markers ────────────────────────────────────────
    octx.clearRect(0, 0, w, h);

    const cYY = Math.cos(totalY), sYY = Math.sin(totalY);
    const cXX = Math.cos(rotX), sXX = Math.sin(rotX);

    renderedMarkers = markers.map((m) => {
      // Convergence : on porte le même spiral-collapse que le vertex shader
      // (cf. VERT_SHADER, branche `uConverging == 1`). Sans ça, les markers
      // resteraient figés dans leur position d'origine pendant que la galaxie
      // tourne autour d'eux — visuellement déconnectés.
      let px = m.pos.x;
      let py = m.pos.y;
      let pz = m.pos.z;
      if (isConverging && convergeTargetPos) {
        const dx = m.pos.x - convergeTargetPos.x;
        const dy = m.pos.y - convergeTargetPos.y;
        const dz = m.pos.z - convergeTargetPos.z;
        const dist2D = Math.hypot(dx, dz);
        const swirl = convT * (2.6 + dist2D * 1.8);
        const ca = Math.cos(swirl);
        const sa = Math.sin(swirl);
        const rotDx = dx * ca + dz * sa;
        const rotDz = -dx * sa + dz * ca;
        const radial = 1 - convEase;
        px = convergeTargetPos.x + rotDx * radial;
        py = convergeTargetPos.y + dy * radial;
        pz = convergeTargetPos.z + rotDz * radial;
      }
      const x1 = px * cYY + pz * sYY;
      const z1 = -px * sYY + pz * cYY;
      const y1 = py * cXX - z1 * sXX;
      const z2 = py * sXX + z1 * cXX;
      return {
        marker: m,
        x: cx + x1 * radius,
        y: cy + y1 * radius,
        depth: (z2 + 1) / 2,
      };
    });

    const sortedM = renderedMarkers
      .map((r, i) => ({ r, i }))
      .sort((a, b) => a.r.depth - b.r.depth);

    octx.save();
    octx.globalCompositeOperation = 'lighter'; // additive — layers stack into one bright glow
    for (const { r, i } of sortedM) {
      const isHovered = i === hoveredIndex;
      const isTarget = i === convergeMarkerIdx;
      const depth = r.depth;
      const markerZoom = Math.min(2.4, Math.pow(zoom, 0.75));

      // Target marker swells and its halo blooms during convergence.
      const convScale = isTarget ? 1 + convEase * 1.6 : 1;
      const convBoost = isTarget ? 1 + convEase * 1.8 : 1;
      // Les markers non-target spiralent vers le target et fondent en alpha
      // pour s'absorber dans le bloom (sinon ils s'empilent visuellement).
      const convFadeMul = (isConverging && !isTarget) ? Math.max(0, 1 - convEase * 0.95) : 1;
      const hoverMul = isHovered ? 1.25 : 1;

      // Three nested soft glows, no hard edge — same rendering language as
      // the WebGL particles around it (additive radial falloff).
      const coreR = (3.2 + depth * 1.8) * dpr * markerZoom * convScale * hoverMul;
      const bloomR = coreR * 3.8;
      const haloR = coreR * 9 * convBoost;

      // Star palette derived from marker.rgb so chaque projet a sa couleur.
      // L'astuce visuelle : on garde un core blanc-chaud (toutes les étoiles
      // sont incandescentes au cœur) puis on fait fondre vers la teinte du
      // marker pour le bloom et le halo. Ça donne des étoiles colorées tout
      // en gardant l'effet "spot lumineux" cohérent entre projets.
      const [mr, mg, mb] = r.marker.rgb;
      const lighten = (t: number): [number, number, number] => [
        Math.round(mr + (255 - mr) * t),
        Math.round(mg + (255 - mg) * t),
        Math.round(mb + (255 - mb) * t),
      ];
      const darken = (t: number): [number, number, number] => [
        Math.round(mr * (1 - t)),
        Math.round(mg * (1 - t)),
        Math.round(mb * (1 - t)),
      ];
      const [br, bg, bb] = lighten(0.55);   // bloom: tint bright
      const [cr, cg, cb] = lighten(0.88);   // core mid: near-white
      const [dr, dg, db] = darken(0.18);    // halo deep

      // 1. Wide colored halo
      const halo = octx.createRadialGradient(r.x, r.y, 0, r.x, r.y, haloR);
      const haloA = 0.32 * convBoost * hoverMul * convFadeMul;
      halo.addColorStop(0, `rgba(${mr}, ${mg}, ${mb}, ${haloA * 0.7})`);
      halo.addColorStop(0.35, `rgba(${dr}, ${dg}, ${db}, ${haloA * 0.28})`);
      halo.addColorStop(1, `rgba(${dr}, ${dg}, ${db}, 0)`);
      octx.fillStyle = halo;
      octx.beginPath();
      octx.arc(r.x, r.y, haloR, 0, Math.PI * 2);
      octx.fill();

      // 2. Bloom : near-white → marker tint
      const bloom = octx.createRadialGradient(r.x, r.y, 0, r.x, r.y, bloomR);
      bloom.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${0.85 * hoverMul * convFadeMul})`);
      bloom.addColorStop(0.5, `rgba(${br}, ${bg}, ${bb}, ${0.5 * hoverMul * convFadeMul})`);
      bloom.addColorStop(1, `rgba(${mr}, ${mg}, ${mb}, 0)`);
      octx.fillStyle = bloom;
      octx.beginPath();
      octx.arc(r.x, r.y, bloomR, 0, Math.PI * 2);
      octx.fill();

      // 3. Hot overexposed core — toujours blanc-chaud avec un voile de la teinte
      const core = octx.createRadialGradient(r.x, r.y, 0, r.x, r.y, coreR);
      core.addColorStop(0, `rgba(255, 252, 248, ${convFadeMul})`);
      core.addColorStop(0.5, `rgba(${cr}, ${cg}, ${cb}, ${0.95 * convFadeMul})`);
      core.addColorStop(1, `rgba(${br}, ${bg}, ${bb}, 0)`);
      octx.fillStyle = core;
      octx.beginPath();
      octx.arc(r.x, r.y, coreR, 0, Math.PI * 2);
      octx.fill();

      // 4. Hover pulse — bloom-colored ring
      if (isHovered && !isConverging) {
        const t = (performance.now() / 700) % 1;
        octx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.55 * (1 - t)})`;
        octx.lineWidth = 1 * dpr;
        octx.beginPath();
        octx.arc(r.x, r.y, coreR + bloomR * t * 0.6, 0, Math.PI * 2);
        octx.stroke();
      }
    }
    octx.restore();

    requestAnimationFrame(frame);
  }

  function toCanvasCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr };
  }

  function findMarkerAt(x: number, y: number): number {
    const hitR = 24 * dpr;
    let best = -1;
    let bestDepth = -1;
    for (let i = 0; i < renderedMarkers.length; i++) {
      const r = renderedMarkers[i];
      if (r.depth < 0.2) continue;
      const dx = r.x - x;
      const dy = r.y - y;
      if (Math.sqrt(dx * dx + dy * dy) <= hitR && r.depth > bestDepth) {
        best = i;
        bestDepth = r.depth;
      }
    }
    return best;
  }

  function updateTooltip(idx: number, clientX: number, clientY: number): void {
    if (idx === -1 || !wrap) {
      tooltip.classList.remove('is-visible');
      return;
    }
    const wrapRect = wrap.getBoundingClientRect();
    const m = renderedMarkers[idx].marker;
    const [tr, tg, tb] = m.rgb;
    const softR = Math.round(tr + (255 - tr) * 0.4);
    const softG = Math.round(tg + (255 - tg) * 0.4);
    const softB = Math.round(tb + (255 - tb) * 0.4);
    tooltip.textContent = m.label;
    tooltip.style.setProperty('--tt-color', `rgb(${tr}, ${tg}, ${tb})`);
    tooltip.style.setProperty('--tt-color-soft', `rgb(${softR}, ${softG}, ${softB})`);
    tooltip.style.setProperty('--tt-glow', `rgba(${tr}, ${tg}, ${tb}, 0.55)`);
    tooltip.style.setProperty('--tt-glow-soft', `rgba(${tr}, ${tg}, ${tb}, 0.24)`);
    tooltip.style.left = `${clientX - wrapRect.left}px`;
    tooltip.style.top = `${clientY - wrapRect.top - 18}px`;
    tooltip.classList.add('is-visible');
  }

  canvas.addEventListener('pointermove', (e) => {
    pointerInside = true;
    lastMove = performance.now();
    if (convergeStartTime !== null) return;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);

    if (isDragging) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      targetPanX = dragStartPan.x + dx * dpr;
      targetPanY = dragStartPan.y + dy * dpr;
      hoveredIndex = -1;
      tooltip.classList.remove('is-visible');
      return;
    }

    const idx = findMarkerAt(x, y);
    hoveredIndex = idx;
    canvas.style.cursor = idx >= 0 ? 'pointer' : 'grab';
    updateTooltip(idx, e.clientX, e.clientY);

    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    const parallaxFactor = Math.max(0, 1 - Math.abs(zoom - 1) * 2);
    targetRotY = nx * PARALLAX_Y * parallaxFactor;
    targetRotX = BASE_TILT_X + ny * PARALLAX_X * parallaxFactor;
  });

  canvas.addEventListener('pointerleave', () => {
    pointerInside = false;
    isDragging = false;
    hoveredIndex = -1;
    tooltip.classList.remove('is-visible');
    targetRotX = BASE_TILT_X;
    targetRotY = 0;
    canvas.style.cursor = '';
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (convergeStartTime !== null) return;
    if (hoveredIndex >= 0) return;
    isDragging = true;
    dragStart.x = e.clientX;
    dragStart.y = e.clientY;
    dragStartPan.x = targetPanX;
    dragStartPan.y = targetPanY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('pointerup', (e) => {
    if (isDragging) {
      isDragging = false;
      canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = pointerInside ? 'grab' : '';
    }
  });

  // touch-action: pan-y laisse le navigateur prendre la main quand il
  // détecte un scroll vertical — un pointercancel arrive alors sans
  // pointerup. Sans ça, isDragging restait collé à true jusqu'au tap
  // suivant, et la galaxie panait pendant le scroll de la page.
  canvas.addEventListener('pointercancel', (e) => {
    if (isDragging) {
      isDragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
      canvas.style.cursor = '';
    }
  });

  canvas.addEventListener('click', (e) => {
    if (convergeStartTime !== null) return;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    const idx = findMarkerAt(x, y);
    if (idx === -1) return;

    const href = markers[idx].href;
    convergeStartTime = performance.now();
    convergeMarkerIdx = idx;
    hoveredIndex = -1;
    tooltip.classList.remove('is-visible');
    canvas.style.cursor = '';

    setTimeout(() => {
      // Route through the hash so the view switches to Projets (and scrolls to
      // the target) instead of trying to scroll a section that's display:none.
      location.hash = href;
    }, CONVERGE_NAVIGATE_AT);
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.10 : 1 / 1.10;
      const rect = canvas.getBoundingClientRect();
      zoomBy(factor, (e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
    },
    { passive: false },
  );

  canvas.addEventListener('dblclick', (e) => {
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    if (findMarkerAt(x, y) !== -1) return;
    resetView();
  });

  document.querySelectorAll<HTMLElement>('[data-zoom-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.zoomAction;
      const centerX = canvas.width / 2 + panX;
      const centerY = canvas.height / 2 + panY;
      if (action === 'in') zoomBy(1.4, centerX, centerY);
      else if (action === 'out') zoomBy(1 / 1.4, centerX, centerY);
      else if (action === 'reset') resetView();
    });
  });

  setInterval(() => {
    if (!pointerInside && performance.now() - lastMove > 1500) {
      targetRotX = BASE_TILT_X;
      targetRotY = 0;
    }
  }, 500);

  document.querySelectorAll<HTMLElement>('[data-marker-jump]').forEach((btn) => {
    btn.addEventListener('mouseenter', () => {
      const label = btn.dataset.markerJump;
      const idx = markers.findIndex((m) => m.label === label);
      if (idx >= 0) hoveredIndex = idx;
    });
    btn.addEventListener('mouseleave', () => {
      hoveredIndex = -1;
    });
  });

  resize();
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
  }
  if ('fonts' in document) {
    document.fonts.ready.then(resize).catch(() => undefined);
  }
  requestAnimationFrame(frame);
}
