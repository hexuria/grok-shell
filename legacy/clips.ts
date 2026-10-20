// Grok's clip runtime — the real Working/Streaming/Done/Blocked keyframes
// decoded and rendered live through the ported mark engine (markeng.mjs),
// replacing the procedural stand-ins. Clip data: clips.data.ts (the bundle's
// inline `Yx` registry, 28 clips). Track semantics are the `zx()`/`vt()`/`rc()`
// ports below; rendering is `$h()` (the bundle's own solid projector) with
// position/squash/zoom applied as the same 2D transform `jT()` computes.
import { $h, Ib, jT } from "./markeng.mjs";
import { CLIPS } from "./clips.data";

type Key = { t: number; v: number[]; ease: number[] };
type Clip = {
  duration: number;
  position: Key[];
  rotation: Key[];
  squash: Key[];
  zoom: Key[];
  lids: Key[];
  expression: { t: number; name: string }[];
  squashAnchor: number;
  restTime: number;
};

// ——— Sand runtime ports (index.eager-platform) ———
const RR = [0.42, 0, 0.58, 1]; // `rr` default ease
const AA = 0.26; // `aa` blink length
const ON = 0.6; // `On` rest zoom
// cubic-bezier timing: rc() — Newton-solve x→t, then sample y (sl)
const sl = (e: number, t: number, n: number) => {
  const r = 1 - e;
  return 3 * r * r * e * t + 3 * r * e * e * n + e * e * e;
};
const Mb = (e: number, t: number, n: number) => {
  const r = 1 - e;
  return 3 * r * r * t + 6 * r * e * (n - t) + 3 * e * e * (1 - n);
};
const rc = (e: number, t: number[]) => {
  const [n, r, o, s] = t;
  let i = e;
  for (let a = 0; a < 8; a++) {
    const c = sl(i, n, o) - e;
    const u = Mb(i, n, o);
    if (Math.abs(c) < 1e-6 || Math.abs(u) < 1e-6) break;
    i = Math.min(1, Math.max(0, i - c / u));
  }
  return sl(i, r, s);
};
// `_x` track-name aliases
const ALIAS: Record<string, string> = {
  position: "position", rotation: "rotation", squash: "squash", scale: "zoom",
  lids: "lids", expression: "expression", pos: "position", rot: "rotation",
  scl: "squash", zoom: "zoom", expr: "expression",
};
const Nx = ({ t, v, ease }: any): Key => ({
  t,
  v: typeof v === "string" ? [] : v,
  ease: Array.isArray(ease) && ease.length === 4 ? ease : RR,
});
// vt(): eased lerp between the keys bracketing `t`
const vt = (tr: Key[] | undefined, t: number): number[] | null => {
  if (!tr || tr.length === 0) return null;
  if (t <= tr[0].t) return tr[0].v;
  const n = tr[tr.length - 1];
  if (t >= n.t) return n.v;
  let r = 0;
  for (; r < tr.length - 2 && tr[r + 1].t <= t; ) r++;
  const o = tr[r], s = tr[r + 1];
  const i = (t - o.t) / Math.max(s.t - o.t, 1e-9);
  const a = rc(i, o.ease);
  return o.v.map((c, u) => c + (s.v[u] - c) * a);
};

const COOKED = new Map<string, Clip>();
// zx(): raw clip → cooked track lists; "blink" expression keys expand into
// the lids track (Fx: 0→1→0 over AA seconds)
export function cookClip(name: string): Clip | null {
  const hit = COOKED.get(name);
  if (hit) return hit;
  const raw = CLIPS.find((e: any) => e.name === name);
  if (!raw) return null;
  const tracks: Record<string, Key[]> = {};
  for (const [k, arr] of Object.entries(raw.tracks ?? {})) {
    const a = ALIAS[k];
    if (a && !tracks[a]) tracks[a] = (arr as any[]).map(Nx);
  }
  const lids = (tracks.lids ?? []).slice();
  const rawTracks = raw.tracks as unknown as Record<string, any[]>;
  const expr = (rawTracks?.expression ?? rawTracks?.expr ?? []) as any[];
  const expression: { t: number; name: string }[] = [];
  for (const i of expr) {
    if (i.v === "blink") {
      lids.push({ t: i.t, v: [0], ease: RR }, { t: i.t + AA * 0.45, v: [1], ease: RR }, { t: i.t + AA, v: [0], ease: RR });
    } else {
      expression.push({ t: i.t, name: faceName(String(i.v ?? "")) });
    }
  }
  lids.sort((a, b) => a.t - b.t);
  expression.sort((a, b) => a.t - b.t);
  const c: Clip = {
    duration: raw.duration,
    position: tracks.position ?? [],
    rotation: tracks.rotation ?? [],
    squash: tracks.squash ?? [],
    zoom: tracks.zoom ?? [],
    lids,
    expression,
    squashAnchor: raw.squashAnchor ?? 0,
    restTime: raw.workArea?.start ?? 0,
  };
  COOKED.set(name, c);
  return c;
}

