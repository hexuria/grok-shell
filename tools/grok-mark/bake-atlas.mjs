// Bakes Grok's mark outlines into atlas.data.ts: per picker body, IM()'s
// silhouette (Grok's own solver, motion.mjs) over a (yaw, pitch) grid at roll
// 0, as radial functions around the projected origin. markatlas.mjs answers
// IM() from it at run time, so no outline is solved live: the solver costs
// 10–40ms a frame in QuickJS and some poses take seconds.
// Run: node tools/grok-mark/bake-atlas.mjs [--check]   (env STEP, K)
import fs from "node:fs";
import { Cs, IM, pc, YN } from "../../motion.mjs";
import { atlasOutline, decodeAtlas } from "../../markatlas.mjs";

const OUT = new URL("../../atlas.data.ts", import.meta.url);
const STEP = Number(process.env.STEP || 10); // grid spacing, degrees
const K = Number(process.env.K || 128); // radial samples
const NREF = 160;
// the picker's bodies minus blob — the sphere renders through jT, not IM
const SHAPES = ["cloud", "square", "sparkle", "clover", "heart", "flower", "teardrop", "tablet", "wedge", "house", "star", "hex"];

const loopsOf = (d) =>
  d.split("Z").filter((s) => s.includes("M")).map((s) => {
    const a = s.replace("M", " ").trim().split(/\s+/).map(Number), p = [];
    for (let i = 0; i + 1 < a.length; i += 2) p.push([a[i], a[i + 1]]);
    return p;
  }).filter((l) => l.length >= 3);
const outline = (body, yaw, pitch, roll) => IM(body, { yaw, pitch, roll }, NREF).flatMap(loopsOf);
// farthest distance from points of `a` to the outline `b`
const maxDist = (a, b) => {
  let worst = 0;
  for (const l of a) for (const p of l) {
    let best = Infinity;
    for (const m of b) for (let i = 0; i < m.length; i++) {
      const s = m[i], e = m[(i + 1) % m.length], vx = e[0] - s[0], vy = e[1] - s[1];
      const t = Math.max(0, Math.min(1, ((p[0] - s[0]) * vx + (p[1] - s[1]) * vy) / (vx * vx + vy * vy || 1)));
      best = Math.min(best, Math.hypot(p[0] - s[0] - t * vx, p[1] - s[1] - t * vy));
    }
    worst = Math.max(worst, best);
  }
  return worst;
};
// the outline as its area centroid plus ρ(θ) around it, in units of pc()
// around the projected origin (y up) — a heart's or cloud's notch can leave
// the origin itself outside the silhouette
const radial = (loops, o) => {
  const c = NREF / 2, rho = new Float64Array(K);
  const pts = loops.map((l) => l.map(([x, y]) => [(x - c) / o, (c - y) / o]));
  // loops can come back with mixed winding: weight each by its own |area|
  let area = 0, gx = 0, gy = 0;
  for (const l of pts) {
    let la = 0, lx = 0, ly = 0;
    for (let i = 0; i < l.length; i++) {
      const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length], cr = x0 * y1 - x1 * y0;
      la += cr; lx += (x0 + x1) * cr; ly += (y0 + y1) * cr;
    }
    const sign = la < 0 ? -1 : 1;
    area += sign * la; gx += sign * lx; gy += sign * ly;
  }
  const cx = gx / (3 * area), cy = gy / (3 * area);
  let multi = 0;
  for (let k = 0; k < K; k++) {
    const t = (2 * Math.PI * k) / K, dx = Math.cos(t), dy = Math.sin(t);
    let best = 0, hits = 0;
    for (const l of pts) for (let i = 0; i < l.length; i++) {
      const q = l[(i + 1) % l.length];
      const px = l[i][0] - cx, py = l[i][1] - cy, ex = q[0] - l[i][0], ey = q[1] - l[i][1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const s = (px * ey - py * ex) / den, u = (px * dy - py * dx) / den;
      // a ray through a vertex must not slip between its two segments
      if (s > 0 && u >= -1e-9 && u <= 1 + 1e-9) {
        hits++;
        best = Math.max(best, s);
      }
    }
    if (!hits) throw new Error("a ray missed the outline");
    rho[k] = best;
    if (hits > 2) multi++;
  }
  return { cx, cy, rho, multi };
};

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const data = {};
for (const shape of SHAPES) {
  const body = YN(shape), o = pc(Cs(body), NREF);
  // X-mirror symmetric bodies store yaw ≥ 0 only
  let mirror = true;
  for (let i = 0; i < 12 && mirror; i++) {
    const yaw = rnd() * 180, pitch = rnd() * 180 - 90;
    const flipped = outline(body, -yaw, pitch, 0).map((l) => l.map(([x, y]) => [NREF - x, y]));
    mirror = maxDist(flipped, outline(body, yaw, pitch, 0)) < 0.05;
  }
  const J = 360 / STEP, P = 180 / STEP + 1, cols = mirror ? 180 / STEP + 1 : J;
  const nodes = [];
  let m = 0, cMax = 0, multi = 0;
  for (let row = 0; row < P; row++) for (let col = 0; col < cols; col++) {
    const r = radial(outline(body, mirror ? col * STEP : -180 + col * STEP, -90 + row * STEP, 0), o);
    nodes.push(r);
    multi += r.multi;
    cMax = Math.max(cMax, Math.abs(r.cx), Math.abs(r.cy));
    for (const v of r.rho) m = Math.max(m, v);
  }
  m *= 1.0001;
  cMax = cMax * 1.0001 || 1;
  // per node: centroid (x, y over ±c) then K radii (over m)
  const bytes = Buffer.alloc(nodes.length * (K + 2));
  nodes.forEach((r, i) => {
    const at = i * (K + 2);
    bytes[at] = Math.round(((r.cx / cMax + 1) / 2) * 255);
    bytes[at + 1] = Math.round(((r.cy / cMax + 1) / 2) * 255);
    r.rho.forEach((v, k) => (bytes[at + 2 + k] = Math.round((v / m) * 255)));
  });
  data[shape] = { mirror: mirror ? 1 : 0, m: +m.toPrecision(6), c: +cMax.toPrecision(6), kf: +(o / NREF).toPrecision(6), r: bytes.toString("base64") };
  console.log(`${shape.padEnd(9)} ${body.padEnd(12)} mirror=${mirror} nodes=${nodes.length} rays crossing twice=${multi}`);
}

