import { signal, Text, View } from "nsh";

export default function R() {
  const liked = signal(false);
  return (
    <View class="gap-2 py-1">
      <Text class="text-sm text-zinc-700">{"You asked for: Build a fully playable, polished Snake mini-game.\n\nThe player controls a snake that moves around a grid, eats food, grows longer, and earns points. The game ends when the snake hits a wall or itself.\n\nRequirements:\n- Smooth, responsive movement with arrow keys or WASD.\n- Support touch and swipe controls.\n- Food spawns randomly without overlapping the snake.\n- Snake grows longer each time it eats.\n- Gradually increase difficulty as the score rises.\n- Display current score and best score.\n- Save high scores between sessions.\n- Include start, pause, game-over, and restart functionality.\n- Prevent illegal 180-degree turns.\n- Add occasional bonus food for extra points.\n- Include satisfying sound effects and subtle animations.\n- Use a modern neon arcade aesthetic with a dark background, glowing snake, and animated food.\n- Ensure the game works smoothly across different window sizes.\n\nMake the game visually appealing, lightweight, responsive, and genuinely fun to play.\n\nDeliver a complete, working game, not a mockup. Follow the project's existing architecture and conventions."}</Text>
      <View onPress={() => liked.update((v) => !v)} activeOpacity={0.6} class="self-start rounded-lg bg-zinc-100 px-3 py-1.5">
        <Text class="text-sm">{liked() ? "♥ liked" : "♡ like"}</Text>
      </View>
    </View>
  );
}
