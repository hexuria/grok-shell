import { signal, Text, View } from "nsh";

const W = 10, H = 14, C = 24;
type Cell = [number, number];
type Piece = { cells: Cell[]; c: number; x: number; y: number };

const SHAPES: Cell[][] = [
  [[0,0],[1,0],[2,0],[3,0]],
  [[0,0],[1,0],[0,1],[1,1]],
  [[1,0],[0,1],[1,1],[2,1]],
  [[0,0],[0,1],[1,1],[2,1]],
  [[2,0],[0,1],[1,1],[2,1]],
  [[1,0],[2,0],[0,1],[1,1]],
  [[0,0],[1,0],[1,1],[2,1]],
];
const COLORS: string[] = ["#0f172a", "#22d3ee", "#facc15", "#a855f7", "#f97316", "#2563eb", "#22c55e", "#ef4444"];

export default function R() {
  const board = signal<number[]>(new Array<number>(W * H).fill(0));
  const cur = signal<Piece | null>(null);
  const score = signal<number>(0);
  const over = signal<boolean>(false);

  const fits = (cells: Cell[], x: number, y: number, b: number[]): boolean =>
    cells.every(([cx, cy]: Cell) => {
      const nx = x + cx, ny = y + cy;
      return nx >= 0 && nx < W && ny >= 0 && ny < H && b[ny * W + nx] === 0;
    });

  const spawn = (): void => {
    const k = Math.floor(Math.random() * SHAPES.length);
    const p: Piece = { cells: SHAPES[k], c: k + 1, x: 3, y: 0 };
    if (!fits(p.cells, p.x, p.y, board())) { over.set(true); cur.set(null); return; }
    cur.set(p);
  };

  const lock = (): void => {
    const p = cur();
    if (!p) return;
    const b = [...board()];
    p.cells.forEach(([cx, cy]: Cell) => { b[(p.y + cy) * W + p.x + cx] = p.c; });
    const rows: number[][] = [];
    for (let y = 0; y < H; y++) {
      const r = b.slice(y * W, (y + 1) * W);
      if (r.some((v: number) => v === 0)) rows.push(r);
    }
    const cleared = H - rows.length;
    while (rows.length < H) rows.unshift(new Array<number>(W).fill(0));
    board.set(rows.flat());
    score.update((s: number) => s + 1 + cleared * 10);
    spawn();
  };

  const step = (dx: number, dy: number): boolean => {
    const p = cur();
    if (!p || over()) return false;
    if (fits(p.cells, p.x + dx, p.y + dy, board())) {
      cur.set({ ...p, x: p.x + dx, y: p.y + dy });
      return true;
    }
    return false;
  };

  const down = (): void => { if (!step(0, 1)) lock(); };
  const left = (): void => { step(-1, 0); };
  const right = (): void => { step(1, 0); };
  const drop = (): void => { while (step(0, 1)) {} lock(); };

  const rotate = (): void => {
    const p = cur();
    if (!p || over()) return;
    let cells: Cell[] = p.cells.map(([x, y]: Cell): Cell => [-y, x]);
    const mx = Math.min(...cells.map((c: Cell) => c[0]));
    const my = Math.min(...cells.map((c: Cell) => c[1]));
    cells = cells.map(([x, y]: Cell): Cell => [x - mx, y - my]);
    if (fits(cells, p.x, p.y, board())) cur.set({ ...p, cells });
  };

  const reset = (): void => {
    board.set(new Array<number>(W * H).fill(0));
    score.set(0);
    over.set(false);
    spawn();
  };

  const view = (): number[] => {
    const b = [...board()];
    const p = cur();
    if (p) p.cells.forEach(([cx, cy]: Cell) => { b[(p.y + cy) * W + p.x + cx] = p.c; });
    return b;
  };

  spawn();

  const btn = (label: string, fn: () => void) => (
    <View onPress={fn} activeOpacity={0.7} class="flex-1 items-center py-2 rounded-lg bg-slate-700">
      <Text class="text-white font-semibold">{label}</Text>
    </View>
  );

  return (
    <View class="flex flex-col gap-3 p-4 rounded-xl bg-slate-900">
      <View class="flex flex-row justify-between items-center">
        <Text class="text-white font-bold text-lg">Tetris</Text>
        <Text class="text-cyan-400 font-semibold">Score {score()}</Text>
      </View>

      <View style={{
        flexDirection: "row",
        flexWrap: "wrap",
        width: W * C,
        height: H * C,
        alignSelf: "center",
        backgroundColor: "#0f172a",
        borderRadius: 6,
        overflow: "hidden",
      }}>
        <Each of={view()}>
          {(v: any) => (
            <View style={{
              width: C,
              height: C,
              borderWidth: 1,
              borderColor: "#1e293b",
              backgroundColor: COLORS[v()],
            }} />
          )}
        </Each>
      </View>

      <If when={over()}>
        <View class="flex flex-col items-center gap-2">
          <Text class="text-red-400 font-bold">Game over</Text>
          {btn("Restart", reset)}
        </View>
      </If>

      <If when={!over()}>
        <View class="flex flex-row gap-2">
          {btn("←", left)}
          {btn("⟳", rotate)}
          {btn("→", right)}
          {btn("↓", down)}
          {btn("⤓", drop)}
        </View>
      </If>
    </View>
  );
}