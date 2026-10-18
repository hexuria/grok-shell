import { signal, effect, cleanup, Text, View } from "nsh";
import { Canvas } from "nsh/canvas";
import { keymap } from "nsh/keymap";

export const popoutWidth = 340;

const S = "R45";
const W = 300, H = 440, GROUND = 60, GAP = 120, PW = 52, BX = 80, BR = 14;
const FLAP = -7.5, GRAVITY = 0.45, SPEED = 2.2;

type Pipe = { x: number; gy: number; passed: boolean };

export default function R() {
  const frame = signal(0);
  const status = signal("ready"); // ready | playing | over
  const score = signal(0);
  const best = signal(0);
  const plays = signal(0);

  const g = { y: H / 2, vy: 0, t: 0, pipes: [] as Pipe[] };
  let snap = "";

  const apply = (s: any) => {
    best.set(s?.best ?? 0);
    plays.set(s?.plays ?? 0);
  };

  const save = () => {
    const s = { best: best(), plays: plays() };
    snap = JSON.stringify(s);
    fetch(`http://127.0.0.1:8787/state/${S}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    }).catch(() => {});
  };

  // Restore once
  fetch(`http://127.0.0.1:8787/state/${S}`)
    .then((r) => r.json())
    .then((d) => {
      if (d && d.state) {
        apply(d.state);
        snap = JSON.stringify({ best: d.state.best ?? 0, plays: d.state.plays ?? 0 });
      }
    })
    .catch(() => {});

  // Multi-surface sync
  effect(() => {
    const t = setInterval(async () => {
      try {
        const d = await fetch(`http://127.0.0.1:8787/state/${S}`).then((r) => r.json());
        const s = JSON.stringify(d?.state || {});
        if (s !== "{}" && s !== snap && d.state) {
          snap = s;
          apply(d.state);
        }
      } catch {}
    }, 2000);
    cleanup(() => clearInterval(t));
  });

  const reset = () => {
    g.y = H / 2;
    g.vy = 0;
    g.pipes = [];
    score.set(0);
    status.set("ready");
  };

  const die = () => {
    status.set("over");
    best.set(Math.max(best(), score()));
    plays.update((n) => n + 1);
    save();
  };

  const act = () => {
    const st = status();
    if (st === "ready") {
      g.y = H / 2;
      g.vy = FLAP;
      g.pipes = [];
      score.set(0);
      status.set("playing");
    } else if (st === "playing") {
      g.vy = FLAP;
    } else {
      reset();
    }
  };

  keymap.bind({ space: act, enter: act, up: act });

  const tick = () => {
    g.t++;
    if (status() !== "playing") {
      if (status() === "ready") g.y = H / 2 + Math.sin(g.t / 12) * 8;
      frame.update((n) => n + 1);
      return;
    }

    g.vy += GRAVITY;
    g.y += g.vy;
    for (const p of g.pipes) p.x -= SPEED;

    const last = g.pipes[g.pipes.length - 1];
    if (!last || last.x < W - 170) {
      g.pipes.push({
        x: W + 10,
        gy: 50 + Math.random() * (H - GROUND - GAP - 100),
        passed: false,
      });
    }
    g.pipes = g.pipes.filter((p) => p.x > -PW - 10);

    let dead = g.y + BR >= H - GROUND || g.y - BR <= 0;
    for (const p of g.pipes) {
      if (
        BX + BR > p.x &&
        BX - BR < p.x + PW &&
        (g.y - BR < p.gy || g.y + BR > p.gy + GAP)
      ) dead = true;
      if (!p.passed && p.x + PW < BX - BR) {
        p.passed = true;
        score.update((n) => n + 1);
      }
    }

    frame.update((n) => n + 1);
    if (dead) die();
  };

  effect(() => {
    const t = setInterval(tick, 1000 / 60);
    cleanup(() => clearInterval(t));
  });

  const draw = (ctx: any) => {
    const f = frame();
    const st = status();
    const sc = score();

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#38bdf8");
    sky.addColorStop(1, "#e0f7ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Clouds
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 4; i++) {
      const cx = ((((i * 97 - f * 0.3) % (W + 80)) + (W + 80)) % (W + 80)) - 40;
      const cy = 50 + ((i * 53) % 120);
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.arc(cx + 18, cy - 4, 22, 0, Math.PI * 2);
      ctx.arc(cx + 38, cy, 16, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pipes
    for (const p of g.pipes) {
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(p.x, 0, PW, p.gy);
      ctx.fillRect(p.x, p.gy + GAP, PW, H - GROUND - (p.gy + GAP));
      ctx.fillStyle = "#15803d";
      ctx.fillRect(p.x - 4, p.gy - 18, PW + 8, 18);
      ctx.fillRect(p.x - 4, p.gy + GAP, PW + 8, 18);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(p.x + 6, 0, 6, Math.max(0, p.gy - 18));
    }

    // Ground
    ctx.fillStyle = "#d6a85a";
    ctx.fillRect(0, H - GROUND, W, GROUND);
    ctx.fillStyle = "#84cc16";
    ctx.fillRect(0, H - GROUND, W, 14);
    ctx.fillStyle = "#b8893f";
    const off = (f * SPEED) % 20;
    for (let x = -off; x < W; x += 20) ctx.fillRect(x, H - GROUND + 26, 10, 4);

    // Bird
    const tilt = Math.max(-0.5, Math.min(0.9, g.vy * 0.06));
    ctx.save();
    ctx.translate(BX, g.y);
    ctx.rotate(st === "ready" ? 0 : tilt);
    ctx.fillStyle = "#fde047";
    ctx.strokeStyle = "#ca8a04";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, BR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Wing (flaps with frame)
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.ellipse(-4, 3 + Math.sin(f * 0.5) * 3, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(5, -4, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(6.5, -4, 2.2, 0, Math.PI * 2);
    ctx.fill();
    // Beak
    ctx.fillStyle = "#fb923c";
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(20, 3);
    ctx.lineTo(10, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Score
    if (st === "playing") {
      ctx.font = "bold 36px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(15,23,42,0.6)";
      ctx.strokeText(String(sc), W / 2, 60);
      ctx.fillStyle = "#fff";
      ctx.fillText(String(sc), W / 2, 60);
    }

    // Overlays
    if (st === "ready" || st === "over") {
      ctx.fillStyle = "rgba(15,23,42,0.35)";
      ctx.fillRect(40, 130, W - 80, 180);
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      if (st === "ready") {
        ctx.font = "bold 28px system-ui, sans-serif";
        ctx.fillText("Flappy Bird", W / 2, 175);
        ctx.font = "16px system-ui, sans-serif";
        ctx.fillText("Tap or press Space", W / 2, 215);
        ctx.fillText("to start", W / 2, 240);
      } else {
        ctx.font = "bold 26px system-ui, sans-serif";
        ctx.fillText("Game Over", W / 2, 165);
        ctx.font = "bold 40px system-ui, sans-serif";
        ctx.fillText(String(sc), W / 2, 220);
        ctx.font = "16px system-ui, sans-serif";
        ctx.fillText("Tap to play again", W / 2, 268);
      }
    }
  };

  return (
    <View class="flex flex-col items-center gap-3 p-3">
      <View onPress={act} activeOpacity={0.9} class="rounded-xl overflow-hidden">
        <Canvas draw={draw} style={{ width: W, height: H }} />
      </View>
      <View class="flex flex-row justify-between w-full px-2">
        <Text class="text-sm font-semibold text-gray-700">Score: {score()}</Text>
        <Text class="text-sm font-semibold text-gray-700">Best: {best()}</Text>
        <Text class="text-sm font-semibold text-gray-700">Plays: {plays()}</Text>
      </View>
    </View>
  );
}