import { signal, effect, cleanup, Text, View } from "nsh";
import { Canvas } from "nsh/canvas";
import { keymap } from "nsh/keymap";

type P = { x: number; y: number };

const S = "R104";
const N = 16;
const CELL = 16;
const W = N * CELL;

export default function R() {
  const snake = signal<P[]>([{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }]);
  const food = signal<P>({ x: 12, y: 8 });
  const score = signal(0);
  const best = signal(0);
  const plays = signal(0);
  const status = signal("ready"); // ready | playing | paused | over

  let cur: P = { x: 1, y: 0 };
  let pending: P = { x: 1, y: 0 };
  let snap = "";

  function save() {
    const body = { best: best(), plays: plays() };
    snap = JSON.stringify(body);
    fetch(`http://127.0.0.1:8787/state/${S}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  function placeFood(s: P[]): P {
    let f: P;
    do {
      f = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
    } while (s.some((p: P) => p.x === f.x && p.y === f.y));
    return f;
  }

  function start() {
    const s: P[] = [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }];
    snake.set(s);
    food.set(placeFood(s));
    score.set(0);
    cur = { x: 1, y: 0 };
    pending = { x: 1, y: 0 };
    status.set("playing");
  }

  function over() {
    status.set("over");
    plays.update((v: number) => v + 1);
    if (score() > best()) best.set(score());
    save();
  }

  function tick() {
    if (status() !== "playing") return;
    cur = pending;
    const s: P[] = snake();
    const head: P = { x: s[0].x + cur.x, y: s[0].y + cur.y };
    if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N) return over();
    const f: P = food();
    const eat = head.x === f.x && head.y === f.y;
    const body: P[] = eat ? s : s.slice(0, -1);
    if (body.some((p: P) => p.x === head.x && p.y === head.y)) return over();
    const next: P[] = [head, ...s];
    if (!eat) next.pop();
    snake.set(next);
    if (eat) {
      score.update((v: number) => v + 1);
      food.set(placeFood(next));
    }
  }

  function turn(dx: number, dy: number) {
    if (dx === -cur.x && dy === -cur.y) return;
    if (status() === "ready" || status() === "over") start();
    if (status() === "playing") pending = { x: dx, y: dy };
  }

  function toggle() {
    if (status() === "ready" || status() === "over") start();
    else if (status() === "playing") status.set("paused");
    else if (status() === "paused") status.set("playing");
  }

  keymap.bind(
    {
      left: () => turn(-1, 0),
      right: () => turn(1, 0),
      up: () => turn(0, -1),
      down: () => turn(0, 1),
      space: () => toggle(),
    },
    { repeat: false }
  );

  // Game loop
  effect(() => {
    const t = setInterval(tick, 130);
    cleanup(() => clearInterval(t));
  });

  // Restore best score
  fetch(`http://127.0.0.1:8787/state/${S}`)
    .then((r) => r.json())
    .then((d: any) => {
      if (d && d.state) {
        best.set(d.state.best || 0);
        plays.set(d.state.plays || 0);
        snap = JSON.stringify({ best: best(), plays: plays() });
      }
    })
    .catch(() => {});

  // Sync across surfaces
  effect(() => {
    const t = setInterval(async () => {
      try {
        const d: any = await fetch(`http://127.0.0.1:8787/state/${S}`).then((r) => r.json());
        const s = JSON.stringify(d?.state || {});
        if (s !== "{}" && s !== snap && d.state) {
          snap = s;
          best.set(d.state.best || 0);
          plays.set(d.state.plays || 0);
        }
      } catch {}
    }, 2000);
    cleanup(() => clearInterval(t));
  });

  const msg = () => {
    const st = status();
    if (st === "ready") return "Press an arrow or Start";
    if (st === "paused") return "Paused · press space";
    if (st === "over") return `Game over · score ${score()}`;
    return "Eat the red food";
  };

  return (
    <View class="flex flex-col items-center gap-3 p-4 rounded-xl bg-slate-900">
      <View class="flex flex-row justify-between w-full">
        <View class="flex flex-col items-start">
          <Text class="text-slate-400 text-xs font-bold">SCORE</Text>
          <Text class="text-white text-xl font-bold">{score()}</Text>
        </View>
        <View class="flex flex-col items-center">
          <Text class="text-slate-400 text-xs font-bold">PLAYS</Text>
          <Text class="text-slate-200 text-base font-bold">{plays()}</Text>
        </View>
        <View class="flex flex-col items-end">
          <Text class="text-slate-400 text-xs font-bold">BEST</Text>
          <Text class="text-amber-400 text-xl font-bold">{best()}</Text>
        </View>
      </View>

      <View class="rounded-lg overflow-hidden border border-slate-700">
        <Canvas
          style={{ width: W, height: W }}
          draw={(ctx: any) => {
            const sn: P[] = snake();
            const f: P = food();
            ctx.fillStyle = "#0f172a";
            ctx.fillRect(0, 0, W, W);
            ctx.fillStyle = "#f43f5e";
            ctx.fillRect(f.x * CELL + 2, f.y * CELL + 2, CELL - 4, CELL - 4);
            sn.forEach((p: P, i: number) => {
              ctx.fillStyle = i === 0 ? "#4ade80" : "#22c55e";
              ctx.fillRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2);
            });
          }}
        />
      </View>

      <Text class="text-slate-300 text-sm">{msg()}</Text>

      <View class="flex flex-row items-center gap-6">
        <View class="flex flex-col items-center gap-2">
          <View onPress={() => turn(0, -1)} activeOpacity={0.7} class="w-12 h-12 rounded-lg bg-slate-700 items-center justify-center">
            <Text class="text-white text-lg font-bold">▲</Text>
          </View>
          <View class="flex flex-row gap-2">
            <View onPress={() => turn(-1, 0)} activeOpacity={0.7} class="w-12 h-12 rounded-lg bg-slate-700 items-center justify-center">
              <Text class="text-white text-lg font-bold">◀</Text>
            </View>
            <View onPress={() => turn(0, 1)} activeOpacity={0.7} class="w-12 h-12 rounded-lg bg-slate-700 items-center justify-center">
              <Text class="text-white text-lg font-bold">▼</Text>
            </View>
            <View onPress={() => turn(1, 0)} activeOpacity={0.7} class="w-12 h-12 rounded-lg bg-slate-700 items-center justify-center">
              <Text class="text-white text-lg font-bold">▶</Text>
            </View>
          </View>
        </View>

        <View onPress={toggle} activeOpacity={0.7} class="px-4 py-3 rounded-lg bg-emerald-500">
          <Text class="text-white font-bold">
            {status() === "playing" ? "Pause" : status() === "paused" ? "Resume" : "Start"}
          </Text>
        </View>
      </View>
    </View>
  );
}