import { Canvas } from "nsh/canvas";
import { Animated, createNativeValue, Easing } from "nsh/animated";
import { Image } from "nsh/image";
import { cleanup, effect, signal, Text, View } from "nsh";
import { appearance } from "./theme";
import { mediaUrl } from "./filetile";
import { MARKS, MARK_EYE_N, MARK_FPS, MARK_FRAMES, MARK_GAZE_N, MARK_HI, MARK_LO, MARK_POINTS, MARK_SPRITE } from "./marks.data";
import { clipFrame, cookClip, sampleClip } from "./clips";
import { ambientCtl, ambientFrame, type AmbientFrame, type Part } from "./ambient";

// ————————————————————————————————————————————————————————————————
// Grok Bot avatar, ported from Sand's bundle (index.eager-platform).
// ————————————————————————————————————————————————————————————————

const TAU = Math.PI * 2;

// Picker lists as extracted: `ol` (13 shapes) and `Wf` minus black (10 colors).
export const BOT_SHAPES = [
  "blob", "cloud", "square", "sparkle", "clover", "heart", "flower",
  "teardrop", "tablet", "wedge", "house", "star", "hex",
];
// The swatches as Grok Bot renders them (computed sRGB over CDP; its
// bundle's values are display-P3 sources).
export const BOT_COLORS = [
  "#FFFFFF", // white (Grok's first swatch)
  "#A16B39", // brown
  "#FC2C3E", // red
  "#F9670E", // orange
  "#F69412", // yellow
  "#14C370", // green
  "#13B8A3", // cyan
  "#1884FC", // blue
  "#905AFB", // violet
  "#FB3499", // magenta
  "#777777", // gray
];
// bots saved with the bundle's values show (and select) as the rendered ones
const LEGACY_COLORS: Record<string, string> = {
  "#936439": "#A16B39", "#FF263C": "#FC2C3E", "#FF6700": "#F9670E", "#FF9800": "#F69412",
  "#00C972": "#14C370", "#00BCA6": "#13B8A3", "#1084FE": "#1884FC", "#9159FE": "#905AFB",
  "#FF309B": "#FB3499",
};
export const normColor = (c: string) => LEGACY_COLORS[c?.toUpperCase()] ?? c?.toUpperCase();
// The first swatch is Grok's adaptive ink ("Black character color"): white on
// dark, black (rgb 0 0 0, measured) on light.
export const inkOf = (c: string) => {
  const n = normColor(c);
  return n === "#FFFFFF" && appearance() === "light" ? "#000000" : n;
};