export type ClipPose = {
  pitch: number; yaw: number; roll: number;
  ox: number; oy: number; sx: number; sy: number; sa: number; zoom: number; lid: number;
  eyes?: EyeSpec[];
};
export function sampleClip(name: string | string[], t: number): ClipPose | null {
  // a list cycles like rv(): each clip plays once through, then the next —
  // deterministic order keeps every copy of the mark in sync
  if (Array.isArray(name)) {
    if (name.length === 0) return null;
    if (name.length > 1) {
      const cooked = name.map(cookClip).filter(Boolean) as Clip[];
      const total = cooked.reduce((s, c) => s + c.duration, 0);
      let w = ((t % total) + total) % total;
      for (const c of cooked) {
        if (w < c.duration) return sampleTracks(c, w);
        w -= c.duration;
      }
    }
    name = name[0];
  }
  const c = cookClip(name);
  if (!c) return null;
  const w = ((t % c.duration) + c.duration) % c.duration;
  return sampleTracks(c, w);
}

function sampleTracks(c: Clip, w: number): ClipPose {
  const u = vt(c.rotation, w) ?? [0, 0, 0];
  const l = vt(c.position, w) ?? [0, 0];
  const d = vt(c.squash, w) ?? [1, 1];
  const z = vt(c.zoom, w);
  const lid = vt(c.lids, w);
  // expression keys → the active face; transitions morph over MORPH_T from
  // the previously active face (wrap: the clip's last key is the baseline)
  let eyes: EyeSpec[] | undefined;
  if (c.expression.length > 0) {
    let i = c.expression.length - 1;
    for (; i > 0 && c.expression[i].t > w; i--);
    const cur = c.expression[i], prev = i > 0 ? c.expression[i - 1] : c.expression[0];
    const k = Math.min(1, Math.max(0, (w - cur.t) / MORPH_T));
    eyes = cur.name === prev.name || k >= 1
      ? FACE[cur.name]
      : [0, 1].map((e) => lerpEye(FACE[prev.name][e], FACE[cur.name][e], k));
  }
  return {
    // rotation keys are [pitch, yaw, roll] euler degrees
    pitch: u[0] ?? 0, yaw: u[1] ?? 0, roll: u[2] ?? 0,
    ox: l[0] ?? 0, oy: l[1] ?? 0,
    sx: d[0] ?? 1, sy: d[1] ?? 1, sa: c.squashAnchor,
    zoom: (z ? z[0] : ON) / ON, // normalize: rest zoom renders at baked size
    lid: lid ? Math.min(1, Math.max(0, lid[0])) : 0,
    eyes,
  };
}