if (process.argv.includes("--check")) {
  for (const shape of SHAPES) {
    const body = YN(shape), A = decodeAtlas(data[shape], STEP, K), errs = [];
    for (let i = 0; i < 40; i++) {
      const yaw = rnd() * 360 - 180, pitch = rnd() * 180 - 90, roll = rnd() * 360 - 180;
      const truth = outline(body, yaw, pitch, roll), mine = loopsOf(atlasOutline(A, NREF, yaw, pitch, roll));
      errs.push(Math.max(maxDist(mine, truth), maxDist(truth, mine)));
    }
    errs.sort((a, b) => a - b);
    console.log(`${shape.padEnd(9)} sprite px @${NREF}: p50 ${errs[20].toFixed(2)}  p95 ${errs[38].toFixed(2)}  max ${errs[39].toFixed(2)}  (≈${(errs[39] * 0.5).toFixed(2)} px on a 60pt mark)`);
  }
}

const src = `// Generated by tools/grok-mark/bake-atlas.mjs — do not edit.
// Grok's mark outlines, solved by its own engine (motion.mjs IM()): per body a
// (yaw, pitch) grid every ${STEP}° at roll 0 — pitch rows −90…90, yaw columns
// −180…${180 - STEP} (0…180 when the body is X-mirror symmetric) — each node its
// area centroid (2 bytes over ±c) then ${K} radii around it (bytes over m), in
// units of kf·n around the projected origin.
export const ATLAS_STEP = ${STEP};
export const ATLAS_K = ${K};
export const ATLAS: Record<string, { mirror: 0 | 1; m: number; c: number; kf: number; r: string }> = ${JSON.stringify(data)};
`;
fs.writeFileSync(OUT, src);
console.log(`wrote ${OUT.pathname} (${(src.length / 1024).toFixed(0)} KB)`);