// ————— Grok's avatar, rendered the way Grok renders it —————
// Each shape is a real solid (extrusion, loft, revolve, pill or sphere; see
// tools/grok-mark). Grok projects it at the current pose and fills the
// silhouette with ONE flat color, the eyes cut out as holes, so depth reads
// from the outline's thickness as it turns, not from shading. The
// silhouettes are baked from Grok's own engine (marks.data.ts); a shared
// ~30fps clock blends the nearest frames and eases toward the camera pose
// on hover.
const clock = signal(0);
let clockOn = false;
const startClock = () => {
  if (clockOn) return;
  clockOn = true;
  let last = 0;
  const tick = (ms: number) => {
    if (ms - last >= 33) {
      last = ms;
      clock.set(ms / 1000);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const decoded = new Map<string, { bytes: Uint8Array; poly: Uint8Array; gBytes: Uint8Array; gPoly: Uint8Array }>();
const markOf = (shape: string) => {
  const key = MARKS[shape] ? shape : "blob";
  let m = decoded.get(key);
  if (!m) {
    const dec = (s: string) => {
      const bin = atob(s);
      const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      return b;
    };
    m = { bytes: dec(MARKS[key].o), poly: dec(MARKS[key].p), gBytes: dec(MARKS[key].g.o), gPoly: dec(MARKS[key].g.p) };
    decoded.set(key, m);
  }
  return m;
};
const unq = (v: number) => MARK_LO + (v / 255) * (MARK_HI - MARK_LO);
// Idle_D's blinks (expression keys), each ~180ms
const BLINKS = [0.593, 2.069, 2.372, 4.247];
const lidAt = (t: number) => {
  for (const b of BLINKS) {
    const d = t - b;
    if (d >= 0 && d < 0.18) return d < 0.07 ? 1 - (d / 0.07) * 0.92 : 0.08 + ((d - 0.07) / 0.11) * 0.92;
  }
  return 1;
};
const hexRgb = (hx: string) => {
  const n = parseInt(hx.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const darken = (hx: string, k: number) => {
  if (!hx.startsWith("#")) return hx;
  const [r, g, b] = hexRgb(hx).map((v) => Math.round(v * (1 - k)));
  return `rgb(${r},${g},${b})`;
};

// ————— ambient `vx` effects —————
// One shared controller (the active state is app-wide); each blob advances
// it once per clock tick. Parts live in a 192-unit space centered at 96 —
// scaled to sprite space by On·n/2/x / sc0 = 144/320 = 0.45.
let amb: ReturnType<typeof ambientCtl> | null = null;
let ambT = -1;
const ambientTick = (kind: string | null, t: number, size: number): AmbientFrame | null => {
  if (!amb) amb = ambientCtl();
  amb.set(kind);
  if (ambT !== t) { amb.advance(t - ambT, false); ambT = t; }
  const snap = amb.snapshot();
  if (snap.amount <= 0.004 && snap.kind == null) return null;
  return ambientFrame(snap, size);
};
const PART_K = MARK_SPRITE / 1.3913 / 192; // 192-space → sprite units (box = 144/1.3913 ≈ 103.5)

// ————— head silhouette morph: loop → core.ring —————
// Grok resamples the silhouette to bd points and lerps to the ambient ring
// (Hh's circle, or the pencil stadium). Same here: resample the outline by
// arc length starting at its rightmost vertex (Hh's phase), same winding,
// then lerp by `round`.
const resampleLoop = (pts: number[][], n: number): number[][] => {
  const m = pts.length;
  const seg: number[] = [];
  let per = 0;
  for (let i = 0; i < m; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % m];
    const l = Math.hypot(bx - ax, by - ay);
    seg.push(l); per += l;
  }
  if (per <= 0) return pts.slice(0, n);
  // shoelace sign tells the winding — ring goes CW on screen (+y down)
  let shoelace = 0, start = 0, best = -1e9;
  for (let i = 0; i < m; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % m];
    shoelace += ax * by - bx * ay;
    if (pts[i][0] > best) { best = pts[i][0]; start = i; }
  }
  const out: number[][] = [];
  let i0 = start, acc = 0;
  for (let j = 0; j < n; j++) {
    const target = (j / n) * per;
    while (acc + seg[i0] < target - 1e-9) { acc += seg[i0]; i0 = (i0 + 1) % m; }
    const f = seg[i0] > 0 ? Math.min(1, (target - acc) / seg[i0]) : 0;
    const [ax, ay] = pts[i0], [bx, by] = pts[(i0 + 1) % m];
    out.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
  }
  if (shoelace >= 0) return out;
  // flip winding but keep index 0 at the rightmost sample so vertex pairing
  // with the ring stays aligned
  out.reverse();
  out.unshift(out.pop()!);
  return out;
};
const morphLoop = (pts: number[][], ring: number[][], k: number, round: number): number[][] => {
  const rs = resampleLoop(pts, ring.length);
  return rs.map(([px, py], i) => {
    const tx = MARK_SPRITE / 2 + (ring[i][0] - 96) * k;
    const ty = MARK_SPRITE / 2 + (ring[i][1] - 96) * k;
    return [px + (tx - px) * round, py + (ty - py) * round];
  });
};

const drawPart = (ctx: any, p: Part, cx: number, cy: number, k: number, alpha = 1) => {
  const X = (v: number) => cx + (v - 96) * k;
  const Y = (v: number) => cy + (v - 96) * k;
  ctx.globalAlpha = alpha * p.opacity;
  switch (p.type) {
    case "disc":
      ctx.beginPath();
      ctx.arc(X(p.cx), Y(p.cy), p.r * k, 0, TAU);
      ctx.fill();
      break;
    case "ring": {
      ctx.beginPath();
      if (p.arc) {
        const a0 = ((p.arc.startDeg ?? -90) * Math.PI) / 180;
        ctx.arc(X(p.cx), Y(p.cy), p.r * k, a0, a0 + p.arc.fraction * TAU);
      } else ctx.arc(X(p.cx), Y(p.cy), p.r * k, 0, TAU);
      ctx.lineWidth = p.width * k;
      ctx.stroke();
      break;
    }
    case "stroke":
      ctx.beginPath();
      ctx.moveTo(X(p.d[0][0]), Y(p.d[0][1]));
      for (let i = 1; i < p.d.length; i++) ctx.lineTo(X(p.d[i][0]), Y(p.d[i][1]));
      ctx.lineWidth = p.width * k;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      break;
    case "shape": {
      // Vh transforms are authored in 192-space — set a matching ctx frame
      // and replay translate/rotate/scale verbatim
      ctx.save();
      ctx.translate(cx - 96 * k, cy - 96 * k);
      ctx.scale(k, k);
      for (const m of p.transform?.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g) ?? []) {
        const a = m[2].trim().split(/[\s,]+/).map(Number);
        if (m[1] === "translate") ctx.translate(a[0], a[1]);
        else if (m[1] === "scale") ctx.scale(a[0], a[0]);
        else if (m[1] === "rotate") {
          if (a.length >= 3) { ctx.translate(a[1], a[2]); ctx.rotate((a[0] * Math.PI) / 180); ctx.translate(-a[1], -a[2]); }
          else ctx.rotate((a[0] * Math.PI) / 180);
        }
      }
      ctx.beginPath();
      for (const loop of p.d) {
        ctx.moveTo(loop[0][0], loop[0][1]);
        for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i][0], loop[i][1]);
        ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
      break;
    }
  }
};

// Pointer gaze: targets the eyes ease toward (normalized −1…1); the resting
// gaze looks up, like Grok's idle. On first engagement Grok snaps cx,cy to
// the pointer (hold===0 in setGaze) — `snap` carries that to the draw.
export function blobGaze() {
  const g = { x: 0, y: 0 };
  // bumped on change: wakes still blobs, which otherwise don't tick
  const v = signal(0);
  let held = false;
  const follow = (e: { x: number; y: number }, cx: number, cy: number, reach = 60) => {
    const first = !held;
    held = true;
    const x = Math.max(-1, Math.min(1, (e.x - cx) / reach));
    // Grok's IL/xx gaze space is y-up: the mark's baked fl() poses take
    // positive gy as "look up" — the raw pointer delta would read inverted.
    const y = Math.max(-1, Math.min(1, (cy - e.y) / reach));
    if (first) {
      g.x = x;
      g.y = y;
      r.snap = true;
      v.set(v() + 1);
      return;
    }
    if (x === g.x && y === g.y) return;
    g.x = x;
    g.y = y;
    v.set(v() + 1);
  };
  const rest = () => {
    // setGaze(null): only isHeld clears; the gaze keeps its last target
    held = false;
    v.set(v() + 1);
  };
  const r = { g, follow, rest, v, snap: false, get held() { return held; } };
  return r;
}
export type BlobGaze = ReturnType<typeof blobGaze>;
// Hover "Edit Avatar": eases the pose to camera-facing and the fill toward
// Grok's brightness(0.3).
export function blobEdit() {
  const s = { target: 0 };
  const v = signal(0);
  return {
    s,
    v,
    to: (t: number) => {
      s.target = t;
      v.set(v() + 1);
    },
  };
}
export type BlobEdit = ReturnType<typeof blobEdit>;

type BotBlobProps = {
  shape: string;
  color: string;
  size: number;
  breathe?: boolean;
  gaze?: BlobGaze;
  edit?: BlobEdit;
  /** sleeping: front pose, eyes closed to low slits */
  lid?: number;
  /** a still pose: "rest" (Idle_D's resting tilt, Grok's picker cells) or "front" */
  pose?: "rest" | "front";
  /** a Grok clip name or a cycling list (Working_A…Streaming_C…) — plays
   *  the real keyframes live through the ported engine; while it plays
   *  gaze is dead (S gate) */
  clip?: string | string[];
  /** a `vx` ambient kind (dots/orbit/radar/…) — morphs the mark itself:
   *  head shrinks/turns/lifts per the `core` transform, glyphs draw inside */
  fx?: string;
};

// `size` is the stage; the avatar's nominal box is 82% of it (Grok's sprite
// spans 1.3913× the box, so lobes and turned slabs overhang it).
export function BotBlob(props: BotBlobProps) {
  startClock();
  const phase = Math.random() * 6;
  let ek = 0, gx = 0, gy = 0, hk = 0, prev = -1;
  const draw = (ctx: any, { width, height }: { width: number; height: number }) => {
    // Only breathing blobs (and still ones easing their eyes/pose) follow the
    // 30fps clock; a settled still blob redraws only when its gaze/edit wakes
    // it. Every blob reading the clock redrew them all, forever.
    const still = (props.breathe === false || props.lid != null || props.pose != null) && !props.clip && !props.fx;
    props.gaze?.v();
    props.edit?.v();
    const gz = props.gaze?.g ?? { x: 0, y: 0 };
    const held = props.gaze?.held === true;
    const settled =
      Math.abs(gz.x - gx) < 0.002 && Math.abs(gz.y - gy) < 0.002 &&
      Math.abs((props.edit?.s.target ?? 0) - ek) < 0.002 && Math.abs(hk - (held ? 1 : 0)) < 0.002;
    const t = !still || !settled ? clock() : Date.now() / 1000;
    const dt = prev < 0 ? 0 : Math.min(0.1, Math.max(0, t - prev));
    prev = t;
    const ease = (rate: number) => 1 - Math.exp(-dt * rate);
    ek += ((props.edit?.s.target ?? 0) - ek) * (dt ? ease(14) : 1);
    // Grok's se(): on first engagement the gaze coords snap to the pointer —
    // setGaze snaps cx,cy only while hold===0, so re-entering mid-release
    // eases across instead of jumping — then cx,cy and hold ease
    // exponentially (bx() = 1−.86^(dt·60) ≡ rate 9) and the pose lerps
    // rest→fl() by hold. A clip playing ignores gaze entirely (S gate).
    if (props.gaze?.snap) {
      if (hk < 0.05) { gx = gz.x; gy = gz.y; }
      props.gaze.snap = false;
    }
    gx += (gz.x - gx) * (dt ? ease(9) : 1);
    gy += (gz.y - gy) * (dt ? ease(9) : 1);
    // the turn itself eases in over ~2s — deliberately slow to test the
    // engagement feel (cx,cy stay at Grok's rate: once held, tracking is
    // still responsive)
    hk += ((held ? 1 : 0) - hk) * (dt ? ease(2) : 1);
    hk = Math.min(1, Math.max(0, hk));
    // A playing clip owns the pose end to end (S gate): the real keyframes
    // drive rotation/position/squash/zoom and the lids track owns the eyes —
    // rendered live through the ported solid projector, not the bakes.
    const cl = props.clip || props.fx ? sampleClip(props.clip ?? "Idle_B", t) : null;
    if (cl) {
      // a `lid` prop is the face-morph stand-in (sleepy, squinted…): it
      // compounds the clip's own lids/blink track — open = (1−lid)·propLid
      if (props.lid != null) cl.lid = 1 - (1 - cl.lid) * props.lid;
      let af: AmbientFrame | null = null;
      try {
        af = ambientTick(props.fx ?? null, t, props.size * 0.82);
      } catch (e) {
        console.error("ambient", e);
      }
      const fr = clipFrame(props.shape, cl, MARK_SPRITE);
      const box0 = props.size * 0.82;
      const sc0 = (box0 * 1.3913) / MARK_SPRITE;
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(sc0, sc0);
      // the mark's morph zoom (compact marks zoom less — xd/DE)
      if (af && af.zoom !== 1) ctx.scale(af.zoom, af.zoom);
      // the head group: WE()'s transform — ambient core scale/offset/rotate
      // around the mark's center, its opacity dims the whole head
      ctx.save();
      if (af) {
        const c = af.core;
        ctx.translate(c.dx * PART_K, c.dy * PART_K);
        if (c.rotation) ctx.rotate((c.rotation * Math.PI) / 180);
        ctx.scale(c.scale, c.scale);
        ctx.globalAlpha = c.opacity;
        ctx.translate(-MARK_SPRITE / 2, -MARK_SPRITE / 2);
      } else {
        ctx.translate(-MARK_SPRITE / 2, -MARK_SPRITE / 2);
      }
      ctx.beginPath();
      const outline = af && af.core.round > 0.001
        ? fr.outline.map((pl) => morphLoop(pl, af.core.ring, PART_K, af.core.round))
        : fr.outline;
      for (const pl of outline) {
        ctx.moveTo(pl[0][0], pl[0][1]);
        for (let j = 1; j < pl.length; j++) ctx.lineTo(pl[j][0], pl[j][1]);
        ctx.closePath();
      }
      // engaged morphs hide the face — the glyph parts take its place
      if (!af || af.isFaceVisible) {
        for (const pl of fr.eyes) {
          ctx.moveTo(pl[0][0], pl[0][1]);
          for (let j = 1; j < pl.length; j++) ctx.lineTo(pl[j][0], pl[j][1]);
          ctx.closePath();
        }
      }
      ctx.fillStyle = darken(inkOf(props.color), 0.7 * ek);
      ctx.fill("evenodd");
      ctx.restore();
      // glyph parts draw in the mark's fill inside the same box
      if (af) {
        const ink = darken(inkOf(props.color), 0.7 * ek);
        ctx.fillStyle = ink;
        ctx.strokeStyle = ink;
        try {
          for (const p of af.parts) drawPart(ctx, p, 0, 0, PART_K);
        } catch (e) {
          console.error("drawPart", e);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return;
    }
    const { bytes, poly, gBytes, gPoly } = markOf(props.shape);
    const P = MARK_POINTS, F = MARK_FRAMES, front = F, EN = MARK_EYE_N, EB = EN * 4;
    // A still mark idles in Idle_D's resting tilt (frame 0: slanted, eyes
    // up — Grok's sidebar/panel marks), not squared to the camera; "front"
    // stays available for cells that want the flat pose.
    const stillFrame = props.pose === "front" ? front : 0;
    const ct = (t + phase) % 6;
    const ft = ct * MARK_FPS;
    const i0 = still ? stillFrame : Math.floor(ft) % F;
    const i1 = still ? stillFrame : (i0 + 1) % F;
    const f = still ? 0 : ft - Math.floor(ft);
    // The fl() gaze grid: bilinear-blend the four baked turn poses around
    // (gx,gy), then the pose lerps base→grid by hold — real turned
    // silhouettes and face-seated eyes, not a dragged overlay.
    const GN = MARK_GAZE_N, P2 = P * 2;
    const fx = Math.max(0, Math.min(GN - 1, ((gx + 1) / 2) * (GN - 1)));
    const fy = Math.max(0, Math.min(GN - 1, ((gy + 1) / 2) * (GN - 1)));
    const x0 = Math.floor(fx), x1 = Math.min(GN - 1, x0 + 1), ax = fx - x0;
    const y0 = Math.floor(fy), y1 = Math.min(GN - 1, y0 + 1), ay = fy - y0;
    const C = [y0 * GN + x0, y0 * GN + x1, y1 * GN + x0, y1 * GN + x1];
    const W = [(1 - ax) * (1 - ay), ax * (1 - ay), (1 - ax) * ay, ax * ay];
    const kh = still ? hk : 0;
    const pt = (fr: number, j: number) => unq(bytes[fr * P2 + j]);
    const at = (j: number) => {
      const a = pt(i0, j) + (pt(i1, j) - pt(i0, j)) * f;
      const p = a + (pt(front, j) - a) * ek;
      if (!kh) return p;
      const g = gBytes[C[0] * P2 + j] * W[0] + gBytes[C[1] * P2 + j] * W[1] + gBytes[C[2] * P2 + j] * W[2] + gBytes[C[3] * P2 + j] * W[3];
      return p + (unq(g) - p) * kh;
    };
    // eyes: real face-seated outlines (16 pts each, left first), not fitted
    // ellipses — Grok's curved slots with their true taper and turn
    const ey = (n: number) => {
      const a = unq(poly[i0 * EB + n]) + (unq(poly[i1 * EB + n]) - unq(poly[i0 * EB + n])) * f;
      const p = a + (unq(poly[front * EB + n]) - a) * ek;
      if (!kh) return p;
      const g = gPoly[C[0] * EB + n] * W[0] + gPoly[C[1] * EB + n] * W[1] + gPoly[C[2] * EB + n] * W[2] + gPoly[C[3] * EB + n] * W[3];
      return p + (unq(g) - p) * kh;
    };
    const box = props.size * 0.82;
    const scale = (box * 1.3913) / MARK_SPRITE;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    // fl()'s position term: the mark drifts toward the pointer, in units of
    // the mark's own size (non-spheres lean ~2.3× harder — Grok's .07/.055).
    const ms = MARK_SPRITE / 1.3913;
    ctx.translate((props.shape === "blob" ? 0.03 : 0.07) * gx * kh * ms, -(props.shape === "blob" ? 0.024 : 0.055) * gy * kh * ms);
    ctx.translate(-MARK_SPRITE / 2, -MARK_SPRITE / 2);
    ctx.beginPath();
    ctx.moveTo(at(0), at(1));
    for (let j = 1; j < P; j++) ctx.lineTo(at(j * 2), at(j * 2 + 1));
    ctx.closePath();
    // blink squashes each outline vertically around its own center
    const lid = props.lid ?? (still ? 1 : Math.max(lidAt(ct), hk));
    for (let e = 0; e < 2; e++) {
      const o = e * EN * 2;
      if (ey(o) < MARK_LO + 0.5) continue;
      let cy = 0;
      for (let s = 0; s < EN; s++) cy += ey(o + s * 2 + 1);
      cy /= EN;
      ctx.moveTo(ey(o), cy + (ey(o + 1) - cy) * lid);
      for (let s = 1; s < EN; s++) ctx.lineTo(ey(o + s * 2), cy + (ey(o + s * 2 + 1) - cy) * lid);
      ctx.closePath();
    }
    ctx.fillStyle = props.lid != null ? props.color : darken(inkOf(props.color), 0.7 * ek);
    ctx.fill("evenodd");
    ctx.restore();
  };
  const cs = props.size * 1.5, off = -props.size * 0.25;
  return (
    <View style={{ width: props.size, height: props.size }}>
      <Canvas style={{ position: "absolute", left: off, top: off, width: cs, height: cs }} draw={draw} />
    </View>
  );
}

// ————— Grok's "Computer is asleep" avatar (measured over CDP) —————
// The same mark, camera-facing, filled with the theme's muted ink whatever
// the bot's color, eyes closed to low slits; it breathes (2.4s: opacity
// .85↔1, scale 1↔1.04) while three 11pt "z"s rise from its top-right,
// 800ms apart (translateY 0→-12, scale .6→1, fade in by 25% then out).
export function SleepingBlob(props: { shape: string; size?: number; ink?: string }) {
  const s = props.size ?? 33;
  const ink = props.ink ?? "rgba(245,245,245,0.54)";
  const breath = createNativeValue(0);
  const zs = [createNativeValue(0), createNativeValue(0), createNativeValue(0)];
  effect(() => {
    const ease = Easing.bezier(0.42, 0, 0.58, 1);
    const b = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 1200, easing: ease }),
      Animated.timing(breath, { toValue: 0, duration: 1200, easing: ease }),
    ]));
    b.start();
    const loops = zs.map((z) => Animated.loop(Animated.sequence([
      Animated.timing(z, { toValue: 1, duration: 2400, easing: Easing.bezier(0, 0, 0.58, 1) }),
      Animated.timing(z, { toValue: 0, duration: 0 }),
    ])));
    const timers = loops.map((l, i) => setTimeout(() => l.start(), i * 800));
    cleanup(() => {
      b.stop();
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    });
  });
  return (
    <View style={{ width: s, height: s }}>
      <View
        style={{
          width: s,
          height: s,
          opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
          transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
        }}
      >
        <BotBlob shape={props.shape} color={ink} size={s / 0.82} lid={0.28} />
      </View>
      {zs.map((z, i) => (
        <Text
          style={{
            position: "absolute",
            left: s - 3 + i * 4,
            top: -11 + [1, -3, 8][i],
            fontSize: 11,
            fontWeight: "600",
            color: ink,
            opacity: z.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 0] }),
            transform: [
              { translateY: z.interpolate({ inputRange: [0, 1], outputRange: [0, -12] }) },
              { scale: z.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
            ],
          }}
        >
          z
        </Text>
      ))}
    </View>
  );
}

