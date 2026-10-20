// Bakes the resting marks from Grok's own engine (motion.mjs: ih + Uh) into
// rest.data.ts: per picker shape, the rest pose plus grids of the gaze poses
// se() passes through — at hold 1/3 and 2/3 (5×5) and full hold (7×7). QuickJS
// can't afford Uh's live silhouette solve on hover (~9ms a frame, ~2ms in
// Chromium, and nearly every hover frame lands on a new pose), so resting
// marks interpolate these frames instead. Run: node tools/grok-mark/bake-rest.mjs
import fs from "node:fs";
import { ih, rv, Uh, YN } from "../../app/mark/motion.mjs";

const OUT = new URL("../../app/mark/rest.data.ts", import.meta.url);
const SHAPES = ["blob", "cloud", "square", "sparkle", "clover", "heart", "flower", "teardrop", "tablet", "wedge", "house", "star", "hex"];
const W = 192; // Uh's viewBox; the mark box is W·0.6/0.92 (KN's resolution rule)
// hold layers and their gaze grids (cols: gaze x −1…1, rows: gaze y −1…1)
const LAYERS = [[1 / 3, 5], [2 / 3, 5], [1, 7]];
const grid = (n) => Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
const N = 96; // outline points
const EN = 20; // points per eye
const APPEARANCE = { ink: [0, 0, 0], spot: [0, 0, 0], cutout: true, inkPaint: "#000" };

const settle = (R) => {
  for (let i = 0; i < 900 && !R.isSettled; i++) R.advance(1 / 30);
  if (!R.isSettled) throw new Error("engine did not settle");
};
// The resting engine at an exact hold: setGaze snaps cx,cy (hold is 0), then
// hold = 1−0.86^(60·Σdt) (bx), so a chosen total dt lands on it exactly —
// split under advance()'s 0.1s clamp.
const treeAt = (body, gaze, hold) => {
  const R = ih({ body });
  rv(R, "idle", { seed: 1, isCompact: false, isResting: true });
  settle(R);
  if (gaze) {
    R.setGaze(gaze);
    if (hold >= 1) settle(R);
    else {
      const total = Math.log(1 - hold) / (60 * Math.log(0.86)), steps = Math.ceil(total / 0.09);
      for (let i = 0; i < steps; i++) R.advance(total / steps);
    }
  }
  return Uh(R.frame(), APPEARANCE, W, "b", { displaySize: (W * 0.6) / 0.92, extent: "100%" });
};