// ——— faces (vn): expression morphs ——
// Each face is two eye specs rendered as stroked paths (Grok's eyes are
// curve strokes, not ellipses). Ports of jb() (bezier→3 cubic slots),
// th() (sample to 22 pts), _r/zn/sc/qb constructors; il/Mr/Nb constants.
type Pt = [number, number];
type Bez = { p0: Pt; p1: Pt; p2: Pt; isArc?: boolean };
export type EyeSpec = {
  off: number[]; tilt: number; wid: number; lidY: number;
  oval: number[]; ovalMix: number; pts: number[][]; path: number[] | null; fillRing: null;
};
const IL = 0.1305, MR = 0.26, NB = 21;
function jb({ p0: e, p1: t, p2: n, isArc: r }: Bez): number[] {
  const [o, s] = e, [i, a] = t, [c, u] = n;
  const l = new Array(18).fill(0);
  const d = (y: number, w: number[]) => { l[y * 6] = w[0]; l[y * 6 + 1] = w[1]; };
  const f = (y: number, w: number[]) => { l[y * 6 + 2] = w[0] - l[y * 6]; l[y * 6 + 3] = w[1] - l[y * 6 + 1]; };
  const h = (y: number, w: number[]) => { l[y * 6 + 4] = w[0] - l[y * 6]; l[y * 6 + 5] = w[1] - l[y * 6 + 1]; };
  if (r) {
    const y = 2 * (o * (a - u) + i * (u - s) + c * (s - a));
    if (Math.abs(y) > 1e-9) {
      const S = o * o + s * s, b = i * i + a * a, v = c * c + u * u;
      const E = (S * (a - u) + b * (u - s) + v * (s - a)) / y;
      const A = (S * (c - i) + b * (o - c) + v * (i - o)) / y;
      const F = Math.hypot(o - E, s - A);
      const N = Math.atan2(s - A, o - E), R = Math.atan2(u - A, c - E), B = Math.atan2(a - A, i - E);
      const P = Math.PI * 2, I = (R - N + P) % P;
      const O = (B - N + P) % P <= I ? I : I - P;
      const H = (K: number) => [E + F * Math.cos(K), A + F * Math.sin(K)];
      const L = (K: number) => [-Math.sin(K), Math.cos(K)];
      const j = O / 2, J = (4 / 3) * Math.tan(j / 4) * F;
      const fe = [N, N + j, N + O];
      for (let K = 0; K < 3; K++) {
        const te = H(fe[K]), Z = L(fe[K]);
        d(K, te);
        if (K > 0) f(K, [te[0] - J * Z[0], te[1] - J * Z[1]]);
        if (K < 2) h(K, [te[0] + J * Z[0], te[1] + J * Z[1]]);
      }
      return l;
    }
    const w = [(o + c) / 2, (s + u) / 2];
    d(0, [o, s]); d(1, w); d(2, [c, u]);
    h(0, [o + (w[0] - o) / 3, s + (w[1] - s) / 3]);
    f(1, [w[0] - (w[0] - o) / 3, w[1] - (w[1] - s) / 3]);
    h(1, [w[0] + (c - w[0]) / 3, w[1] + (u - w[1]) / 3]);
    f(2, [c - (c - w[0]) / 3, u - (u - w[1]) / 3]);
    return l;
  }
  const p = [(o + i) / 2, (s + a) / 2], g = [(i + c) / 2, (a + u) / 2];
  const m = [(p[0] + g[0]) / 2, (p[1] + g[1]) / 2];
  d(0, [o, s]); d(1, m); d(2, [c, u]);
  h(0, [o + (2 / 3) * (p[0] - o), s + (2 / 3) * (p[1] - s)]);
  f(1, [m[0] + (2 / 3) * (p[0] - m[0]), m[1] + (2 / 3) * (p[1] - m[1])]);
  h(1, [m[0] + (2 / 3) * (g[0] - m[0]), m[1] + (2 / 3) * (g[1] - m[1])]);
  f(2, [c - (2 / 3) * (g[0] - c), u - (2 / 3) * (g[1] - u)]);
  return l;
}
function th(e: number[]): Pt[] {
  const t = (NB + 1) >> 1, n: Pt[] = [];
  const ho = (i: number) => [e[i * 6], e[i * 6 + 1]];
  // control point = endpoint + stored delta (jb writes deltas at +2/+4)
  const pc = (i: number, r: number) => [e[i * 6] + e[i * 6 + r], e[i * 6 + 1] + e[i * 6 + r + 1]];
  const rr = (o: number[], s: number[], i: number[], a: number[], c: number) => {
    for (let u = c; u < t; u++) {
      const l = u / (t - 1), d = 1 - l;
      const f = d * d * d, h = 3 * d * d * l, p = 3 * d * l * l, g = l * l * l;
      n.push([f * o[0] + h * s[0] + p * i[0] + g * a[0], f * o[1] + h * s[1] + p * i[1] + g * a[1]]);
    }
  };
  rr(ho(0), pc(0, 4), pc(1, 2), ho(1), 0);
  rr(ho(1), pc(1, 4), pc(2, 2), ho(2), 1);
  return n;
}
const _rE = (off: number[], tilt: number, wid: number, bez: Bez, oval: number[]): EyeSpec => {
  const s = jb(bez);
  return { off, tilt, wid, lidY: 1, oval, ovalMix: 0, pts: th(s), path: s, fillRing: null };
};
const scE = (e: number, t: number, n: number, r: number[], o: number): EyeSpec => {
  const s = Math.max(0, (t - e) / 2), i = (n * Math.PI) / 180;
  const a = Math.sin(i) * s, c = Math.cos(i) * s;
  return _rE(r, o, e / 2, { p0: [-a, -c], p1: [0, 0], p2: [a, c] }, [0, 0]);
};
const znE = (e: number, t: number, n: number, r: number) => scE(e, t, n, [r, 0], 0);
const qbE = (e: number, t: number, n: number) =>
  _rE([n, 0], 0, t, { p0: [-e, 0], p1: [0, 0], p2: [e, 0] }, [e, t]);
