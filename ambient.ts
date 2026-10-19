// Grok's ambient effects — the `vx` system ported from Sand's bundle
// (index.eager-platform). An effect is not an overlay: the mark itself
// shrinks/turns/lifts (the `core` transform) while glyph `parts` (discs,
// rings, shapes, strokes in a 192-unit space centered at x=96) draw inside
// it in the mark's own fill — "thinking" compresses the orb into three
// bobbing dots where the face was.
//
// Ix() is the state controller (springs + effect-swap crossfade + spin);
// DE() composes the frame (core transform, mark zoom, glyph parts);
// FE()/TE..NE are the 13 effect generators with their real constants.

const Sx = Math.PI, Mx = 0.1, Tx = 2654435769;
const Ex = new Set(["progress", "gather"]);
const Px: Record<string, number> = { progress: 2.5, gather: 2, spawning: 2 };
const Ax = 1.5;
const VX: Record<string, string> = {
  thinking: "dots", orbit: "orbit", radar: "radar", progress: "progress",
  spawning: "gather", dictating: "wave", sending: "send", receiving: "receive",
  uploading: "dock", bouncing: "ball", writing: "pencil", alerting: "bang",
  "powering-down": "standby",
};
const le = (e: number, t: number, n: number) => Math.min(n, Math.max(t, e));
const ts = (e: number) => (e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2);
const Ye = (e: number) => 1 - Math.pow(1 - e, 3);
const Is = (e: number) => 1 + 2.70158 * Math.pow(e - 1, 3) + 1.70158 * Math.pow(e - 1, 2);
const wb = (e: number) => e * e * (3 - 2 * e);
const Bt = (e: number) => ((e % 1) + 1) % 1;
const ic = (e: number) => {
  let t = e | 0;
  return () => {
    t = (t + 1831565813) | 0;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
};
const ac = (e: string) => Px[e] ?? 2.5;

// ——— spring primitives (Ao/Io/Qf) ———
type Spring = { x: number; v: number; t: number };
const Ao = (e: number): Spring => ({ x: e, v: 0, t: e });
const Io = (e: Spring, t: number, n: number, r: number) => {
  e.v += (-2 * n * t * e.v - t * t * (e.x - e.t)) * r;
  e.x += e.v * r;
  if (!Number.isFinite(e.x) || !Number.isFinite(e.v)) { e.x = e.t; e.v = 0; }
};
const kb = 1 / 120;
const Qf = (e: number) => Math.max(1, Math.ceil(e / kb));

export type AmbientSnapshot = {
  amount: number; spin: number; kind: string | null; outgoing: string | null;
  swap: number; clock: { stateTime: number; shotTime: number };
  outgoingClock: { stateTime: number; shotTime: number };
};

// Ix() — the ambient controller. `state` is a yl/vx key (thinking, orbit…);
// set() resolves it through vx. progress/spawning re-fire on their cycle.
export function ambientCtl(seed = Tx) {
  const n = ic(seed), r = Ao(0), o = Ao(1), s = Ao(0);
  let target: string | null = null, kind: string | null = null, outgoing: string | null = null;
  let cycle = false, g = 0, m = 0, y = 0, w = 0, S = 0, d = 0, f = 0, h = 1, active = false, E = 0;
  const set = (v: string | null) => {
    // accepts a yl state key (thinking…) or an already-resolved kind; anything
    // else ("none", unknown) disengages — an unknown kind would NaN the frame
    const k = v ? (VX[v] ?? v) : null;
    target = k != null && Pi[k] != null ? k : null;
  };
  const b = (isReduced: boolean) => {
    const v = target, Ey = y;
    if (kind !== target && target != null) { y = g; cycle = false; }
    let A = v != null;
    if (kind != null && Ex.has(kind)) {
      if (!cycle && g - y > ac(kind)) { cycle = true; d = g; }
      else if (cycle && g - d > Ax) { cycle = false; y = g; }
      A = !cycle;
    }
    r.t = A ? 1 : 0;
    if (v !== kind) {
      if (kind != null && r.x > 0.02) { outgoing = kind; w = m; S = Ey; o.x = isReduced ? 1 : 0; }
      else { outgoing = null; o.x = 1; }
      o.v = 0; o.t = 1; kind = v; m = g;
    }
    if (v == null && r.x < 0.004) { kind = null; outgoing = null; }
    if (o.x > 0.996) outgoing = null;
    if (A !== active) { if (A && !isReduced) h = n() < 0.5 ? 1 : -1; if (!isReduced) { f += Sx * h; s.t = f; } active = A; }
  };
  const advance = (dt: number, isReduced = false) => {
    const E2 = dt > 0 ? Math.min(dt, Mx) : 0;
    g += E2;
    b(isReduced);
    const A = Qf(E2), F = E2 / A;
    for (let N = 0; N < A; N++) { Io(r, 14, 1, F); Io(o, 11, 1, F); Io(s, 14, 1, F); }
    if (isReduced) { o.x = 1; s.x = s.t; r.x = r.t; }
  };
  const snapshot = (): AmbientSnapshot => ({
    amount: le(r.x, 0, 1), spin: s.x, kind, outgoing, swap: le(o.x, 0, 1),
    clock: { stateTime: g - m, shotTime: g - y },
    outgoingClock: { stateTime: g - w, shotTime: g - S },
  });
  return { set, advance, snapshot, get kind() { return kind; } };
}

// ——— glyph model (Ht/$s/Vh/gE) ———
export type Part =
  | { type: "disc"; cx: number; cy: number; r: number; opacity: number }
  | { type: "ring"; cx: number; cy: number; r: number; width: number; opacity: number; arc?: { fraction: number; startDeg: number } }
  | { type: "shape"; d: Pt2[][]; transform?: string; opacity: number }
  | { type: "stroke"; d: Pt2[]; width: number; opacity: number };
type Pt2 = [number, number];

const x = 96;
const Ht = (key: string, cx: number, cy: number, r: number, opacity: number): Part => ({ type: "disc", cx, cy, r, opacity } as any);
const Rs = (key: string, r: number, width: number, opacity: number, arc?: { fraction: number; startDeg: number }): Part => ({ type: "ring", cx: x, cy: x, r, width, opacity, arc } as any);
const Vh = (key: string, d: Pt2[][], transform: string, opacity: number): Part => ({ type: "shape", d, transform, opacity } as any);
const gE = (key: string, d: Pt2[], width: number, opacity: number): Part => ({ type: "stroke", d, width, opacity } as any);

const yE = { lift: 0, pop: 1, tone: 1 };
const oE = 1400, rE = 9, eE = 0.84, tE = 0.22, nE = 1.02, JT = 22, vd = 62;
const Gh = (e: { stateTime: number }, t: number, n: number, r: boolean) => {
  const o = Bt((e.stateTime * 1e3) / oE + 0.119);
  const s = Math.abs(o - t / 3);
  const i = Math.min(s, 1 - s);
  const a = r ? 1 : Math.exp(-(i * i) / (2 * 0.15 * 0.15));
  const c = r ? 0 : 1;
  return { lift: a * rE * n * c, pop: 1 + c * (eE + tE * a - 1), tone: 1 - c * 0.5 * (1 - a) };
};
const kE = (e: number) => 0.42 + 0.29 * Math.sin(e * 0.0021) * Math.sin(e * 0.0034) + 0.29 * Math.sin(e * 0.0013 + 1.7);
const wE = (e: number, t: number) => kE(e) * (0.55 + 0.45 * Math.sin(e * 0.012 - Math.abs(t) * 1.05));
const bE = (e: number) => -Math.PI * 1.25 + ic(e)() * Math.PI * 1.5;
const xE = (e: number) => {
  const r = 1082.2060353798126, o = 40, s = Math.sqrt((2 * o) / r);
  if (e < s) return 0.5 * r * e * e;
  const i = Bt((e - s) / 0.62);
  return o - 208 * i * (1 - i);
};
const Bh = 1500, xa = 1700, ps = 2500, Pr = 0.68, Oo = ps * Pr, sE = 2.4, iE = 120;
const wc = (e: number) => {
  const t = Bt(e / ps);
  if (t < Pr) {
    const r = t / Pr, o = r * r * (3 - 2 * r), s = le(r / 0.08, 0, 1) * le((1 - r) / 0.08, 0, 1);
    return { x: -54 + 118 * o, y: 26, wig: Math.sin(r * 24) * 3.2 * s, rot: 17 + Math.sin(e * 6e-4) * 1 };
  }
  const n = ts((t - Pr) / (1 - Pr));
  return { x: 64 - 118 * n, y: 26 - 20 * Math.sin(n * Math.PI), wig: 0, rot: 17 - 2 * Math.sin(n * Math.PI) + Math.sin(e * 6e-4) * 1 };
};
const Wh = (e: number): Pt2 => { const t = wc(e); return [x + t.x, x + t.y + t.wig + 19]; };
const vE: { at: number; point: Pt2 }[] = (() => {
  const e: { at: number; point: Pt2 }[] = [];
  for (let t = 0; t < Oo; t++) {
    const n = Wh(t), r = e[e.length - 1];
    if (r === undefined || Math.hypot(n[0] - r.point[0], n[1] - r.point[1]) > sE) e.push({ at: t, point: n });
  }
  return e;
})();
const SE = (e: number): Pt2[] => {
  const t = Bt(e / ps) * ps, n = Math.min(t, Oo);
  const r = vE.filter((a) => a.at <= n), o = r.length > 0 ? r[r.length - 1].at : n;
  const s = n > o ? [Wh(n)] : [];
  const i = [...r.map((a) => a.point), ...s].slice(-64);
  return t < Oo ? i : i.slice(Math.floor(((t - Oo) / 1e3) * iE));
};
// rounded-bar path builders fE/hE (pencil shaft, bang bar) → point loops
const capsuleV = (wd: number, ht: number): Pt2[] => {
  const n = wd / 2, r0 = x - ht / 2 + n, r1 = x + ht / 2 - n;
  const pts: Pt2[] = [];
  for (let i = 0; i <= 10; i++) { const a = Math.PI - (i / 10) * Math.PI; pts.push([x + n * Math.cos(a), r0 - n * Math.sin(a)]); }
  for (let i = 0; i <= 10; i++) { const a = -(i / 10) * Math.PI; pts.push([x + n * Math.cos(a), r1 - n * Math.sin(a)]); }
  return pts;
};
const bangBar = (wd: number, rd: number, ht: number): Pt2[] => {
  const r = wd / 2, s = x - ht / 2, i = x + ht / 2;
  const pts: Pt2[] = [];
  for (let k = 0; k <= 8; k++) { const a = Math.PI - (k / 8) * Math.PI; pts.push([x + r * Math.cos(a), s + r - r * Math.sin(a)]); }
  pts.push([x + rd, i - rd]);
  for (let k = 0; k <= 8; k++) { const a = -(k / 8) * Math.PI; pts.push([x + rd * Math.cos(a), i - rd - rd * Math.sin(a)]); }
  pts.push([x - r, s + r]);
  return pts;
};
const pE = capsuleV(30, 88);   // pencil shaft
const mE = bangBar(30, 17, 96); // "!" bar
const uE = [-2, -1, 1, 2];
const aE = ac("progress") * 1e3, cE = ac("spawning") * 1e3;

// ——— the 13 effect generators (TE..NE → parts in 192-space) ———
type Clock = { stateTime: number; shotTime: number };
const TE = (e: number, t: Clock, n: boolean): Part[] => {
  const r = [x - vd, x + vd], o: Part[] = [];
  for (let s = 0; s < 2; s++) {
    const i = le((e - s * 0.12) / (1 - s * 0.12), 0, 1);
    if (i <= 0.004) continue;
    const a = Ye(i), c = Is(i), u = Gh(t, s === 0 ? 0 : 2, e, n);
    o.push(Ht(`dots.${s}`, x + (r[s] - x) * c, x - u.lift, JT * a * u.pop * nE, a * u.tone));
  }
  return o;
};
const EE = (e: number, t: Clock): Part[] => {
  const n = Ye(e), r = 52 * Is(e), o = 12, s = t.stateTime * 1e3 * 0.0017;
  return Array.from({ length: 5 }, (_, a) => {
    const c = s + (a * Math.PI * 2) / 5, u = Math.cos(c), l = 0.5 + 0.5 * le(u, 0, 1);
    return Ht(`orbit.${a}`, x + r * Math.sin(c), x - r * 0.42 * Math.cos(c), Math.max(o * l * n, 0.3), le((u + 0.4) / 0.6, 0.18, 1) * n);
  });
};
const PE = (e: number, t: Clock, n: number): Part[] => {
  const r = Ye(e), o = 1300, s = 104;
  return Array.from({ length: 3 }, (_, a) => {
    const c = Bt((t.stateTime * 1e3) / o + a / 3);
    return Rs(`radar.${a}`, n + (s - n) * c, 3.4 * (1 - c * 0.55), r * (1 - c) * 0.9);
  });
};
const AE = (e: number, t: Clock): Part[] => {
  const n = Ye(e), r = 62 * Is(e), o = le((t.shotTime * 1e3) / aE, 0, 1), s = le(o / 0.85, 0, 1);
  const i = Rs("progress.track", r, 5, n * 0.16);
  return s <= 0 ? [i] : [i, { type: "ring", key: "progress.arc", cx: x, cy: x, r, width: 5, opacity: n, arc: { fraction: s, startDeg: -90 } } as any];
};
const IE = (e: number, t: Clock): Part[] => {
  const n = Ye(e), r: Part[] = [];
  for (let o = 0; o < 5; o++) {
    const s = le((t.shotTime * 1e3 / cE - o * 0.09) / 0.62, 0, 1);
    if (s >= 1) continue;
    const i = 1 - Math.pow(1 - s, 3), a = o * 2.4 + s * 2.2, c = 96 * (1 - i);
    r.push(Ht(`gather.${o}`, x + c * Math.cos(a), x + c * Math.sin(a) * 0.8, 9 * (0.5 + 0.5 * i) * n, n * le(s * 5, 0, 1) * (1 - i * 0.25)));
  }
  return r;
};
const _E = (e: number, t: Clock): Part[] => {
  const n = t.stateTime * 1e3, r = 44, o: Part[] = [];
  for (const s of uE) {
    const i = le((e - Math.abs(s) * 0.1) / (1 - Math.abs(s) * 0.1), 0, 1);
    if (i <= 0.004) continue;
    const a = Is(i), c = wE(n, s), u = (7 + 9 * le(c, 0.08, 1)) * Ye(i), l = 6 * le(c, 0, 1) * i;
    o.push(Ht(`wave.${s}`, x + s * r * a, x - l, u, i));
  }
  return o;
};
const CE = (e: number, t: Clock): Part[] => {
  const n = Ye(e), r = Bt((t.stateTime * 1e3) / Bh), o = le((r - 0.18) / 0.55, 0, 1), s = o * o * (0.4 + 0.6 * o), i = 0.74, a = -0.62, c: Part[] = [];
  if (o > 0 && o < 1) { const f = 108 * s; c.push(Ht("send.packet", x + i * f, x + a * f, 10 * (1 - s * 0.55) * n, n * (1 - s * s))); }
  const u = le((r - 0.26) / 0.55, 0, 1), l = u * u * (0.4 + 0.6 * u);
  if (o > 0 && u > 0 && u < 1) { const f = 108 * l; c.push(Ht("send.streak", x + i * f, x + a * f, 5 * (1 - l * 0.6) * n, n * 0.3 * (1 - l))); }
  const d = le((r - 0.18) / 0.3, 0, 1);
  if (d > 0 && d < 1) c.push(Rs("send.launch", 20 + 34 * Ye(d), 2.8 * (1 - d), n * (1 - d) * 0.8));
  return c;
};
const RE = (e: number, t: Clock): Part[] => {
  const n = Ye(e), r = t.stateTime * 1e3, o = bE(Math.floor(r / xa)), s = Bt(r / xa), i = le(s / 0.6, 0, 1), a = 1 - Math.pow(1 - i, 3);
  const c = Math.cos(o), u = Math.sin(o), l = 108 * (1 - a), d: Part[] = [];
  if (i < 1) { const h = 18 * Math.sin(i * Math.PI) * (1 - a * 0.7); d.push(Ht("receive.packet", x + c * l - u * h, x + u * l + c * h, 3.5 + 6.5 * a, n * le(i * 3.5, 0, 1) * (0.3 + 0.7 * a))); }
  const f = le((s - 0.58) / 0.32, 0, 1);
  if (f > 0 && f < 1) d.push(Rs("receive.absorb", 20 + 26 * Ye(f), 2.8 * (1 - f), n * (1 - f) * 0.8));
  return d;
};
const $E = (e: number, t: Clock): Part[] => {
  const n = Ye(e), r = t.stateTime * 1e3, o = 42, s = 1.1, i: Part[] = [];
  for (let a = 0; a < 2; a++) {
    const c = le((t.stateTime - (0.2 + a * 1.3)) / 0.9, 0, 1);
    if (c <= 0) continue;
    const u = 1 - Math.pow(1 - c, 3), l = r * 0.001 * s + a * Math.PI, d = x + o * Math.sin(l), f = x + o * 0.5 * Math.cos(l) + Math.sin(r * 0.003 + a) * 2;
    const h = x - 120 + a * 30, p = x + 95;
    i.push(Ht(`dock.${a}`, h + (d - h) * u, p + (f - p) * u, (7 + 3 * u) * n, n * le(c * 4, 0, 1)));
  }
  return i;
};
const OE = (e: number, t: Clock): Part[] => {
  const n = t.stateTime * 1e3, r = wc(n), o = ((r.rot - 90) * Math.PI) / 180, s = 68;
  const i = Math.cos(o) * s, a = Math.sin(o) * s, c = x + (r.x + i) * e, u = x + (r.y + r.wig * 0.15 + a) * e;
  const l: Part[] = [];
  // shaft transform applied at draw time via transform string
  l.push(Vh("pencil.shaft", [pE], `translate(${c.toFixed(1)} ${u.toFixed(1)}) rotate(${(r.rot * e).toFixed(1)}) scale(${Ye(e).toFixed(3)}) translate(${-x} ${-x})`, le(e * 1.6 - 0.3, 0, 1)));
  const d = SE(n);
  if (d.length >= 2) l.push(gE("pencil.ink", d, 6, le(e * 1.2, 0, 1)));
  return l;
};
const LE = (e: number, t: Clock): Part[] => {
  const n = t.stateTime, r = Ye(le(e * 1.1, 0, 1)), o = Math.exp(-(n % 2.2) * 5.5), s = Math.sin(n * 42) * 2.2 * o;
  return [Vh("bang.bar", [mE], `translate(0 ${(-26 - (1 - r) * 70).toFixed(1)}) rotate(${s.toFixed(2)} ${x} ${(x - 74).toFixed(1)}) translate(${x} ${x}) scale(${le(e * 1.2, 0, 1).toFixed(3)}) translate(${-x} ${-x})`, le(e * 1.5 - 0.2, 0, 1))];
};
const NE = (e: number, _t: Clock): Part[] => {
  const n = 0.5 + 0.5 * Math.sin(_t.stateTime * 1e3 * 0.0016);
  return [Ht("standby.halo", x, x, 26 + 7 * n, Ye(e) * (0.06 + 0.1 * n))];
};
const FE = (kind: string, amount: number, clk: Clock, f: number, reduced: boolean): Part[] => {
  switch (kind) {
    case "dots": return TE(amount, clk, reduced);
    case "orbit": return EE(amount, clk);
    case "radar": return PE(amount, clk, f);
    case "progress": return AE(amount, clk);
    case "gather": return IE(amount, clk);
    case "wave": return _E(amount, clk);
    case "send": return CE(amount, clk);
    case "receive": return RE(amount, clk);
    case "dock": return $E(amount, clk);
    case "ball": return [];
    case "pencil": return OE(amount, clk);
    case "bang": return LE(amount, clk);
    case "standby": return NE(amount, clk);
    default: return [];
  }
};

const Pi: Record<string, number> = { dots: 22, orbit: 19, radar: 19, progress: 19, gather: 19, wave: 16, send: 20, receive: 20, dock: 20, ball: 18, pencil: 17, bang: 13, standby: 13 };
const xd: Record<string, number> = { dots: 1.5, orbit: 1.14, radar: 1.14, progress: 1.32, gather: 1.15, wave: 1.42, send: 1.12, receive: 1.12, dock: 1.3, ball: 1.22, pencil: 1.18, bang: 1.28, standby: 1.75 };
const ZT = 0.62;

export type AmbientFrame = {
  core: { scale: number; dx: number; dy: number; rotation: number; opacity: number; round: number };
  zoom: number;
  parts: Part[];
  isFaceVisible: boolean;
};
// DE() — the ambient composer. t = display size (compact marks zoom less).
export function ambientFrame(e: AmbientSnapshot, t: number): AmbientFrame {
  const { kind: n } = e;
  const o = le(e.amount, 0, 1), s = le(e.swap, 0, 1), i = s < 0.999 ? e.outgoing : null;
  const a = (j: string | null) => (j === n ? o * s : j === i ? o * (1 - s) : 0);
  const c = (j: string | null) => (j === n ? e.clock : e.outgoingClock);
  const u = le(o / ZT, 0, 1);
  const f = n ? Pi[n] * s + (i ? Pi[i] : Pi[n]) * (1 - s) : 19;
  const h = a("dots"), p = n === "dots" || i === "dots";
  const g = p ? Gh(c("dots"), 1, o, false) : yE;
  let m = p ? 1 + (g.pop - 1) * (h / Math.max(o, 0.001)) : 1;
  const y = a("receive");
  if (y > 0.004) { const j = Bt((c("receive").stateTime * 1e3) / xa), J = le((j - 0.58) / 0.34, 0, 1); m *= 1 + 0.11 * Math.sin(J * Math.PI) * y; }
  const w = a("send");
  if (w > 0.004) { const j = Bt((c("send").stateTime * 1e3) / Bh), J = j < 0.18 ? -0.06 * Math.sin((j / 0.18) * Math.PI) : 0, fe = j >= 0.18 && j < 0.42 ? 0.05 * Math.sin(((j - 0.18) / 0.24) * Math.PI) : 0; m *= 1 + (J + fe) * w; }
  const S = a("bang");
  if (S > 0.004) m *= 1 + 0.04 * Math.exp(-(c("bang").stateTime % 2.2) * 5.5) * S;
  let b = 0, v = 0, E = 0;
  const A = a("pencil");
  if (A > 0.004) { const j = wc(c("pencil").stateTime * 1e3); b += j.x * A; v += (j.y + j.wig * 0.5) * A; E += j.rot * A; }
  if (S > 0.004) v += 58 * S;
  const F = a("ball");
  if (F > 0.004) v += xE(c("ball").stateTime) * F;
  const N = (f / x) * m, R = a("standby"), B = R > 0 ? (0.28 + 0.2 * Math.sin(c("standby").stateTime * 1e3 * 0.0016)) * R : 0;
  const P = {
    scale: 1 - o + N * o, dx: b * o, dy: -g.lift * h + v * o, rotation: E * o,
    opacity: (1 - (1 - g.tone) * h) * (1 - B), round: ts(u),
  };
  const I = 1 - wb(le((t - 44) / 90, 0, 1));
  const _ = n == null ? 1 : xd[n], O = i ? xd[i] : _;
  const H = 1 + (_ * s + O * (1 - s) - 1) * o * I;
  const L: Part[] = [];
  for (const j of [i, n]) {
    if (j == null) continue;
    const J = a(j);
    if (J > 0.004) L.push(...FE(j, J, c(j), f, false));
  }
  return { core: P, zoom: H, parts: L.filter((j) => j.opacity > 0), isFaceVisible: o < 0.5 };
}
