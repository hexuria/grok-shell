import { signal, effect, cleanup, Text, View } from "nsh";
import { Canvas } from "nsh/canvas";

type Piece = { m: number[][]; k: number; x: number; y: number };

const W = 10, H = 20, CELL = 14;
const COLORS = ["#0f172a", "#22d3ee", "#facc15", "#a855f7", "#4ade80", "#f87171", "#60a5fa", "#fb923c"];
const SHAPES: number[][][] = [
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
  [[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
  [[0,1,1,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]],
  [[1,1,0,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
  [[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
  [[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
];

const rot = (m: number[][]): number[][] =>
  m[0].map((_: number, c: number) => m.map((r: number[]) => r[c]).reverse());

const randPiece = (): Piece => {
  const k = Math.floor(Math.random() * 7);
  return { m: SHAPES[k], k: k + 1, x: 3, y: 0 };
};

const collide = (m: number[][], x: number, y: number, b: number[]): boolean => {
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    if (!m[i][j]) continue;
    const nx = x + j, ny = y + i;
    if (nx < 0 || nx >= W || ny >= H) return true;
    if (ny >= 0 && b[ny * W + nx]) return true;
  }
  return false;
};

const merge = (p: Piece, b: number[]): { nb: number[]; n: number } => {
  const nb = b.slice();
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    if (!p.m[i][j]) continue;
    const ny = p.y + i, nx = p.x + j;
    if (ny >= 0) nb[ny * W + nx] = p.k;
  }
  const out: number[] = [];
  let cleared = 0;
  for (let r = 0; r < H; r++) {
    const row = nb.slice(r * W, r * W + W);
    if (row.every((v: number) => v)) cleared++;
    else out.push(...row);
  }
  const empty: number[] = Array(cleared * W).fill(0);
  return { nb: [...empty, ...out], n: cleared };
};

export default function R() {
  const board = signal<number[]>(Array(W * H).fill(0));
  const cur = signal<Piece>(randPiece());
  const score = signal(0);
  const lines = signal(0);
  const over = signal(false);

  const land = (p: Piece, b: number[]) => {
    const { nb, n } = merge(p, b);
    board.set(nb);
    if (n) {
      score.update((s: number) => s + [0, 100, 300, 500, 800][n]);
      lines.update((l: number) => l + n);
    }
    const np = randPiece();
    if (collide(np.m, np.x, np.y, nb)) over.set(true);
    else cur.set(np);
  };

  const tick = () => {
    if (over()) return;
    const p: Piece = cur();
    const b: number[] = board();
    if (!collide(p.m, p.x, p.y + 1, b)) cur.set({ ...p, y: p.y + 1 });
    else land(p, b);
  };

  const move = (dx: number) => {
    if (over()) return;
    const p: Piece = cur();
    if (!collide(p.m, p.x + dx, p.y, board())) cur.set({ ...p, x: p.x + dx });
  };

  const rotate = () => {
    if (over()) return;
    const p: Piece = cur();
    const b: number[] = board();
    const nm = rot(p.m);
    for (const k of [0, -1, 1, -2, 2]) {
      if (!collide(nm, p.x + k, p.y, b)) {
        cur.set({ ...p, m: nm, x: p.x + k });
        return;
      }
    }
  };

  const drop = () => {
    if (over()) return;
    const p: Piece = cur();
    const b: number[] = board();
    let y = p.y;
    while (!collide(p.m, p.x, y + 1, b)) y++;
    land({ ...p, y }, b);
  };

  const restart = () => {
    board.set(Array(W * H).fill(0));
    score.set(0);
    lines.set(0);
    over.set(false);
    cur.set(randPiece());
  };

  effect(() => {
    const t = setInterval(tick, 500);
    cleanup(() => clearInterval(t));
  });

  return (
    <View class="flex-col items-center gap-3 p-4 bg-slate-900 rounded-2xl">
      <View class="flex-row justify-between items-center w-full">
        <Text class="text-white font-bold text-lg">Tetris</Text>
        <Text class="text-slate-400 text-sm">{`Score ${score()} · Lines ${lines()}`}</Text>
      </View>

      <Canvas
        style={{ width: W * CELL, height: H * CELL }}
        draw={(ctx) => {
          const b: number[] = board();
          const p: Piece = cur();
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(0, 0, W * CELL, H * CELL);
          const cell = (x: number, y: number, v: number) => {
            ctx.fillStyle = COLORS[v];
            ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
          };
          for (let i = 0; i < W * H; i++) {
            if (b[i]) cell(i % W, Math.floor(i / W), b[i]);
          }
          for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
            if (p.m[i][j] && p.y + i >= 0) cell(p.x + j, p.y + i, p.k);
          }
          if (over()) {
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillRect(0, 0, W * CELL, H * CELL);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 14px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Game over", (W * CELL) / 2, (H * CELL) / 2);
          }
        }}
      />

      <View class="flex-row gap-2 w-full">
        <View onPress={() => move(-1)} activeOpacity={0.7} class="flex-1 py-2 rounded-lg bg-slate-700 items-center">
          <Text class="text-white">←</Text>
        </View>
        <View onPress={rotate} activeOpacity={0.7} class="flex-1 py-2 rounded-lg bg-slate-700 items-center">
          <Text class="text-white">⟳</Text>
        </View>
        <View onPress={() => move(1)} activeOpacity={0.7} class="flex-1 py-2 rounded-lg bg-slate-700 items-center">
          <Text class="text-white">→</Text>
        </View>
        <View onPress={drop} activeOpacity={0.7} class="flex-1 py-2 rounded-lg bg-cyan-500 items-center">
          <Text class="text-slate-900 font-bold">Drop</Text>
        </View>
      </View>

      <If when={over()}>
        <View onPress={restart} activeOpacity={0.7} class="w-full py-2 rounded-lg bg-emerald-500 items-center">
          <Text class="text-slate-900 font-bold">Play again</Text>
        </View>
      </If>
    </View>
  );
}