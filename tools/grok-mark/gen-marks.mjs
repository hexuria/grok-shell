// Bakes Grok's 3D avatar marks into marks.data.ts: for each picker shape,
// the projected silhouette of its solid (extrusion / loft / revolve / pill /
// sphere) and its surface-seated eyes over the Idle_D clip, plus the
// camera-facing pose. Run: node tools/grok-mark/gen-marks.mjs
import fs from "node:fs";
import { $h, jT, Ib } from "./engine.mjs";

const OUT = new URL("../../marks.data.ts", import.meta.url);
const SPRITE = 144;
const N = 80; // outline points per frame
const FPS = 8;
const CLIP = 6; // Idle_D loops every 6s
const LO = -8, HI = 152; // sprite range quantized to a byte
const NAMES = {
  blob: "sphere", cloud: "cloud", square: "square", sparkle: "sparkle", clover: "clover",
  heart: "heartChubby", flower: "starFlower", teardrop: "teardrop", tablet: "tablet",
  wedge: "wedge", house: "house", star: "star6", hex: "hex",
};
// Idle_D rotation keys [t, [pitch, yaw, roll], bezier] (Sand's clip table)
const KEYS = [
  [0.0, [-15.896, 33.293, 25.385], [0.6511, 0, 0.3268, 1]],
  [0.587, [-34.323, 16.862, 15.137], [0.5997, 0, 0.2467, 1]],
  [1.078, [-34.323, 16.862, 15.137], [0.5997, 0, 0.1066, 1]],
  [1.963, [-6.168, 3.099, 14.349], [0.42, 0, 0.58, 1]],
  [2.672, [-6.168, 3.099, 14.349], [0.42, 0, 0.2029, 1]],
  [3.914, [7.573, 40.387, 25.474], [0.42, 0, 0.58, 1]],
  [4.786, [7.573, 40.387, 25.474], [0.6316, 0, 0.2164, 1]],
  [5.633, [-15.896, 33.293, 25.385], [0.6511, 0, 0.3268, 1]],
  [6.0, [-15.896, 33.293, 25.385], [0.6511, 0, 0.3268, 1]],
];
const bezier = ([x1, y1, x2, y2], x) => {
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 40; i++) {
    t = (lo + hi) / 2;
    const bx = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
    if (bx < x) lo = t; else hi = t;
  }
  return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
};
const poseAt = (time) => {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= time) i++;
  const [t0, a, ez] = KEYS[i], [t1, b] = KEYS[i + 1];
  const k = bezier(ez, (time - t0) / (t1 - t0 || 1));
  const v = a.map((x, j) => x + (b[j] - x) * k);
  return { pitch: v[0], yaw: v[1], roll: v[2] };
};
const eye = () => ({ oval: [0.13, 0.285], off: [0, 0], lidY: 1, tilt: 0, wid: 0, pts: [], ovalMix: 1 });
const D = Math.PI / 180;
const loops = (d) =>
  d.split(/Z|(?=M)/).map((s) => s.replace(/[ML]/g, " ").trim().split(/[\s,]+/).filter(Boolean).map(Number))
    .filter((a) => a.length >= 6)
    .map((a) => { const p = []; for (let i = 0; i + 1 < a.length; i += 2) p.push([a[i], a[i + 1]]); return p; });
const area = (p) => p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0) / 2;
// arc-length resample to n points, clockwise, starting straight above the centroid
function resample(poly, n = N) {
  if (area(poly) < 0) poly = [...poly].reverse();
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  let start = 0, best = 1e9;
  poly.forEach(([x, y], i) => { const a = Math.abs(Math.atan2(x - cx, cy - y)); if (y < cy && a < best) { best = a; start = i; } });
  poly = [...poly.slice(start), ...poly.slice(0, start)];
  const seg = poly.map((p, i) => Math.hypot(poly[(i + 1) % poly.length][0] - p[0], poly[(i + 1) % poly.length][1] - p[1]));
  const total = seg.reduce((a, b) => a + b, 0);
  const out = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (acc + seg[i] < target) acc += seg[i++];
    const f = seg[i] ? (target - acc) / seg[i] : 0;
    const a = poly[i], b = poly[(i + 1) % poly.length];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}
