import { signal, effect, cleanup, Text, View } from "nsh";
import { Canvas } from "nsh/canvas";
import { keymap } from "nsh/keymap";

export const popoutWidth = 360;

const COLS = 10;
const ROWS = 20;
const COLORS = ["#000000", "#35d7ff", "#4f83ff", "#ff9c3a", "#ffd83d", "#55df83", "#bd70ff", "#ff5f72"];
const SHAPES = [
  [[0,1],[1,1],[2,1],[3,1]],
  [[0,0],[0,1],[1,1],[2,1]],
  [[2,0],[0,1],[1,1],[2,1]],
  [[1,0],[2,0],[1,1],[2,1]],
  [[1,0],[2,0],[0,1],[1,1]],
  [[1,0],[0,1],[1,1],[2,1]],
  [[0,0],[1,0],[1,1],[2,1]],
];

type Piece = { kind: number; x: number; y: number; rot: number };

function cells(kind: number, rot: number): number[][] {
  let out = SHAPES[kind].map(([x, y]) => [x, y]);
  for (let i = 0; i < rot; i++) out = out.map(([x, y]) => [3 - y, x]);
  return out;
}
function emptyBoard(): number[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}
function randomPiece(): Piece {
  return { kind: Math.floor(Math.random() * SHAPES.length), x: 3, y: 0, rot: 0 };
}