const dup = (e: EyeSpec) => [e, e];
// `vn` — Grok's face table
const FACE: Record<string, EyeSpec[]> = {
  neutral: dup(znE(MR, 0.57, 0, 0)),
  happy: dup(_rE([0.03, 0.03], 0, IL, { p0: [0.16, -0.04], p1: [0, 0.12], p2: [-0.16, -0.04], isArc: true }, [0, 0])),
  surprised: dup(znE(0.42, 0.86, 0, 0.03)),
  inspecting: [znE(0.54, 0.54, 0, 0.04), znE(0.36, 0.36, 0, 0.04)],
  sad: dup(znE(MR, 0.5, -28, -0.05)),
  sleepy: dup(_rE([0.01, 0], 0, MR / 2, { p0: [-0.11, 0.025], p1: [0, -0.05], p2: [0.11, 0.025] }, [0, 0])),
  squinted: dup(znE(MR, 0.5, 90, 0.01)),
  calm: dup(qbE(0.296, 0.247, 0.05)),
  confused: dup(_rE([-0.1, 0], 0, IL, { p0: [0.01, 0.16], p1: [-0.17, 0], p2: [0.01, -0.16] }, [0, 0])),
};
// `Db` name aliases
const FACE_ALIAS: Record<string, string> = {
  thinking: "sad", strange: "inspecting", angry: "neutral", inspect: "inspecting",
  squint: "squinted", idle: "neutral", smile: "happy", sleep: "sleepy",
};
const faceName = (v: string) => {
  const n = (FACE_ALIAS[v.trim().toLowerCase()] ?? v.trim().toLowerCase());
  return FACE[n] ? n : "neutral";
};
const MORPH_T = 0.28; // `xb` — face morph duration
const lerpEye = (a: EyeSpec, b: EyeSpec, k: number): EyeSpec => ({
  off: [a.off[0] + (b.off[0] - a.off[0]) * k, a.off[1] + (b.off[1] - a.off[1]) * k],
  tilt: a.tilt + (b.tilt - a.tilt) * k,
  wid: a.wid + (b.wid - a.wid) * k,
  lidY: a.lidY + (b.lidY - a.lidY) * k,
  oval: a.oval.map((v, i) => v + ((b.oval[i] ?? 0) - v) * k),
  ovalMix: 0,
  pts: a.pts.map((p, i) => [p[0] + ((b.pts[i]?.[0] ?? p[0]) - p[0]) * k, p[1] + ((b.pts[i]?.[1] ?? p[1]) - p[1]) * k]),
  path: null,
  fillRing: null,
});