// an eye path → ellipse [cx, cy, rx, ry, angleDeg] (PCA of its outline)
function fitEllipse(d) {
  const p = loops(d).flat();
  if (p.length < 3) return [0, 0, 0, 0, 0];
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of p) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  sxx /= p.length; syy /= p.length; sxy /= p.length;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const ang = Math.atan2(l1 - sxx, sxy || 1e-9) * 180 / Math.PI; // major axis
  const r = (v) => Math.round(v * 10) / 10;
  return [r(cx), r(cy), r(Math.sqrt(2 * Math.max(0, l2))), r(Math.sqrt(2 * Math.max(0, l1))), r(ang - 90)];
}
// the eye itself: Grok's real outline — a curved slot seated on the turned
// face, not an ellipse — resampled to EYE_N points for frame blending
const EYE_N = 16;
function eyePoly(d) {
  const p = loops(d).flat();
  if (p.length < 4) return null;
  return resample(p, EYE_N);
}
const polyC = (p) => p.reduce((s, q) => s + q[0], 0) / p.length;
function mark(body, pose) {
  if (body === "sphere") {
    // jT draws the sphere at display size; 144/1.3913 display units span the
    // same scale as $h's 144pt sprite, so only the origin moves. Its body is
    // an SVG circle (arcs), so the outline is sampled directly; with cutout
    // off it returns the eye polygons separately.
    const n = SPRITE / 1.3913, off = SPRITE / 2 - n / 2;
    const s = jT({ zoom: 1, squash: [1, 1], offset: [0, 0], squashAnchor: 0, quat: Ib(pose.pitch * D, pose.yaw * D, pose.roll * D), eyes: [eye(), eye()], glow: null }, { cutout: false }, n);
    const outline = Array.from({ length: 160 }, (_, i) => {
      const a = (i / 160) * Math.PI * 2;
      return [SPRITE / 2 + (n / 2) * Math.cos(a), SPRITE / 2 + (n / 2) * Math.sin(a)];
    });
    const eyes = loops(s.eyes).map((l) => "M" + l.map(([x, y]) => `${x + off} ${y + off}`).join(" ") + "Z");
    return { outline, eyes };
  }
  const r = $h(body, pose, SPRITE, [eye(), eye()]);
  const outline = loops(r.body.join(" ")).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
  return { outline, eyes: r.eyes };
}
const q = (v) => Math.max(0, Math.min(255, Math.round(((v - LO) / (HI - LO)) * 255)));
const frames = Math.round(FPS * CLIP);
// The gaze grid: Grok's fl() gaze pose sampled over (gx,gy) — the mark's
// rotation when fully held at that gaze point (roll→0). Runtime bilinearly
// blends the four nearest cells, then eases rest→grid by the hold ramp —
// the same math `se()` runs in Sand's runtime. kx = per-body turn scale.
const GN = 5, GRID = [-1, -0.5, 0, 0.5, 1];
const KX = { heartChubby: 0.6, wedge: 0.55 };
const gazePose = (body, gx, gy) => {
  const o = KX[body] ?? 1, r = body !== "sphere";
  return { pitch: -(r ? 19 : 14) * o * gy, yaw: (r ? 26 : 18) * o * gx, roll: 0 };
};
const eyeBytes = (m) => {
  // left eye first by centroid x; each eye = EYE_N (x,y) pairs; absent → zeros
  const ep = m.eyes.map(eyePoly).filter(Boolean).sort((a, b) => polyC(a) - polyC(b));
  const out = [];
  for (let i = 0; i < 2; i++) {
    const p = ep[i];
    for (let k = 0; k < EYE_N; k++) out.push(q(p?.[k]?.[0] ?? 0), q(p?.[k]?.[1] ?? 0));
  }
  return out;
};
const data = {};
for (const [pick, body] of Object.entries(NAMES)) {
  const bytes = [], eyes = [], pBytes = [];
  const poses = [...Array.from({ length: frames }, (_, i) => poseAt((i / FPS) % CLIP)), { pitch: 0, yaw: 0, roll: 0 }];
  for (const pose of poses) {
    const m = mark(body, pose);
    for (const [x, y] of resample(m.outline)) bytes.push(q(x), q(y));
    // left eye first
    const e = m.eyes.map(fitEllipse).sort((a, b) => a[0] - b[0]);
    eyes.push(e.length === 2 ? [...e[0], ...e[1]] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    pBytes.push(...eyeBytes(m));
  }
  const gBytes = [], gEyes = [], gPBytes = [];
  for (const gy of GRID) for (const gx of GRID) {
    const m = mark(body, gazePose(body, gx, gy));
    for (const [x, y] of resample(m.outline)) gBytes.push(q(x), q(y));
    const e = m.eyes.map(fitEllipse).sort((a, b) => a[0] - b[0]);
    gEyes.push(e.length === 2 ? [...e[0], ...e[1]] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    gPBytes.push(...eyeBytes(m));
  }
  data[pick] = {
    o: Buffer.from(bytes).toString("base64"),
    e: eyes,
    p: Buffer.from(pBytes).toString("base64"),
    g: { o: Buffer.from(gBytes).toString("base64"), e: gEyes, p: Buffer.from(gPBytes).toString("base64") },
  };
}
const src = `// Generated by tools/grok-mark/gen-marks.mjs — do not edit.
// Grok's 3D avatar marks: per shape, ${frames} Idle_D frames (${FPS} fps) + the
// camera-facing pose (last), each an ${N}-point silhouette (bytes over the
// ${SPRITE}pt sprite, range ${LO}..${HI}) and two eye ellipses [cx, cy, rx, ry, deg].
// \`g\` is the gaze grid: ${GN}×${GN} fl() poses (rows = pitch/gaze-y, cols =
// yaw/gaze-x, both −1…1) in the same encoding — the real turned silhouettes
// and surface-seated eyes the runtime blends toward while held. \`p\` is the
// real per-eye outline (2 × ${EYE_N} (x,y) pairs per frame, left eye first).
export const MARK_FPS = ${FPS};
export const MARK_FRAMES = ${frames};
export const MARK_POINTS = ${N};
export const MARK_SPRITE = ${SPRITE};
export const MARK_LO = ${LO};
export const MARK_HI = ${HI};
export const MARK_GAZE_N = ${GN};
export const MARK_EYE_N = ${EYE_N};
export const MARKS: Record<string, { o: string; e: number[][]; p: string; g: { o: string; e: number[][]; p: string } }> = ${JSON.stringify(data)};
`;
fs.writeFileSync(OUT, src);
console.log(`wrote ${OUT.pathname} (${(src.length / 1024).toFixed(0)} KB)`);