// ————— image avatars (Grok's Generate / Upload) —————
// crop: zoom `s` (≥1) and offset `x`/`y` as fractions of the circle.
export type AvatarCrop = { s: number; x: number; y: number } | null | undefined;

export function CroppedImage(props: { uri: string; size: number; crop?: AvatarCrop; editK?: any }) {
  const z = () => props.crop?.s ?? 1;
  return (
    <View
      style={{
        width: props.size,
        height: props.size,
        borderRadius: props.size / 2,
        overflow: "hidden",
        backgroundColor: "#1f1f1f",
      }}
    >
      <Image
        src={{ uri: mediaUrl(props.uri) }}
        resizeMode="cover"
        fadeDuration={0}
        style={{
          position: "absolute",
          width: props.size * z(),
          height: props.size * z(),
          left: (props.size - props.size * z()) / 2 + (props.crop?.x ?? 0) * props.size,
          top: (props.size - props.size * z()) / 2 + (props.crop?.y ?? 0) * props.size,
        }}
      />
      <If when={!!props.editK}>
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#000",
            opacity: props.editK?.interpolate?.({ inputRange: [0, 1], outputRange: [0, 0.7] }) ?? 0,
          }}
        />
      </If>
    </View>
  );
}

// A bot's avatar wherever it shows: its image when it has one, else the
// blob. `size` is the blob's stage; images fill `box` (default: the blob's
// drawn extent, so both read the same size in a row).
export function BotAvatar(props: {
  shape: string;
  color: string;
  image?: string;
  crop?: AvatarCrop;
  size: number;
  box?: number;
  gaze?: BlobGaze;
  /** hover "Edit Avatar": the blob eases straight + darkens (JS) */
  edit?: BlobEdit;
  /** the same for image avatars (a native overlay) */
  editK?: any;
  breathe?: boolean;
  lid?: number;
  clip?: string | string[];
  fx?: string;
}) {
  const box = () => props.box ?? Math.round(props.size * 0.82);
  return (
    <View style={{ width: props.size, height: props.size, alignItems: "center", justifyContent: "center" }}>
      <If when={!!props.image}>
        <CroppedImage uri={props.image!} size={box()} crop={props.crop} editK={props.editK} />
      </If>
      <If when={!props.image}>
        <BotBlob
          shape={props.shape}
          color={props.color}
          size={props.size}
          gaze={props.gaze}
          edit={props.edit}
          breathe={props.breathe}
          lid={props.lid}
          clip={props.clip}
          fx={props.fx}
        />
      </If>
    </View>
  );
}
