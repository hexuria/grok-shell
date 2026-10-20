import { Canvas } from "nsh/canvas";
import { Animated, createNativeValue, Easing } from "nsh/animated";
import { Image } from "nsh/image";
import { cleanup, effect, signal, Text, View } from "nsh";
import { appearance } from "./theme";
import { mediaUrl } from "./filetile";
import { ih, rP, rv, Uh, Wn, YN } from "./motion.mjs";
import { atlasOutline, decodeAtlas, type Atlas } from "./markatlas.mjs";
import { paintTree } from "./markpaint";
import { ATLAS, ATLAS_K, ATLAS_STEP } from "./atlas.data";
import { REST, REST_EN, REST_LAYERS, REST_N } from "./rest.data";

// Grok's IM() looks every outline up in its cache first: answer it from the
// atlas its own solver pre-computed, so no outline is solved live — that
// solve costs 10–40ms a frame in QuickJS and some poses run past the 2s
// script budget. set() is a no-op: nothing needs caching.
const atlasByBody = new Map(Object.entries(ATLAS).map(([shape, entry]) => [YN(shape), entry]));
const atlases = new Map<string, Atlas | null>();
Wn.get = (key: string) => {
  const [body, n, yaw, pitch, roll] = key.split(" ");
  let atlas = atlases.get(body);
  if (atlas === undefined) {
    const entry = atlasByBody.get(body);
    atlas = entry ? decodeAtlas(entry, ATLAS_STEP, ATLAS_K) : null;
    atlases.set(body, atlas);
  }
  return atlas ? [atlasOutline(atlas, +n, +yaw, +pitch, +roll)] : undefined;
};
Wn.set = () => Wn;

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
const hexRgb = (hx: string) => {
  const n = parseInt(hx.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const darken = (hx: string, k: number) => {
  if (!hx.startsWith("#")) return hx;
  const [r, g, b] = hexRgb(hx).map((v) => Math.round(v * (1 - k)));
  return `rgb(${r},${g},${b})`;
};

// ————— Grok's avatar, run by Grok's own motion engine (motion.mjs) —————
// One engine + state director per placement on a shared ~30fps clock (Grok's
// default mark rate); each frame is Uh()'s SVG tree painted by markpaint.ts,
// or for resting marks the pre-solved frames below.

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

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

// ————— resting marks, pre-solved by Grok's engine (rest.data.ts) —————
// Uh's live silhouette solve costs ~9ms a frame in QuickJS and hover lands on
// a new pose nearly every frame, so a resting mark with its neutral face
// paints the baked frames instead, interpolated at se()'s own gaze state.
const restFrames = new Map<string, Uint8Array>();
const restOf = (shape: string) => {
  let bytes = restFrames.get(shape);
  if (!bytes && REST[shape]) {
    const bin = atob(REST[shape]);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    restFrames.set(shape, bytes);
  }
  return bytes;
};
const REST_FB = (REST_N + 2 * REST_EN) * 2; // bytes a frame
// se()'s gaze state (ih: setGaze/advance/rest), mirrored from the same inputs
type GazeState = { held: boolean; x: number; y: number; cx: number; cy: number; hold: number };
const gazeSet = (s: GazeState, gaze: [number, number] | null) => {
  if (!gaze) {
    s.held = false;
    return;
  }
  s.x = clamp(gaze[0] || 0);
  s.y = clamp(gaze[1] || 0);
  if (s.hold === 0) {
    s.cx = s.x;
    s.cy = s.y;
  }
  s.held = true;
};
const near = (from: number, to: number, k: number) => {
  const value = from + (to - from) * k;
  return Math.abs(to - value) < 0.001 ? to : value;
};
const gazeAdvance = (s: GazeState, dt: number) => {
  if (!s.held && s.hold === 0) return;
  const k = 1 - 0.86 ** (Math.min(dt, 0.1) * 60);
  s.cx = near(s.cx, s.x, k);
  s.cy = near(s.cy, s.y, k);
  s.hold = near(s.hold, s.held ? 1 : 0, k);
};
// the baked pose at (cx, cy, hold): bilinear in each hold layer's gaze grid,
// linear between layers (layer 0 is the rest frame)
const paintRest = (ctx: any, bytes: Uint8Array, s: GazeState, x: number, y: number, px: number, ink: string) => {
  const layer = (index: number): [number[], number[]] => {
    if (index < 0) return [[0], [1]];
    let base = 1;
    for (let i = 0; i < index; i++) base += REST_LAYERS[i][1] ** 2;
    const n = REST_LAYERS[index][1];
    const fx = ((s.cx + 1) / 2) * (n - 1), fy = ((s.cy + 1) / 2) * (n - 1);
    const x0 = Math.min(n - 2, Math.floor(fx)), y0 = Math.min(n - 2, Math.floor(fy)), ax = fx - x0, ay = fy - y0;
    const f = base + y0 * n + x0;
    return [[f, f + 1, f + n, f + n + 1], [(1 - ax) * (1 - ay), ax * (1 - ay), (1 - ax) * ay, ax * ay]];
  };
  let index = 0;
  while (index < REST_LAYERS.length - 1 && REST_LAYERS[index][0] < s.hold) index++;
  const h0 = index === 0 ? 0 : REST_LAYERS[index - 1][0];
  const t = Math.max(0, Math.min(1, (s.hold - h0) / (REST_LAYERS[index][0] - h0)));
  const [fa, wa] = layer(index - 1), [fb, wb] = layer(index);
  const k = px / 255;
  const at = (j: number) => {
    let a = 0, b = 0;
    for (let i = 0; i < fa.length; i++) a += bytes[fa[i] * REST_FB + j] * wa[i];
    for (let i = 0; i < 4; i++) b += bytes[fb[i] * REST_FB + j] * wb[i];
    return (a + (b - a) * t) * k;
  };
  ctx.beginPath();
  for (const [from, count] of [[0, REST_N], [REST_N, REST_EN], [REST_N + REST_EN, REST_EN]]) {
    for (let i = 0; i < count; i++) {
      const j = (from + i) * 2;
      if (i === 0) ctx.moveTo(x + at(j), y + at(j + 1));
      else ctx.lineTo(x + at(j), y + at(j + 1));
    }
    ctx.closePath();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  ctx.fill("evenodd");
};

export function blobGaze() {
  const v = signal(0);
  let target: [number, number] | null = null;
  let ver = 0;
  const change = (next: [number, number] | null) => {
    if (target?.[0] === next?.[0] && target?.[1] === next?.[1]) return;
    target = next;
    ver++;
    v.set(ver);
  };
  return {
    v,
    follow: (event: { x: number; y: number }, cx: number, cy: number, reach = 60) => {
      change([clamp((event.x - cx) / reach), clamp(-(event.y - cy) / reach)]);
    },
    rest: () => change(null),
    get target() { return target; },
    get ver() { return ver; },
  };
}
export type BlobGaze = ReturnType<typeof blobGaze>;

export function blobEdit() {
  const s = { target: 0 };
  const v = signal(0);
  return {
    s,
    v,
    to: (target: number) => {
      s.target = target;
      v.set(v() + 1);
    },
  };
}
export type BlobEdit = ReturnType<typeof blobEdit>;

type BlobPoke = { kind: string; turns?: number };

export function blobPokes() {
  const v = signal(0);
  const queue: BlobPoke[] = [];
  return {
    v,
    queue,
    fire: (kind: string, turns?: number) => {
      queue.push({ kind, turns });
      v.set(v() + 1);
    },
  };
}
export type BlobPokes = ReturnType<typeof blobPokes>;

type BotBlobProps = {
  shape: string;
  color: string;
  size: number;
  state?: string;
  paused?: boolean;
  emphasized?: boolean;
  gaze?: BlobGaze;
  edit?: BlobEdit;
  pokes?: BlobPokes;
  morphShape?: boolean;
  seed?: string;
  gazeAt?: [number, number];
};

export function BotBlob(props: BotBlobProps) {
  startClock();
  const box = props.size * 0.82;
  const seed = props.seed ?? Math.random().toString(36).slice(2);
  let graceUntil = 0;
  const state = props.state ?? "idle";
  const initiallyResting = props.paused ?? (state === "idle" && Date.now() >= graceUntil);
  const R = ih({ body: YN(props.shape) });
  const O = rv(R, state, {
    seed: rP(seed),
    isCompact: box < 48,
    isResting: initiallyResting,
  });
  const gs: GazeState = { held: false, x: 0, y: 0, cx: 0, cy: 0, hold: 0 };
  const initialGaze = props.gaze?.target ?? props.gazeAt ?? null;
  R.setGaze(initialGaze);
  gazeSet(gs, initialGaze);

  let lastShape = props.shape;
  let lastState = state;
  let lastCompact = box < 48;
  let lastEmphasis = false;
  let lastResting = initiallyResting;
  let lastGazeVer = props.gaze?.ver ?? 0;
  let wasPlaying = R.isPlaying;
  // face morphs, pokes and shape crossfades aren't baked: render them live
  let liveUntil = 0;
  let ek = 0;
  let previous = 0;
  let asleep = true;

  const draw = (ctx: any, { width, height }: { width: number; height: number }) => {
    const gaze = props.gaze;
    const edit = props.edit;
    const editTarget = edit?.s.target ?? 0;
    const pokes = props.pokes;
    const nextState = props.state ?? "idle";
    const now = Date.now();

    if (props.shape !== lastShape) {
      R.setBody(YN(props.shape));
      if (props.morphShape) graceUntil = now + 1400;
      liveUntil = now + 1200;
      lastShape = props.shape;
    }
    if (nextState !== lastState) {
      if (nextState === "idle") graceUntil = now + 1400;
      O.setState(nextState);
      lastState = nextState;
    }
    const compact = box < 48;
    if (compact !== lastCompact) {
      O.setCompact(compact);
      lastCompact = compact;
    }
    const emphasized = !!props.emphasized;
    if (emphasized !== lastEmphasis) {
      O.setEmphasis(emphasized);
      liveUntil = now + 400;
      lastEmphasis = emphasized;
    }
    // Pointer moves arrive far faster than frames: take the latest target
    // untracked, so a mousemove never repaints by itself — only a settled
    // mark subscribes, to wake (below).
    if (gaze && gaze.ver !== lastGazeVer) {
      const target = gaze.target ?? props.gazeAt ?? null;
      R.setGaze(target);
      gazeSet(gs, target);
      lastGazeVer = gaze.ver;
    }
    for (const poke of pokes?.queue.splice(0) ?? []) {
      R.poke(poke.kind, poke.turns == null ? undefined : { turns: poke.turns });
      liveUntil = now + 1500;
    }

    const resting = props.paused ?? (nextState === "idle" && now >= graceUntil);
    if (resting !== lastResting) {
      O.setResting(resting);
      lastResting = resting;
    }
    const live =
      !resting ||
      !R.isSettled ||
      Math.abs(editTarget - ek) > 0.002 ||
      graceUntil > now;

    let dt = 0;
    if (live) {
      const time = clock();
      if (asleep) {
        previous = time;
        asleep = false;
      } else {
        dt = Math.min(0.1, Math.max(0, time - previous));
        previous = time;
      }
      if (dt > 0) {
        if (!resting) O.advance(dt);
        R.advance(dt);
        gazeAdvance(gs, dt);
        ek += (editTarget - ek) * (1 - Math.exp(-14 * dt));
      }
    } else {
      asleep = true;
      gaze?.v();
      edit?.v();
      pokes?.v();
    }
    // loading the rest pose zeroes se()'s hold (ih's z()): mirror it
    const playing = R.isPlaying;
    if (wasPlaying && !playing) gs.hold = 0;
    wasPlaying = playing;

    ctx.clearRect(0, 0, width, height);
    const ink = inkOf(props.color);
    const inkPaint = ek > 0.001 ? darken(ink, 0.7 * ek) : ink;
    const extent = Math.round(box * (0.92 / 0.6) * 100) / 100;
    const x = (width - extent) / 2, y = (height - extent) / 2;
    const baked = resting && !playing && nextState === "idle" && !emphasized && now >= liveUntil ? restOf(props.shape) : undefined;
    if (baked) paintRest(ctx, baked, gs, x, y, extent, inkPaint);
    else {
      const tree = Uh(
        R.frame(),
        { ink: [0, 0, 0], spot: [0, 0, 0], cutout: true, inkPaint },
        extent,
        "m",
        { displaySize: box, extent: "100%" },
      );
      paintTree(ctx, tree, x, y, extent);
    }
  };

  const canvasSize = props.size * 1.5;
  const offset = -props.size * 0.25;
  return (
    <View style={{ width: props.size, height: props.size }}>
      <Canvas
        style={{ position: "absolute", left: offset, top: offset, width: canvasSize, height: canvasSize }}
        draw={draw}
      />
    </View>
  );
}

export function SleepingBlob(props: { shape: string; size?: number; ink?: string }) {
  const size = props.size ?? 33;
  const ink = props.ink ?? "rgba(245,245,245,0.54)";
  const breath = createNativeValue(0);
  const zs = [createNativeValue(0), createNativeValue(0), createNativeValue(0)];
  effect(() => {
    const ease = Easing.bezier(0.42, 0, 0.58, 1);
    const breathing = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 1200, easing: ease }),
      Animated.timing(breath, { toValue: 0, duration: 1200, easing: ease }),
    ]));
    breathing.start();
    const loops = zs.map((z) => Animated.loop(Animated.sequence([
      Animated.timing(z, { toValue: 1, duration: 2400, easing: Easing.bezier(0, 0, 0.58, 1) }),
      Animated.timing(z, { toValue: 0, duration: 0 }),
    ])));
    const timers = loops.map((loop, index) => setTimeout(() => loop.start(), index * 800));
    cleanup(() => {
      breathing.stop();
      timers.forEach(clearTimeout);
      loops.forEach((loop) => loop.stop());
    });
  });
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
          transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
        }}
      >
        <BotBlob shape={props.shape} color={ink} size={size / 0.82} state="sleeping" paused gazeAt={[0, 0]} />
      </View>
      {zs.map((z, index) => (
        <Text
          style={{
            position: "absolute",
            left: size - 3 + index * 4,
            top: -11 + [1, -3, 8][index],
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

export type AvatarCrop = { s: number; x: number; y: number } | null | undefined;

export function CroppedImage(props: { uri: string; size: number; crop?: AvatarCrop; editK?: any }) {
  const zoom = () => props.crop?.s ?? 1;
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
          width: props.size * zoom(),
          height: props.size * zoom(),
          left: (props.size - props.size * zoom()) / 2 + (props.crop?.x ?? 0) * props.size,
          top: (props.size - props.size * zoom()) / 2 + (props.crop?.y ?? 0) * props.size,
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

export function BotAvatar(props: {
  shape: string;
  color: string;
  image?: string;
  crop?: AvatarCrop;
  size: number;
  box?: number;
  state?: string;
  paused?: boolean;
  emphasized?: boolean;
  gaze?: BlobGaze;
  edit?: BlobEdit;
  editK?: any;
  pokes?: BlobPokes;
  morphShape?: boolean;
  seed?: string;
  gazeAt?: [number, number];
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
          state={props.state}
          paused={props.paused}
          emphasized={props.emphasized}
          gaze={props.gaze}
          edit={props.edit}
          pokes={props.pokes}
          morphShape={props.morphShape}
          seed={props.seed}
          gazeAt={props.gazeAt}
        />
      </If>
    </View>
  );
}
