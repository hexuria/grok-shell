import { signal, Text, View, mount } from "nsh";

type Score = { X: number; O: number; draw: number };
type Key = "X" | "O" | "draw";

const S = "R121";
const LINES: number[][] = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

// Returns [winner, winningIndices] or null
function winnerOf(b: string[]): [string, number[]] | null {
  for (const [a, c, d] of LINES) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return [b[a], [a, c, d]];
  }
  return null;
}

export default function R() {
  const board = signal<string[]>(Array(9).fill(""));
  const turn = signal<string>("X");
  const over = signal<boolean>(false);
  const winLine = signal<number[]>([]);
  const status = signal<string>("X's turn");
  const score = signal<Score>({ X: 0, O: 0, draw: 0 });

  // Restore saved scores once on mount
  fetch(`http://127.0.0.1:8787/state/${S}`)
    .then(r => r.json())
    .then(d => {
      if (d && d.state) score.set({ X: d.state.X || 0, O: d.state.O || 0, draw: d.state.draw || 0 });
    })
    .catch(() => {});

  // Persist scores (never during render)
  function save(s: Score) {
    fetch(`http://127.0.0.1:8787/state/${S}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ X: s.X, O: s.O, draw: s.draw }),
    }).catch(() => {});
  }

  function bump(key: Key) {
    const cur = score();
    const s: Score = { ...cur, [key]: cur[key] + 1 };
    score.set(s);
    save(s);
  }

  function play(i: number) {
    if (over() || board()[i]) return; // ignore filled squares and finished games
    const b = [...board()];
    b[i] = turn();
    board.set(b);

    const w = winnerOf(b);
    if (w) {
      winLine.set(w[1]);
      over.set(true);
      status.set(`${w[0]} wins!`);
      bump(w[0] as Key);
    } else if (b.every(Boolean)) {
      over.set(true);
      status.set("It's a draw!");
      bump("draw");
    } else {
      const next = turn() === "X" ? "O" : "X";
      turn.set(next);
      status.set(`${next}'s turn`);
    }
  }

  function newGame() {
    board.set(Array(9).fill(""));
    turn.set("X");
    over.set(false);
    winLine.set([]);
    status.set("X's turn");
  }

  // Single square; highlighted when part of the winning line
  function cell(i: number) {
    const won = winLine().includes(i);
    const v = board()[i];
    return (
      <View
        onPress={() => play(i)}
        activeOpacity={0.7}
        class="w-20 h-20 rounded-lg items-center justify-center border border-black/10 dark:border-white/10"
        style={{ backgroundColor: won ? "#1680f3" : undefined }}
      >
        <Text
          class="text-3xl font-semibold"
          style={{ color: won ? "#ffffff" : v === "X" ? "#1680f3" : "#e5484d" }}
        >
          {v}
        </Text>
      </View>
    );
  }

  const ids: number[] = [0, 1, 2];

  return (
    <View class="items-center gap-4 p-4 bg-white dark:bg-[#161616] rounded-xl">
      <Text class="text-lg font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">Tic-Tac-Toe</Text>
      <Text class="text-sm text-[#1c1c1c99] dark:text-[#f5f5f599]">{status()}</Text>

      {/* 3x3 board */}
      <View class="gap-2">
        {ids.map((r: number) => (
          <View class="flex-row gap-2">
            {ids.map((c: number) => cell(r * 3 + c))}
          </View>
        ))}
      </View>

      {/* Running score */}
      <View class="flex-row gap-2 w-full">
        <View class="flex-1 items-center p-2 rounded-lg bg-[#f5f5f5] dark:bg-[#1f1f1f]">
          <Text class="text-xs text-[#1c1c1c99] dark:text-[#f5f5f599]">X wins</Text>
          <Text class="text-base font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">{score().X}</Text>
        </View>
        <View class="flex-1 items-center p-2 rounded-lg bg-[#f5f5f5] dark:bg-[#1f1f1f]">
          <Text class="text-xs text-[#1c1c1c99] dark:text-[#f5f5f599]">Draws</Text>
          <Text class="text-base font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">{score().draw}</Text>
        </View>
        <View class="flex-1 items-center p-2 rounded-lg bg-[#f5f5f5] dark:bg-[#1f1f1f]">
          <Text class="text-xs text-[#1c1c1c99] dark:text-[#f5f5f599]">O wins</Text>
          <Text class="text-base font-semibold text-[#1c1c1c] dark:text-[#f5f5f5]">{score().O}</Text>
        </View>
      </View>

      <View onPress={newGame} activeOpacity={0.7} class="px-4 py-2 rounded-md bg-[#1680f3]">
        <Text class="text-sm font-semibold text-white">New Game</Text>
      </View>
    </View>
  );
}