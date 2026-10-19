import { Canvas } from "nsh/canvas";
import { Animated, createNativeValue, Easing } from "nsh/animated";
import { Image } from "nsh/image";
import { cleanup, effect, signal, Text, View } from "nsh";
import { appearance } from "./theme";
import { mediaUrl } from "./filetile";
import { MARKS, MARK_FPS, MARK_FRAMES, MARK_HI, MARK_LO, MARK_POINTS, MARK_SPRITE } from "./marks.data";

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
const decoded = new Map<string, Uint8Array>();
const markOf = (shape: string) => {
  const key = MARKS[shape] ? shape : "blob";
  let b = decoded.get(key);
  if (!b) {
    const bin = atob(MARKS[key].o);
    b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    decoded.set(key, b);
  }
  return { bytes: b, eyes: MARKS[key].e };
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

// Pointer gaze: targets the eyes ease toward (normalized −1…1); the resting
// gaze looks up, like Grok's idle.
export function blobGaze() {
  const g = { x: 0, y: -0.35 };
  // bumped on change: wakes still blobs, which otherwise don't tick
  const v = signal(0);
  let held = false;
  const follow = (e: { x: number; y: number }, cx: number, cy: number, reach = 60) => {
    held = true;
    const x = Math.max(-1, Math.min(1, (e.x - cx) / reach));
    const y = Math.max(-1, Math.min(1, (e.y - cy) / reach));
    if (x === g.x && y === g.y) return;
    g.x = x;
    g.y = y;
    v.set(v() + 1);
  };
  const rest = () => {
    held = false;
    g.x = 0;
    g.y = -0.35;
    v.set(v() + 1);
  };
  return { g, follow, rest, v, get held() { return held; } };
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
};

// `size` is the stage; the avatar's nominal box is 82% of it (Grok's sprite
// spans 1.3913× the box, so lobes and turned slabs overhang it).
export function BotBlob(props: BotBlobProps) {
  startClock();
  const phase = Math.random() * 6;
  let ek = 0, gx = 0, gy = -0.35, hk = 0, prev = -1;
  const draw = (ctx: any, { width, height }: { width: number; height: number }) => {
    // Only breathing blobs (and still ones easing their eyes/pose) follow the
    // 30fps clock; a settled still blob redraws only when its gaze/edit wakes
    // it. Every blob reading the clock redrew them all, forever.
    const still = props.breathe === false || props.lid != null || props.pose != null;
    props.gaze?.v();
    props.edit?.v();
    const gz0 = props.gaze?.g ?? { x: 0, y: -0.35 };
    const held0 = props.gaze?.held === true;
    const settled =
      Math.abs(gz0.x - gx) < 0.002 && Math.abs(gz0.y - gy) < 0.002 && Math.abs((props.edit?.s.target ?? 0) - ek) < 0.002 &&
      Math.abs(hk - (held0 ? 1 : 0)) < 0.002;
    const t = !still || !settled ? clock() : Date.now() / 1000;
    const dt = prev < 0 ? 0 : Math.min(0.1, Math.max(0, t - prev));
    prev = t;
    const ease = (rate: number) => 1 - Math.exp(-dt * rate);
    ek += ((props.edit?.s.target ?? 0) - ek) * (dt ? ease(14) : 1);
    const gz = props.gaze?.g ?? { x: 0, y: -0.35 };
    // Grok's bx: ~14% closer per frame ≈ rate 9; hold ramps the same way
    gx += (gz.x - gx) * (dt ? ease(9) : 1);
    gy += (gz.y - gy) * (dt ? ease(9) : 1);
    const held = props.gaze?.held === true;
    hk += ((held ? 1 : 0) - hk) * (dt ? ease(9) : 1);
    const { bytes, eyes } = markOf(props.shape);
    const P = MARK_POINTS, F = MARK_FRAMES, front = F;
    const stillFrame = props.pose === "rest" ? 0 : front;
    const ct = (t + phase) % 6;
    const ft = ct * MARK_FPS;
    const i0 = still ? stillFrame : Math.floor(ft) % F;
    const i1 = still ? stillFrame : (i0 + 1) % F;
    const f = still ? 0 : ft - Math.floor(ft);
    // Grok: while the pointer holds the mark the idle loop freezes — the
    // pose blends to the front frame and the body pivots instead.
    const k = still ? 0 : Math.max(ek, hk);
    const pt = (fr: number, j: number) => unq(bytes[fr * P * 2 + j]);
    const at = (j: number) => {
      const a = pt(i0, j) + (pt(i1, j) - pt(i0, j)) * f;
      return a + (pt(front, j) - a) * k;
    };
    const box = props.size * 0.82;
    const scale = (box * 1.3913) / MARK_SPRITE;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    // Grok's turn: fl()×hold×.55 — a yaw of ~9.9°·gx, a small drift of the
    // mark size (.0165·gx/.0132·gy ≈ 2.4/1.9 sprite units) — while the eyes
    // (offset further below) lead the face.
    ctx.rotate(gx * 0.17 * hk);
    ctx.translate(gx * 2.4 * hk, gy * 1.9 * hk);
    ctx.translate(-MARK_SPRITE / 2, -MARK_SPRITE / 2);
    ctx.beginPath();
    ctx.moveTo(at(0), at(1));
    for (let j = 1; j < P; j++) ctx.lineTo(at(j * 2), at(j * 2 + 1));
    ctx.closePath();
    // eyes: lerped ellipses [cx, cy, rx, ry, deg], blink scales the long axis
    const e0 = eyes[i0], e1 = eyes[i1], ef = eyes[front];
    const lid = props.lid ?? (still ? 1 : Math.max(lidAt(ct), hk));
    for (const o of [0, 5]) {
      const v = (n: number) => {
        const a = e0[o + n] + (e1[o + n] - e0[o + n]) * f;
        return a + (ef[o + n] - a) * k;
      };
      const rx = v(2), ry = v(3) * lid;
      if (rx < 0.4 || ry < 0.3) continue;
      const rot = (v(4) * Math.PI) / 180;
      const cx = v(0) + gx * 6;
      const cy = v(1) + gy * 5 + (1 - lid) * v(3) * 0.45;
      ctx.moveTo(cx + rx * Math.cos(rot), cy + rx * Math.sin(rot));
      ctx.ellipse(cx, cy, rx, ry, rot, 0, TAU);
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
        />
      </If>
    </View>
  );
}