export default function R() {
  const board = signal(emptyBoard());
  const piece = signal(randomPiece());
  const score = signal(0);
  const best = signal(0);
  const plays = signal(0);
  const gameOver = signal(false);
  const paused = signal(false);
  const ready = signal(false);
  let snap = "";
  const S = "R124";

  const collides = (b: number[][], p: Piece, x = p.x, y = p.y, rot = p.rot) => {
    for (const [cx, cy] of cells(p.kind, rot)) {
      const bx = x + cx;
      const by = y + cy;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && b[by][bx] !== 0) return true;
    }
    return false;
  };

  const save = () => {
    const state = { best: best(), plays: plays(), widget: { kind: "stat", value: String(best()), label: "Tetris best score", sub: `${plays()} games started` } };
    snap = JSON.stringify(state);
    fetch(`http://127.0.0.1:8787/state/${S}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: snap,
    }).catch(() => {});
  };

  const startNewGame = () => {
    board.set(emptyBoard());
    score.set(0);
    piece.set(randomPiece());
    gameOver.set(false);
    paused.set(false);
    plays.set(plays() + 1);
    save();
  };

  const lockPiece = () => {
    const p = piece();
    const next = board().map(row => row.slice());
    for (const [cx, cy] of cells(p.kind, p.rot)) {
      const x = p.x + cx;
      const y = p.y + cy;
      if (y < 0) {
        gameOver.set(true);
        save();
        return;
      }
      if (y < ROWS && x >= 0 && x < COLS) next[y][x] = p.kind + 1;
    }
    const remaining = next.filter(row => row.some(v => v === 0));
    const cleared = ROWS - remaining.length;
    const compacted = Array.from({ length: cleared }, () => Array(COLS).fill(0)).concat(remaining);
    board.set(compacted);
    if (cleared) {
      const points = [0, 100, 300, 500, 800][cleared] || cleared * 200;
      const updated = score() + points;
      score.set(updated);
      if (updated > best()) best.set(updated);
    }
    const nextPiece = randomPiece();
    piece.set(nextPiece);
    if (collides(compacted, nextPiece)) gameOver.set(true);
    if (cleared || gameOver()) save();
  };

  const move = (dx: number, dy: number) => {
    if (gameOver() || paused()) return;
    const p = piece();
    if (!collides(board(), p, p.x + dx, p.y + dy)) {
      piece.set({ ...p, x: p.x + dx, y: p.y + dy });
    } else if (dy > 0) {
      lockPiece();
    }
  };

  const rotate = () => {
    if (gameOver() || paused()) return;
    const p = piece();
    const nextRot = (p.rot + 1) % 4;
    if (!collides(board(), p, p.x, p.y, nextRot)) piece.set({ ...p, rot: nextRot });
  };

  const hardDrop = () => {
    if (gameOver() || paused()) return;
    const p = piece();
    let y = p.y;
    while (!collides(board(), p, p.x, y + 1)) y++;
    piece.set({ ...p, y });
    lockPiece();
  };

  const togglePause = () => {
    if (!gameOver()) paused.set(!paused());
  };

  keymap.bind({
    left: () => move(-1, 0),
    right: () => move(1, 0),
    down: () => move(0, 1),
    up: rotate,
    space: hardDrop,
  }, { repeat: true });

  effect(() => {
    const t = setInterval(() => {
      if (!paused() && !gameOver()) move(0, 1);
    }, 650);
    cleanup(() => clearInterval(t));
  });

  effect(() => {
    let alive = true;
    fetch(`http://127.0.0.1:8787/state/${S}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        const s = d?.state;
        if (s && Object.keys(s).length) {
          best.set(Number(s.best) || 0);
          plays.set(Number(s.plays) || 0);
          snap = JSON.stringify(s);
        } else {
          plays.set(1);
          save();
        }
        ready.set(true);
      })
      .catch(() => ready.set(true));
    const t = setInterval(async () => {
      if (!ready()) return;
      try {
        const d = await fetch(`http://127.0.0.1:8787/state/${S}`).then(r => r.json());
        const s = d?.state || {};
        const nextSnap = JSON.stringify(s);
        if (nextSnap !== "{}" && nextSnap !== snap) {
          snap = nextSnap;
          best.set(Number(s.best) || 0);
          plays.set(Number(s.plays) || 0);
        }
      } catch {}
    }, 2000);
    cleanup(() => { alive = false; clearInterval(t); });
  });

  return (
    <View class="flex flex-col gap-3 p-3 rounded-2xl bg-white dark:bg-[#161616] min-h-96">
      <View class="flex flex-row items-center justify-between">
        <View class="flex flex-col">
          <Text class="text-lg font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">Tetris</Text>
          <Text class="text-xs text-[#1c1c1c99] dark:text-[#f5f5f599]">Arrow keys move · ↑ rotate · Space drop</Text>
        </View>
        <View class="flex flex-row gap-3">
          <View class="flex flex-col items-end">
            <Text class="text-xs text-[#1c1c1c99] dark:text-[#f5f5f599]">SCORE</Text>
            <Text class="text-base font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">{score()}</Text>
          </View>
          <View class="flex flex-col items-end">
            <Text class="text-xs text-[#1c1c1c99] dark:text-[#f5f5f599]">BEST</Text>
            <Text class="text-base font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">{best()}</Text>
          </View>
        </View>
      </View>

      <View class="self-center overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
        <Canvas style={{ width: 300, height: 600 }} draw={(ctx, size) => {
          const cell = Math.min(size.width / COLS, size.height / ROWS);
          const ox = (size.width - cell * COLS) / 2;
          const oy = (size.height - cell * ROWS) / 2;
          const b = board();
          const p = piece();
          ctx.clearRect(0, 0, size.width, size.height);
          ctx.fillStyle = "#080d1a";
          ctx.fillRect(ox, oy, cell * COLS, cell * ROWS);
          ctx.strokeStyle = "rgba(255,255,255,0.09)";
          ctx.lineWidth = 1;
          for (let x = 0; x <= COLS; x++) {
            ctx.beginPath(); ctx.moveTo(ox + x * cell, oy); ctx.lineTo(ox + x * cell, oy + ROWS * cell); ctx.stroke();
          }
          for (let y = 0; y <= ROWS; y++) {
            ctx.beginPath(); ctx.moveTo(ox, oy + y * cell); ctx.lineTo(ox + COLS * cell, oy + y * cell); ctx.stroke();
          }
          const paint = (x: number, y: number, color: string, ghost = false) => {
            if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
            ctx.fillStyle = color;
            ctx.globalAlpha = ghost ? 0.23 : 1;
            ctx.fillRect(ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2);
            if (!ghost) {
              ctx.fillStyle = "rgba(255,255,255,0.24)";
              ctx.fillRect(ox + x * cell + 2, oy + y * cell + 2, cell - 4, 3);
            }
            ctx.globalAlpha = 1;
          };
          for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (b[y][x]) paint(x, y, COLORS[b[y][x]]);
          if (!gameOver()) {
            let gy = p.y;
            while (!collides(b, p, p.x, gy + 1)) gy++;
            for (const [cx, cy] of cells(p.kind, p.rot)) paint(p.x + cx, gy + cy, COLORS[p.kind + 1], true);
            for (const [cx, cy] of cells(p.kind, p.rot)) paint(p.x + cx, p.y + cy, COLORS[p.kind + 1]);
          }
          if (gameOver() || paused()) {
            ctx.fillStyle = "rgba(4,8,18,0.78)";
            ctx.fillRect(ox, oy + cell * 7, cell * COLS, cell * 6);
            ctx.textAlign = "center";
            ctx.fillStyle = "#ffffff";
            ctx.font = "600 25px sans-serif";
            ctx.fillText(gameOver() ? "GAME OVER" : "PAUSED", ox + cell * COLS / 2, oy + cell * 10);
            ctx.font = "14px sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.78)";
            ctx.fillText(gameOver() ? "Tap New game to play again" : "Tap Resume when ready", ox + cell * COLS / 2, oy + cell * 11.1);
          }
        }} />
      </View>

      <View class="flex flex-row items-center justify-between">
        <Text class="text-xs text-[#1c1c1c99] dark:text-[#f5f5f599]">{plays()} games started · gravity every 0.65s</Text>
        <View onPress={togglePause} activeOpacity={0.7} class="px-3 py-2 rounded-lg bg-[#f5f5f5] dark:bg-[#1f1f1f] border border-black/10 dark:border-white/10">
          <Text class="text-sm font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">{paused() ? "Resume" : "Pause"}</Text>
        </View>
      </View>

      <View class="flex flex-row gap-2 justify-center">
        <View onPress={() => move(-1, 0)} activeOpacity={0.7} class="px-4 py-3 rounded-lg bg-[#f5f5f5] dark:bg-[#1f1f1f] border border-black/10 dark:border-white/10"><Text class="text-base font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">←</Text></View>
        <View onPress={() => move(0, 1)} activeOpacity={0.7} class="px-4 py-3 rounded-lg bg-[#f5f5f5] dark:bg-[#1f1f1f] border border-black/10 dark:border-white/10"><Text class="text-base font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">↓</Text></View>
        <View onPress={rotate} activeOpacity={0.7} class="px-4 py-3 rounded-lg bg-[#f5f5f5] dark:bg-[#1f1f1f] border border-black/10 dark:border-white/10"><Text class="text-base font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">↻</Text></View>
        <View onPress={() => move(1, 0)} activeOpacity={0.7} class="px-4 py-3 rounded-lg bg-[#f5f5f5] dark:bg-[#1f1f1f] border border-black/10 dark:border-white/10"><Text class="text-base font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">→</Text></View>
      </View>
      <View class="flex flex-row gap-2 justify-center">
        <View onPress={hardDrop} activeOpacity={0.7} class="px-5 py-2 rounded-lg bg-[#1680f3] dark:bg-[#1884fc]"><Text class="text-sm font-semibold text-white">Hard drop</Text></View>
        <View onPress={startNewGame} activeOpacity={0.7} class="px-5 py-2 rounded-lg bg-[#f5f5f5] dark:bg-[#1f1f1f] border border-black/10 dark:border-white/10"><Text class="text-sm font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">New game</Text></View>
      </View>
    </View>
  );
}