// ——— SVG → absolute polylines ———
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const parseTransform = (s) => {
  let m = [1, 0, 0, 1, 0, 0];
  for (const [, name, raw] of String(s ?? "").matchAll(/([a-z]+)\(([^)]*)\)/gi)) {
    const a = raw.trim().split(/[\s,]+/).map(Number);
    if (name === "matrix") m = mul(m, a);
    else if (name === "translate") m = mul(m, [1, 0, 0, 1, a[0], a[1] ?? 0]);
    else if (name === "scale") m = mul(m, [a[0], 0, 0, a[1] ?? a[0], 0, 0]);
    else if (name === "rotate") {
      const r = (a[0] * Math.PI) / 180, c = Math.cos(r), s2 = Math.sin(r), [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      m = mul(mul(mul(m, [1, 0, 0, 1, cx, cy]), [c, s2, -s2, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else throw new Error(`transform ${name}`);
  }
  return m;
};
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
// SVG arc (endpoint form) → points, per SVG 1.1 F.6.5
const arcPoints = (x1, y1, rx, ry, phi, large, sweep, x2, y2) => {
  const p = (phi * Math.PI) / 180, cp = Math.cos(p), sp = Math.sin(p);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(8, Math.ceil(Math.abs(dt) / (Math.PI / 48)));
  return Array.from({ length: steps }, (_, i) => {
    const t = t1 + (dt * (i + 1)) / steps;
    return [cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp];
  });
};
const pathLoops = (d) => {
  const loops = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0;
  const toks = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let i = 0, cmd = "";
  const num = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === "Z") { if (cur) loops.push(cur); cur = null; x = sx; y = sy; continue; }
    if (C === "M") { if (cur) loops.push(cur); x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); sx = x; sy = y; cur = [[x, y]]; cmd = rel ? "l" : "L"; continue; }
    if (C === "L") { x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); cur.push([x, y]); continue; }
    if (C === "H") { x = (rel ? x : 0) + num(); cur.push([x, y]); continue; }
    if (C === "V") { y = (rel ? y : 0) + num(); cur.push([x, y]); continue; }
    if (C === "C" || C === "Q") {
      const n = C === "C" ? 3 : 2, pts = [];
      for (let k = 0; k < n; k++) pts.push([(rel ? x : 0) + num(), (rel ? y : 0) + num()]);
      const P = [[x, y], ...pts];
      for (let s = 1; s <= 16; s++) {
        const t = s / 16, u = 1 - t;
        cur.push(n === 3
          ? [u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0], u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1]]
          : [u * u * P[0][0] + 2 * u * t * P[1][0] + t * t * P[2][0], u * u * P[0][1] + 2 * u * t * P[1][1] + t * t * P[2][1]]);
      }
      [x, y] = P[n];
      continue;
    }
    if (C === "A") {
      const rx = num(), ry = num(), phi = num(), large = num(), sweep = num();
      const ex = (rel ? x : 0) + num(), ey = (rel ? y : 0) + num();
      cur.push(...arcPoints(x, y, rx, ry, phi, large, sweep, ex, ey));
      x = ex; y = ey;
      continue;
    }
    throw new Error(`path command ${cmd}`);
  }
  if (cur) loops.push(cur);
  return loops.filter((l) => l.length >= 3);
};
const area = (p) => p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0) / 2;
// Uh's tree → { outline, eyes } in viewBox units: the body is the use'd
// g's paths (or a lone evenodd path: the sphere, eyes as its inner loops),
// the eyes the mask's black paths, all under their transforms.
const flatten = (tree) => {
  const defs = new Map(), body = [], eyes = [];
  const collect = (n) => { if (n.attrs?.id) defs.set(n.attrs.id, n); n.children?.forEach(collect); };
  collect(tree);
  const walk = (n, m) => {
    if (n.tag === "defs" || n.tag === "mask") return;
    const mm = n.attrs?.transform ? mul(m, parseTransform(n.attrs.transform)) : m;
    const mask = /#([^)]+)\)/.exec(String(n.attrs?.mask ?? ""))?.[1];
    if (mask) for (const c of defs.get(mask).children) if (c.tag === "path" && c.attrs.fill === "#000") eyes.push(...pathLoops(c.attrs.d).map((l) => l.map((p) => apply(mm, p))));
    if (n.tag === "use") return defs.get(String(n.attrs.href).slice(1)).children.forEach((c) => body.push(...pathLoops(c.attrs.d).map((l) => l.map((p) => apply(mm, p)))));
    if (n.tag === "path") return body.push(...pathLoops(n.attrs.d).map((l) => l.map((p) => apply(mm, p))));
    if (n.tag !== "svg" && n.tag !== "g") throw new Error(`unexpected <${n.tag}> at rest`);
    n.children.forEach((c) => walk(c, mm));
  };
  walk(tree, [1, 0, 0, 1, 0, 0]);
  body.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const [outline, ...inner] = body;
  return { outline, eyes: [...eyes, ...inner] };
};
// arc-length resample to n points, clockwise on screen, starting straight
// above the centroid — the same anchor every frame, so frames blend pointwise
const resample = (poly, n) => {
  if (area(poly) < 0) poly = [...poly].reverse();
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  let start = 0, best = Infinity;
  poly.forEach(([x, y], i) => { const a = Math.abs(Math.atan2(x - cx, cy - y)); if (y < cy && a < best) { best = a; start = i; } });
  poly = [...poly.slice(start), ...poly.slice(0, start)];
  const seg = poly.map((p, i) => Math.hypot(poly[(i + 1) % poly.length][0] - p[0], poly[(i + 1) % poly.length][1] - p[1]));
  const total = seg.reduce((a, b) => a + b, 0), out = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (acc + seg[i] < target) acc += seg[i++];
    const f = seg[i] ? (target - acc) / seg[i] : 0, a = poly[i], b = poly[(i + 1) % poly.length];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
};
const q = (v) => {
  const b = Math.round((v / W) * 255);
  if (b < 0 || b > 255) throw new Error(`coordinate ${v} outside the viewBox`);
  return b;
};

const data = {};
for (const shape of SHAPES) {
  const body = YN(shape), bytes = [];
  const frames = [[null, 0], ...LAYERS.flatMap(([hold, n]) => grid(n).flatMap((gy) => grid(n).map((gx) => [[gx, gy], hold])))];
  for (const [gaze, hold] of frames) {
    const { outline, eyes } = flatten(treeAt(body, gaze, hold));
    if (eyes.length !== 2) throw new Error(`${shape} ${gaze}: ${eyes.length} eyes`);
    const cxOf = (l) => l.reduce((s, p) => s + p[0], 0) / l.length;
    eyes.sort((a, b) => cxOf(a) - cxOf(b));
    for (const [x, y] of [...resample(outline, N), ...resample(eyes[0], EN), ...resample(eyes[1], EN)]) bytes.push(q(x), q(y));
  }
  data[shape] = Buffer.from(bytes).toString("base64");
}
const src = `// Generated by tools/grok-mark/bake-rest.mjs — do not edit.
// Grok's resting marks, solved by its own engine (motion.mjs): per shape, the
// rest pose, then per hold layer a grid of gaze poses (rows: gaze y −1…1,
// cols: gaze x −1…1). Each frame: ${N} outline points, then two eyes of ${EN}
// points (left first) — (x, y) bytes over Uh's 0…${W} viewBox.
export const REST_W = ${W};
export const REST_LAYERS: [hold: number, grid: number][] = ${JSON.stringify(LAYERS)};
export const REST_N = ${N};
export const REST_EN = ${EN};
export const REST: Record<string, string> = ${JSON.stringify(data)};
`;
fs.writeFileSync(OUT, src);
console.log(`wrote ${OUT.pathname} (${(src.length / 1024).toFixed(0)} KB)`);
