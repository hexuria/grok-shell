import { Canvas } from "nsh/canvas";
import { signal, View } from "nsh";
import { BotBlob } from "./blob";
import { tc } from "./theme";

// ————————————————————————————————————————————————————————————————
// Agent status, ported from Sand's bundle (index.eager-platform/app).
// ————————————————————————————————————————————————————————————————
// `vx` maps a status key to an ambient effect on the mark; `yl` maps the
// richer agent states to clips/faces. The clips themselves are 3D keyframes
// we don't bake, so clip-driven states fall back to the mark's idle loop
// (breathe) plus the matching overlay. The state table below is the union:
//   vx:  thinking→dots orbit radar progress spawning→gather dictating→wave
//        sending→send receiving→receive uploading→dock bouncing→ball
//        writing→pencil alerting→bang powering-down→standby
//   yl:  idle listening thinking streaming searching reading working coding
//        running computing controlling waiting blocked finished failed
//        sleeping waking happy excited laughing proud curious playful shy
//        surprised suspicious angry confused sad drowsy bored scared
//        celebrate approving orbit radar progress spawning loading
//        dictating sending receiving uploading writing alerting bouncing
//        powering-down humming notifying dragging logo showcase turntable

const TAU = Math.PI * 2;

const fxClock = signal(0);
let fxOn = false;
const startFx = () => {
  if (fxOn) return;
  fxOn = true;
  const tick = (ms: number) => {
    fxClock.set(ms / 1000);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

export type AgentFx =
  | "none" | "dots" | "orbit" | "radar" | "progress" | "gather" | "wave"
  | "send" | "receive" | "dock" | "ball" | "pencil" | "bang" | "standby";

export type AgentState = {
  fx: AgentFx;
  label: string;
  /** play the idle loop (fallback when no clip is named) */
  breathe?: boolean;
  /** lid amount for face states (squinted, sleepy…) */
  lid?: number;
  /** Grok clip(s) from `yl` — real keyframes played through clips.ts */
  clip?: string | string[];
};

const WORKING = ["Working_A", "Working_B", "Working_C", "Working_D", "Working_E", "Working_F"];
const IDLE_B = "Idle_B";

export const AGENT_STATUS: Record<string, AgentState> = {
  idle: { fx: "none", label: "" },
  listening: { fx: "none", label: "Listening…", clip: "Idle_D" },
  thinking: { fx: "dots", label: "Thinking…", clip: IDLE_B },
  streaming: { fx: "wave", label: "Streaming…", clip: ["Streaming_A", "Streaming_B", "Streaming_C"] },
  searching: { fx: "radar", label: "Searching…", clip: IDLE_B },
  reading: { fx: "radar", label: "Reading…", clip: WORKING },
  working: { fx: "orbit", label: "Working…", clip: WORKING },
  coding: { fx: "orbit", label: "Coding…", clip: WORKING },
  running: { fx: "orbit", label: "Running…", clip: WORKING },
  computing: { fx: "orbit", label: "Computing…", clip: WORKING },
  controlling: { fx: "orbit", label: "Controlling…", clip: WORKING },
  waiting: { fx: "orbit", label: "Waiting…", clip: IDLE_B },
  blocked: { fx: "bang", label: "Blocked", clip: "Blocked_A" },
  finished: { fx: "none", label: "Done", clip: ["Done_B", "Done_A"] },
  failed: { fx: "bang", label: "Failed", clip: "Blocked_B" },
  sleeping: { fx: "none", label: "Sleeping", lid: 0.15, clip: IDLE_B },
  waking: { fx: "none", label: "Waking…", clip: IDLE_B },
  happy: { fx: "none", label: "Happy", clip: "Done_A" },
  excited: { fx: "none", label: "Excited", clip: "Done_C" },
  laughing: { fx: "none", label: "Laughing", clip: "Done_B" },
  proud: { fx: "none", label: "Proud", clip: "Marketing_B" },
  curious: { fx: "none", label: "Curious…", clip: "Working_B" },
  playful: { fx: "none", label: "Playful", clip: "Bodymoves_A" },
  shy: { fx: "none", label: "Shy", clip: "Idle_D" },
  surprised: { fx: "none", label: "Surprised", clip: IDLE_B },
  suspicious: { fx: "none", label: "Suspicious", clip: "Idle_D" },
  angry: { fx: "none", label: "Angry", clip: "Blocked_A" },
  confused: { fx: "bang", label: "Confused", clip: "Blocked_A" },
  sad: { fx: "none", label: "Sad", clip: "Blocked_B" },
  drowsy: { fx: "none", label: "Drowsy", clip: "Blocked_C" },
  bored: { fx: "none", label: "Bored", clip: IDLE_B },
  scared: { fx: "none", label: "Scared", clip: "Idle_D" },
  celebrate: { fx: "none", label: "Celebrate", clip: "Rotation_A" },
  approving: { fx: "none", label: "Approving", clip: "Rotation_C" },
  orbit: { fx: "orbit", label: "Orbit", clip: IDLE_B },
  radar: { fx: "radar", label: "Radar", clip: IDLE_B },
  progress: { fx: "progress", label: "Progress", clip: IDLE_B },
  spawning: { fx: "gather", label: "Spawning…", clip: IDLE_B },
  loading: { fx: "progress", label: "Loading…", clip: IDLE_B },
  dictating: { fx: "wave", label: "Dictating…", clip: IDLE_B },
  sending: { fx: "send", label: "Sending…", clip: IDLE_B },
  receiving: { fx: "receive", label: "Receiving…", clip: IDLE_B },
  uploading: { fx: "dock", label: "Uploading…", clip: IDLE_B },
  writing: { fx: "pencil", label: "Writing…", clip: IDLE_B },
  alerting: { fx: "bang", label: "Alert", clip: IDLE_B },
  bouncing: { fx: "ball", label: "Bouncing", clip: IDLE_B },
  "powering-down": { fx: "standby", label: "Powering down…", clip: IDLE_B },
  humming: { fx: "none", label: "Humming", clip: IDLE_B },
  notifying: { fx: "bang", label: "Notification", clip: "Done_B" },
  dragging: { fx: "none", label: "Dragging", clip: IDLE_B },
};

// ————— ambient overlay: the vx effect drawn around the mark —————
const drawFx = (fx: AgentFx, ctx: any, w: number, h: number, t: number, ink: string) => {
  const cx = w / 2, cy = h / 2, r = w * 0.30;
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  switch (fx) {
    case "dots": {
      // thinking: three dots bobbing in sequence at mouth level
      for (let i = 0; i < 3; i++) {
        const p = (t * 1.7 + i * 0.33) % 1;
        ctx.globalAlpha = 0.35 + 0.65 * Math.sin(p * Math.PI);
        ctx.beginPath();
        ctx.arc(cx + (i - 1) * r * 0.5, cy + r * 0.45 - Math.sin(p * Math.PI) * r * 0.18, r * 0.09, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case "orbit": {
      // a dot (and fading tail) circling the mark
      const a = t * TAU / 1.7;
      for (let k = 0; k < 4; k++) {
        const aa = a - k * 0.42;
        ctx.globalAlpha = (1 - k / 4) * 0.9;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(aa) * r * 1.15, cy + Math.sin(aa) * r * 1.15, r * 0.085 * (1 - k * 0.15), 0, TAU);
        ctx.fill();
      }
      break;
    }
    case "radar": {
      // searching: rings expanding from the mark
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.55 + i / 3) % 1;
        ctx.globalAlpha = (1 - p) * 0.55;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r * (0.55 + p * 0.95), 0, TAU);
        ctx.stroke();
      }
      break;
    }
    case "progress": {
      // a bright arc sweeping the ring
      const a = t * TAU / 1.15;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = r * 0.09;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.05, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.05, a, a + TAU * 0.22);
      ctx.stroke();
      break;
    }
    case "gather": {
      // spawning: particles converging on the mark, then reset
      for (let i = 0; i < 5; i++) {
        const ang = i * (TAU / 5) + 0.5;
        const p = (t * 0.9 + i * 0.17) % 1;
        const rad = r * (1.6 - 1.1 * p);
        ctx.globalAlpha = 0.3 + 0.6 * p;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, r * 0.075, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case "wave": {
      // dictating: five bars breathing
      for (let i = 0; i < 5; i++) {
        const hh = r * (0.18 + 0.5 * (0.5 + 0.5 * Math.sin(t * 7 + i * 1.15)));
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.roundRect(cx + (i - 2) * r * 0.32 - r * 0.05, cy + r * 0.35 - hh / 2, r * 0.1, hh, r * 0.05);
        ctx.fill();
      }
      break;
    }
    case "send": {
      // a dot (and ghost) leaving the mark up-right
      for (let k = 0; k < 3; k++) {
        const p = (t * 1.05 - k * 0.09) % 1;
        if (p < 0) continue;
        ctx.globalAlpha = (1 - k / 3) * (1 - p * 0.7);
        ctx.beginPath();
        ctx.arc(cx + p * p * r * 1.5, cy - p * r * 1.35, r * 0.085, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case "receive": {
      // a dot dropping into the mark from above
      const p = (t * 1.1) % 1;
      const ease = p * p;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 1.5 + ease * r * 1.5, r * 0.085, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 1.5 + ease * ease * r * 1.5 - r * 0.14, r * 0.06, 0, TAU);
      ctx.fill();
      break;
    }
    case "dock": {
      // uploading: dot rises out of the mark then settles back
      const p = (t * 0.9) % 1;
      const y = p < 0.5 ? p * 2 : (1 - p) * 2;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy - y * r * 1.3, r * 0.085, 0, TAU);
      ctx.fill();
      break;
    }
    case "ball": {
      // bouncing: a dot bouncing at the mark's foot
      const y = Math.abs(Math.sin(t * 5.5));
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy + r * 1.1 - y * r * 0.75, r * 0.1, 0, TAU);
      ctx.fill();
      break;
    }
    case "pencil": {
      // writing: a short stroke being scribbled, over and over
      const p = (t * 1.3) % 1;
      const n = 14;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      for (let i = 0; i <= n * p; i++) {
        const u = i / n;
        const x = cx - r * 0.55 + u * r * 1.1;
        const yy = cy + r * 0.5 + Math.sin(u * 9) * r * 0.09;
        i === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
      break;
    }
    case "bang": {
      // alerting: "!" pulsing over the mark
      const s = 1 + Math.sin(t * 6) * 0.12;
      ctx.globalAlpha = 0.95;
      const fs = r * 0.85 * s;
      ctx.font = `700 ${fs}px -apple-system, system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", cx, cy - r * 0.55);
      break;
    }
    case "standby": {
      // powering-down: a power glyph dimming
      const p = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.4));
      ctx.globalAlpha = p;
      ctx.lineWidth = r * 0.09;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.35, r * 0.3, Math.PI * 0.35, Math.PI * 2.65);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.72);
      ctx.lineTo(cx, cy - r * 0.38);
      ctx.stroke();
      break;
    }
    default:
      return;
  }
};

// The ambient overlay by itself — drawn in the theme ink (the mark's fill is
// the bot color, so drawing effects in that ink would be invisible on it).
export function FxOverlay(props: { fx: AgentFx; size: number; ink?: string }) {
  startFx();
  const draw = (ctx: any, { width, height }: { width: number; height: number }) => {
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    drawFx(props.fx, ctx, width, height, fxClock(), props.ink ?? tc("#f5f5f5"));
    ctx.globalAlpha = 1;
  };
  return (
    <Canvas
      pointerEvents="none"
      style={{ position: "absolute", left: -props.size * 0.25, top: -props.size * 0.25, width: props.size * 1.5, height: props.size * 1.5 }}
      draw={draw}
    />
  );
}

// The status row's mark: the bot's avatar at 22pt with the ambient effect
// drawn over it; clip-states stand in with the idle loop, face states with
// the lid amount.
export function StatusAvatar(props: { shape: string; color: string; state: string; size?: number }) {
  const s = props.size ?? 22;
  const st = () => AGENT_STATUS[props.state] ?? { fx: "none", label: props.state };
  return (
    <View style={{ width: s, height: s }}>
      <BotBlob
        shape={props.shape}
        color={props.color}
        size={s}
        breathe={st().breathe}
        lid={st().lid}
        clip={st().clip}
        fx={st().fx}
        pose={st().breathe == null && st().lid == null && st().clip == null ? "rest" : undefined}
      />
    </View>
  );
}

// ————— Grok's status text: a bright band sweeping the muted label —————
// Grok does it as a CSS background-position sweep with background-clip:text;
// the canvas equivalent is a moving linear-gradient fill.
export function ShimmerText(props: {
  text: string;
  size?: number;
  color: string;
  hi: string;
}) {
  startFx();
  const size = props.size ?? 11;
  const draw = (ctx: any, { width, height }: { width: number; height: number }) => {
    ctx.clearRect(0, 0, width, height);
    const t = fxClock();
    ctx.font = `${size}px -apple-system, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const w = Math.min(ctx.measureText(props.text).width, width);
    const band = Math.max(30, w * 0.4);
    const cx = -band + ((t % 1.9) / 1.9) * (w + band * 2);
    const g = ctx.createLinearGradient(cx - band, 0, cx + band, 0);
    g.addColorStop(0, props.color);
    g.addColorStop(0.5, props.hi);
    g.addColorStop(1, props.color);
    ctx.fillStyle = g;
    ctx.fillText(props.text, 0, height / 2, width);
  };
  return <Canvas draw={draw} style={{ height: size + 8, flexGrow: 1, minWidth: 60 }} />;
}