// ——— live render ———
// app shape → Grok body name (gen-marks NAMES)
const BODY: Record<string, string> = {
  blob: "sphere", cloud: "cloud", square: "square", sparkle: "sparkle",
  clover: "clover", heart: "heartChubby", flower: "starFlower",
  teardrop: "teardrop", tablet: "tablet", wedge: "wedge", house: "house",
  star: "star6", hex: "hex",
};
// the eye spec gen-marks bakes with; lidY is the open fraction (lids→blink)
const eye = (lidY: number) => ({ oval: [0.13, 0.285], off: [0, 0], lidY, tilt: 0, wid: 0, pts: [], ovalMix: 1 });
// path "d" string → point loops (gen-marks `loops`; arcs flatten through $h's
// own sampling so M/L coords suffice)
const loops = (d: string): number[][][] =>
  d.split(/Z|(?=M)/)
    .map((s) => s.replace(/[ML]/g, " ").trim().split(/[\s,]+/).filter(Boolean).map(Number))
    .filter((a) => a.length >= 6)
    .map((a) => {
      const p: number[][] = [];
      for (let i = 0; i + 1 < a.length; i += 2) p.push([a[i], a[i + 1]]);
      return p;
    });

export type ClipFrame = { outline: number[][][]; eyes: number[][][] };
// Project `shape` at the sampled pose, in an `n`-unit sprite box.
// Sphere is jT()'s special case (not in $h's body registry): jT applies
// zoom/squash/offset internally, so its output is already in final coords.
// The other solids go through $h (rotation only), and position/squash/zoom
// apply as the same 2D transform jT computes:
//   x' = n/2 + (ox·z·n/2) + v0·z·sx·n/2      v = unit coords, y-up
//   y' = n/2 − (sa·(1−sy)+oy)·z·n/2 − v1·z·sy·n/2
const D = Math.PI / 180;
export function clipFrame(shape: string, p: ClipPose, n: number): ClipFrame {
  const body = BODY[shape] ?? "sphere";
  const lidY = Math.max(0.02, 1 - p.lid);
  // expression-morphed eyes when the clip carries them; the lids/blink
  // track still squashes them via lidY
  const eyes = p.eyes
    ? p.eyes.map((e) => ({ ...e, lidY: e.lidY * lidY }))
    : [eye(lidY), eye(lidY)];
  if (body === "sphere") {
    // jT renders at display size; n/1.3913 display units match $h's sprite
    // scale, then everything shifts into the n box (gen-marks' mark()).
    const m = n / 1.3913, off = n / 2 - m / 2;
    const r = jT(
      {
        zoom: p.zoom, squash: [p.sx, p.sy], offset: [p.ox, p.oy],
        squashAnchor: p.sa,
        quat: Ib(p.pitch * D, p.yaw * D, p.roll * D),
        eyes: eyes as any, glow: null,
      },
      { cutout: false },
      m,
    );
    // jT's body is the sphere's arc path — the same ellipse params it used:
    const o = (p.zoom * m) / 2;
    const ax = Math.abs(p.sx), ay = Math.abs(p.sy);
    const cx = m / 2 + o * p.ox + off;
    const cy = m / 2 - (p.sa * (1 - ay) + p.oy) * o + off;
    const outline = [Array.from({ length: 96 }, (_, i) => {
      const a = (i / 96) * Math.PI * 2;
      return [cx + o * ax * Math.cos(a), cy + o * ay * Math.sin(a)];
    })];
    return {
      outline,
      eyes: loops(r.eyes).map((poly) => poly.map(([x, y]) => [x + off, y + off])),
    };
  }
  const r = $h(body, { pitch: p.pitch, yaw: p.yaw, roll: p.roll }, n, eyes as any);
  const o = (p.zoom * n) / 2;
  const ax = Math.abs(p.sx), ay = Math.abs(p.sy);
  const cx = n / 2 + p.ox * o;
  const cy = n / 2 - (p.sa * (1 - ay) + p.oy) * o;
  const tf = ([px, py]: number[]) => {
    const v0 = (px - n / 2) / (n / 2), v1 = (n / 2 - py) / (n / 2);
    return [cx + v0 * o * ax, cy - v1 * o * ay];
  };
  return {
    outline: loops(r.body.join(" ")).map((poly) => poly.map(tf)),
    eyes: loops(r.eyes.join(" ")).map((poly) => poly.map(tf)),
  };
}
